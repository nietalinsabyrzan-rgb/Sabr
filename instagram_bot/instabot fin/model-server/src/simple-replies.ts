import type { Lang } from "./language.js";
import type { Surface } from "./prompt.js";

const GREETING_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "привет",
  "здравия",
  "здравствуйте",
  "здравствуй",
  "желаю",
  "добрый",
  "доброго",
  "день",
  "дня",
  "вечер",
  "вчер",
  "времени",
  "утро",
  "салам",
  "салем",
  "салеметсиз",
  "салеметсизбе",
  "сәлем",
  "саламатсыз",
  "саламатсызба",
  "саламатсызбе",
  "салематсыз",
  "салематсызба",
  "салематсызбе",
  "сәлеметсіз",
  "сіз",
  "сиз",
  "ба",
  "бе",
  "ассалаумағалейкум",
  "ассалау",
]);

export const GREETING_REPLY: Record<Lang, Record<Surface, string>> = {
  ru: {
    comment: "Здравствуйте! Чем могу помочь по продуктам Отбасы банка?",
    dm: "Здравствуйте! Чем могу помочь по продуктам Отбасы банка?",
  },
  kk: {
    comment: "Сәлеметсіз бе! Отбасы банк өнімдері бойынша қалай көмектесе аламын?",
    dm: "Сәлеметсіз бе! Отбасы банк өнімдері бойынша қалай көмектесе аламын?",
  },
};

export function isGreetingOnly(text: string): boolean {
  const words = text
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .match(/[\p{L}]+/gu);
  if (!words || words.length === 0 || words.length > 4) return false;
  return words.every((word) => GREETING_WORDS.has(word));
}
