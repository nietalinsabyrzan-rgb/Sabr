import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DedupStore } from "./dedup.js";

test("new IDs are accepted once, duplicates rejected", () => {
  const file = join(mkdtempSync(join(tmpdir(), "dedup-")), "seen.txt");
  const store = new DedupStore(file);
  assert.equal(store.markProcessed("c:1"), true);
  assert.equal(store.markProcessed("c:1"), false);
  assert.equal(store.markProcessed("m:1"), true);
});

test("processed IDs survive a restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "dedup-")), "seen.txt");
  const first = new DedupStore(file);
  first.markProcessed("c:42");
  first.markProcessed("m:abc");

  const reopened = new DedupStore(file);
  assert.equal(reopened.markProcessed("c:42"), false);
  assert.equal(reopened.markProcessed("m:abc"), false);
  assert.equal(reopened.markProcessed("c:43"), true);
});

test("store prunes to the configured bound", () => {
  const file = join(mkdtempSync(join(tmpdir(), "dedup-")), "seen.txt");
  const store = new DedupStore(file, 100, 50);
  for (let i = 0; i < 150; i++) store.markProcessed(`c:${i}`);
  assert.ok(store.size <= 101);
  // Recent IDs kept, oldest dropped.
  assert.equal(store.has("c:149"), true);
  assert.equal(store.has("c:0"), false);
});
