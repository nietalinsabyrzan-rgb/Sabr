import type { Lang } from "./language.js";
import type { Surface } from "./prompt.js";

const GREETING_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "privet",
  "salem",
  "salam",
  "assalam",
  "assalamu",
  "aleikum",
  "aleykum",
  "привет",
  "приветствую",
  "приветсвую",
  "преветствую",
  "приветик",
  "прив",
  "здравия",
  "здравствуйте",
  "здравствуй",
  "здраствуйте",
  "здрасте",
  "здрасьте",
  "здарова",
  "здаров",
  "желаю",
  "добрый",
  "доброе",
  "доброй",
  "доброго",
  "день",
  "дня",
  "вечер",
  "вчер",
  "времени",
  "утро",
  "ночи",
  "салам",
  "саламалейкум",
  "салем",
  "салеметсиз",
  "салеметсизбе",
  "салеметсизба",
  "салембердик",
  "сәлем",
  "сәлембердік",
  "сәлеметсізбе",
  "сәлеметсізба",
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
  "алейкум",
  "алейкумассалам",
  "уагалейкумассалам",
  "ассалаумағалейкум",
  "ассалам",
  "ассалау",
]);

const FUZZY_GREETING_WORDS = [
  "здравствуйте",
  "здравствуй",
  "здраствуйте",
  "привет",
  "приветствую",
  "салеметсизбе",
  "саламатсызба",
  "сәлеметсізбе",
  "сәлем",
  "салем",
];

export const GREETING_REPLY: Record<Lang, Record<Surface, string>> = {
  ru: {
    comment: "Здравствуйте! Чем могу помочь по продуктам Отбасы банка?",
    dm: "Здравствуйте! Чем могу помочь по продуктам Отбасы банка?\n\nМожете написать тему: депозит, ипотека, субсидия, военная программа, консультация.",
  },
  kk: {
    comment: "Сәлеметсіз бе! Отбасы банк өнімдері бойынша қалай көмектесе аламын?",
    dm: "Сәлеметсіз бе! Отбасы банк өнімдері бойынша қалай көмектесе аламын?\n\nТақырыпты жаза аласыз: депозит, ипотека, субсидия, әскери бағдарлама, кеңес алу.",
  },
};

export function isGreetingOnly(text: string): boolean {
  const words = text
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .match(/[\p{L}]+/gu);
  if (!words || words.length === 0 || words.length > 4) return false;
  return words.every((word) => isGreetingWord(word));
}

function isGreetingWord(word: string): boolean {
  if (GREETING_WORDS.has(word)) return true;
  if (word.length < 5) return false;
  return FUZZY_GREETING_WORDS.some((greeting) => {
    const distance = levenshteinDistance(word, greeting);
    const allowed = greeting.length >= 10 ? 2 : 1;
    return distance <= allowed;
  });
}

function levenshteinDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}
