import test from "node:test";
import assert from "node:assert/strict";
import { matchFaqOverride } from "./faq-overrides.js";

test("matches max credit questions", () => {
  const match = matchFaqOverride("сколько максимум кредит?", "ru", "dm");
  assert.equal(match?.id, "max_credit");
  assert.match(match?.reply ?? "", /зависит от выбранной программы/);
});

test("matches Kazakh deposit opening questions", () => {
  const match = matchFaqOverride("депозит қалай ашамын?", "kk", "dm");
  assert.equal(match?.id, "open_deposit");
  assert.match(match?.reply ?? "", /Депозитті/);
});

test("matches credit risk questions", () => {
  const match = matchFaqOverride(
    "Что такое кредитный риск и какие способы его снижения использует банк?",
    "ru",
    "dm",
  );
  assert.equal(match?.id, "credit_risk");
  assert.match(match?.reply ?? "", /вероятность/);
});

test("matches Kazakh credit risk questions", () => {
  const match = matchFaqOverride("Кредиттік тәуекел деген не?", "kk", "dm");
  assert.equal(match?.id, "credit_risk");
  assert.match(match?.reply ?? "", /Кредиттік тәуекел/);
});

test("does not match unrelated messages", () => {
  assert.equal(matchFaqOverride("сәлем", "kk", "dm"), undefined);
});
