// Instagram DMs are capped at 1000 characters per message. Split longer
// replies into chunks on sentence/word boundaries and send them in order.
export const DM_MAX = 1000;
// Instagram comments are capped at ~2200 characters; a comment is a single
// message, so overlong replies are clamped rather than chunked.
export const COMMENT_MAX = 2200;

export function chunkText(text: string, max = DM_MAX): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= max) return [trimmed];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n");
    if (cut < max * 0.5) cut = window.lastIndexOf(". ");
    if (cut < max * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function clampText(text: string, max = COMMENT_MAX): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;

  const window = trimmed.slice(0, max - 1);
  let cut = window.lastIndexOf(". ");
  if (cut < max * 0.5) cut = window.lastIndexOf(" ");
  if (cut <= 0) cut = max - 1;
  return `${trimmed.slice(0, cut + 1).trim()}…`;
}
