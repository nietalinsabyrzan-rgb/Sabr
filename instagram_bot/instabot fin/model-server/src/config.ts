import "dotenv/config";

const missing: string[] = [];

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    missing.push(name);
    return "";
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function optionalChoice<T extends string>(
  name: string,
  fallback: T,
  choices: readonly T[],
): T {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if ((choices as readonly string[]).includes(raw)) return raw as T;
  missing.push(`${name} (expected one of: ${choices.join(", ")})`);
  return fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    missing.push(`${name} (not a number: "${raw}")`);
    return fallback;
  }
  return n;
}

const llmProvider = optionalChoice("LLM_PROVIDER", "openai", ["openai", "ollama"] as const);
const openaiApiKey =
  llmProvider === "openai" ? required("OPENAI_API_KEY") : optional("OPENAI_API_KEY", "");
const openaiModel = optional("OPENAI_MODEL", "gpt-4o-mini");
const ollamaModel = optional("OLLAMA_MODEL", "qwen2.5:7b");

export const config = {
  port: optionalNumber("PORT", 8080),

  // LLM provider
  llmProvider,

  // OpenAI
  openaiApiKey,
  openaiModel,

  // Ollama
  ollamaHost: optional("OLLAMA_HOST", "http://127.0.0.1:11434"),
  ollamaModel,

  // Embeddings
  embedModel: optional(
    "EMBED_MODEL",
    llmProvider === "ollama" ? "nomic-embed-text" : "text-embedding-3-small",
  ),

  // RAG
  ragChunkSize: optionalNumber("RAG_CHUNK_SIZE", 800),
  ragChunkOverlap: optionalNumber("RAG_CHUNK_OVERLAP", 100),
  ragTopK: optionalNumber("RAG_TOP_K", 5),

  // Generation params
  maxTokens: optionalNumber("MAX_TOKENS", 512),
  temperature: optionalNumber("TEMPERATURE", 0.3),
  generateTimeoutMs: optionalNumber("GENERATE_TIMEOUT_MS", 90_000),

  knowledgePath: optional("KNOWLEDGE_PATH", "knowledge.md"),
  dataDir: optional("DATA_DIR", "data"),
};

export const activeChatModel =
  config.llmProvider === "ollama" ? config.ollamaModel : config.openaiModel;
export const embeddingCacheKey = `${config.llmProvider}:${config.embedModel}`;

if (missing.length > 0) {
  console.error(
    `[config] missing/invalid required environment variables:\n` +
      missing.map((m) => `  - ${m}`).join("\n") +
      `\nSet them in .env and restart.`
  );
  process.exit(1);
}
