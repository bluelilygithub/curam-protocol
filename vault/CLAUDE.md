# Curam Vault — CLAUDE.md

Invite-based multi-user AI workspace. Node.js/Express backend + React/Vite frontend. Deployed on Railway at `https://curam-vault.up.railway.app`. PostgreSQL 15 + pgvector. Primary AI: Anthropic Claude. Secondary: Google Gemini.

---

## Stack

**Backend:** Node.js/Express · PostgreSQL 15 + pgvector · `pg` (no ORM) · node-cron · multer  
**Frontend:** React 18 + Vite · Zustand (3 stores, persisted) · React Router v6 · Tailwind CSS  
**AI:** Anthropic SDK (streaming + prompt caching) · Google Generative AI SDK (Gemini + embeddings)  
**Deploy:** Railway · `vault/railway.toml` · push `version-7` branch → auto-deploy

---

## Key Files

- `server/index.js` — Express entry, route registration order matters (shared routes before requireAuth)
- `server/db.js` — all 39 tables in one file; every statement idempotent (`IF NOT EXISTS`); runs on every boot
- `server/middleware/auth.js` — 32-byte hex token lookup in `auth_sessions` + `requireAdmin` guard
- `server/routes/admin.js` — admin dashboard stats/monitor + user management endpoints
- `server/routes/chat.js` — `buildSystemPrompt()`, prompt caching, SSE streaming, model routing
- `server/services/modelResolver.js` — **`getModelsForUser()`**: resolves **`light`** / **`standard`** / Gemini / DeepSeek from Settings (see **Model selection**)
- `client/src/hooks/useModels.js` — loads **`vault_models`** + **`default_model`** + **`branch_eval_model`** via `/api/settings`
- `client/src/utils/apiClient.js` — authenticated fetch wrapper; **use this for all `/api/` calls**
- `client/src/store/authStore.js` — Zustand auth (token, user); persisted
- `client/src/providers/IconProvider.jsx` — `getIcon(name, props)` semantic map; add icons here before using
- `client/src/providers/ThemeProvider.jsx` — writes `--color-*` CSS vars to `<head>` on mount/change

---

## Auth

Token-based, not JWT. 32-byte random hex stored in `auth_sessions` table. Every request hits DB once for lookup. Intentional: instant invalidation without a blocklist.

`requireAuth` protects all `/api/*` except `/api/auth/*`, `/api/health`, and `/api/shared/*` (public task sharing). The shared routes **must** be registered before `requireAuth` in `server/index.js`.

`/api/admin/*` is protected by `requireAdmin` (checks `users."isAdmin"`). The seeded first user is admin by default.

**Never use raw `fetch('/api/...')` in frontend.** Always use `apiClient`.

---

## Database Patterns

- Raw SQL, parameterised queries (`$1`, `$2`). No ORM.
- All camelCase column names double-quoted: `"projectId"`, `"createdAt"`, `"userId"`.
- `COUNT(*)` / `SUM()` return strings from PostgreSQL — always wrap with `Number()`.
- Transactions: `const client = await pool.connect()` → `BEGIN` / `COMMIT` / `ROLLBACK` / `client.release()`.
- Upsert: `INSERT ... ON CONFLICT (key) DO UPDATE SET ...=EXCLUDED....`
- Named routes must come **before** `/:id` routes in every route file.
- `"order"` is a SQL reserved word — always double-quoted in DDL and queries.

---

## AI / Streaming

