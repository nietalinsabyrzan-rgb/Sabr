import { config } from "./config.js";

const OPENAI_API = "https://api.openai.com/v1";

export async function chatCompletion(opts: {
  system: string;
  user: string;
}): Promise<string> {
  if (config.llmProvider === "ollama") {
    return ollamaChatCompletion(opts);
  }
  return openaiChatCompletion(opts);
}

async function openaiChatCompletion(opts: {
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

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (config.llmProvider === "ollama") {
    return ollamaEmbedTexts(texts);
  }
  return openaiEmbedTexts(texts);
}

async function openaiEmbedTexts(texts: string[]): Promise<number[][]> {
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

export async function ollamaReachable(): Promise<boolean> {
  if (config.llmProvider === "ollama") {
    return ollamaReachableNative();
  }
  return openaiReachable();
}

async function openaiReachable(): Promise<boolean> {
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

async function ollamaChatCompletion(opts: {
  system: string;
  user: string;
}): Promise<string> {
  const res = await fetch(`${config.ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      options: {
        temperature: config.temperature,
        num_predict: config.maxTokens,
      },
    }),
    signal: AbortSignal.timeout(config.generateTimeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama chat failed ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text) as {
    message?: { content?: string };
    response?: string;
  };
  return (data.message?.content ?? data.response ?? "").trim();
}

async function ollamaEmbedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${config.ollamaHost}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.embedModel,
      input: texts,
    }),
    signal: AbortSignal.timeout(config.generateTimeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama embed failed ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text) as {
    embeddings?: number[][];
    embedding?: number[];
  };
  const embeddings = data.embeddings ?? (data.embedding ? [data.embedding] : undefined);
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error(
      `Ollama embed returned ${embeddings?.length ?? 0} vectors for ${texts.length} inputs`,
    );
  }
  return embeddings;
}

async function ollamaReachableNative(): Promise<boolean> {
  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
