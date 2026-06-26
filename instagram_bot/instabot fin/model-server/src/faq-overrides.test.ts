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

test("does not match unrelated messages", () => {
  assert.equal(matchFaqOverride("сәлем", "kk", "dm"), undefined);
});
