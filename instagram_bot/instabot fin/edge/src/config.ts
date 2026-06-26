import "dotenv/config";

const missing: string[] = [];

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    missing.push(name);
    return "";
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    missing.push(`${name} (not a number: "${raw}")`);
    return fallback;
  }
  return n;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw !== "false" && raw !== "0" && raw !== "no";
}

const webhookSignatureRequired = optionalBoolean("WEBHOOK_SIGNATURE_REQUIRED", true);

export const config = {
  port: optionalNumber("PORT", 3000),

  igUserId: required("IG_USER_ID"),
  igAccessToken: required("IG_ACCESS_TOKEN"),
  webhookVerifyToken: required("IG_WEBHOOK_VERIFY_TOKEN"),
  igAppSecret: webhookSignatureRequired ? required("IG_APP_SECRET") : optional("IG_APP_SECRET", ""),
  webhookSignatureRequired,
  graphHost: optional("IG_GRAPH_HOST", "https://graph.instagram.com"),

  // Internal-LAN URL of the model server, e.g. http://10.0.0.5:8080
  modelServerUrl: normalizeUrl(required("MODEL_SERVER_URL")),
  // Must exceed the model server's GENERATE_TIMEOUT_MS (default 90s) so the
  // edge waits for the model server's own timeout/response instead of giving
  // up first and retrying into still-in-flight work (a retry storm).
  llmTimeoutMs: optionalNumber("LLM_TIMEOUT_MS", 100_000),

  // Kill switch: when false the webhook still returns 200 but nothing is
  // generated or sent. Flip and restart to silence the bot instantly.
  autoReplyEnabled:
    optional("AUTO_REPLY_ENABLED", "true").toLowerCase() !== "false",

  dataDir: optional("DATA_DIR", "data"),
  auditRetentionDays: optionalNumber("AUDIT_RETENTION_DAYS", 90),
  // Refresh the IG token when it is older than this many days (expiry ~60d).
  tokenRefreshDays: optionalNumber("IG_TOKEN_REFRESH_DAYS", 7),
  rateLimitMaxEvents: optionalNumber("RATE_LIMIT_MAX_EVENTS", 8),
  rateLimitWindowMs: optionalNumber("RATE_LIMIT_WINDOW_MS", 10 * 60_000),
  dmBatchDelayMs: optionalNumber("DM_BATCH_DELAY_MS", 12_000),
  dmBatchMaxMessages: optionalNumber("DM_BATCH_MAX_MESSAGES", 6),
  conversationMemoryTtlMs: optionalNumber("CONVERSATION_MEMORY_TTL_MS", 24 * 60 * 60_000),
  conversationMemoryMaxTurns: optionalNumber("CONVERSATION_MEMORY_MAX_TURNS", 5),
};

function normalizeUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

if (missing.length > 0) {
  console.error(
    `[config] missing/invalid required environment variables:\n` +
      missing.map((m) => `  - ${m}`).join("\n") +
      `\nSet them in the environment or .env (see .env.example) and restart.`,
  );
  process.exit(1);
}
