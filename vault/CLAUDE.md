# Curam Vault — CLAUDE.md

Invite-based multi-user AI workspace. Node.js/Express backend + React/Vite frontend. Deployed on Railway at `https://curam-vault.up.railway.app`. PostgreSQL 15 + pgvector. Primary AI: Anthropic Claude. Secondary: Google Gemini.

---

## Stack

**Backend:** Node.js/Express · PostgreSQL 15 + pgvector · `pg` (no ORM) · node-cron · multer  
**Frontend:** React 18 + Vite · Zustand (4 stores) · React Router v6 · Tailwind CSS  
**AI:** Anthropic SDK (streaming + prompt caching) · Google Generative AI SDK (Gemini + embeddings)  
**Deploy:** Railway · `vault/railway.toml` · push `version-7` branch → auto-deploy

---

## Key Files

- `server/index.js` — Express entry, route registration order matters (shared routes before requireAuth)
- `server/db.js` — all 44 tables in one file; every statement idempotent (`IF NOT EXISTS`); runs on every boot
- `server/middleware/auth.js` — 32-byte hex token lookup in `auth_sessions` + `requireAdmin` guard
- `server/routes/admin.js` — admin dashboard stats/monitor + user management endpoints
- `server/routes/chat.js` — `buildSystemPrompt()`, prompt caching, SSE streaming, model routing
- `server/services/modelResolver.js` — **`getModelsForUser()`**: resolves **`light`** / **`standard`** / Gemini / DeepSeek from Settings (see **Model selection**)
- `client/src/hooks/useModels.js` — loads **`vault_models`** + **`default_model`** + **`branch_eval_model`** via `/api/settings`
- `client/src/utils/apiClient.js` — authenticated fetch wrapper; **use this for all `/api/` calls**
- `client/src/store/authStore.js` — Zustand auth (token, user); persisted
- `client/src/store/processingStore.js` — global long-running operation state; drives `ProcessingModal`
- `client/src/components/ProcessingModal.jsx` — **global blocking overlay** for slow operations; rendered once in `App.jsx`
- `client/src/providers/IconProvider.jsx` — `getIcon(name, props)` semantic map; add icons here before using
- `client/src/providers/ThemeProvider.jsx` — writes `--color-*` CSS vars to `<head>` on mount/change
- `client/DESIGN.md` — **read before any UI/client work** (tokens, layout, components, do/don’t)
- `server/services/SuggestionService.js` — **all services/crons/agents call this** to emit inbox findings
- `server/routes/suggestions.js` — agent suggestion inbox API
- `server/services/marketData.js` — Shares quote fetching: Finnhub (NYSE/NASDAQ) + Alpha Vantage (ASX) + Frankfurter FX
- `server/services/sharesPortfolio.js` — `computeHoldingsAndRealized()`, `buildDashboard()`, quote cache, exchange-filtered snapshots
- `server/services/sharesNewsService.js` — daily briefings + monthly summaries: Finnhub/web search → AI → `share_news_briefings`
- `server/routes/shares.js` — CRUD for trades + cash, dashboard, charts, refresh
- `server/routes/sharesNews.js` — `GET /api/shares/news`, `POST /api/shares/news/generate`, `POST /api/shares/news/generate-summary`

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

### WP Theme Builder (`my-wp-theme-builder/`)

Mounted at **`/tb`**. Stage 1 model routing is **separate** from chat defaults but uses the same Vault **`vault_models`** / **`default_model`** when no app override is set.

**App overrides (beat Vault defaults):** `THEME_BUILDER_DESIGN_MODEL`, `THEME_BUILDER_DEV_DESIGN_MODEL` (local only), `workspace_settings.theme_builder_design_model` (Settings → AI & Chat → Theme builder design model).

**Local dev:** use Ollama via `THEME_BUILDER_DEV_DESIGN_MODEL` — do not silently switch to cloud APIs in code. **Production:** cloud models from Settings + Railway API keys.

Full priority table and env vars: **`docs/theme-builder.md`**. Resolver: `my-wp-theme-builder/utils/themeBuilderModel.js`.

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

Full reference: **`client/DESIGN.md`**. Cursor rule `.cursor/rules/vault-ui.mdc` applies when editing `client/**`.

**Theming:** Six CSS custom properties (`--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-text`, `--color-muted`). ThemeProvider writes them to `<head>`. Use `var(--color-xxx)` inline, not Tailwind `dark:` classes. Warnings: hardcoded amber (`#f59e0b`). Errors: hardcoded red (`#ef4444`). Status colours are intentionally outside the theme system.

