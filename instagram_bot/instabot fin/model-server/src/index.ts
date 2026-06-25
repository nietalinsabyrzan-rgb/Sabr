import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { config } from "./config.js";
import { activeChatModel, embeddingCacheKey } from "./config.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { chunkKnowledge, knowledgeCacheKey, RagIndex } from "./rag.js";
import { chatCompletion, embedTexts, ollamaReachable } from "./openai.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  FALLBACK_REPLY,
  type Surface,
} from "./prompt.js";
import { detectLanguage, type Lang } from "./language.js";
import { KAZAKH_QUALITY_FALLBACK, kazakhQualityIssues } from "./reply-quality.js";
import { GREETING_REPLY, isGreetingOnly } from "./simple-replies.js";
import { CLARIFY_REPLY, shouldAskClarifyingQuestion } from "./clarify.js";

const knowledge = readFileSync(config.knowledgePath, "utf8");
const chunks = chunkKnowledge(knowledge, config.ragChunkSize, config.ragChunkOverlap);
const index = new RagIndex(
  chunks,
  embedTexts,
  join(config.dataDir, "rag-cache.json"),
  knowledgeCacheKey(knowledge, embeddingCacheKey),
);

// Build the index in the background and keep retrying.
// /readyz stays 503 until done.
async function buildIndexWithRetry() {
  for (;;) {
    try {
      await index.build();
      logger.info("rag index built", { chunks: index.chunkCount });
      return;
    } catch (err) {
      logger.error("rag index build failed, retrying in 30s", { error: String(err) });
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}
void buildIndexWithRetry();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

app.get("/readyz", async (_req, res) => {
  const providerOk = await ollamaReachable();
  const ready = index.ready && providerOk;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not ready",
    ragIndex: index.ready ? `built (${index.chunkCount} chunks)` : "building",
    provider: config.llmProvider,
    providerStatus: providerOk ? "reachable" : "unreachable",
    model: activeChatModel,
    embedModel: config.embedModel,
  });
});

app.get("/metrics", (_req, res) => res.json(metrics.snapshot()));

app.post("/generate-reply", async (req, res) => {
  const { surface, userMessage, username, languageHint } = req.body ?? {};
  if (
    (surface !== "comment" && surface !== "dm") ||
    typeof userMessage !== "string" ||
    !userMessage.trim() ||
    (languageHint !== undefined && languageHint !== "kk" && languageHint !== "ru")
  ) {
    res.status(400).json({
      error:
        "expected { surface: 'comment'|'dm', userMessage: string, username?, languageHint?: 'kk'|'ru' }",
    });
    return;
  }
  if (!index.ready) {
    res.status(503).json({ error: "rag index still building, retry shortly" });
    return;
  }

  const started = Date.now();
  try {
    const language = (languageHint ?? detectLanguage(userMessage)) as Lang;
    if (isGreetingOnly(userMessage)) {
      const elapsedMs = Date.now() - started;
      const reply = GREETING_REPLY[language][surface as Surface];
      metrics.inc("replies_generated");
      metrics.inc(`replies_generated_${language}`);
      metrics.inc("simple_greeting_replies");
      metrics.observeLatency("generate_ms", elapsedMs);
      logger.info("simple greeting reply generated", {
        surface,
        language,
        elapsedMs,
        replyChars: reply.length,
      });
      res.json({
        reply,
        meta: {
          language,
          elapsedMs,
          retrieved: [],
          simpleReply: "greeting",
        },
      });
      return;
    }
    if (shouldAskClarifyingQuestion(userMessage)) {
      const elapsedMs = Date.now() - started;
      const reply = CLARIFY_REPLY[language][surface as Surface];
      metrics.inc("clarifying_replies");
      metrics.inc(`clarifying_replies_${language}`);
      metrics.observeLatency("generate_ms", elapsedMs);
      logger.info("clarifying reply generated before retrieval", {
        surface,
        language,
        elapsedMs,
        replyChars: reply.length,
      });
      res.json({
        reply,
        meta: {
          language,
          elapsedMs,
          retrieved: [],
          simpleReply: "clarify",
        },
      });
      return;
    }

    const scoredRelevant = await index.retrieveScored(userMessage, config.ragTopK);
    const topScore = scoredRelevant[0]?.score ?? 0;
    if (topScore < config.ragMinScore) {
      const elapsedMs = Date.now() - started;
      const reply = CLARIFY_REPLY[language][surface as Surface];
      metrics.inc("clarifying_replies");
      metrics.inc(`clarifying_replies_${language}`);
      metrics.inc("clarifying_replies_low_rag_score");
      metrics.observeLatency("generate_ms", elapsedMs);
      logger.info("clarifying reply generated after low retrieval score", {
        surface,
        language,
        elapsedMs,
        topScore,
        minScore: config.ragMinScore,
        replyChars: reply.length,
      });
      res.json({
        reply,
        meta: {
          language,
          elapsedMs,
          retrieved: scoredRelevant.map(({ chunk, score }) => ({
            id: chunk.id,
            heading: chunk.heading,
            score,
          })),
          simpleReply: "clarify",
          topScore,
        },
      });
      return;
    }

    const relevant = scoredRelevant.map(({ chunk }) => chunk);
    let reply = await chatCompletion({
      system: buildSystemPrompt(relevant),
      user: buildUserPrompt({
        surface: surface as Surface,
        userMessage,
        username,
        languageHint: language,
      }),
    });
    if (language === "kk") {
      const qualityIssues = kazakhQualityIssues(reply);
      if (qualityIssues.length > 0) {
        logger.warn("kazakh reply failed quality gate, using fallback", {
          surface,
          qualityIssues,
          replyPreview: reply.slice(0, 160),
        });
        reply = KAZAKH_QUALITY_FALLBACK[surface as Surface];
      }
    }
    const elapsedMs = Date.now() - started;
    const retrieved = relevant.map((chunk) => ({
      id: chunk.id,
      heading: chunk.heading,
      score: scoredRelevant.find(({ chunk: scoredChunk }) => scoredChunk.id === chunk.id)?.score,
    }));

    metrics.inc("replies_generated");
    metrics.inc(`replies_generated_${language}`);
    metrics.observeLatency("generate_ms", elapsedMs);
    logger.info("reply generated", {
      surface,
      language,
      elapsedMs,
      replyChars: reply.length,
      retrieved,
    });
    res.json({
      reply:
        reply ||
        FALLBACK_REPLY[language][surface as Surface],
      meta: {
        language,
        elapsedMs,
        retrieved,
      },
    });
  } catch (err) {
    metrics.inc("generate_failures");
    logger.error("generate-reply failed", { error: String(err) });
    res.status(502).json({ error: "generation failed" });
  }
});

app.listen(config.port, () => {
  logger.info("model server listening", {
    port: config.port,
    provider: config.llmProvider,
    model: activeChatModel,
    embedModel: config.embedModel,
    chunks: chunks.length,
  });
});
