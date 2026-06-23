import { config } from "./config.js";
import { tokenStore } from "./runtime.js";
import { chunkText, clampText, COMMENT_MAX } from "./text.js";

const GRAPH_VERSION = "v21.0";
// Instagram API with Instagram Login → https://graph.instagram.com (default)
// Instagram Graph API with Facebook Login → https://graph.facebook.com
const GRAPH_BASE = `${config.graphHost}/${GRAPH_VERSION}`;

async function post(path: string, body: Record<string, unknown>) {
  const url = `${GRAPH_BASE}/${path}?access_token=${encodeURIComponent(tokenStore.getToken())}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Graph POST ${path} failed ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function get(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ ...params, access_token: tokenStore.getToken() });
  const res = await fetch(`${GRAPH_BASE}/${path}?${qs}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Graph GET ${path} failed ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

export async function replyToComment(commentId: string, message: string) {
  return post(`${commentId}/replies`, { message: clampText(message, COMMENT_MAX) });
}

export async function sendDirectMessage(recipientId: string, text: string) {
  const parts = chunkText(text);
  for (const part of parts) {
    await post(`${config.igUserId}/messages`, {
      recipient: { id: recipientId },
      message: { text: part },
    });
  }
}

export async function getCommentText(commentId: string): Promise<string> {
  const data = await get(commentId, { fields: "text,from,username" });
  return data.text ?? "";
}
