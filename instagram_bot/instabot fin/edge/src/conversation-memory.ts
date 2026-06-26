const DEPENDENT_WORDS = new Set([
  "да",
  "нет",
  "ок",
  "окей",
  "ага",
  "угу",
  "и",
  "а",
  "сколько",
  "как",
  "какой",
  "какая",
  "какие",
  "қанша",
  "қалай",
  "ия",
  "жоқ",
  "иә",
  "жарайды",
]);

export interface ConversationTurn {
  userText: string;
  botReply: string;
  ts: number;
}

export class ConversationMemory {
  private turns = new Map<string, ConversationTurn>();

  constructor(
    private ttlMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  remember(peerId: string, userText: string, botReply: string) {
    this.turns.set(peerId, {
      userText: userText.trim(),
      botReply: botReply.trim(),
      ts: this.now(),
    });
  }

  augmentIfDependent(peerId: string, text: string): { text: string; usedContext: boolean } {
    const turn = this.turns.get(peerId);
    if (!turn || this.now() - turn.ts > this.ttlMs || !isDependentFollowUp(text)) {
      return { text, usedContext: false };
    }

    return {
      usedContext: true,
      text: [
        "Контекст предыдущего сообщения в этом Direct:",
        `Клиент раньше писал: "${turn.userText}"`,
        `Бот ответил: "${turn.botReply}"`,
        "",
        "Новое короткое сообщение клиента:",
        `"${text}"`,
        "",
        "Ответь на новое сообщение с учётом контекста. Если даже с контекстом вопрос непонятен — попроси уточнить.",
      ].join("\n"),
    };
  }

  prune() {
    const now = this.now();
    for (const [peerId, turn] of this.turns) {
      if (now - turn.ts > this.ttlMs) this.turns.delete(peerId);
    }
  }

  get size(): number {
    return this.turns.size;
  }
}

export function isDependentFollowUp(text: string): boolean {
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
  if (!normalized) return false;
  const words = normalized.match(/[\p{L}\d]+/gu) ?? [];
  if (words.length === 0 || words.length > 4) return false;
  if (/[?？]/.test(normalized) && words.length > 2) return false;
  return words.every((word) => DEPENDENT_WORDS.has(word)) || normalized.length <= 12;
}
