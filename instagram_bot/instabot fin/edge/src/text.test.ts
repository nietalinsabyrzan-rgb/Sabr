import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, clampText, DM_MAX, COMMENT_MAX } from "./text.js";

test("short text stays a single chunk", () => {
  assert.deepEqual(chunkText("Привет!"), ["Привет!"]);
});

test("long text splits into chunks within the DM limit", () => {
  const sentence = "Это предложение про депозиты Отбасы банка. ";
  const long = sentence.repeat(60); // ~2640 chars
  const chunks = chunkText(long);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.ok(c.length <= DM_MAX, `chunk too long: ${c.length}`);
    assert.ok(c.trim().length > 0);
  }
  // No content lost beyond whitespace at the joins.
  assert.equal(chunks.join("").replace(/\s+/g, ""), long.replace(/\s+/g, ""));
});

test("clampText leaves short comments untouched", () => {
  assert.equal(clampText("Короткий ответ."), "Короткий ответ.");
});

test("clampText cuts overlong comments at a sentence boundary", () => {
  const sentence = "Ставка по депозиту зависит от тарифа. ";
  const long = sentence.repeat(100); // ~3800 chars
  const clamped = clampText(long);
  assert.ok(clamped.length <= COMMENT_MAX, `clamped too long: ${clamped.length}`);
  assert.ok(clamped.endsWith("…"));
});
