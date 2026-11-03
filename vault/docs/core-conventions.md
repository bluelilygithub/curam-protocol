# Core conventions (full text)

Full versions of the Auth, Feature access, Database, AI/streaming, Model selection, RAG, Context, UI system and Suggestions sections. CLAUDE.md holds the short rules.

## Auth

Token-based, not JWT. 32-byte random hex stored in `auth_sessions` table. Every request hits DB once for lookup. Intentional: instant invalidation without a blocklist.

`requireAuth` protects all `/api/*` except `/api/auth/*`, `/api/health`, and `/api/shared/*` (public task sharing). The shared routes **must** be registered before `requireAuth` in `server/index.js`.

`/api/admin/*` is protected by `requireAdmin` (checks `users."isAdmin"`). The seeded first user is admin by default.

**Never use raw `fetch('/api/...')` in frontend.** Always use `apiClient`.

---

## Feature access

Two layers, workspace-wide then per-user, both **allow-by-default**:

1. **Workspace defaults** — `workspace_settings` rows keyed `feature_<name>` (`true`/`false`), admin-editable via Settings → Feature Access → `POST /api/settings/feature-access`. Missing row = default from `FEATURE_ACCESS_DEFAULTS`.
2. **Per-user narrowing** — `users."featureOverrides"` JSONB column (nullable; `null`/`{}` = inherit workspace defaults untouched). Only keys set to `false` are respected — **an override can turn a feature off for one member, never on** beyond what the workspace already allows. Managed by admin via `UsersAdminPanel` "Features" panel → `GET`/`POST /api/admin/users/:id/feature-access`.

Resolution: `applyUserOverrides(workspaceFlags, overrides)` in `server/config/featureAccess.js` — `final[key] = workspaceFlags[key] && overrides[key] !== false`.

