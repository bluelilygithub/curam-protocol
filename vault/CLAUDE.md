# Curam Vault — CLAUDE.md

Invite-based multi-user AI workspace. Node.js/Express backend + React/Vite frontend. Deployed on Railway at `https://curam-vault.up.railway.app`. PostgreSQL 15 + pgvector. Primary AI: Anthropic Claude. Secondary: Google Gemini.

Detail lives in `docs/`. This file holds the rules; follow the pointers when you touch that area.

---

## DEPLOY SPEED — MANDATORY, READ BEFORE ANY PUSH OR BUILD CHANGE

**Full rules and the layer table: [`docs/deploy-speed.md`](docs/deploy-speed.md). Read it first.** Deploys should take about 2-3 minutes. The owner measures you by how fast changes go live.

The build is split (since 2026-11-13): GitHub builds the slow layers from `Dockerfile.base` into `ghcr.io/bluelilygithub/curam-vault-base` (workflow `.github/workflows/base-image.yml`, runs only on dependency changes); Railway's `Dockerfile` starts `FROM` that image and only runs `npm install`, `COPY . .` and `npm run build`.

1. **NEVER edit `package.json` or `package-lock.json` just to add or rename a test script.** One edit makes GitHub rebuild the whole base image (10-15 minutes) before the change is fully live. Run new tests with `node path/to/file.test.js`. If a `package.json` change is unavoidable, tell the owner first, in plain words, that the deploy will be slow, and batch every such change into one commit.
2. **NEVER diagnose, propose or change anything about deploys, builds or a Dockerfile without first reading `docs/deploy-speed.md` and running `git log --oneline -- Dockerfile Dockerfile.base .dockerignore`.** This has been fixed three times already (72aac7cc, 7874897c, 273148cd). Re-proposing it from the `Dockerfile` alone wastes the owner's time. It happened on 2026-11-02.
3. **System packages, pip installs and planner installs go in `Dockerfile.base`, never in `Dockerfile`.** Never switch Railway back to building everything itself.
4. **Before every push, run `git diff --stat origin/<branch>..HEAD`.** If `package.json`, `package-lock.json`, `Dockerfile`, `Dockerfile.base` or any `requirements.txt` is in it, say "this push will be a slow deploy, because ..." BEFORE pushing. For a dependency change, check the GitHub Actions "Base image" run succeeded before saying it is live.

---

## CHANGELOG — MANDATORY, EVERY COMMIT

**Every commit gets an entry in the admin Changelog (`/changelog`) before it is pushed.** The owner reads it to see what each update did, what it touched, why, what it gained and what to watch. Full rules and the entry format: [`docs/changelog.md`](docs/changelog.md).

