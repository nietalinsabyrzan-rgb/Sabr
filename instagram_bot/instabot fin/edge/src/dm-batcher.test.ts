import { test } from "node:test";
import assert from "node:assert/strict";
import { DmBatcher, type DmBatch } from "./dm-batcher.js";

test("combines several DM messages from one sender", () => {
  const batches: DmBatch[] = [];
  const batcher = new DmBatcher(1_000, 5, (batch) => batches.push(batch));

  batcher.add("u1", "m1", "здравствуйте");
  batcher.add("u1", "m2", "у меня есть вопрос");
  batcher.add("u1", "m3", "какая ставка?");
  batcher.flushSender("u1");

  assert.deepEqual(batches, [
    {
      senderId: "u1",
      messageIds: ["m1", "m2", "m3"],
      text: "здравствуйте\nу меня есть вопрос\nкакая ставка?",
    },
  ]);
});

test("keeps different senders in different batches", () => {
  const batches: DmBatch[] = [];
  const batcher = new DmBatcher(1_000, 5, (batch) => batches.push(batch));

  batcher.add("u1", "m1", "one");
  batcher.add("u2", "m2", "two");
  batcher.flushSender("u1");
  batcher.flushSender("u2");

  assert.equal(batches.length, 2);
  assert.equal(batches[0].senderId, "u1");
  assert.equal(batches[1].senderId, "u2");
});

test("flushes immediately at max message count", () => {
  const batches: DmBatch[] = [];
  const batcher = new DmBatcher(1_000, 2, (batch) => batches.push(batch));

  batcher.add("u1", "m1", "first");
  batcher.add("u1", "m2", "second");

  assert.equal(batches.length, 1);
  assert.equal(batches[0].text, "first\nsecond");
});
