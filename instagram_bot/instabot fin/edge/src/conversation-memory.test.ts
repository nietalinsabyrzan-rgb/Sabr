import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationMemory, isDependentFollowUp } from "./conversation-memory.js";

test("detects short dependent follow-ups", () => {
  assert.equal(isDependentFollowUp("да"), true);
  assert.equal(isDependentFollowUp("а сколько?"), true);
  assert.equal(isDependentFollowUp("қалай?"), true);
  assert.equal(isDependentFollowUp("какая ставка по ипотеке"), false);
});

test("augments dependent messages with previous context", () => {
  let now = 1_000;
  const memory = new ConversationMemory(60_000, () => now);
  memory.remember("u1", "какой максимальный кредит?", "Максимальная сумма зависит от программы.");

  const result = memory.augmentIfDependent("u1", "а сколько?");

  assert.equal(result.usedContext, true);
  assert.match(result.text, /какой максимальный кредит/);
  assert.match(result.text, /а сколько/);
});

test("does not use expired context", () => {
  let now = 1_000;
  const memory = new ConversationMemory(60_000, () => now);
  memory.remember("u1", "ипотека", "Ответ");

  now += 61_000;
  const result = memory.augmentIfDependent("u1", "да");

  assert.equal(result.usedContext, false);
  assert.equal(result.text, "да");
});
