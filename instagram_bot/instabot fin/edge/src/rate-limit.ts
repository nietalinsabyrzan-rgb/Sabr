export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private maxEvents: number,
    private windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    const allowed = recent.length < this.maxEvents;
    if (allowed) recent.push(now);
    this.hits.set(key, recent);

    const oldest = recent[0] ?? now;
    return {
      allowed,
      remaining: Math.max(0, this.maxEvents - recent.length),
      resetAt: new Date(oldest + this.windowMs).toISOString(),
    };
  }

  prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    for (const [key, hits] of this.hits) {
      const recent = hits.filter((ts) => ts > cutoff);
      if (recent.length) this.hits.set(key, recent);
      else this.hits.delete(key);
    }
  }
}
