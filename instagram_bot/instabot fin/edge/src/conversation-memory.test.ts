import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationMemory, isDependentFollowUp } from "./conversation-memory.js";

test("detects short dependent follow-ups", () => {
  assert.equal(isDependentFollowUp("да"), true);
  assert.equal(isDependentFollowUp("а сколько?"), true);
  assert.equal(isDependentFollowUp("қалай?"), true);
  assert.equal(isDependentFollowUp("какая ставка по ипотеке"), false);
});

test("augments dependent messages with previous context", () => {
  let now = 1_000;
  const memory = new ConversationMemory(60_000, 5, undefined, () => now);
  memory.remember("u1", "какой максимальный кредит?", "Максимальная сумма зависит от программы.");

  const result = memory.augmentIfDependent("u1", "а сколько?");

  assert.equal(result.usedContext, true);
  assert.match(result.text, /какой максимальный кредит/);
  assert.match(result.text, /а сколько/);
});

test("does not use expired context", () => {
  let now = 1_000;
  const memory = new ConversationMemory(60_000, 5, undefined, () => now);
  memory.remember("u1", "ипотека", "Ответ");

  now += 61_000;
  const result = memory.augmentIfDependent("u1", "да");

  assert.equal(result.usedContext, false);
  assert.equal(result.text, "да");
});

test("keeps several turns and caps history", () => {
  let now = 1_000;
  const memory = new ConversationMemory(60_000, 2, undefined, () => now);
  memory.remember("u1", "первый вопрос", "первый ответ");
  now += 1_000;
  memory.remember("u1", "второй вопрос", "второй ответ");
  now += 1_000;
  memory.remember("u1", "третий вопрос", "третий ответ");

  const result = memory.augmentIfDependent("u1", "а сколько?");

  assert.equal(result.usedContext, true);
  assert.doesNotMatch(result.text, /первый вопрос/);
  assert.match(result.text, /второй вопрос/);
  assert.match(result.text, /третий вопрос/);
});

test("persists redacted memory and loads it after restart", () => {
  let now = 1_000;
  const dir = mkdtempSync(join(tmpdir(), "conversation-memory-"));
  const file = join(dir, "memory.json");
  const first = new ConversationMemory(60_000, 5, file, () => now);
  first.remember("u1", "мой телефон +7 701 123 45 67", "не отправляйте телефон");

  const raw = readFileSync(file, "utf8");
  assert.doesNotMatch(raw, /701 123 45 67/);
  assert.match(raw, /\[PHONE-REDACTED\]/);

  const second = new ConversationMemory(60_000, 5, file, () => now);
  const result = second.augmentIfDependent("u1", "да");

  assert.equal(result.usedContext, true);
  assert.match(result.text, /\[PHONE-REDACTED\]/);
});

test("counts consecutive clarify replies", () => {
  const memory = new ConversationMemory(60_000);
  memory.remember("u1", "непонятно", "уточните вопрос", "clarify");
  memory.remember("u1", "ок", "уточните вопрос", "clarify");

  assert.equal(memory.recentBotKindCount("u1", "clarify"), 2);

  memory.remember("u1", "ипотека", "ответ по ипотеке", "reply");
  assert.equal(memory.recentBotKindCount("u1", "clarify"), 0);
});

test("persists bot kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "conversation-memory-kind-"));
  const file = join(dir, "memory.json");
  const first = new ConversationMemory(60_000, 5, file);
  first.remember("u1", "не понял", "уточните", "clarify");

  const second = new ConversationMemory(60_000, 5, file);
  assert.equal(second.recentBotKindCount("u1", "clarify"), 1);
});
