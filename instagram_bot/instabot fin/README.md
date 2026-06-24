# Otbasy InstaBot

Instagram bot that replies to comments **with a comment** and to DMs **with a DM**, grounded in the Otbasy Bank product knowledge base. Auto-detects KZ/RU and answers in kind.

Two services:

```
Instagram (Meta)
   │  webhook in / Graph API out  (internet, 443)
   ▼
┌─────────────────────────────┐   internal LAN     ┌────────────────────────────┐
│  edge/  (DMZ / public)      │ ── /generate-reply ▶│  model-server/ (private)    │
│  - receive webhook          │ ◀── reply text ──── │  - LLM chat + embeddings    │
│  - call Instagram Graph API │                     │  - RAG over knowledge.md    │
└─────────────────────────────┘                     └────────────────────────────┘
```

| Service | Role |
|---|---|
| `edge/` | Internet-facing. Receives webhooks, queues events, posts replies via `graph.instagram.com`. Holds no model/data beyond operational state in `data/`. |
| `model-server/` | Private service. OpenAI or local Ollama chat + embeddings with RAG over `model-server/knowledge.md`. One endpoint: `POST /generate-reply {surface, userMessage, username?} -> {reply}`. |

## Install & build

```bash
npm install        # installs both workspaces
npm run build      # tsc for both
npm test           # unit tests for both
```

Per-service config: copy `edge/.env.example` → `edge/.env` and `model-server/.env.example` → `model-server/.env`, fill in values. Both services **fail fast at startup** if required env vars are missing. In production, inject secrets (`IG_ACCESS_TOKEN`, `IG_APP_SECRET`, …) from the bank's secrets manager — never commit them.

## Run

```bash
# model server:
npm run start:model     # :8080, builds the RAG index on first boot (cached in data/)

# edge box:
npm run start:edge      # :3000, MODEL_SERVER_URL must point at the model server
```

Dev mode: `npm run dev:edge` / `npm run dev:model` (+ ngrok for the webhook callback, see HANDOFF.md for the Meta app setup).

## Operations

- **Kill switch** — set `AUTO_REPLY_ENABLED=false` on the edge and restart: webhooks are still acknowledged (200) but nothing is generated or sent.
- **Dedup** — processed event IDs persist in `edge/data/processed-events.txt`; restarts don't re-reply to old events. Single instance only — move to Redis before running replicas.
- **Retry / dead-letter** — events are processed off an in-process queue with exponential backoff (4 attempts); exhausted jobs land in `edge/data/dead-letter.jsonl` for manual replay.
- **Token auto-refresh** — the IG long-lived token (~60-day expiry) is refreshed when older than `IG_TOKEN_REFRESH_DAYS` (default 7); the refreshed token persists in `edge/data/ig-token.json`. Refresh failures are logged loudly (`token_refresh_failure` metric) — alert on them.
- **Audit log** — every inbound message and outbound reply is written to `edge/data/audit/audit-YYYY-MM-DD.jsonl` with sensitive values (ИИН, card numbers, codes) redacted before hitting disk. Files older than `AUDIT_RETENTION_DAYS` (default 90) are pruned daily.
- **Sensitive data** — if a user sends an ИИН / card number / code, the message is never forwarded to the model; the bot replies with a KZ/RU warning instead.
- **Endpoints** — both services expose `/healthz` (liveness), `/readyz` (readiness: edge checks the model server; model server checks the active LLM provider + RAG index) and `/metrics` (JSON counters/latencies).

## How replies are generated

`model-server` chunks `knowledge.md` by heading (~1.4KB chunks), embeds them with `EMBED_MODEL`, and caches the vectors in `data/rag-cache.json` (keyed by knowledge hash + provider + model; delete nothing, it rebuilds automatically when `knowledge.md` changes). Per request it retrieves the top-`RAG_TOP_K` chunks and sends them with the guardrail system prompt to the active chat model.

By default it uses OpenAI:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
EMBED_MODEL=text-embedding-3-small
```

For local no-OpenAI-key mode, run Ollama and use:

```bash
LLM_PROVIDER=ollama
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
EMBED_MODEL=nomic-embed-text
```

Required local models:

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

Tone, length and guardrails live in `model-server/src/prompt.ts`.

**Updating the knowledge base:** replace `model-server/knowledge.md` and restart the model server; the index re-embeds once.

Instagram limits are enforced on the edge: DMs are chunked at 1000 chars, comments clamped at 2200.

## Not done yet (intentionally)

- **Multi-account support** — current code is single-account (`IG_USER_ID`/`IG_ACCESS_TOKEN`); see HANDOFF.md P2.
- The `/privacy` page was removed — in production the privacy policy is a legal-reviewed page on the bank's website.

## Render deployment

This repo includes a root-level `render.yaml` Blueprint for Render. It creates:

- `otbasy-instabot-model` as a private Node service for RAG + OpenAI replies.
- `otbasy-instabot-edge` as the public Node web service for Instagram webhooks.

Use Render's Blueprint flow and connect this Git repo. Render will ask for secret values marked `sync: false`:

- `OPENAI_API_KEY` on the model service when `LLM_PROVIDER=openai`.
- `IG_USER_ID`, `IG_ACCESS_TOKEN`, and `IG_WEBHOOK_VERIFY_TOKEN` on the edge service.

After deploy, set the Meta webhook callback URL to:

```text
https://<edge-service>.onrender.com/webhook
```

Use the same `IG_WEBHOOK_VERIFY_TOKEN` value in Meta's webhook verify token field. The Blueprint uses paid `starter` instances because Render free web services can sleep and are not suitable for a 24/7 bot.

## Files

```
edge/src/
  index.ts        Express bootstrap, health/metrics, schedulers (token refresh, audit prune)
  webhook.ts      verify + event router → retry queue → reply (kill switch, sensitive-data block)
  instagram.ts    Graph API client (reply, DM chunking, comment clamp)
  llm.ts          HTTP client for the model server
  config.ts       env validation (fail fast)
  dedup.ts / queue.ts / audit.ts / redact.ts / token-store.ts / text.ts
  get-token.ts    one-time OAuth helper (npm run auth -w edge)
model-server/src/
  index.ts        /generate-reply, /healthz, /readyz, /metrics
  rag.ts          chunking, embeddings, cosine retrieval, disk cache
  ollama.ts       chat + embed clients (OpenAI-compatible / native API)
  prompt.ts       system instructions, prompt assembly, fallbacks
model-server/knowledge.md   product knowledge base (single source of truth)
```
