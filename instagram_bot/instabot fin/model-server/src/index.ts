import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { config } from "./config.js";
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

const knowledge = readFileSync(config.knowledgePath, "utf8");
const chunks = chunkKnowledge(knowledge, config.ragChunkSize, config.ragChunkOverlap);
const index = new RagIndex(
  chunks,
  embedTexts,
  join(config.dataDir, "rag-cache.json"),
  knowledgeCacheKey(knowledge, config.embedModel),
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
  const openaiOk = await ollamaReachable(); // reused name, checks OpenAI
  const ready = index.ready && openaiOk;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not ready",
    ragIndex: index.ready ? `built (${index.chunkCount} chunks)` : "building",
    openai: openaiOk ? "reachable" : "unreachable",
    model: config.openaiModel,
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
    const relevant = await index.retrieve(userMessage, config.ragTopK);
    const reply = await chatCompletion({
      system: buildSystemPrompt(relevant),
      user: buildUserPrompt({
        surface: surface as Surface,
        userMessage,
        username,
        languageHint: language,
      }),
    });
    const elapsedMs = Date.now() - started;
    const retrieved = relevant.map((chunk) => ({
      id: chunk.id,
      heading: chunk.heading,
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
    model: config.openaiModel,
    embedModel: config.embedModel,
    chunks: chunks.length,
  });
});
