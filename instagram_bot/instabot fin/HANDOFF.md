# Handoff — Otbasy Instagram Bot: Production Changes

This doc lists the code changes needed to take the current MVP to a production deployment
inside the bank. It's written to be read cold, without the original chat history.

---

## Current state (working MVP)

Single Node/TypeScript Express process, currently running on Railway against a **test
Instagram account** (not the bank's real one).

| File | Role |
|---|---|
| `src/index.ts` | Express bootstrap. Routes: `/` (health), `GET/POST /webhook`, `GET /privacy`. |
| `src/webhook.ts` | Webhook verify + event router (comments + DMs). **In-memory** dedup. Ignores echoes/self. |
| `src/instagram.ts` | Instagram Graph client. Host defaults to `graph.instagram.com`. `replyToComment`, `sendDirectMessage` (1000-char chunking), `getCommentText`. |
| `src/llm.ts` | Reply generation via **Anthropic Claude** (`claude-sonnet-4-6`), full `knowledge.md` sent as a cached system prompt. |
| `src/get-token.ts` | One-time OAuth helper to mint an Instagram long-lived token (`npm run auth`). |
| `knowledge.md` | Otbasy Bank product knowledge base (~280KB), single source of truth. |

It receives a comment → replies with a comment; receives a DM → replies with a DM.
Language (KZ/RU) is auto-detected. Replies are grounded in `knowledge.md`.

---

## Target architecture (production)

Two services, because the model server must stay off the internet:

```
Instagram (Meta)
   │  webhook in / Graph API out  (internet, 443)
   ▼
┌─────────────────────────────┐   internal LAN    ┌───────────────────────────┐
│  EDGE NODE (DMZ / public)   │ ── generate ────▶ │  MODEL SERVER (no internet)│
│  - receive webhook          │ ◀── reply text ─── │  - Ollama (local LLM)      │
│  - verify Meta signature    │                    │  - RAG over knowledge.md   │
│  - call Instagram Graph API │                    │  - GPU                     │
└─────────────────────────────┘                    └───────────────────────────┘
```

- **Edge node**: only internet-facing piece. Receives webhooks, posts replies. Holds no
  data/model. Reuses most of the current code (`webhook.ts` + `instagram.ts`).
- **Model server**: isolated (no internet). Runs Ollama + RAG, exposes one endpoint
  `POST /generate-reply { surface, userMessage } → { reply }`. Replaces `llm.ts`'s
  Anthropic call.
- Edge → model server is a plain HTTP call over the internal LAN (one port).
- The privacy policy page is **NOT** served by the bot in production — it lives on the
  bank's website (legal-reviewed). Remove `/privacy` from the edge.

---

## Decisions to resolve first (they change the code)

1. **Ingestion method.**
   - **Webhooks** (current) → instant; needs inbound 443 on the edge. The two-service
     design above assumes this.
   - **Polling** → outbound-only, no inbound; ~30–60s latency; requires rewriting the
     receiving half to poll `GET /me/conversations` + per-media `GET /{media}/comments`
     and track last-seen IDs.
   - **Cloud-queue hybrid** → cloud function receives webhook → queue → internal server
     pulls outbound. Near-instant, no inbound on bank network, but message text transits
     a cloud relay (needs legal sign-off).
2. **Number of Instagram accounts.** Current code is single-account (`IG_USER_ID` +
   `IG_ACCESS_TOKEN`). Multiple accounts = list of {id, token} + loop. Decide now.
3. **Meta side.** The current Meta app is on a throwaway test IG. Production needs the
   bank's real account(s) under the bank's **Meta Business Portfolio**, business
   **verification**, app owned by the bank, and freshly generated tokens.

---

## Code changes — prioritized

### P0 — required before production

1. **Split into edge + model service.**
   - Edge keeps `index.ts` (webhook routes only), `webhook.ts`, `instagram.ts`.
   - `llm.ts` becomes a thin HTTP client that calls the model server's `/generate-reply`
     instead of generating in-process.
   - New service (model server): Ollama + RAG + `/generate-reply`.

2. **Swap Anthropic → local Ollama, with RAG.** (`src/llm.ts` → model server)
   - Replace the Anthropic SDK call with an HTTP call to Ollama's OpenAI-compatible
     endpoint (`POST {OLLAMA_HOST}/v1/chat/completions`).
   - **Add RAG** — do NOT send all 280KB of `knowledge.md` every call (too large/slow for
     a local model). Chunk `knowledge.md`, embed (e.g. `bge-m3` / `multilingual-e5`,
     good for RU/KZ), retrieve top-k relevant chunks per question, put only those in the
     prompt. Keep the system instructions/guardrails from the current `SYSTEM_INSTRUCTIONS`.
   - Model must handle **Kazakh + Russian** — evaluate ISSAI KazLLM / Qwen2.5 / Aya on
     real product questions before committing.

3. **Webhook signature verification.** (`src/webhook.ts`)
   - Verify Meta's `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body using the
     app secret) on every `POST /webhook`; reject mismatches with 403.
   - Requires capturing the **raw request body** (the current `express.json()` parses it —
     add a verify callback to keep the raw buffer).
   - **Mandatory** before exposing inbound, or anyone can POST forged events.

