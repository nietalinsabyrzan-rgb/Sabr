import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";

interface StoredToken {
  accessToken: string;
  refreshedAt: string;
}

// Instagram long-lived tokens expire after ~60 days. The store starts from the
// IG_ACCESS_TOKEN env value and persists each refreshed token so it survives
// restarts (env vars can't be rewritten by the process).
export class TokenStore {
  private stored: StoredToken | null = null;

  constructor(
    private filePath: string,
    private initialToken: string,
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    if (existsSync(filePath)) {
      try {
        this.stored = JSON.parse(readFileSync(filePath, "utf8"));
      } catch (err) {
        logger.error("token store unreadable, falling back to env token", {
          error: String(err),
        });
      }
    }
  }

  getToken(): string {
    return this.stored?.accessToken ?? this.initialToken;
  }

  /** Days since the last successful refresh; Infinity if never refreshed. */
  ageDays(): number {
    if (!this.stored) return Infinity;
    return (Date.now() - new Date(this.stored.refreshedAt).getTime()) / 86_400_000;
  }

  async refresh(graphHost: string): Promise<void> {
    const url =
      `${graphHost}/refresh_access_token` +
      `?grant_type=ig_refresh_token` +
      `&access_token=${encodeURIComponent(this.getToken())}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`refresh_access_token failed ${res.status}: ${text}`);
    }
    const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error(`refresh_access_token returned no token: ${text}`);
    }
    this.stored = {
      accessToken: data.access_token,
      refreshedAt: new Date().toISOString(),
    };
    writeFileSync(this.filePath, JSON.stringify(this.stored, null, 2));
    metrics.markTimestamp("token_last_refreshed");
    logger.info("instagram token refreshed", {
      expiresInDays: data.expires_in ? Math.round(data.expires_in / 86_400) : undefined,
    });
  }

  /** Refresh if the stored token is older than maxAgeDays (or never refreshed). */
  async refreshIfStale(graphHost: string, maxAgeDays: number): Promise<void> {
    if (this.ageDays() < maxAgeDays) return;
    try {
      await this.refresh(graphHost);
      metrics.inc("token_refresh_success");
    } catch (err) {
      // Loud failure: ops must rotate manually before the ~60-day expiry.
      metrics.inc("token_refresh_failure");
      logger.error("INSTAGRAM TOKEN REFRESH FAILED — bot will stop working when the token expires", {
        error: String(err),
        tokenAgeDays: Number.isFinite(this.ageDays()) ? Math.round(this.ageDays()) : null,
      });
    }
  }
}
