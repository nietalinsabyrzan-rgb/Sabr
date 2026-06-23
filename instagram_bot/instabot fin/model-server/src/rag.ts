import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "./logger.js";

export interface Chunk {
  id: number;
  /** Breadcrumb of markdown headings, e.g. "Депозиты > Тариф Бастау" */
  heading: string;
  text: string;
}

interface Section {
  heading: string;
  lines: string[];
}

/**
 * Split a markdown knowledge base into retrieval chunks. Sections follow the
 * heading structure; oversized sections are split on paragraph boundaries
 * with a character overlap so facts straddling a cut are still retrievable.
 * Each chunk is prefixed with its heading breadcrumb for embedding context.
 */
export function chunkKnowledge(
  markdown: string,
  chunkSize = 1_400,
  overlap = 200,
): Chunk[] {
  const sections: Section[] = [];
  const breadcrumb: string[] = [];
  let current: Section = { heading: "", lines: [] };

  for (const line of markdown.split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (current.lines.some((l) => l.trim())) sections.push(current);
      const depth = m[1].length;
      breadcrumb.length = depth - 1;
      breadcrumb[depth - 1] = m[2].trim();
      current = { heading: breadcrumb.filter(Boolean).join(" > "), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) sections.push(current);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const body = section.lines.join("\n").trim();
    for (const piece of splitWithOverlap(body, chunkSize, overlap)) {
      chunks.push({
        id: chunks.length,
        heading: section.heading,
        text: section.heading ? `${section.heading}\n\n${piece}` : piece,
      });
    }
  }
  return chunks;
}

function splitWithOverlap(text: string, max: number, overlap: number): string[] {
  if (text.length <= max) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const pieces: string[] = [];
  let buf = "";

  const flush = () => {
    if (buf.trim()) pieces.push(buf.trim());
    // Carry the tail of the previous piece into the next one.
    buf = buf.length > overlap ? buf.slice(-overlap) : "";
  };

  for (const para of paragraphs) {
    // A single paragraph larger than max (e.g. a long table) is hard-split.
    if (para.length > max) {
      flush();
      for (let i = 0; i < para.length; i += max - overlap) {
        pieces.push(para.slice(i, i + max).trim());
      }
      buf = "";
      continue;
    }
    if (buf.length + para.length + 2 > max) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (buf.trim()) pieces.push(buf.trim());
  return pieces.filter(Boolean);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

interface CacheFile {
  key: string;
  vectors: number[][];
}

/**
 * In-memory vector index over knowledge chunks. Embeddings are computed once
 * at startup (batched) and cached on disk keyed by a hash of the knowledge
 * text + embedding model, so restarts are instant until either changes.
 */
export class RagIndex {
  private vectors: number[][] = [];
  ready = false;

  constructor(
    private chunks: Chunk[],
    private embed: EmbedFn,
    private cachePath?: string,
    private cacheKey?: string,
  ) {}

  get chunkCount(): number {
    return this.chunks.length;
  }

  async build(batchSize = 16): Promise<void> {
    if (this.cachePath && this.cacheKey && existsSync(this.cachePath)) {
      try {
        const cache = JSON.parse(readFileSync(this.cachePath, "utf8")) as CacheFile;
        if (cache.key === this.cacheKey && cache.vectors.length === this.chunks.length) {
          this.vectors = cache.vectors;
          this.ready = true;
          logger.info("rag index loaded from cache", { chunks: this.chunks.length });
          return;
        }
      } catch {
        // Corrupt cache — rebuild below.
      }
    }

    const started = Date.now();
    const vectors: number[][] = [];
    for (let i = 0; i < this.chunks.length; i += batchSize) {
      const batch = this.chunks.slice(i, i + batchSize);
      const embedded = await this.embed(batch.map((c) => c.text));
      vectors.push(...embedded);
    }
    if (vectors.length !== this.chunks.length) {
      throw new Error(
        `embedding count mismatch: ${vectors.length} vectors for ${this.chunks.length} chunks`,
      );
    }
    this.vectors = vectors;
    this.ready = true;
    logger.info("rag index built", {
      chunks: this.chunks.length,
      tookMs: Date.now() - started,
    });

    if (this.cachePath && this.cacheKey) {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(
        this.cachePath,
        JSON.stringify({ key: this.cacheKey, vectors } satisfies CacheFile),
      );
    }
  }

  async retrieve(query: string, k: number): Promise<Chunk[]> {
    if (!this.ready) throw new Error("rag index not built yet");
    const [qv] = await this.embed([query]);
    return this.vectors
      .map((v, i) => ({ i, score: cosine(qv, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ i }) => this.chunks[i]);
  }
}

export function knowledgeCacheKey(markdown: string, embedModel: string): string {
  return createHash("sha256").update(embedModel).update("\0").update(markdown).digest("hex");
}
