export interface DmBatch {
  senderId: string;
  text: string;
  messageIds: string[];
}

interface PendingBatch {
  texts: string[];
  messageIds: string[];
  timer?: ReturnType<typeof setTimeout>;
}

export class DmBatcher {
  private pending = new Map<string, PendingBatch>();

  constructor(
    private delayMs: number,
    private maxMessages: number,
    private flush: (batch: DmBatch) => void,
  ) {}

  add(senderId: string, messageId: string, text: string) {
    const pending = this.pending.get(senderId) ?? { texts: [], messageIds: [] };
    pending.texts.push(text.trim());
    pending.messageIds.push(messageId);
    this.pending.set(senderId, pending);

    if (pending.timer) clearTimeout(pending.timer);

    if (pending.texts.length >= this.maxMessages) {
      this.flushSender(senderId);
      return;
    }

    pending.timer = setTimeout(() => this.flushSender(senderId), this.delayMs);
    pending.timer.unref?.();
  }

  flushSender(senderId: string) {
    const pending = this.pending.get(senderId);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(senderId);

    this.flush({
      senderId,
      text: pending.texts.filter(Boolean).join("\n"),
      messageIds: pending.messageIds,
    });
  }

  get pendingConversations(): number {
    return this.pending.size;
  }
}