4. **Kill switch.** (`src/webhook.ts` / config)
   - An env flag (e.g. `AUTO_REPLY_ENABLED=false`) that, when off, still 200s the webhook
     but skips generating/sending. Lets ops disable auto-replies instantly if the bot
     misbehaves.

5. **Persistent dedup / processed-state.** (`src/webhook.ts`)
   - Current dedup is an in-memory `Set` — resets on restart (risk: re-replying to old
     events) and won't work across >1 instance. Move to a small persistent store
     (file/SQLite/Redis) keyed by event/message/comment ID.

6. **Config & secrets hardening.**
   - Validate required env at startup (fail fast with a clear message).
   - Secrets (token, app secret) from a secrets manager, never in code/repo.

### P1 — strongly recommended

7. **Token auto-refresh.** Instagram token expires ~60 days. Add a scheduled job that
   calls `GET graph.instagram.com/refresh_access_token` before expiry and updates the
   stored token; alert on failure. (Otherwise the bot silently dies in ~2 months.)

8. **Audit logging (redacted).** Persist every inbound message and outbound reply for
   compliance — but **redact sensitive data** (ИИН, card numbers, codes). Define retention.

9. **Async processing + retry + reconciliation.** Currently the webhook 200s then
   processes inline; if the reply call fails, the event is lost. Add a queue, retry with
   backoff, and a dead-letter path. Optionally a periodic reconciliation poll as a safety
   net for missed webhooks.

10. **Sensitive-data handling.** Detect when a user sends ИИН/card/codes; the bot should
    refuse and warn (the prompt already instructs this — enforce + don't log the raw value).

11. **Observability.** Structured logging, an error tracker (e.g. Sentry), a real
    health/readiness endpoint, and basic metrics (replies sent, failures, latency).

### P2 — context-dependent / nice to have

12. **Multi-account support** (only if running on several IG accounts) — replace the single
    `IG_USER_ID`/`IG_ACCESS_TOKEN` with a list and route per account.

13. **Remove `/privacy` route** from the edge (privacy page lives on the bank website).

14. **Comment-length guard** — comments cap ~2200 chars; add the same chunking/clamp as
    DMs if needed (rarely hit).

15. **Tests** — none currently. At minimum: signature verification, dedup, chunking,
    language/grounding smoke tests.

---

## Network / infra requirements (for context; not code)

- Edge: inbound 443 (ideally restricted to Meta **AS32934**, path `/webhook` only),
  outbound 443 to **`graph.instagram.com`** (the only external host needed — Instagram
  Login flow), DNS for it.
- Model server: **no internet** — only an internal-LAN port reachable from the edge.
- If the bank uses a TLS-inspecting egress proxy: install its root CA on the edge and
  allowlist `graph.instagram.com`.
- Privacy policy: a public, legal-reviewed page on the bank's website (not the bot).

---

## Quick reference — endpoints used

- Send DM: `POST graph.instagram.com/v21.0/{ig-user-id}/messages`
- Reply to comment: `POST graph.instagram.com/{comment-id}/replies`
- Refresh token: `GET graph.instagram.com/refresh_access_token`
- All on `graph.instagram.com` (Instagram-Login flow). `graph.facebook.com` is the
  Facebook-Login flow and is **not** used here.
