import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactSensitive } from "./redact.js";

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
  botKind?: "reply" | "clarify" | "handoff";
  ts: number;
}

export class ConversationMemory {
  private histories = new Map<string, ConversationTurn[]>();

  constructor(
    private ttlMs: number,
    private maxTurns = 5,
    private filePath?: string,
    private now: () => number = () => Date.now(),
  ) {
    this.load();
  }

  remember(
    peerId: string,
    userText: string,
    botReply: string,
    botKind: ConversationTurn["botKind"] = "reply",
  ) {
    const history = this.activeHistory(peerId);
    history.push({
      userText: redactSensitive(userText).trim(),
      botReply: redactSensitive(botReply).trim(),
      botKind,
      ts: this.now(),
    });
    this.histories.set(peerId, history.slice(-this.maxTurns));
    this.save();
  }

  augmentIfDependent(peerId: string, text: string): { text: string; usedContext: boolean } {
    const history = this.activeHistory(peerId);
    if (history.length === 0 || !isDependentFollowUp(text)) {
      return { text, usedContext: false };
    }

    return {
      usedContext: true,
      text: [
        "Контекст последних сообщений в этом Direct:",
        ...history.flatMap((turn, index) => [
          `${index + 1}. Клиент: "${turn.userText}"`,
          `   Бот: "${turn.botReply}"`,
        ]),
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
    for (const [peerId, history] of this.histories) {
      const active = history.filter((turn) => now - turn.ts <= this.ttlMs);
      if (active.length === 0) this.histories.delete(peerId);
      else this.histories.set(peerId, active.slice(-this.maxTurns));
    }
    this.save();
  }

  get size(): number {
    return this.histories.size;
  }

  recentBotKindCount(peerId: string, botKind: ConversationTurn["botKind"]): number {
    let count = 0;
    const history = this.activeHistory(peerId);
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].botKind !== botKind) break;
      count++;
    }
    return count;
  }

  private activeHistory(peerId: string): ConversationTurn[] {
    const now = this.now();
    const history = (this.histories.get(peerId) ?? []).filter(
      (turn) => now - turn.ts <= this.ttlMs,
    );
    if (history.length === 0) this.histories.delete(peerId);
    else this.histories.set(peerId, history.slice(-this.maxTurns));
    return history.slice(-this.maxTurns);
  }

  private load() {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      if (!raw || typeof raw !== "object") return;
      const entries = Object.entries(raw as Record<string, unknown>);
      for (const [peerId, value] of entries) {
        if (!Array.isArray(value)) continue;
        const turns = value
          .filter(isConversationTurn)
          .map((turn) => ({
            userText: redactSensitive(turn.userText).trim(),
            botReply: redactSensitive(turn.botReply).trim(),
            botKind: turn.botKind,
            ts: turn.ts,
          }))
          .slice(-this.maxTurns);
        if (turns.length > 0) this.histories.set(peerId, turns);
      }
      this.prune();
    } catch {
      this.histories.clear();
    }
  }

  private save() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const payload: Record<string, ConversationTurn[]> = {};
    for (const [peerId, history] of this.histories) {
      payload[peerId] = history.slice(-this.maxTurns);
    }
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
  }
}

function isConversationTurn(value: unknown): value is ConversationTurn {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ConversationTurn).userText === "string" &&
    typeof (value as ConversationTurn).botReply === "string" &&
    typeof (value as ConversationTurn).ts === "number"
  );
}

export function isDependentFollowUp(text: string): boolean {
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
  if (!normalized) return false;
  const words = normalized.match(/[\p{L}\d]+/gu) ?? [];
  if (words.length === 0 || words.length > 4) return false;
  if (/[?？]/.test(normalized) && words.length > 2) return false;
  return words.every((word) => DEPENDENT_WORDS.has(word)) || normalized.length <= 12;
}
