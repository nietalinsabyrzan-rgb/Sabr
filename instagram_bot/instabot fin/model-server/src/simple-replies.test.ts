import test from "node:test";
import assert from "node:assert/strict";
import { GREETING_REPLY, isGreetingOnly, questionTextAfterGreeting } from "./simple-replies.js";

test("detects Russian-only greetings", () => {
  assert.equal(isGreetingOnly("привет"), true);
  assert.equal(isGreetingOnly("приветствую"), true);
  assert.equal(isGreetingOnly("приветсвую"), true);
  assert.equal(isGreetingOnly("преветствую"), true);
  assert.equal(isGreetingOnly("приветик"), true);
  assert.equal(isGreetingOnly("прив"), true);
  assert.equal(isGreetingOnly("Здравствуйте!"), true);
  assert.equal(isGreetingOnly("здпасствуйте"), true);
  assert.equal(isGreetingOnly("здраствуйтее"), true);
  assert.equal(isGreetingOnly("здравстуйте"), true);
  assert.equal(isGreetingOnly("здрасьте"), true);
  assert.equal(isGreetingOnly("здрасте"), true);
  assert.equal(isGreetingOnly("здарова"), true);
  assert.equal(isGreetingOnly("Здравия желаю"), true);
  assert.equal(isGreetingOnly("Добрый день"), true);
  assert.equal(isGreetingOnly("доброе утро"), true);
  assert.equal(isGreetingOnly("добрый вечер"), true);
  assert.equal(isGreetingOnly("доброй ночи"), true);
  assert.equal(isGreetingOnly("добрый вчер"), true);
  assert.equal(isGreetingOnly("доброго времени дня"), true);
  assert.equal(isGreetingOnly("hi"), true);
  assert.equal(isGreetingOnly("hello"), true);
  assert.equal(isGreetingOnly("privet"), true);
});

test("detects Kazakh-only greetings", () => {
  assert.equal(isGreetingOnly("Сәлем"), true);
  assert.equal(isGreetingOnly("Сәлембердік"), true);
  assert.equal(isGreetingOnly("Салам"), true);
  assert.equal(isGreetingOnly("Сәлеметсіз бе"), true);
  assert.equal(isGreetingOnly("Сәлеметсізбе"), true);
  assert.equal(isGreetingOnly("Салем"), true);
  assert.equal(isGreetingOnly("Салембердик"), true);
  assert.equal(isGreetingOnly("Салеметсизбе"), true);
  assert.equal(isGreetingOnly("Салеметсзибе"), true);
  assert.equal(isGreetingOnly("Салеметсизба"), true);
  assert.equal(isGreetingOnly("Салеметсиз бе"), true);
  assert.equal(isGreetingOnly("Саламатсызба"), true);
  assert.equal(isGreetingOnly("Саламатсыз ба"), true);
  assert.equal(isGreetingOnly("Саламатсызбе"), true);
  assert.equal(isGreetingOnly("Салематсызбе"), true);
  assert.equal(isGreetingOnly("Саламалейкум"), true);
  assert.equal(isGreetingOnly("Ассалам алейкум"), true);
  assert.equal(isGreetingOnly("Ассалаумағалейкум"), true);
  assert.equal(isGreetingOnly("salam"), true);
  assert.equal(isGreetingOnly("salem"), true);
  assert.equal(isGreetingOnly("assalamu aleikum"), true);
});

test("does not treat real questions as greetings", () => {
  assert.equal(isGreetingOnly("Сәлем, депозит қалай ашамын?"), false);
  assert.equal(isGreetingOnly("Салам, кредит қанша береді?"), false);
  assert.equal(isGreetingOnly("привет сколько максимум кредит"), false);
  assert.equal(isGreetingOnly("добрый день какие условия депозита"), false);
});

test("DM greeting suggests common topics", () => {
  assert.match(GREETING_REPLY.ru.dm, /депозит/);
  assert.match(GREETING_REPLY.ru.dm, /ипотека/);
  assert.match(GREETING_REPLY.kk.dm, /әскери бағдарлама/);
});

test("strips greeting prefix from greeting plus question", () => {
  assert.equal(questionTextAfterGreeting("привет, как открыть депозит?"), "как открыть депозит?");
  assert.equal(questionTextAfterGreeting("Добрый день какие условия депозита"), "какие условия депозита");
  assert.equal(questionTextAfterGreeting("Сәлем, депозит қалай ашамын?"), "депозит қалай ашамын?");
});

test("keeps pure greetings and plain questions unchanged", () => {
  assert.equal(questionTextAfterGreeting("привет"), "привет");
  assert.equal(questionTextAfterGreeting("как открыть депозит?"), "как открыть депозит?");
});
