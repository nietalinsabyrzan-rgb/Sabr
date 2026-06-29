import express from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { verify, handleEvent, queueDepth } from "./webhook.js";
import { modelServerHealthy } from "./llm.js";
import { auditLog, tokenStore } from "./runtime.js";

const app = express();
app.disable("x-powered-by");

// Keep the raw body: Meta's X-Hub-Signature-256 is an HMAC over the raw bytes,
// so the signature check (pending infosec review, see webhook.ts) needs it.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/", (_req, res) => res.send("Otbasy InstaBot edge is running"));
app.get("/webhook", verify);
app.post("/webhook", handleEvent);

// Liveness: the process is up.
app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

// Readiness: we can actually serve traffic (model server reachable).
app.get("/readyz", async (_req, res) => {
  const modelOk = await modelServerHealthy();
  const status = modelOk ? 200 : 503;
  res.status(status).json({
    status: modelOk ? "ready" : "degraded",
    modelServer: modelOk ? "reachable" : "unreachable",
    autoReplyEnabled: config.autoReplyEnabled,
    queueDepth: queueDepth(),
  });
});

app.get("/metrics", (_req, res) => {
  res.json({ ...metrics.snapshot(), queueDepth: queueDepth() });
});

// NOTE: the /privacy page was intentionally removed — in production the
// privacy policy is a legal-reviewed page on the bank's website.

const port = config.port;
const server = app.listen(port, () => {
  logger.info("edge listening", {
    port,
    autoReplyEnabled: config.autoReplyEnabled,
    modelServerUrl: config.modelServerUrl,
  });
  if (!config.autoReplyEnabled) {
    logger.warn("kill switch active: AUTO_REPLY_ENABLED=false — webhooks acknowledged, no replies sent");
  }
});

// Token auto-refresh is only for Instagram-Login long-lived tokens. Facebook
// Graph/Page tokens use a different lifecycle and should not hit this endpoint.
if (config.graphHost.includes("graph.instagram.com")) {
  void tokenStore.refreshIfStale(config.graphHost, config.tokenRefreshDays);
  setInterval(
    () => void tokenStore.refreshIfStale(config.graphHost, config.tokenRefreshDays),
    6 * 3_600_000,
  ).unref();
}

// Audit retention: prune old files daily.
auditLog.prune();
setInterval(() => auditLog.prune(), 24 * 3_600_000).unref();

function shutdown(signal: string) {
  logger.info("shutting down", { signal, queueDepth: queueDepth() });
  server.close(() => process.exit(0));
  // Give in-flight work a grace period, then exit hard.
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
