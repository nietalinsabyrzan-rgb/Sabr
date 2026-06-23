import { config } from "./config.js";

const OPENAI_API = "https://api.openai.com/v1";

// OpenAI chat completion replacing Ollama's native chat endpoint
export async function chatCompletion(opts: {
  system: string;
  user: string;
}): Promise<string> {
  const res = await fetch(`${OPENAI_API}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
    }),
    signal: AbortSignal.timeout(config.generateTimeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI chat failed ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// OpenAI embeddings replacing Ollama's embed endpoint (batched)
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OPENAI_API}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.embedModel,
      input: texts,
    }),
    signal: AbortSignal.timeout(config.generateTimeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI embed failed ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text) as {
    data?: Array<{ embedding: number[] }>;
  };
  const embeddings = data.data?.map((d) => d.embedding);
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error(
      `OpenAI embed returned ${embeddings?.length ?? 0} vectors for ${texts.length} inputs`
    );
  }
  return embeddings;
}

// Health check — verify the OpenAI key works
export async function ollamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OPENAI_API}/models`, {
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
