import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { redactSensitive } from "./redact.js";
import { logger } from "./logger.js";

export interface AuditEntry {
  direction: "in" | "out";
  surface: "comment" | "dm";
  peerId?: string;
  username?: string;
  text: string;
  flag?: string;
  language?: "kk" | "ru";
  replyChars?: number;
  model?: {
    elapsedMs?: number;
    retrieved?: Array<{ id: number; heading: string }>;
  };
  rateLimit?: {
    resetAt: string;
  };
}

// Compliance audit trail: every inbound message and outbound reply, one JSONL
// file per day. Text is redacted (ИИН, card numbers, codes) before it touches
// disk; raw sensitive values are never persisted.
export class AuditLog {
  constructor(
    private dir: string,
    private retentionDays: number,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  record(entry: AuditEntry) {
    const ts = new Date();
    const day = ts.toISOString().slice(0, 10);
    try {
      appendFileSync(
        join(this.dir, `audit-${day}.jsonl`),
        JSON.stringify({
          ts: ts.toISOString(),
          ...entry,
          text: redactSensitive(entry.text),
        }) + "\n",
      );
    } catch (err) {
      logger.error("audit write failed", { error: String(err) });
    }
  }

  /** Delete audit files older than the retention window. */
  prune() {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    for (const file of readdirSync(this.dir)) {
      const m = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
      if (!m) continue;
      if (new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) {
        try {
          unlinkSync(join(this.dir, file));
          logger.info("audit file pruned", { file });
        } catch (err) {
          logger.error("audit prune failed", { file, error: String(err) });
        }
      }
    }
  }
}
