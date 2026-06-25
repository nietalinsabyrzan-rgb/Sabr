import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "./language.js";

test("detects Kazakh messages with Kazakh-specific letters", () => {
  assert.equal(detectLanguage("Сәлеметсіз бе, тұрғын үй несиесін қалай аламын?"), "kk");
});

test("detects Kazakh messages written without every Kazakh-specific letter", () => {
  assert.equal(detectLanguage("Салем, маган депозит жайлы айтып бересиз бе"), "kk");
  assert.equal(detectLanguage("салам"), "kk");
  assert.equal(detectLanguage("саламалейкум"), "kk");
  assert.equal(detectLanguage("сәлембердік"), "kk");
  assert.equal(detectLanguage("салембердик"), "kk");
  assert.equal(detectLanguage("Салеметсизбе"), "kk");
  assert.equal(detectLanguage("Салеметсизба"), "kk");
  assert.equal(detectLanguage("Саламатпысыз"), "kk");
  assert.equal(detectLanguage("Саламатсыз ба"), "kk");
  assert.equal(detectLanguage("salam"), "kk");
  assert.equal(detectLanguage("assalamu aleikum"), "kk");
  assert.equal(detectLanguage("Отбасы банк шарттары кандай болады"), "kk");
});

test("keeps Russian messages Russian", () => {
  assert.equal(detectLanguage("Здравствуйте, подскажите условия по депозиту"), "ru");
});
