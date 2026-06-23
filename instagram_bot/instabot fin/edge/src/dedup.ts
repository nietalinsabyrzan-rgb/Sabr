import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Persistent dedup of processed webhook event IDs. File-backed (one ID per
// line) so a restart does not re-reply to old events. Single-instance only —
// move to Redis if the edge ever runs more than one replica.
export class DedupStore {
  private seen = new Set<string>();
  private order: string[] = [];

  constructor(
    private filePath: string,
    private maxEntries = 50_000,
    private pruneTo = 25_000,
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    if (existsSync(filePath)) {
      for (const line of readFileSync(filePath, "utf8").split("\n")) {
        const id = line.trim();
        if (id && !this.seen.has(id)) {
          this.seen.add(id);
          this.order.push(id);
        }
      }
    }
  }

  /** Returns true if the ID is new (and records it), false if already seen. */
  markProcessed(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    appendFileSync(this.filePath, `${id}\n`);
    if (this.order.length > this.maxEntries) this.prune();
    return true;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  get size(): number {
    return this.seen.size;
  }

  private prune() {
    this.order = this.order.slice(-this.pruneTo);
    this.seen = new Set(this.order);
    writeFileSync(this.filePath, this.order.join("\n") + "\n");
  }
}