- `loadFeatureAccess(userId)` (`server/middleware/auth.js`) does the full merge server-side; `requireFeature(key)` route guard uses it and always lets admins through regardless of overrides.
- `GET /api/settings/feature-access` (used by ~20 client pages to gate nav/UI) returns the caller's own merged flags — admins always get unnarrowed workspace flags.
- Admins are never narrowed by `featureOverrides` — the UI only exposes the panel for non-admin rows.
- **Accountant logins (`users."accountantOfUserId"` set) are not members and skip both layers:** `accountantFlags()` in `server/config/featureAccess.js` (used by `loadFeatureAccess` and `GET /api/settings/feature-access`) gives Finance always on, Shares on only when `featureOverrides.shares === true` (the Shares button in **Accountant access**), everything else off, whatever the workspace switches say. (Before 2026-10-27 turning Finance off for members also 403'd the accountant and emptied their Finance.) Users list rows for accountants show role **Accountant** and no Features/Make Admin buttons; they are managed in Settings -> Members -> Accountant access. The member Features panel opens as a full-width row under the member. `FinancePage.jsx` is wrapped by a gate: a member with Finance off who types `/finance` sees a plain notice instead of a half-broken page (the API still 403s). Test: `node server/config/featureAccess.test.js`.

**Client and server flag lists must match** (`translate`/`guitar` drifted until 2026-10-30; `server/config/featureAccess.test.js` now fails on any difference in keys, defaults or the Feature Access menu). Add a flag to both `server/config/featureAccess.js` and `client/src/utils/featureAccess.js`. A flag that ships off or unproven also gets a `FEATURE_LIFECYCLE` entry (`preview`, or `parked`) in both files; no entry means `ga`. The Feature Access panel shows it.

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
| **`vault_models`** | JSON array of `{ id, name, emoji, provider, … }` — allowed ids for this user’s UI and resolver input order |
| **`default_model`** | Optional. If present **and** that `id` is in **`vault_models`**, it becomes the **`standard`** tier; otherwise **`standard`** is the **first** id in **`vault_models`** |
| **`branch_eval_model`** | Separate from chat default — branch-suggestion evaluation only |

**Document redaction agent card** (`document-redaction-agent`): settings keys `document_redaction_local_model` + `document_redaction_frontier_model`. Resolve at runtime via `resolveDocumentRedactionModels({ userId, jobId })` in `server/services/documentRedactionModelResolver.js` — never hardcode model ids. Both slots accept any connected `vault_models` entry.

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

Full reference: **`client/DESIGN.md`**. Cursor rule `.cursor/rules/vault-ui.mdc` applies when editing `client/**`.

**Theming:** Six CSS custom properties (`--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-text`, `--color-muted`). ThemeProvider writes them to `<head>`. Use `var(--color-xxx)` inline, not Tailwind `dark:` classes. Warnings: hardcoded amber (`#f59e0b`). Errors: hardcoded red (`#ef4444`). Status colours are intentionally outside the theme system.

**Default palette (warm-sand):** bg `#F5F5F0` · surface `#EEEEE8` · border `#D8D8D0` · primary `#9B5B46` (darkened from `#CC785C` for 4.5:1; each theme also has `onPrimary`, the text colour on primary buttons, written as `--color-on-primary` and applied to any inline `background: var(--color-primary)`) · text `#1A1A1A` · muted `#6A6A6A` (each theme's `muted` in `themes.js` is held at 4.5:1 or better on its bg and surface; keep it that way when adding a theme)

**Layout:** Full-viewport flex row: sidebar + main (flex-1). Use `100dvh` with `100vh` fallback. Single responsive breakpoint: `sm` (640px). Sidebar has three states: **expanded** (user's saved width, 180–520px, default 240px) · **collapsed** (48px icon rail, desktop default on first load) · **hidden** (mobile only, fixed overlay). Desktop state persisted in `localStorage` key `vault:sidebarOpen`. `ProjectSidebar` receives `collapsed` prop from `Layout`; collapsed renders icon-only rail, full renders the complete project/session tree.

**Accessibility baseline (`client/src/index.css`):** a global `:focus-visible` ring on buttons/links/tabbables, row actions written as `opacity-0 group-hover:opacity-*` are shown automatically on touch, on keyboard focus within the row, and when focused, `prefers-reduced-motion` is honoured (spinners keep turning), and `Toast` is a permanent `aria-live` region (errors `role="alert"`, 5 s default). Do not add `outline-none` without a visible replacement, and do not hide an action on hover alone without using these class names.

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

User triages with status: `new` → `opened` → `implement` | `learn` | `ignore`. Use `POST /api/suggestions/:id/implement` to act — do not set `implement` via PATCH.

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
- **Shared mic (`components/voiceInput/VoiceInput.jsx`) has two styles, chosen per field.** Single-line fields use *short* mode (the browser ends the session when you pause: right for a name or number). Multi-line `type="textarea"` + `append` fields use *continuous* mode (keeps listening until you press the mic again, and quietly restarts if the browser ends the session by itself, adding each piece after the last) — same behaviour as the chat/notes mic. Override with the `continuous` prop. The provider holds one recogniser of each kind. A report of "the mic stops at random points" on a long box means it is in short mode.
- **Quick Capture has no floating + button** (removed 2026-10-14: it covered other floating buttons such as the Video Tools tutor). The window still opens with **Ctrl+Shift+N** and from "create task" actions (`document.dispatchEvent(new CustomEvent('vault:open-quick-capture', { detail }))` — SelectionToolbar, NotesPage). Do not re-add a global fixed bottom-right button without checking it against the tutor button.
- **Chat message deletion is a HARD delete** (decided 2026-10-02): `DELETE /api/chat/messages/:id` and `DELETE /api/chat/messages` `{ ids }` remove the rows (bookmarks cascade); there is no soft-delete/tombstone for messages (a deleted chat goes to the shared recycle bin as a whole). Replies are rebuilt from stored messages, so a deleted message stops influencing the chat; already-generated session summaries/titles are not rewritten. Ownership = session owner or project owner; the batch is all-or-nothing. Chat-to-task already exists (`SelectionToolbar` -> `QuickCapture`); tasks have **no assignee** (each task belongs to one user).
- `toast-in` animation, sidebar collapse, icon rotation: all 200ms. Single `--duration-fast: 200ms` if ever extracted.

---

