import { join } from "node:path";
import type { Request, Response } from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { dedupStore, auditLog } from "./runtime.js";
import { RetryQueue } from "./queue.js";
import { RateLimiter } from "./rate-limit.js";
import { verifyMetaSignature } from "./signature.js";
import { DmBatcher } from "./dm-batcher.js";
import {
  replyToComment,
  sendDirectMessage,
  getCommentText,
} from "./instagram.js";
import { generateReplyWithMeta, type GenerateReplyResult, type Surface } from "./llm.js";
import {
  containsSensitive,
  detectLanguage,
  SENSITIVE_WARNING,
} from "./redact.js";

export function verify(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    token === config.webhookVerifyToken
  ) {
    logger.info("webhook subscription verified");
    res.status(200).send(String(challenge ?? ""));
    return;
  }
  res.sendStatus(403);
}

interface InboundJob {
  surface: Surface;
  /** comment ID for comments, sender IG user ID for DMs */
  targetId: string;
  text: string;
  username?: string;
  /** set after the inbound audit record is written, so retries don't repeat it */
  audited?: boolean;
  batchSize?: number;
  messageIds?: string[];
}

const queue = new RetryQueue<InboundJob>(processJob, {
  maxAttempts: 4,
  baseDelayMs: 2_000,
  deadLetterPath: join(config.dataDir, "dead-letter.jsonl"),
  onDeadLetter: (job, error) => {
    metrics.inc("jobs_dead_lettered");
    logger.error("job dead-lettered after max retries", {
      job,
      error: error instanceof Error ? error.message : String(error),
    });
  },
});
const rateLimiter = new RateLimiter(config.rateLimitMaxEvents, config.rateLimitWindowMs);
setInterval(() => rateLimiter.prune(), config.rateLimitWindowMs).unref();
const dmBatcher = new DmBatcher(
  config.dmBatchDelayMs,
  config.dmBatchMaxMessages,
  (batch) => {
    metrics.inc("dm_batches_flushed");
    metrics.inc("dm_messages_batched", batch.messageIds.length);
    queue.push({
      surface: "dm",
      targetId: batch.senderId,
      text: batch.text,
      batchSize: batch.messageIds.length,
      messageIds: batch.messageIds,
    });
  },
);

export function queueDepth(): number {
  return queue.pending + dmBatcher.pendingConversations;
}

export async function handleEvent(req: Request, res: Response) {
  if (
    config.webhookSignatureRequired &&
    !verifyMetaSignature({
      appSecret: config.igAppSecret,
      rawBody: (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
      signatureHeader: req.headers["x-hub-signature-256"],
    })
  ) {
    metrics.inc("webhook_signature_rejected");
    logger.warn("webhook rejected: invalid Meta signature");
    res.sendStatus(403);
    return;
  }

  res.sendStatus(200);
  metrics.inc("webhook_events_received");

  if (!config.autoReplyEnabled) {
    metrics.inc("webhook_events_skipped_killswitch");
    logger.warn("AUTO_REPLY_ENABLED=false — event acknowledged but skipped");
    return;
  }

  try {
    const body = req.body;
    if (body?.object !== "instagram") {
      logger.warn("unknown webhook object", { object: body?.object });
      return;
    }

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === "comments") enqueueComment(change.value);
      }
      for (const msg of entry.messaging ?? []) {
        enqueueMessage(msg);
      }
    }
  } catch (err) {
    logger.error("webhook event parsing failed", { error: String(err) });
  }
}

interface CommentValue {
  id: string;
  text?: string;
  from?: { id: string; username?: string };
  media?: { id: string };
}

function enqueueComment(value: CommentValue) {
  if (!value?.id) return;
  if (value.from?.id && value.from.id === config.igUserId) return; // own comment
  if (!dedupStore.markProcessed(`c:${value.id}`)) {
    metrics.inc("events_deduplicated");
    return;
  }
  queue.push({
    surface: "comment",
    targetId: value.id,
    text: value.text ?? "",
    username: value.from?.username,
  });
}

interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
  };
}

function enqueueMessage(event: MessagingEvent) {
  const msg = event.message;
  if (!msg || msg.is_echo) return;
  if (!msg.mid || !msg.text?.trim()) return;
  if (event.sender.id === config.igUserId) return; // own message
  if (!dedupStore.markProcessed(`m:${msg.mid}`)) {
    metrics.inc("events_deduplicated");
    return;
  }
  dmBatcher.add(event.sender.id, msg.mid, msg.text);
  metrics.inc("dm_messages_buffered");
}

async function processJob(job: InboundJob) {
  let text = job.text;
  if (job.surface === "comment" && !text.trim()) {
    text = await getCommentText(job.targetId);
    if (!text.trim()) return;
  }

  if (!job.audited) {
    const language = detectLanguage(text);
    auditLog.record({
      direction: "in",
      surface: job.surface,
      peerId: job.targetId,
      username: job.username,
      text,
      language,
      ...(job.batchSize ? { flag: `batched:${job.batchSize}` } : {}),
      ...(containsSensitive(text) ? { flag: "sensitive" } : {}),
    });
    job.audited = true;
  }

  let reply: string;
  let result: GenerateReplyResult | undefined;
  let outAudited = false;
  const language = detectLanguage(text);
  const limit = rateLimiter.check(`${job.surface}:${job.targetId}`);
  if (!limit.allowed) {
    metrics.inc("events_rate_limited");
    reply = RATE_LIMIT_REPLY[language];
    auditLog.record({
      direction: "out",
      surface: job.surface,
      peerId: job.targetId,
      text: reply,
      language,
      flag: "rate_limited",
      rateLimit: { resetAt: limit.resetAt },
      replyChars: reply.length,
    });
    outAudited = true;
    logger.warn("reply rate-limited", {
      surface: job.surface,
      targetId: job.targetId,
      language,
      resetAt: limit.resetAt,
    });
  } else if (containsSensitive(text)) {
    // Never forward raw sensitive data to the model; warn the user instead.
    metrics.inc("sensitive_blocked");
    reply = SENSITIVE_WARNING[language];
  } else {
    result = await generateReplyWithMeta({
      surface: job.surface,
      userMessage: text,
      username: job.username,
      languageHint: language,
    });
    reply = result.reply;
  }

  if (job.surface === "comment") {
    await replyToComment(job.targetId, reply);
  } else {
    await sendDirectMessage(job.targetId, reply);
  }

  if (!outAudited) {
    auditLog.record({
      direction: "out",
      surface: job.surface,
      peerId: job.targetId,
      text: reply,
      language,
      replyChars: reply.length,
      ...(result?.meta ? { model: result.meta } : {}),
    });
  }
  metrics.inc(`replies_sent_${job.surface}`);
  logger.info("reply sent", {
    surface: job.surface,
    targetId: job.targetId,
    language,
    replyChars: reply.length,
    retrieved: result?.meta?.retrieved,
  });
}

const RATE_LIMIT_REPLY = {
  ru: "Получили несколько сообщений подряд. Пожалуйста, подождите немного — я отвечу на следующий вопрос чуть позже.",
  kk: "Қатарынан бірнеше хабарлама келді. Өтінеміз, сәл күтіңіз — келесі сұрағыңызға біраздан кейін жауап беремін.",
};
