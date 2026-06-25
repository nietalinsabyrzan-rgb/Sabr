import test from "node:test";
import assert from "node:assert/strict";
import { shouldAskClarifyingQuestion } from "./clarify.js";

test("asks clarification for short unclear fragments", () => {
  assert.equal(shouldAskClarifyingQuestion("Саламатпысыз"), true);
  assert.equal(shouldAskClarifyingQuestion("ок"), true);
  assert.equal(shouldAskClarifyingQuestion("ну да"), true);
});

test("does not clarify when a product or question intent is present", () => {
  assert.equal(shouldAskClarifyingQuestion("ипотека"), false);
  assert.equal(shouldAskClarifyingQuestion("сколько максимум кредит"), false);
  assert.equal(shouldAskClarifyingQuestion("депозит қалай ашамын"), false);
  assert.equal(shouldAskClarifyingQuestion("какие условия?"), false);
});
