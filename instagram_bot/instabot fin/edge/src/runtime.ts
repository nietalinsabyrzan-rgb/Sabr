import { join } from "node:path";
import { config } from "./config.js";
import { DedupStore } from "./dedup.js";
import { AuditLog } from "./audit.js";
import { TokenStore } from "./token-store.js";

// Config-wired singletons shared across modules. Kept out of the individual
// modules so their classes stay constructible in tests without env vars.
export const dedupStore = new DedupStore(
  join(config.dataDir, "processed-events.txt"),
);

export const auditLog = new AuditLog(
  join(config.dataDir, "audit"),
  config.auditRetentionDays,
);

export const tokenStore = new TokenStore(
  join(config.dataDir, "ig-token.json"),
  config.igAccessToken,
);
