import test from "node:test";
import assert from "node:assert/strict";
import { isGreetingOnly } from "./simple-replies.js";

test("detects Russian-only greetings", () => {
  assert.equal(isGreetingOnly("привет"), true);
  assert.equal(isGreetingOnly("Здравствуйте!"), true);
});

test("detects Kazakh-only greetings", () => {
  assert.equal(isGreetingOnly("Сәлем"), true);
  assert.equal(isGreetingOnly("Сәлеметсіз бе"), true);
});

test("does not treat real questions as greetings", () => {
  assert.equal(isGreetingOnly("Сәлем, депозит қалай ашамын?"), false);
  assert.equal(isGreetingOnly("привет сколько максимум кредит"), false);
});
