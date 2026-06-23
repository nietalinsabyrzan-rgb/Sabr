import { join } from "node:path";
import type { Request, Response } from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { dedupStore, auditLog } from "./runtime.js";
import { RetryQueue } from "./queue.js";
import {
  replyToComment,
  sendDirectMessage,
  getCommentText,
} from "./instagram.js";
import { generateReply, type Surface } from "./llm.js";
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

export function queueDepth(): number {
  return queue.pending;
}

export async function handleEvent(req: Request, res: Response) {
  // TODO(infosec): verify Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw
  // body with the app secret) and reject mismatches with 403. The raw body is
  // already captured as req.rawBody in index.ts. Implementation pending the
  // information-security review of webhook ingestion — do not expose this
  // endpoint to the internet without it.
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
  queue.push({
    surface: "dm",
    targetId: event.sender.id,
    text: msg.text,
  });
}

async function processJob(job: InboundJob) {
  let text = job.text;
  if (job.surface === "comment" && !text.trim()) {
    text = await getCommentText(job.targetId);
    if (!text.trim()) return;
  }

  if (!job.audited) {
    auditLog.record({
      direction: "in",
      surface: job.surface,
      peerId: job.targetId,
      username: job.username,
      text,
      ...(containsSensitive(text) ? { flag: "sensitive" } : {}),
    });
    job.audited = true;
  }

  let reply: string;
  if (containsSensitive(text)) {
    // Never forward raw sensitive data to the model; warn the user instead.
    metrics.inc("sensitive_blocked");
    reply = SENSITIVE_WARNING[detectLanguage(text)];
  } else {
    reply = await generateReply({
      surface: job.surface,
      userMessage: text,
      username: job.username,
    });
  }

  if (job.surface === "comment") {
    await replyToComment(job.targetId, reply);
  } else {
    await sendDirectMessage(job.targetId, reply);
  }

  auditLog.record({
    direction: "out",
    surface: job.surface,
    peerId: job.targetId,
    text: reply,
  });
  metrics.inc(`replies_sent_${job.surface}`);
  logger.info("reply sent", { surface: job.surface, targetId: job.targetId });
}
