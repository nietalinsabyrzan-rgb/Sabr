import test from "node:test";
import assert from "node:assert/strict";
import { isGreetingOnly } from "./simple-replies.js";

test("detects Russian-only greetings", () => {
  assert.equal(isGreetingOnly("привет"), true);
  assert.equal(isGreetingOnly("Здравствуйте!"), true);
  assert.equal(isGreetingOnly("Добрый день"), true);
  assert.equal(isGreetingOnly("добрый вчер"), true);
  assert.equal(isGreetingOnly("доброго времени дня"), true);
});

test("detects Kazakh-only greetings", () => {
  assert.equal(isGreetingOnly("Сәлем"), true);
  assert.equal(isGreetingOnly("Сәлеметсіз бе"), true);
  assert.equal(isGreetingOnly("Салем"), true);
  assert.equal(isGreetingOnly("Салеметсизбе"), true);
  assert.equal(isGreetingOnly("Салеметсиз бе"), true);
  assert.equal(isGreetingOnly("Саламатсызба"), true);
  assert.equal(isGreetingOnly("Саламатсыз ба"), true);
  assert.equal(isGreetingOnly("Саламатсызбе"), true);
  assert.equal(isGreetingOnly("Салематсызбе"), true);
});

test("does not treat real questions as greetings", () => {
  assert.equal(isGreetingOnly("Сәлем, депозит қалай ашамын?"), false);
  assert.equal(isGreetingOnly("привет сколько максимум кредит"), false);
});
