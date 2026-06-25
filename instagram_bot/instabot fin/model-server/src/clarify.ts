import type { Lang } from "./language.js";
import type { Surface } from "./prompt.js";

const QUESTION_OR_PRODUCT_WORDS = new Set([
  "как",
  "какой",
  "какая",
  "какие",
  "сколько",
  "можно",
  "нужно",
  "хочу",
  "подскажите",
  "расскажите",
  "условия",
  "ставка",
  "кредит",
  "заем",
  "займ",
  "ипотека",
  "депозит",
  "программа",
  "субсидия",
  "аренда",
  "доход",
  "сумма",
  "қалай",
  "қандай",
  "қанша",
  "бола",
  "болады",
  "болама",
  "керек",
  "несие",
  "ипотека",
  "депозит",
  "бағдарлама",
  "субсидия",
  "жалға",
  "табыс",
  "сома",
  "шарт",
  "шарттары",
]);

export const CLARIFY_REPLY: Record<Lang, Record<Surface, string>> = {
  ru: {
    comment: "Уточните, пожалуйста, вопрос — отвечу по продуктам Отбасы банка.",
    dm: "Уточните, пожалуйста, вопрос: что именно вас интересует по продуктам Отбасы банка?",
  },
  kk: {
    comment: "Сұрағыңызды нақтылап жіберіңізші — Отбасы банк өнімдері бойынша жауап беремін.",
    dm: "Сұрағыңызды нақтылап жіберіңізші: Отбасы банк өнімдері бойынша нақты не білгіңіз келеді?",
  },
};

export function shouldAskClarifyingQuestion(text: string): boolean {
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const words = normalized.match(/[\p{L}\d]+/gu) ?? [];
  if (words.length === 0) return true;
  if (/[?？]/.test(text)) return false;
  if (words.some((word) => QUESTION_OR_PRODUCT_WORDS.has(word))) return false;

  // Short vague messages are usually greetings, reactions, typos, or context-free fragments.
  return words.length <= 2 || normalized.length <= 18;
}