1. Commit the work first. Then, **before `git push`**, add one entry per new commit to the top of `entries` in `server/config/changelogEntries.json` and commit that on its own as `Changelog: <what it covers>`. Push both together, so one deploy carries the code and its entry. (The entry needs the commit's hash, which only exists after the commit; that is why it is a second commit.)
2. A commit that only adds changelog entries (subject starts `Changelog:`) is the one exemption. Every other commit needs an entry, including reverts, docs-only changes and commits the owner makes by hand.
3. Each entry says: what changed, the code impacted (real file paths), the goal, the benefit, and **honest concerns** (cost, risk, untested paths, anything unverified; write `None noted.` only when that is true). Take the date, author, full hash and line counts from `git log --shortstat`, never by hand.
4. **Before pushing, check nothing is missing:** compare `git log --format=%h origin/<branch>..HEAD` with the `commit` values in the file. Say plainly in the reply if you are pushing without an entry, and why.
5. The entry text describes what the commit says it did. Do not claim it was verified unless it was.

---

## Stack

**Backend:** Node.js/Express · PostgreSQL 15 + pgvector · `pg` (no ORM) · node-cron · multer
**Frontend:** React 18 + Vite · Zustand (4 stores) · React Router v6 · Tailwind CSS
**AI:** Anthropic SDK (streaming + prompt caching) · Google Generative AI SDK (Gemini + embeddings)
**Deploy:** Railway · `vault/railway.toml` · push `version-7` branch → auto-deploy

---

## Where things are

**Full per-file and per-tool notes: [`docs/key-files.md`](docs/key-files.md). Read the entry for a tool before changing it.** Other references:

- [`docs/core-conventions.md`](docs/core-conventions.md) — full text of Auth, Feature access, DB, AI streaming, Model selection, RAG, Context, UI system, Suggestions
- [`docs/features.md`](docs/features.md) — what each feature does and its gotchas (Finance, Shares, Video Tools, PDF, Property Scenario, etc.)
- [`docs/env-vars.md`](docs/env-vars.md) — every environment variable
- [`docs/schema-notes.md`](docs/schema-notes.md) — table and column quirks
- `docs/<tool>.md` — one doc per tool (finance, notes, shares-*, video-tools, cellar-planner, guide-chat, recycle-bin, hardening, observability …)

Core files:

- `server/index.js` — Express entry; route registration order matters (shared routes before `requireAuth`)
- `server/db.js` — all tables, every statement idempotent (`IF NOT EXISTS`), runs on every boot
- `server/middleware/auth.js` — token lookup, `requireAdmin`, `requireFeature`/`loadFeatureAccess`
- `server/config/featureAccess.js` + `client/src/utils/featureAccess.js` — feature flag lists (must match)
- `server/routes/chat.js` — `buildSystemPrompt()`, prompt caching, SSE streaming, model routing
- `server/services/modelResolver.js` — `getModelsForUser()`: `light` / `standard` / Gemini / DeepSeek
- `server/services/SuggestionService.js` — all services/crons/agents emit inbox findings through it
- `server/config/changelogEntries.json` + `client/src/pages/ChangelogPage.jsx` — the admin Changelog; **add an entry for every commit** (see the CHANGELOG rule above and `docs/changelog.md`)
- `server/utils/cronLock.js` — `withCronLock(name, fn)` for every cron that sends mail, creates records or calls a paid API
- `server/utils/safeFetch.js` + `server/services/htmlFetch.js` — SSRF guards; write every user-URL fetcher on them
- `server/services/recycleBin/` — shared 30-day recycle bin; any tool that deletes uses `moveToBin()` (`docs/recycle-bin.md`)
- `server/lib/logger.js` — pino; use `getLogger()` not `console.*` in new code (`docs/observability.md`)
- `client/src/utils/apiClient.js` — authenticated fetch wrapper; use for all `/api/` calls
- `client/src/config/appNavigation.js` — the one navigation catalog (menu, sidebar, top bar, trail, Ctrl+K); add a page there, not in Layout. `npm run test:nav` catches drift
- `client/src/components/Dialog.jsx` — the one modal shell; never hand-roll a `fixed inset-0` modal
- `client/src/hooks/useDraggable.js` — every new fixed button/panel is draggable
- `client/src/components/ProcessingModal.jsx` + `store/processingStore.js` — blocking overlay for slow operations
- `client/src/store/popupStore.js` + `hooks/usePopupSlot.js` — self-appearing popups take turns; never stack a second fixed popup
- `client/src/providers/IconProvider.jsx` — `getIcon(name, props)`; `ThemeProvider.jsx` writes `--color-*` vars
- `client/DESIGN.md` — **read before any UI/client work**
- Settings tabs: add to `SETTINGS_GROUPS` in `client/src/utils/settingsGroups.mjs`, then a block in `SettingsPage.jsx`
- Needs-attention list: add a query in `server/routes/attention.js` and a line in `buildAttentionItems`, not a new banner
- Guide chats: one component (`components/tutor/TutorChat.jsx`) and one registry (`server/config/guides.js`); `npm run test:guides`. Update a guide's `CATALOG` together with its tool list; tests fail on drift (`docs/guide-chat.md`)
- Display names renamed 2026-11 (Style editor, Google Ads, Page speed, Search Console, Drawings to Diagrams); internal keys and routes unchanged. Names live in `appNavigation.js`, `utils/featureAccess.js`, `utils/mobileConfig.js`

---

## Auth

Token-based, not JWT. 32-byte random hex in `auth_sessions`; one DB lookup per request (instant invalidation). `requireAuth` protects all `/api/*` except `/api/auth/*`, `/api/health`, `/api/shared/*`. Shared routes **must** be registered before `requireAuth` in `server/index.js`; `SharedTaskPage` (`/shared/task/:token`) sits outside `AuthGuard` in `App.jsx`. `/api/admin/*` uses `requireAdmin` (`users."isAdmin"`); first user is admin.

**Never use raw `fetch('/api/...')` in the frontend. Always use `apiClient`.**

---

## Feature access

Two allow-by-default layers: workspace flags (`workspace_settings` keys `feature_<name>`, edited in Settings → Feature Access) then per-user narrowing (`users."featureOverrides"`; only `false` values count, an override can turn a feature off for a member, never on). `loadFeatureAccess(userId)` merges server-side; `requireFeature(key)` guards routes and always lets admins through.

- Accountant logins (`users."accountantOfUserId"`) skip both layers: Finance always on, Shares only if `featureOverrides.shares === true`, all else off (`accountantFlags()`).
- **Client and server flag lists must match.** Add a flag to both `server/config/featureAccess.js` and `client/src/utils/featureAccess.js`. A flag that ships off or unproven also gets a `FEATURE_LIFECYCLE` entry (`preview` or `parked`) in both. Test: `node server/config/featureAccess.test.js`.

---

## Database patterns

- Raw SQL, parameterised (`$1`). No ORM. No migration tool: idempotent DDL in `server/db.js`.
- camelCase columns are double-quoted: `"projectId"`, `"userId"`. `"order"` is reserved: always quote.
- `COUNT(*)`/`SUM()` return strings: wrap in `Number()`.
- No `pg` type parsers: `DATE`/`TIMESTAMPTZ` arrive as JS `Date`. Format with local getters or cast in SQL (`::date::text`). JSONB arrives parsed: use `typeof v === 'string' ? JSON.parse(v) : v`.
- Every query filters by `"userId"`.
- Transactions: `pool.connect()` → `BEGIN`/`COMMIT`/`ROLLBACK`/`release()`. Upsert: `ON CONFLICT ... DO UPDATE SET x=EXCLUDED.x`.
- **Named routes before `/:id` in every route file.**
- Table and column quirks: `docs/schema-notes.md`.

---

## AI and streaming

**Provider routing:** `modelId.startsWith('gemini-')` → Google SDK, else Anthropic.

**Prompt caching:** `buildSystemPrompt()` returns content blocks with `cache_control: { type: 'ephemeral' }`, ordered by change frequency, max 4 breakpoints; the final block (date, user profile, web search notice) is never cached. Order: persona → project brief → global memory → pinned/session files → uncached tail.

**SSE:** headers `text/event-stream`, `no-cache`. Always emit `data: [DONE]` even on error. Client buffers partial lines across packets (`buf = lines.pop()`).

**RAG:** `chunker.js` (~500 tokens, 50 overlap) → `embeddings.js` (Google `text-embedding-004`, 768-dim) → `file_chunks` → pgvector top-5. Fallback with no key or chunks: full text capped 32K chars, `ragFallbackActive: true`. Pinned files use RAG; session files inject in full.

**Context tiers** (injected in order): global memory → project (brief + pinned files + URLs) → session (files + URLs).

---

## Model selection

**Never hardcode model ids** for user-facing chat or default behaviour. Ids come from Settings (`vault_models`, optional `default_model`, `branch_eval_model`) via `getModelsForUser(userId)`; falls back to the first admin's list.

- **`standard`**: default slot for substantive work (chat, marking, generation). `default_model` if in `vault_models`, else first entry.
- **`light`**: cheap background calls (summaries, chips, helpers).
- **`gemini`** / **`deepseek`**: first matching id.
- Chat precedence: request `model` (if allowed) → `projects.model` → `standard`.
- Per-session model needs Feature Access → Model Selection (Members). Chains use per-step `model`, else `standard`.
- Document redaction card: `resolveDocumentRedactionModels()`. Topic Research: setting `topic_research_model`, empty = `standard`.
- Hardcoded ids allowed only in pricing tables (`costCalculator.js`, `pricing.js`) and legacy migration artefacts.
- Frontend: `useModels`, `utils/models.js` (`getModelShortName` shows the raw id if unknown).

Full text: `docs/core-conventions.md`.

---

## UI system

Full reference: **`client/DESIGN.md`**. Cursor rule `.cursor/rules/vault-ui.mdc` applies to `client/**`.

- **Theming:** six vars `--color-bg/surface/border/primary/text/muted` (+ `--color-on-primary`). Use `var(--color-xxx)` inline, not Tailwind `dark:`. Warning `#f59e0b`, error `#ef4444` are hardcoded. Each theme's `muted` stays 4.5:1 or better. Default palette: warm-sand (primary `#9B5B46`).
- **Layout:** full-viewport flex row, `100dvh` with `100vh` fallback, one breakpoint `sm` (640px). Sidebar: expanded (180–520px), collapsed (48px rail, desktop default), hidden (mobile overlay). Persisted in `localStorage` `vault:sidebarOpen`. Use the full desktop width (cap ~1700px, two columns from `xl`).
- **Hover:** `hover:opacity-60` or `-70` only. No colour shifts. **Transitions: 200ms, no exceptions.**
- **Accessibility:** keep the global `:focus-visible` ring; no `outline-none` without a visible replacement; row actions use `opacity-0 group-hover:opacity-*` so touch/keyboard still see them; honour `prefers-reduced-motion`; `Toast` is a permanent `aria-live` region.
- **Buttons:** no `<Button>` component; compose inline.
- **Icons:** only via `getIcon(name, { size })`; add to the semantic map first; never import Lucide directly.
- **Destructive confirms:** inline "Delete? Yes / No" for routine; `ConfirmModal` (type-to-confirm) only for high-stakes.
- **Loading / empty:** use `Skeleton` and `EmptyState`, not bare "Loading..." / "No items".
- **Z-index:** dropdowns `z-20` · mobile sidebar `z-40` · modals `z-50` · ProcessingModal `z-[9998]` · toasts `z-[9999]`.
- **Every new tool** follows the Video Tools conventions: shared `Tooltip` on every control, (i) box, compass tour, guide chat, mic on text fields (`components/voiceInput/VoiceInput.jsx`).

**ProcessingModal:** for any operation over ~2s that must not be interrupted (AI generation, bulk imports, file processing):

```javascript
const { startProcessing, stopProcessing } = useProcessingStore();
startProcessing('Descriptive action label…', 'Optional detail.');
try { await longRunningOperation(); } finally { stopProcessing(); }
```

Not for instant CRUD; those use toasts.

---

## Agent suggestions inbox

**Mandatory:** every service, cron and background routine that detects an anomaly, gap or improvement must call `SuggestionService.capture()` or `captureIf()`, not only log.

```javascript
const { capture, captureIf, makeFingerprint } = require('../services/SuggestionService');
await captureIf(cond, { userId, source: 'myService', category: 'alert',
  fingerprint: makeFingerprint('myService', `topic:${id}:empty`),
  title: 'Short summary', body: 'What happened and fix', context: 'optional' });
```

Categories: `rule | skill | automation | source | alert | other`. After substantial work, if you notice something the user should triage, add a suggestion (`POST /api/suggestions`, or note it in chat if the server is down). Skip trivial typos and minor observations. Never set `implement` via PATCH; use `POST /api/suggestions/:id/implement`. Docs: `docs/suggestions-inbox.md`.

---

## Key patterns and rules

- Named routes before `/:id`. `/api/shared` and `gmail.js` before `requireAuth`.
- Settings API: `GET /api/settings` returns all keys; `POST /api/settings { key, value }` upserts (empty value deletes).
- Uploads: `multer` to `uploads/<projectId>/`; code files stored as `<name>_<ext>.txt`. Attachments share `server/utils/attachments.js`.
- Fetching a user-supplied URL: `safeFetch`/`htmlFetch.checkSsrf` only.
- Crons that send mail, create records or call paid APIs: wrap in `withCronLock`. New-feature checklist: `docs/hardening.md`.
- Deleting things: use the shared recycle bin (`moveToBin` in the same transaction as the delete).
- Kanban columns sort by `task.order`, not `sortTasks()`.
- `formatEffort(mins)` → `'3h 30m'`; `parseEffortInput(str)` accepts `45m`, `3h`, `1.5h`, `2d`.
- Shared mic: single-line fields use short mode, `textarea`/`append` fields use continuous mode (`continuous` prop overrides). "Mic stops at random points" means it is in short mode.
- No floating Quick Capture button (removed 2026-10-14; it covered the tutor button). Opens with Ctrl+Shift+N or `vault:open-quick-capture`. Do not re-add a global bottom-right button without checking the tutor button.
- Chat message deletion is a HARD delete (decided 2026-10-02). Deleted chats go to the recycle bin whole. Normal lists/search/RAG still filter `s."deletedAt" IS NULL`.
- Tasks have no assignee.
- Notes is the foundation tool: first in nav; Chat reads notes only when "My notes" is on for that chat (`docs/notes.md`).
- Public sign-up is closed (`POST /api/auth/register` returns 403); admins create accounts.
- Feature behaviour (Finance, Shares, Video Tools, PDF, Property Scenario, Browser Agent, etc.): `docs/features.md`. Before touching Finance read `docs/finance.md`; Shares read `ROADMAP.md`.

---

## Local dev

Git remote: push `version-7` → Railway auto-deploys. Run git from the project root `C:\Users\micha\Local Sites\Curam-Protocol`. The old "app is broken locally" note is stale; see memory `reference_local_dev_windows` (private Postgres on 15433, `npm run dev`). Env vars: `docs/env-vars.md`.
