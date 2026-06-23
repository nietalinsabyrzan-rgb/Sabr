export type Lang = "kk" | "ru";

const KK_CHARS = /[әғқңөұүһі]/i;
const RU_CHARS = /[ёъыэ]/i;
const KK_WORDS = new Set([
  "алайын",
  "алуға",
  "алсам",
  "айтып",
  "бар",
  "беріңіз",
  "бересіз",
  "болама",
  "бола",
  "болад",
  "болады",
  "деген",
  "жазылу",
  "жайлы",
  "жинақ",
  "жоқ",
  "қандай",
  "қалай",
  "қанша",
  "керек",
  "маган",
  "маған",
  "несие",
  "отбасы",
  "салем",
  "сәлем",
  "сәлеметсіз",
  "туралы",
  "түсіндіріп",
  "тұрғын",
  "уй",
  "үй",
  "шарттары",
]);
const RU_WORDS = new Set([
  "здравствуйте",
  "привет",
  "какой",
  "какая",
  "как",
  "можно",
  "нужно",
  "подскажите",
  "расскажите",
  "ставка",
  "условия",
]);

export function detectLanguage(text: string): Lang {
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  let kkScore = KK_CHARS.test(normalized) ? 3 : 0;
  let ruScore = RU_CHARS.test(normalized) ? 1 : 0;

  for (const word of normalized.match(/[\p{L}]+/gu) ?? []) {
    if (KK_WORDS.has(word)) kkScore += 1;
    if (RU_WORDS.has(word)) ruScore += 1;
  }

  return kkScore > ruScore ? "kk" : "ru";
}
