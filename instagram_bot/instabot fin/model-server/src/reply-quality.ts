import type { Surface } from "./prompt.js";

const RUSSIAN_LEAK_WORDS = [
  "здравствуйте",
  "вопрос",
  "договор",
  "договорная",
  "сумма",
  "ежемесячный",
  "взнос",
  "мобильное",
  "приложение",
  "филиал",
  "условия",
  "программа",
  "программасынан",
  "супруг",
  "супруга",
  "несовершеннолет",
  "несовершеннолеттең",
  "деталей",
  "детали",
  "можно",
  "нужно",
  "подробнее",
  "уточнить",
  "сайт",
];

const LATIN_ALLOWLIST = new Set([
  "hcsbk",
  "kz",
  "otbasy",
  "bank",
  "instagram",
  "direct",
  "sms",
]);

export const KAZAKH_QUALITY_FALLBACK: Record<Surface, string> = {
  comment:
    "Сәлеметсіз бе! Сұрағыңызды нақтылап жіберіңізші, Отбасы банк өнімдері бойынша жауап беремін.",
  dm: "Сәлеметсіз бе! Сұрағыңызды нақтылап жіберіңізші, Отбасы банк өнімдері бойынша жауап беремін. Толығырақ ақпаратты hcsbk.kz сайтынан немесе 1432 байланыс орталығынан нақтылауға болады.",
};

export function kazakhQualityIssues(reply: string): string[] {
  const issues: string[] = [];
  const lower = reply.toLowerCase();
  const leakedRussian = RUSSIAN_LEAK_WORDS.filter((word) =>
    new RegExp(`(^|[^а-яәіңғүұқөһa-z])${word}([^а-яәіңғүұқөһa-z]|$)`, "i").test(lower),
  );
  if (leakedRussian.length > 0) {
    issues.push(`russian words: ${leakedRussian.slice(0, 5).join(", ")}`);
  }

  const latinWords = lower.match(/[a-z]+/g) ?? [];
  const unexpectedLatin = latinWords.filter((word) => !LATIN_ALLOWLIST.has(word));
  if (unexpectedLatin.length > 0) {
    issues.push(`unexpected latin words: ${unexpectedLatin.slice(0, 5).join(", ")}`);
  }

  const hasKazakhLetters = /[әіңғүұқөһ]/i.test(reply);
  if (!hasKazakhLetters) {
    issues.push("no kazakh-specific letters");
  }

  return issues;
}
