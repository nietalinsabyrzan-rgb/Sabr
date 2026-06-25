// Detection and redaction of sensitive data (ИИН/ЖСН, card numbers, one-time
// codes). Used both to refuse processing such messages and to keep raw values
// out of the audit log.

// 13–19 digits, optionally separated by spaces/dashes (bank card / IBAN-digit runs).
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
// Kazakh ИИН/ЖСН: exactly 12 consecutive digits.
const IIN_RE = /\b\d{12}\b/g;
// 3–8 digit number in close proximity to a "code/password/cvv" keyword.
// \b is ASCII-only in JS, so Unicode lookarounds delimit the Cyrillic keywords.
const CODE_RE =
  /(?<![\p{L}\d])(код|кодты|code|otp|смс|sms|cvv|cvc|пароль|парол|құпия\s*сөз)(?!\p{L})\D{0,15}\d{3,8}\b/giu;
const PHONE_RE = /(?:\+?7|8)[ -]?\(?7\d{2}\)?(?:[ -]?\d){7}\b/g;
const PASSWORD_RE =
  /(?<![\p{L}\d])(пароль|парол|password|pass|құпия\s*сөз)(?!\p{L})\s*[:=]?\s*[^\s,.;!?]{4,}/giu;

export function redactSensitive(text: string): string {
  return text
    .replace(CARD_RE, "[CARD-REDACTED]")
    .replace(IIN_RE, "[IIN-REDACTED]")
    .replace(PHONE_RE, "[PHONE-REDACTED]")
    .replace(PASSWORD_RE, "$1 [SECRET-REDACTED]")
    .replace(CODE_RE, (m) => m.replace(/\d/g, "*"));
}

export function containsSensitive(text: string): boolean {
  // Fresh regex state per call (the constants above are /g and keep lastIndex).
  return (
    new RegExp(CARD_RE.source).test(text) ||
    new RegExp(IIN_RE.source).test(text) ||
    new RegExp(PHONE_RE.source).test(text) ||
    new RegExp(PASSWORD_RE.source, "iu").test(text) ||
    new RegExp(CODE_RE.source, "iu").test(text)
  );
}

export type Lang = "kk" | "ru";

// Kazakh-specific Cyrillic letters; absent from Russian.
const KK_CHARS = /[әғқңөұүһі]/i;
const RU_CHARS = /[ёъыэ]/i;
const KK_WORDS = new Set([
  "алуға",
  "алсам",
  "айтып",
  "бар",
  "беріңіз",
  "бересіз",
  "болама",
  "бола",
  "жазылу",
  "жайлы",
  "жинақ",
  "қандай",
  "қалай",
  "қанша",
  "керек",
  "несие",
  "салем",
  "сәлем",
  "сәлеметсіз",
  "туралы",
  "тұрғын",
  "үй",
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

export const SENSITIVE_WARNING: Record<Lang, string> = {
  ru: "Пожалуйста, не отправляйте персональные данные (ИИН, телефон, номер карты, СМС-коды, пароли) в Instagram — мы никогда их не запрашиваем. Если вы уже отправили такие данные кому-либо, обратитесь в контакт-центр 1432.",
  kk: "Өтінеміз, Instagram-да жеке деректеріңізді (ЖСН, телефон, карта нөмірі, СМС-кодтар, құпиясөздер) жібермеңіз — біз оларды ешқашан сұрамаймыз. Егер мұндай деректерді біреуге жіберіп қойсаңыз, 1432 байланыс орталығына хабарласыңыз.",
};