**Provider routing:** `modelId.startsWith('gemini-')` → Google SDK. Everything else → Anthropic. **`modelResolver` + defaults + overrides:** see **[Model selection](#model-selection)**.

**Prompt caching (Anthropic):** `buildSystemPrompt()` returns an array of content blocks with `cache_control: { type: 'ephemeral' }`, ordered by change frequency. Max 4 cache breakpoints. The final block (today's date, web search notice) is never cached.

| Block | Content | Invalidated when |
|---|---|---|
| 1 | Project name + persona system prompt (omitted if neither present) | Persona switched |
| 2 | Project brief fields (Goal, Problem, Audience, Tech stack, Constraints, Success, Tone, Notes) | Project switched or edited |
| 3 | Global memory entries | Memory entry changed |
| 4 | Pinned files + session files + web pages | File uploaded / URL pinned |
| 5 | Date + user profile + web search notice | Every request (no cache) |

**SSE streaming pattern:**
```javascript
// Server
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
// Always emit [DONE] even on error — client depends on clean close
stream.on('error', () => { res.write('data: [DONE]\n\n'); res.end(); });
```
```javascript
// Client — buffer partial lines across network packets
buf += decoder.decode(value, { stream: true });
const lines = buf.split('\n');
buf = lines.pop(); // keep partial line
```

---

## Model selection

**Rule:** The workspace default for *which model id runs* comes from **Settings** (`vault_models` + optional **`default_model`**), resolved on the server by **`getModelsForUser(userId)`** in **`server/services/modelResolver.js`**. Do not hardcode Anthropic/Gemini/DeepSeek **ids** as fallbacks for user-facing chat or “default” behaviour — adding new literals for routing belongs only in **`vault_models`** (or pricing / static catalog exceptions below).

**Settings keys (`settings` table, per `userId`):**

| Key | Role |
|---|---|
| **`vault_models`** | JSON array of `{ id, name, emoji, … }` — allowed ids for this user’s UI and resolver input order |
| **`default_model`** | Optional. If present **and** that `id` is in **`vault_models`**, it becomes the **`standard`** tier; otherwise **`standard`** is the **first** id in **`vault_models`** |
| **`branch_eval_model`** | Separate from chat default — branch-suggestion evaluation only |

If the user has no **`vault_models`** row (or empty list), resolver uses the **first admin’s** **`vault_models` / `default_model`**.

**Resolver tiers (server):**

- **`standard`** — “default model” slot for substantive work: primary chat stream (when no stricter override), new projects (when member may not choose), compare default, mood, PDF analysis default, chain step fallback when step has no `model`, etc.
- **`light`** — cheaper path for background calls: session summaries, suggestion chips, NLP on selections, task/goal helpers, Gmail/Calendar summaries, etc. **Not** the same as **`default_model`** unless your configured list/order makes them align.
- **`gemini`** / **`deepseek`** — first matching id from **`vault_models`** for provider-specific fallbacks.

**Primary chat precedence** (`server/routes/chat.js`): requested body `model` (when caller may supply it) → project **`projects.model`** (or Student Cards path rules) → **`standard`**.

**Explicit overrides users expect:**

- **Per-session / header model** (`chatModel`) when **Feature Access → Model Selection (Members)** is on (`feature_memberModelSelection` in `workspace_settings`; `memberModelSelection` in **`featureAccess`** on the client) — frontend: `effectiveModel = … || project?.model || defaultModel || first in loaded list`; server must honour `model` on the request where applicable.
- **Per-project** `projects.model` — stored default for that workspace.
- **Chains** — each step can set its own `model`; unresolved steps use **`standard`**.
- **Debate / multi-model** — user picks models per side; not governed by **`default_model`** alone.

**Frontend:**

- **`useModels`** + Settings **AI & Chat** tab persist **`vault_models`** and **`default_model`** via **`POST /api/settings`**.
- **`client/src/utils/models.js`** — seed list for reset, tours, **`PROJECT_TYPES` recommendations**, and display helpers. **`getModelShortName(id)`** shows **`emoji name`** only when `id` is in that catalog; unknown ids render as **the raw string** (no silent substitute).

**Exceptions (hardcoded ids allowed):**

- **Pricing / cost estimates** (`costCalculator.js`, `pricing.js`) — tariff tables keyed by id; unknown ids fall back heuristically for **cost display**, not for **which model ran**.
- **Legacy / migration** artefacts (e.g. old SQL defaults in backup files) — not runtime behaviour.

---

## RAG Pipeline

Files → `chunker.js` (~500 token chunks, 50-token overlap, sentence boundary splits) → `embeddings.js` (Google `text-embedding-004`, 768-dim) → `file_chunks` table.

At chat time: user message embedded → pgvector cosine similarity → top-5 chunks injected.

**Fallback** (no GEMINI_API_KEY or no chunks): full-text injection capped at 32K chars. `ragFallbackActive: true` sent in usage event → amber chip shown in context bar.

Pinned files use RAG (chunks). Session files inject in full — user attached them for a reason.

---

## Context Hierarchy

Three tiers, each injected into the system prompt in order:

1. **Global memory** — injected everywhere, always
2. **Project context** — brief + pinned files (RAG) + pinned URLs; all chats in the project
3. **Session context** — session files (full text) + URL attachments; this conversation only

---

## UI System

**Theming:** Six CSS custom properties (`--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-text`, `--color-muted`). ThemeProvider writes them to `<head>`. Use `var(--color-xxx)` inline, not Tailwind `dark:` classes. Warnings: hardcoded amber (`#f59e0b`). Errors: hardcoded red (`#ef4444`). Status colours are intentionally outside the theme system.

**Default palette (warm-sand):** bg `#F5F5F0` · surface `#EEEEE8` · border `#D8D8D0` · primary `#CC785C` · text `#1A1A1A` · muted `#888888`

**Layout:** Full-viewport flex row: sidebar (240px fixed) + main (flex-1). Use `100dvh` with `100vh` fallback. Single responsive breakpoint: `sm` (640px).

**Hover:** Always `hover:opacity-60` or `hover:opacity-70`. Never colour-shift hover. Works across all themes without per-theme tokens.

**Transitions:** 200ms everywhere. No exceptions.

**Destructive confirms:** Inline ("Delete? Yes / No") for routine deletions. `ConfirmModal` only for high-stakes ops requiring type-to-confirm input.

**No `<Button>` component.** Buttons composed inline. Keep it that way.

**Icons:** Always via `getIcon(name, { size: n })` from `IconProvider`. Add to the semantic map before using — never import Lucide directly in components.

**Z-index convention:** dropdowns `z-20` · mobile sidebar `z-40` · modals `z-50` · toasts `z-[9999]`

---

## Key Patterns & Rules

- All named routes before `/:id` in every route file — critical ordering.
- `/api/shared` and `gmail.js` registered before `requireAuth` in `server/index.js`.
- `SharedTaskPage` at `/shared/task/:token` must be **outside** `AuthGuard` in `App.jsx`.
- Settings API: `GET /api/settings` returns all keys; `POST /api/settings { key, value }` upserts (empty value = delete).
- File uploads: `multer` to `uploads/<projectId>/`. Code files stored as `<name>_<ext>.txt`. SSRF guard in `fetchUrl.js` — resolves DNS + rejects private IP ranges before fetching any user URL.
- Kanban columns sort by `task.order`, not `sortTasks()`. Critical for within-column reorder.
- `formatEffort(mins)` → `'3h 30m'` / `'45m'` / `'—'`. `parseEffortInput(str)` handles `45m`, `3h`, `1.5h`, `2d`, bare numbers.
- `toast-in` animation, sidebar collapse, icon rotation: all 200ms. Single `--duration-fast: 200ms` if ever extracted.

---

## Schema Notes

- 39 tables. All schema in `server/db.js`. No migration tool — idempotent DDL on every boot.
- `sessions.sessionId` is `TEXT PRIMARY KEY` (UUID), not SERIAL.
- `users."isAdmin"` is `BOOLEAN NOT NULL DEFAULT FALSE`; first user is promoted to admin during bootstrap/backfill.
- `tasks."order"` double-quoted everywhere (SQL reserved word).
- `tasks."keyResultId"` FK added via `ALTER TABLE` after `key_results` is created (avoids forward reference).
- `gmail_tokens.expiryDate` is `BIGINT` (Unix ms). Cast to `Number()` in routes.
- Multi-user `"userId"` columns added post-hoc. Every query filters by `"userId"=$1`.

---

## Features

Projects · Folders · Chat (project + general) · Files (RAG) · Personas · Prompts · Memory · Pinned URLs · Document Compare · Multi-Model Debate · Tasks (list/board/calendar/matrix) · Goals (OKR-lite) · Chat History · Web Search (`@search`, Brave/Serper/SerpAPI) · Gmail integration · Google Calendar · Google Drive backup · News Digest · Finance · Admin dashboard + user management · Password reset · Shared task public links

---

## Environment Variables

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude |
| `GEMINI_API_KEY` | Gemini + embeddings |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | Gmail, Calendar, Drive OAuth |
| `ENCRYPTION_KEY` | Encrypts stored OAuth tokens — **do not lose** |
| `DATABASE_URL` | PostgreSQL connection |
| `UPLOAD_DIR` | Railway volume mount path |
| `APP_URL` | Public URL (OAuth redirects, password reset emails) |
| `SEED_EMAIL` / `SEED_PASSWORD` | Auto-created user on first boot |
| `INVITE_CODE` | Required for new user registration |

---

## Local Dev

App is broken locally (Node env issues — see `local-setup-issues.md`). Use Railway for testing production behaviour. Git remote: push `version-7` → Railway auto-deploys.

Run from project root `C:\Users\micha\Local Sites\Curam-Protocol` for all git commands.
