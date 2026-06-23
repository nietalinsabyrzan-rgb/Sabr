import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface RetryQueueOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  deadLetterPath: string;
  onDeadLetter?: (job: unknown, error: unknown) => void;
}

interface Entry<T> {
  job: T;
  attempts: number;
}

// In-process work queue with exponential-backoff retries and a dead-letter
// file. The webhook handler 200s immediately and pushes work here, so a
// failed Graph/model call no longer loses the event.
export class RetryQueue<T> {
  private entries: Entry<T>[] = [];
  private running = false;
  private maxAttempts: number;
  private baseDelayMs: number;

  constructor(
    private handler: (job: T) => Promise<void>,
    private opts: RetryQueueOptions,
  ) {
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 2_000;
    mkdirSync(dirname(opts.deadLetterPath), { recursive: true });
  }

  push(job: T) {
    this.entries.push({ job, attempts: 0 });
    void this.run();
  }

  get pending(): number {
    return this.entries.length;
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      let entry: Entry<T> | undefined;
      while ((entry = this.entries.shift())) {
        try {
          await this.handler(entry.job);
        } catch (err) {
          entry.attempts += 1;
          if (entry.attempts >= this.maxAttempts) {
            this.deadLetter(entry, err);
          } else {
            const delay = this.baseDelayMs * 2 ** (entry.attempts - 1);
            const e = entry;
            setTimeout(() => {
              this.entries.push(e);
              void this.run();
            }, delay).unref();
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  private deadLetter(entry: Entry<T>, error: unknown) {
    appendFileSync(
      this.opts.deadLetterPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        attempts: entry.attempts,
        error: error instanceof Error ? error.message : String(error),
        job: entry.job,
      }) + "\n",
    );
    this.opts.onDeadLetter?.(entry.job, error);
  }
}
