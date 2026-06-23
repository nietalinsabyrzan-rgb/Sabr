import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rate-limit.js";

test("allows only the configured number of events per window", () => {
  const limiter = new RateLimiter(2, 1_000);

  assert.equal(limiter.check("u1", 0).allowed, true);
  assert.equal(limiter.check("u1", 100).allowed, true);
  assert.equal(limiter.check("u1", 200).allowed, false);
  assert.equal(limiter.check("u1", 1_100).allowed, true);
});

test("rate limits are per key", () => {
  const limiter = new RateLimiter(1, 1_000);

  assert.equal(limiter.check("u1", 0).allowed, true);
  assert.equal(limiter.check("u1", 1).allowed, false);
  assert.equal(limiter.check("u2", 2).allowed, true);
});
