import test from "node:test";
import assert from "node:assert/strict";
import { kazakhQualityIssues } from "./reply-quality.js";

test("accepts clean Kazakh replies with allowed brand words", () => {
  const issues = kazakhQualityIssues(
    "Сәлеметсіз бе! Депозитті Otbasy bank мобильді қосымшасында немесе hcsbk.kz сайтында ашуға болады.",
  );
  assert.deepEqual(issues, []);
});

test("rejects mixed Russian and Kazakh replies", () => {
  const issues = kazakhQualityIssues(
    "Сәлеметсіз бе! Ежемесячный взнос және договорная сумма бойынша уточнить керек.",
  );
  assert.match(issues.join("\n"), /russian words/);
});

test("rejects broken mixed-script Kazakh words", () => {
  const issues = kazakhQualityIssues("Сәlemетсіз бе! Депозит ашуға болады.");
  assert.match(issues.join("\n"), /unexpected latin words/);
});

test("rejects Russian legal-family words leaked into Kazakh replies", () => {
  const issues = kazakhQualityIssues(
    "Сәлем! Бұл программа супруг және несовершеннолеттең балалар арқылы қолданылады. Деталей туралы 1432 арқылы нақтылаңыз.",
  );
  assert.match(issues.join("\n"), /russian words/);
});
