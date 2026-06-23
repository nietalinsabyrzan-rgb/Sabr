import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RetryQueue } from "./queue.js";

test("processes jobs in order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "queue-"));
  const seen: number[] = [];
  const q = new RetryQueue<number>(
    async (n) => {
      seen.push(n);
    },
    { deadLetterPath: join(dir, "dead.jsonl") },
  );
  q.push(1);
  q.push(2);
  q.push(3);
  await sleep(50);
  assert.deepEqual(seen, [1, 2, 3]);
});

test("retries with backoff until success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "queue-"));
  let attempts = 0;
  const q = new RetryQueue<string>(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
    },
    { maxAttempts: 4, baseDelayMs: 10, deadLetterPath: join(dir, "dead.jsonl") },
  );
  q.push("job");
  await sleep(300);
  assert.equal(attempts, 3);
  assert.equal(q.pending, 0);
});

test("dead-letters after max attempts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "queue-"));
  const deadPath = join(dir, "dead.jsonl");
  let deadLettered: unknown = null;
  const q = new RetryQueue<{ id: string }>(
    async () => {
      throw new Error("permanent failure");
    },
    {
      maxAttempts: 2,
      baseDelayMs: 10,
      deadLetterPath: deadPath,
      onDeadLetter: (job) => {
        deadLettered = job;
      },
    },
  );
  q.push({ id: "x" });
  await sleep(300);
  assert.deepEqual(deadLettered, { id: "x" });
  const line = JSON.parse(readFileSync(deadPath, "utf8").trim());
  assert.equal(line.job.id, "x");
  assert.equal(line.attempts, 2);
  assert.match(line.error, /permanent failure/);
});
