import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redactSensitive,
  containsSensitive,
  detectLanguage,
} from "./redact.js";

test("redacts a 12-digit ИИН", () => {
  const out = redactSensitive("мой иин 990101350123 вот");
  assert.ok(!out.includes("990101350123"));
  assert.ok(out.includes("[IIN-REDACTED]"));
});

test("redacts a 16-digit card number with spaces", () => {
  const out = redactSensitive("карта 4400 4301 2345 6789, проверьте");
  assert.ok(!out.includes("4400 4301 2345 6789"));
  assert.ok(out.includes("[CARD-REDACTED]"));
});

test("redacts a code mentioned next to a keyword", () => {
  const out = redactSensitive("мне пришёл код 123456 из смс");
  assert.ok(!out.includes("123456"));
});

test("leaves ordinary amounts and phone-length numbers alone", () => {
  const text = "хочу вклад на 500000 тенге на 3 года";
  assert.equal(redactSensitive(text), text);
  assert.equal(containsSensitive(text), false);
});

test("containsSensitive flags ИИН and cards", () => {
  assert.equal(containsSensitive("иин 990101350123"), true);
  assert.equal(containsSensitive("4400430123456789"), true);
  assert.equal(containsSensitive("какая ставка по депозиту?"), false);
});

test("containsSensitive is stable across repeated calls", () => {
  // Guards against /g lastIndex state leaking between calls.
  for (let i = 0; i < 3; i++) {
    assert.equal(containsSensitive("иин 990101350123"), true);
  }
});

test("detects Kazakh vs Russian", () => {
  assert.equal(detectLanguage("Сәлеметсіз бе, депозит туралы сұрағым бар"), "kk");
  assert.equal(detectLanguage("Салем, депозит жайлы айтып бересиз бе"), "kk");
  assert.equal(detectLanguage("Тұрғын үй несиесін қалай алуға болады?"), "kk");
  assert.equal(detectLanguage("Здравствуйте, какая ставка по депозиту?"), "ru");
  assert.equal(detectLanguage("Подскажите условия по ипотеке"), "ru");
});