**Default palette (warm-sand):** bg `#F5F5F0` · surface `#EEEEE8` · border `#D8D8D0` · primary `#CC785C` · text `#1A1A1A` · muted `#888888`

**Layout:** Full-viewport flex row: sidebar + main (flex-1). Use `100dvh` with `100vh` fallback. Single responsive breakpoint: `sm` (640px). Sidebar has three states: **expanded** (user's saved width, 180–520px, default 240px) · **collapsed** (48px icon rail, desktop default on first load) · **hidden** (mobile only, fixed overlay). Desktop state persisted in `localStorage` key `vault:sidebarOpen`. `ProjectSidebar` receives `collapsed` prop from `Layout`; collapsed renders icon-only rail, full renders the complete project/session tree.

**Hover:** Always `hover:opacity-60` or `hover:opacity-70`. Never colour-shift hover. Works across all themes without per-theme tokens.

**Transitions:** 200ms everywhere. No exceptions.

**Destructive confirms:** Inline ("Delete? Yes / No") for routine deletions. `ConfirmModal` only for high-stakes ops requiring type-to-confirm input.

**No `<Button>` component.** Buttons composed inline. Keep it that way.

**Icons:** Always via `getIcon(name, { size: n })` from `IconProvider`. Add to the semantic map before using — never import Lucide directly in components.

**Z-index convention:** dropdowns `z-20` · mobile sidebar `z-40` · modals `z-50` · ProcessingModal `z-[9998]` · toasts `z-[9999]`

### ProcessingModal — global blocking overlay

**Use this for any operation that takes >2 seconds and must not be interrupted.**

```javascript
const { startProcessing, stopProcessing } = useProcessingStore();

// In your async handler:
startProcessing('Descriptive action label…', 'Optional detail sentence.');
try {
  await longRunningOperation();
} finally {
  stopProcessing();
}
```

`ProcessingModal` is rendered once in `App.jsx`. It reads `processingStore`, displays a full-screen overlay with a spinning loader, the message, and a "please don't navigate away" warning. It also attaches a `beforeunload` listener to catch tab close / reload while active.

**When to use:** AI generation, bulk imports, file processing, any server call expected to take >2 s. **Do not use** for instant CRUD operations — those use `toastStore` success/error toasts only.

---

## Agent suggestions inbox

**Mandatory:** Every server service, cron job, and background routine that detects an anomaly, gap, or improvement opportunity **must** call `SuggestionService.capture()` or `captureIf()` — do not only log to console.

```javascript
const { capture, captureIf, makeFingerprint } = require('../services/SuggestionService');

await captureIf(articles.length === 0, {
  userId,
  source: 'myServiceName',
  category: 'alert',
  fingerprint: makeFingerprint('myServiceName', `topic:${id}:empty`),
  title: 'Short summary',
  body: 'What happened and suggested fix',
  context: 'optional path or job id',
});
```

Specialised helpers: `reportNewsDigestRun`, `reportMemoryHealth`, `reportSharesCron`, `runStartupChecks`.

After **substantial** vault work (new feature, refactor, routine, migration, repeated pattern), if you notice something the user should triage — anomaly, missing rule/skill/automation, config gap, design drift — **add a suggestion** via `SuggestionService` or `POST /api/suggestions`.

**UI:** `/suggestions` · **API:** `POST /api/suggestions` · **Docs:** `docs/suggestions-inbox.md`

```json
{
  "category": "rule | skill | automation | source | alert | other",
  "title": "Short actionable summary",
  "body": "What you found, why it matters, suggested fix",
  "context": "optional: file path, cron job, commit, session"
}
```

**When to suggest:** repetitive manual steps → `automation` or `skill`; missing Cursor rule → `rule`; code smell / misconfig → `source` or `alert`; doc/design gap → `rule` or `other`.

**When not to:** trivial typos you already fixed; normal chat Q&A; every minor observation.

User triages with status: `new` → `opened` → `apply` | `learn` | `ignore`. Do not change status via API — user owns triage.

If the dev server is running locally, agents may POST via curl with the user's session token. Otherwise note the suggestion in chat and offer to add it when the server is up.

---

## Key Patterns & Rules

- All named routes before `/:id` in every route file — critical ordering.
- **Suggestions:** services and crons must call `SuggestionService.capture()` / `captureIf()` when anomalies are found — see `docs/suggestions-inbox.md`.
- `/api/shared` and `gmail.js` registered before `requireAuth` in `server/index.js`.
- `SharedTaskPage` at `/shared/task/:token` must be **outside** `AuthGuard` in `App.jsx`.
- Settings API: `GET /api/settings` returns all keys; `POST /api/settings { key, value }` upserts (empty value = delete).
- File uploads: `multer` to `uploads/<projectId>/`. Code files stored as `<name>_<ext>.txt`. SSRF guard in `fetchUrl.js` — resolves DNS + rejects private IP ranges before fetching any user URL.
- Kanban columns sort by `task.order`, not `sortTasks()`. Critical for within-column reorder.
- `formatEffort(mins)` → `'3h 30m'` / `'45m'` / `'—'`. `parseEffortInput(str)` handles `45m`, `3h`, `1.5h`, `2d`, bare numbers.
- `toast-in` animation, sidebar collapse, icon rotation: all 200ms. Single `--duration-fast: 200ms` if ever extracted.

---

## Schema Notes

- 44 tables. All schema in `server/db.js`. No migration tool — idempotent DDL on every boot.
- `sessions.sessionId` is `TEXT PRIMARY KEY` (UUID), not SERIAL.
- `sessions."deletedAt"` is a soft-delete timestamp. Chat delete moves sessions to Deleted; messages remain for restore. Normal lists/search/RAG must filter `s."deletedAt" IS NULL`.
- `users."isAdmin"` is `BOOLEAN NOT NULL DEFAULT FALSE`; first user is promoted to admin during bootstrap/backfill.
- `tasks."order"` double-quoted everywhere (SQL reserved word).
- `tasks."keyResultId"` FK added via `ALTER TABLE` after `key_results` is created (avoids forward reference).
- `gmail_tokens.expiryDate` is `BIGINT` (Unix ms). Cast to `Number()` in routes.
- Multi-user `"userId"` columns added post-hoc. Every query filters by `"userId"=$1`.
- `share_trades.exchange` CHECK constraint `('ASX','NYSE','NASDAQ')` added via `ALTER TABLE` (post-DDL, inside `DO $$ ... EXCEPTION WHEN OTHERS THEN NULL $$` to survive re-runs).
- `share_trades.pricePerShare` is stored in **AUD** for all new trades. Legacy USD rows carry `currency='USD'` + `fxRateToAud` for backward compatibility.
- `share_news_briefings`: `symbol IS NULL` row = market summary for that date. `type` column: `'daily'` (45-day retention, auto-pruned) or `'monthly_summary'` (never deleted). Unique index `idx_share_news_user_date_sym_v2` on `(userId, date, COALESCE(symbol,''), COALESCE(exchange,''), type)`. Daily generate deletes then re-inserts today's `type='daily'` rows. Monthly summaries stored separately and retained permanently. **`DATE` columns from pg come back as strings `'YYYY-MM-DD'`; always `String(b.date).slice(0,10)` before string ops — do not assume it's always a primitive.**

---

## Features

Projects · Folders · Chat (project + general) · Files (RAG) · Personas · Prompts · Memory · **Suggestions inbox** · Pinned URLs · Document Compare · Multi-Model Debate · Tasks (list/board/calendar/matrix) · Goals (OKR-lite) · Chat History · Web Search (`@search`, Brave/Serper/SerpAPI) · Gmail integration · Google Calendar · Google Drive backup · News Digest · Finance · Admin dashboard + user management · Password reset · Shared task public links · **Student** (Quiz + Cards + Saved decks) · **Shares** (portfolio tracker)

**Student → Quiz** (`/student/quiz/*`): Dashboard, Quiz Library (AI-generated pools via `POST /api/student-quizzes`), Take Quiz, Results. Uses **`getModelsForUser` `standard`** for generation/marking — not hardcoded model ids. Tables: `student_quizzes`, `student_quiz_attempts`. Routes: `server/routes/studentQuizzes.js`.

**Shares** (`/shares`): Personal share portfolio tracker. Tabs: Portfolio · Trades · Cash · Charts · News.

- **Holdings + P&L:** `computeHoldingsAndRealized()` in `sharesPortfolio.js` processes trades chronologically (avg-cost method). Returns open holdings + realized P&L per sell. `buildDashboard()` fetches live quotes and returns `positions`, `realized`, `totalRealizedPnlAud`, `unrealizedPnlAud`.
- **Quotes:** Finnhub (`FINNHUB_API_KEY`) for NYSE/NASDAQ; Alpha Vantage (`ALPHA_VANTAGE_API_KEY`) for ASX. Frankfurter for USD→AUD. In-memory quote cache (15 min for user page loads) prevents burning Alpha Vantage's 25 req/day free-tier limit.
- **Cron schedules** (timezone = admin user's `user_timezone` setting, fallback `Australia/Sydney`): ASX snapshots 5 AM + 1 PM; US snapshots hourly 10:00–16:00 ET Mon–Fri; daily news briefings 4 AM; **Portfolio Note email 7 AM**; monthly summary 1st of month 4:30 AM. US poll also runs hourly drop/update emails to admins (see `docs/shares-portfolio-note.md`).
- **Exchange filter:** cron passes `['ASX']` or `['NYSE','NASDAQ']` to `recordSnapshots()` so each run only calls the relevant quote API; stale cache covers the other exchange for the portfolio snapshot.
- **Timezone:** All date storage and cron scheduling use the admin user's `user_timezone` profile setting (read via `GET /api/settings/workspace-timezone`, which queries the first admin's `settings` row). Hardcoded `Australia/Sydney` was removed in favour of this dynamic lookup.
- **News tab — daily briefings:** `sharesNewsService.generateDailyBriefing()` fetches Finnhub company news (US) or web search (ASX), plus a Nasdaq market search, then makes one AI call (`callModel` → `standard` tier) producing per-stock paragraphs + `bullish/bearish/watch/neutral` signals. Stored with `type='daily'`. Auto-pruned after 45 days. Manual "Generate today" button triggers `ProcessingModal`. UI groups by date in an **accordion** — one day open at a time, most recent open by default, collapsed header shows signal badge and stock count.
- **News tab — 30-day summaries:** `sharesNewsService.generateMonthlySummary()` reads 30 days of daily briefings, sends to AI for trend + signal-accuracy review. Stored with `type='monthly_summary'`, never deleted. Triggered via "30-day summary" button (also uses `ProcessingModal`). Cron also runs on the 1st of each month.
- **Portfolio Note (daily email):** `sharesNewsService.generateObservation()` — structured analyst note (TOP LINE, MOVERS & CAUSALITY, SECTOR & MACRO, NEWS WORTH ACTING ON, RISK WATCH, DECISION TRIGGERS, ONE-LINER). Pre-computes portfolio day move, per-holding beat/lag vs SOX/Nasdaq/ASX proxies, and mover list before a 3-stage LLM pipeline. Stored `type='observation'`, emailed 7 AM + on manual observe/refresh. Full spec: **`docs/shares-portfolio-note.md`**.
- **JSONB from pg:** `headlines` column is JSONB. The `pg` driver returns JSONB as a parsed JS object, not a string. Always use `typeof val === 'string' ? JSON.parse(val) : val` pattern — never `JSON.parse(pgJsonbValue)` directly.
- **Tables:** `share_trades`, `share_cash_ledger`, `share_portfolio_snapshots`, `share_symbol_snapshots`, `share_news_briefings`.
- **Routes:** `server/routes/sharesNews.js` registered **before** `server/routes/shares.js` in `server/index.js` to prevent the broader prefix from consuming `/api/shares/news/*` requests.
- **Feature flag:** `shares` in `featureAccess` — admin controls member access.
- **All prices entered in AUD.** Legacy USD rows: `currency='USD'` + `fxRateToAud` stored for backward compat.
- **ASX quote history:** see `vault/docs/shares-api-research.md` for full account of failed providers before Alpha Vantage.

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
| `FINNHUB_API_KEY` | Shares — NYSE/NASDAQ quotes + company news (free tier, no IP block on Railway) |
| `ALPHA_VANTAGE_API_KEY` | Shares — ASX quotes (free tier: 25 req/day; cron polls 2×/day + 15 min cache for UI) |
| `DOMSCAN_API_KEY` | Domain & Brand — DomScan API (10,000 free credits/month); used by `server/routes/domains.js` |

---

## Local Dev

App is broken locally (Node env issues — see `local-setup-issues.md`). Use Railway for testing production behaviour. Git remote: push `version-7` → Railway auto-deploys.

Run from project root `C:\Users\micha\Local Sites\Curam-Protocol` for all git commands.
