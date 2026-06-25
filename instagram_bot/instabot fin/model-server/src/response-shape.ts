import type { Surface } from "./prompt.js";

const LIMITS: Record<Surface, number> = {
  comment: 320,
  dm: 650,
};

export function compactReply(reply: string, surface: Surface): string {
  const normalized = reply.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const limit = LIMITS[surface];
  if (normalized.length <= limit) return normalized;

  const sentences = normalized.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [normalized];
  let out = "";
  for (const sentence of sentences) {
    const next = `${out}${sentence}`.trim();
    if (next.length > limit) break;
    out = next;
  }
  if (out.length >= 80) return out;

  const sliced = normalized.slice(0, limit - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > 120 ? lastSpace : sliced.length).trim()}…`;
}
