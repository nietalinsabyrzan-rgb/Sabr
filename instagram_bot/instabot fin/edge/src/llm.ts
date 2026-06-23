import { config } from "./config.js";
import { metrics } from "./metrics.js";

export type Surface = "comment" | "dm";

// Thin client for the internal model server (Ollama + RAG). Reply generation
// happens there; the edge node only forwards the question and posts the answer.
export async function generateReply(opts: {
  surface: Surface;
  userMessage: string;
  username?: string;
}): Promise<string> {
  const started = Date.now();
  const res = await fetch(`${config.modelServerUrl}/generate-reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`model server ${res.status}: ${text.slice(0, 500)}`);
  }
  metrics.observeLatency("model_server_ms", Date.now() - started);

  const data = JSON.parse(text) as { reply?: unknown };
  if (typeof data.reply !== "string" || !data.reply.trim()) {
    throw new Error("model server returned an empty reply");
  }
  return data.reply.trim();
}

export async function modelServerHealthy(): Promise<boolean> {
  try {
    // /readyz, not /healthz: the model server is only useful to us once its
    // RAG index is built and Ollama is reachable.
    const res = await fetch(`${config.modelServerUrl}/readyz`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
