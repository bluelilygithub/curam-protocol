# Project Memory — Curam Protocol

## User
- **Name:** Michael Barrett
- **Email:** michaelbarrett@bluelily.com.au
- **Company:** Blue Lily / Curam AI (curam-ai.com.au)

## Project Structure
Two separate applications in one repo (`version-7` branch, main branch for PRs):

### 1. Flask Site (`main.py`)
- Python/Flask marketing and document automation site
- Runs locally on `http://localhost:5000`
- Start: `cd project-root && venv\Scripts\activate && python main.py`
- Uses PostgreSQL (`DATABASE_URL` in `.env`)
- **Status: Working locally ✓**

### 2. Vault (`vault/`)
- Node.js/Express backend + React/Vite frontend
- AI workspace — projects, chat, files, personas, prompts, memory, debate, compare
- Deployed on Railway: `https://curam-vault.up.railway.app`
- Start locally: `cd vault && npm run dev` (broken — see local-setup-issues.md)
- **Status: Working on Railway ✓ | Broken locally ✗**

## Key Files
- `vault/server/index.js` — Express server entry point
- `vault/server/db.js` — PostgreSQL schema + connection pool (pg)
- `vault/server/routes/` — API routes
- `vault/server/utils/sendEmail.js` — Shared email helper (MailChannels → SMTP fallback)
- `vault/server/middleware/auth.js` — requireAuth middleware
- `vault/client/src/App.jsx` — React router setup
- `vault/client/src/utils/apiClient.js` — Authenticated fetch wrapper (use this for all API calls)
- `vault/client/src/store/authStore.js` — Zustand auth state (persisted)
- `vault/railway.toml` — Railway build/deploy config

## Auth System
- Token-based (random hex, stored in `auth_sessions` table)
- `requireAuth` middleware protects all `/api/*` except `/api/auth/*` and `/api/health`
- `requireAdmin` middleware protects `/api/admin/*` (checks `users."isAdmin"`)
- Frontend uses `apiClient` for all authenticated requests — **never use raw `fetch()` for `/api/` calls**
- Auto-seed: server creates user from `SEED_EMAIL`+`SEED_PASSWORD` env vars on first startup if no users exist
- Seeded first user is admin by default; user management happens in Admin → Users
- Change password: Settings page → Change Password section
- Password reset: `POST /api/auth/reset-password-request` + `/reset-password-confirm`; `APP_URL` env var for link domain

## DB Tables (PostgreSQL — 27 tables)
Key tables: `users`, `auth_sessions`, `projects`, `files`, `messages`, `sessions`, `folders`, `personas`, `prompts`, `memory`, `pinned_urls`, `debates`, `settings`, `password_resets`
- `users` table includes `"isAdmin" BOOLEAN NOT NULL DEFAULT FALSE` (admin authorization source of truth)
- `sessions` table: `sessionId TEXT PK`, `projectId`, `userId`, `title`, `"deletedAt"` (soft-delete/restore), `summary TEXT`, `"summaryEmbedding" vector(768)`, `isSummarized`, `summaryContent`, `inputTokens`, `outputTokens`, `starred`, `personaId`, `branchedFrom`
- `settings` table: `key TEXT PRIMARY KEY, value TEXT` — stores GEMINI_API_KEY, SEARCH_API_KEY, MAIL_CHANNEL_API_KEY
- `password_resets` table: token, email, expiresAt (1 hour TTL)

## Railway Environment Variables
- `ANTHROPIC_API_KEY` — Claude API key
- `SEED_EMAIL` / `SEED_PASSWORD` — Initial user (change via Settings after first login)
- `NODE_ENV=production` (set in railway.toml)
- `DATABASE_URL` — PostgreSQL connection string (provided by Railway PostgreSQL service)
- `UPLOAD_DIR` — point to Railway volume mount path (e.g. `/data/uploads`)
- `APP_URL` — base URL for password reset emails (e.g. `https://curam-vault.up.railway.app`)
- `INVITE_CODE` — required for new user registration; set this to a secret code and share with invited users
- Optional (can also be set in Settings UI): `GEMINI_API_KEY`, `SEARCH_API_KEY`, `MAIL_CHANNEL_API_KEY`

## Important Patterns
- All frontend API calls must use `apiClient` (`import api from '../utils/apiClient'`)
- Never use raw `fetch('/api/...')` without auth headers (exception: multipart uploads and unauthenticated endpoints)
- PostgreSQL on Railway — persists between deploys via Railway's managed PostgreSQL service
- Git: run all commands from project root `C:\Users\micha\Local Sites\Curam-Protocol`
- Deploy: push to `version-7` branch → Railway auto-deploys
- Settings API: `GET /api/settings` returns all keys, `POST /api/settings { key, value }` upserts (empty value deletes)

## Features Implemented (version-7)
- Projects, chat, files, personas, prompts, memory, folders, pinned URLs
- Document Compare (`/compare`) — SSE streaming, 4 modes, vault file selection, save to project
- Multi-Model Debate (`/debate`) — Anthropic + Gemini models, multi-file context upload, round history navigation, NO_CHANGE detection, synthesis summary, save to project with project selector
- Password reset flow (`/reset-password`) — email token, 1-hour expiry
- Eye/password visibility toggles on login + settings password fields
- Admin Dashboard (`/admin`) — stat cards for projects, sessions, messages, searches, debates, comparisons, tokens; period selector (Today/Week/Month/Last month/6m/12m/Custom); plus **Users** panel for create/list/reset-password/promote/demote/delete
- Configurable upload file types in Settings (persisted in Zustand, used as `accept` on all file inputs)
- API keys stored in env + Railway variables only — no UI panel
- Web search (`@search` in chat): results shown in modal with title/snippet/link before attaching as URL context; "No results found" shown when empty
- Web search supports **Brave Search** (auto-detected via `BSA` key prefix), Serper.dev (40-char hex key), SerpAPI (default); set `SEARCH_PROVIDER` env var to force a provider
- User has a **Brave Search API key** — `SEARCH_API_KEY` starts with `BSA`
- **Gemini models** added everywhere models are selectable: `gemini-2.0-flash` and `gemini-2.5-pro-preview-05-06`; defined in `models.js` with `provider: 'gemini'`; server routes `chat.js` and `compare.js` detect via `isGemini()` and use Google Generative AI SDK
- **General Chat** (`/chat` route, `<ChatPage general />`) — project-free chat workspace; sessions stored with `projectId = null`; "General" section in sidebar with expandable session list and "+" button
- **Chat History** (`/history`) — `ChatHistoryPage.jsx` with History / Deleted / Bookmarks tabs; date filter chips (All time, Today, Yesterday, This Week, Last 7 days, This Month, Last Month, Last 30 days, Custom); text search; click active rows to navigate to session; Deleted tab restores soft-deleted chats
- **Session delete from dropdown** — native `<select>` replaced with custom dropdown in ChatPage header; each session row has a hover trash icon with inline "Move to Deleted? Yes / No" confirm; supports deleting non-active sessions; deletion sets `sessions."deletedAt"` so messages can be restored from Chat History
- **YouTube** (`/youtube`) — search videos (YouTube Data API v3), search history (last 30), favourites save/remove. Embedded player (youtube-nocookie.com). Tabs: Search · History · Favourites. Routes: `server/routes/youtube.js`. DB tables: `youtube_search_history`, `youtube_favourites`. Feature flag: `youtube` in `featureAccess`. Env var: `YOUTUBE_API_KEY`. CSP updated in `server/index.js` to allow youtube-nocookie.com iframes in production. Sourced from mcp_curamTools backend; vault frontend built from scratch.
- **Precious Metals** — Metals tab in Shares page; `metal_purchases` table; `server/routes/metals.js`; spot price via metals.live (free, no key) → USD/oz → AUD via Frankfurter (`getGoldSpotAud()` in `marketData.js`); coin count × oz helper auto-fills total; summary cards + per-purchase P&L vs spot; gated by `requireFeature('shares')`
- **Finance** (`/finance`) — small business accounting: Invoices, Clients, Suppliers, Expenses, Wages, Journal, Accounts (chart), Codes (tx codes), BAS (GST quarters), **Balances** (trial balance tab — all-time cumulative DR/CR per account, verifies double-entry is working), Settings. Backend: `server/routes/finance.js`. Frontend: `client/src/pages/FinancePage.jsx`. All expense/invoice-paid/wage entries auto-create double-entry journal entries. `GET /api/finance/trial-balance` aggregates journal lines per account.
- **Tasks** (`/tasks`) — full task management; see Tasks section below
- **Goals** (`/goals`) — OKR-lite Goal Setting; Objectives → Key Results → Tasks; see Goals section below
- **Mobile Dashboard** (`/mobile-dashboard`) — auto-redirect from `/` on mobile (`window.innerWidth < 640`); 5 configurable tiles: Tasks (today's due + inline quick-add), Projects (2-col grid), Finance (YTD summary), Chat History (last 12 sessions), Notes (list + inline quick-create); mobile top bar replaces icon row with Home + Menu (≡) + Logout; `MobileNavDropdown` full-screen overlay lists all 21 features; Settings → Mobile tab: toggle/reorder tiles + toggle nav items; persisted as `mobile_dashboard_tiles` / `mobile_nav_items` settings keys
- **Notes mobile UX** — on mobile (`viewportMobile` state + resize listener) the notes list panel becomes a fixed slide-in drawer (285px, `transform translateX`, z-50, backdrop overlay); auto-opens on page load; closes on note select or ✕ tap; `≡ Notes` button in editor toolbar re-opens it; mic button (Web Speech API — `SpeechRecognition || webkitSpeechRecognition`) appends dictated transcript on new line to note body on stop; `interimResults: true` required for iOS Safari (never sets `isFinal`); stale-closure-safe via `bodyValueRef`/`titleValueRef`/`selectedRef`; red "Listening…" banner with italic live preview while active; `micError` state for permission/error visibility; Convert to Task + Take to Chat visible on all screen sizes
- **Project session RAG** — after each AI reply in a project chat, the resolver **`light`** model (`getModelsForUser`) generates a ~150-word session summary, Gemini `text-embedding-004` embeds it, both stored in `sessions.summary` + `sessions."summaryEmbedding" vector(768)`; at query time user message embedded → cosine-search same-project sessions (excluding current) → top-5 injected as non-cached "Related project conversations" system prompt block; falls back to most-recent if embeddings unavailable
- **Branch from follow-up** — clicking a follow-up chip (post-stream suggestions) expands inline to show "Ask here" or "New chat". "New chat" calls `POST /api/chat/sessions/branch-from-followup` `{ projectId, title, parentSessionId }` → generates a substantive opening response using `standardModel` grounded in parent session messages + project brief → creates new session in same project → navigates to it. `isBranching` state shows "Creating…" while in-flight. `canBranch=!!projectId` so General chat never shows "New chat". Old `POST /api/chat/branches` LLM evaluation endpoint and `BranchSuggestions.jsx` removed.
- **Favicon + Apple Touch Icon** — `curam-ai-logo.png` copied to `client/public/favicon.png`; `<link rel="icon">` + `<link rel="apple-touch-icon">` in `client/index.html`
- **Toolbar system** — `PageToolbar.jsx`: shared toolbar with zones [title][views][children] → [OverflowMenu][?][primary CTA]; view buttons show icon+label (label hidden on mobile); wired into TasksPage. `OverflowMenu.jsx`: standalone `⋯` dropdown (label/icon/shortcut/active/danger/divider/disabled); used by PageToolbar and ChatPage. ChatPage: star/summarize/download/delete moved to `OverflowMenu`; Files button labelled. Two icons added to IconProvider: `more-horizontal`, `help-circle`.

## DB Tables (additional)
- `comparisons` — saved comparison results linked to projects
- `search_logs` — logs every web search query (powers admin dashboard search count)
- `tasks` — id, title, notes, status, priority, **isUrgent INTEGER DEFAULT 0**, **renewalDimension TEXT NULL**, category, projectId, parentTaskId, dueDate, recurrence, recurrenceConfig JSON, recurrenceCount, order, shareToken, estimatedMinutes, timeSpentMinutes, keyResultId, createdAt, updatedAt
- `task_tags` — taskId, tag
- `task_comments` — id, taskId, type (user/system), content, createdAt; system events auto-logged on status/priority/dueDate changes
- `task_templates` — id, name, description, category, priority, recurrence, tags, createdAt
- `objectives` — id, title, description, timeframe, status (active/completed/paused), color, **renewalDimension TEXT NULL**, createdAt, updatedAt
- `key_results` — id, objectiveId (FK→objectives CASCADE), title, targetValue REAL, currentValue REAL, unit TEXT, status, dueDate, createdAt, updatedAt
- `template_subtasks` — id, templateId, title, order

## Tasks Feature
**Routes:** `vault/server/routes/tasks.js`, `vault/server/routes/taskTemplates.js`, `vault/server/routes/sharedTasks.js`
**Frontend:** `vault/client/src/pages/TasksPage.jsx`, `vault/client/src/components/TasksCalendar.jsx`, `vault/client/src/components/tasks/WeeklyReviewModal.jsx`, `vault/client/src/components/tasks/TaskImportModal.jsx`, `vault/client/src/components/tasks/FocusMode.jsx`, `vault/client/src/components/tasks/TaskFilters.jsx`, `vault/client/src/components/tasks/TaskStatsBar.jsx`, `vault/client/src/components/tasks/TaskTemplatesPanel.jsx`, `vault/client/src/pages/SharedTaskPage.jsx`

### API endpoints
- `GET /api/tasks` — list (filter by status/priority/category/projectId/tag/dueBefore/dueAfter/search)
- `POST /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id` — include `estimatedMinutes`, `timeSpentMinutes`, `keyResultId`, `isUrgent`
- `PUT /api/tasks/reorder`, `PUT /api/tasks/bulk`, `DELETE /api/tasks/bulk`
- `POST /api/tasks/:id/duplicate`, `GET|POST /api/tasks/:id/comments`, `DELETE /api/tasks/comments/:commentId`
- `POST /api/tasks/extract`, `POST /api/tasks/ai-generate` (prompt updated to include estimatedMinutes)
- `GET /api/tasks/morning-digest` — overdue + today + Claude haiku suggestion
- `POST /api/tasks/weekly-review-suggestions` — SSE stream of Claude weekly focus suggestions
- `POST /api/tasks/import` — bulk CSV import `{ tasks }` → `{ created, skipped, errors }`
- `POST /api/tasks/:id/share` → `{ shareUrl, token }`; `DELETE /api/tasks/:id/share` — revoke
- `GET /api/shared/task/:token` — PUBLIC (before requireAuth in index.js); returns task + subtasks
- Full CRUD on `/api/task-templates`; `POST /api/task-templates/:id/apply`

### Views
- **List** — grouped by category, drag-to-reorder, bulk select/edit/delete, stats bar (6 cards incl. Total Effort + Time Logged), 14-day chart, keyboard shortcuts (`n`, `w`, `/`, `f`, `1-3`, `b`, `m`, `?`)
- **Board (Kanban)** — columns sort by `task.order` (NOT `sortTasks()`); share button on cards
- **Calendar** — `TasksCalendar.jsx`; drag pills to reschedule
- **Matrix (Eisenhower)** — 2×2 grid (Urgent × Important); `isUrgent` toggle in form + QuickCapture; ⚡ badge on list/board; `m` shortcut; insight line with optional dimension prefix; show-completed toggle; `?view=matrix` URL param

### Key patterns
- All named routes BEFORE `/:id` in tasks.js (critical ordering)
- `/api/shared` registered BEFORE `requireAuth` in index.js; `SharedTaskPage` at `/shared/task/:token` OUTSIDE `AuthGuard` in App.jsx
- `formatEffort(mins)` → `'3h 30m'` / `'45m'` / `'—'`; `parseEffortInput(str)` → handles `45m`, `3h`, `1.5h`, `2d`, bare numbers
- Share popovers: `sharePopovers` state Map<taskId, {url, copied}>; share button shown on hover in list+kanban
- **Weekly Review** — `WeeklyReviewModal.jsx`; 3-step modal; `w` keyboard shortcut; "Weekly Review" toolbar button
  - Step 1: last week completed tasks (Mon–Sun), grouped by category
  - Step 2: overdue (todo + dueBefore today) with mark-done / reschedule / remove-due actions
  - Step 3: next 7 days tasks + Claude SSE stream + quick-add + effort total + Renewal this week row
- **CSV Import** — `TaskImportModal.jsx`; download template + drag-drop upload + preview table + validation + `POST /api/tasks/import`
- **Public Sharing** — `shareToken` column; `sharedTasks.js` public route; `SharedTaskPage.jsx` at `/shared/task/:token`
- **Effort Estimation** — `estimatedMinutes` column; quick-select buttons (15m/30m/1h/2h/4h/1d/2d) + manual input in task form; effort pill on cards; 5th stats bar card "Total Effort"
- Kanban columns sort by `task.order` (not `sortTasks()`); critical for within-column reorder to work
- Note tooltip: `position: fixed`; works in all 3 views
- **Aging indicator** — `isStale(task)`: status='todo' + createdAt > 7 days → amber clock icon
- **Quick Capture FAB** — `QuickCapture.jsx` in `Layout.jsx`; `Ctrl+Shift+N`; dispatches `vault:task-created`
- **Morning Digest** — `MorningDigest.jsx` in `Layout.jsx`; localStorage `vault:digest:YYYY-MM-DD`; once per day
- **Task search** — `useSearch.js` `Promise.all([/api/search, /api/tasks?search=])`; `SearchPalette.jsx` → `/tasks`
- **In-page help panel** — `showHelp` state; book icon in toolbar; right-side slide panel

### Templates
- Side panel; create/apply/delete; `POST /api/task-templates/:id/apply`

## Goals Feature (OKR-lite)
**Routes:** `vault/server/routes/goals.js`
**Frontend:** `vault/client/src/pages/GoalsPage.jsx`
**DB tables:** `objectives`, `key_results`; tasks have `keyResultId` FK

### API endpoints (`/api/goals`) — all registered inside requireAuth
- `GET /mission`, `PUT /mission` — get/upsert personal mission statement in `settings` table
- `POST /mission/generate` — SSE: stream Claude-generated mission statement from 4 wizard answers
- `GET /` — list objectives with nested KRs + overallProgress
- `POST /` — create objective `{ title, description, timeframe, color, renewalDimension }`
- `GET /dashboard` — `{ activeCount, avgProgress, topObjectives[3], completedThisMonth }`
- `POST /ai-suggest` — SSE: stream SMART KR suggestions as JSON objects (one per line)
- `POST /renewal-assessment` — SSE: stream renewal balance assessment from Claude Haiku; body: `{ dimensions: { physical, mental, social, spiritual } }`
- `PUT /key-results/:krId` — update KR fields (before `/:id` routes)
- `DELETE /key-results/:krId` — delete KR, unlinks tasks (before `/:id` routes)
- `GET /:id`, `PUT /:id`, `DELETE /:id` — CRUD on objective (PUT now accepts `renewalDimension`)
- `POST /:id/key-results` — add KR to objective

### buildKeyResult / buildObjective helpers
- `buildKeyResult(kr)` — adds `linkedTaskCount`, `completedTaskCount`, `progress` (0–100)
- `buildObjective(row)` — nests `keyResults[]`, adds `overallProgress` (avg of KR progress)

### Frontend integration
- **GoalsPage** (`/goals`): MissionStatementCard → Renewal Balance dashboard (collapsible, `localStorage goalsRenewalOpen`) → two-panel layout; `?section=mission/renewal` query param scrolls+highlights; `renewalDimension` in NewObjectiveModal + detail panel inline selector + badge on list item
- **Renewal Balance section**: 4 dimension cards (🏃🟦 📚🟩 🤝🟨 🌱🟪) + balance bar + nudge + AI Assessment (SSE) button
- **GoalsWidget** in `ProjectList.jsx`: fetches `/api/goals/dashboard`; shows stat pills + top 3 objective progress bars; only renders if activeCount > 0
- **WeeklyReview Step 3**: active objectives + Renewal this week row (4 dimension icons with completed-this-week counts; red dot if zero)
- **TasksPage form**: "Link to Goal" two-step dropdown; Renewal Dimension selector (4 buttons); `renewalDimension` in payload; dimension emoji pill on list/board cards
- **TaskFilters**: dimension chip row (All Dimensions · 🏃 · 📚 · 🤝 · 🌱); `filterDimension` state + filter logic
- **Matrix view**: `?view=matrix` URL param on mount; dimension prefix in insight line
- **7 Habits sidebar**: `ProjectSidebar.jsx` collapsible section (`localStorage sidebarHabitsOpen`); 3 links: 🧭 Mission `/goals?section=mission` · ⚡ Matrix `/tasks?view=matrix` · 🌱 Renewal `/goals?section=renewal`
- **Layout sidebar**: Goals link after Tasks, uses `getIcon('target', {size:16})`

## Local Setup Issues
See `local-setup-issues.md` for details on the broken Node.js environment.

## Gmail Integration
- **Routes:** `vault/server/routes/gmail.js` (registered BEFORE requireAuth in index.js; has internal auth middleware that skips /callback)
- **DB:** `gmail_tokens` table (userId, accessToken, refreshToken, expiryDate, scope, email)
- **Env vars:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- **OAuth flow:** `/api/gmail/auth` → returns authUrl → client navigates → Google → `/api/gmail/callback` → redirect to `/settings?gmailConnected=1`
- **Endpoints:** `GET /status`, `GET /auth`, `GET /callback`, `POST /disconnect`, `GET /search?q=`, `GET /thread/:threadId`, `POST /ask` (SSE)
- **Frontend:** `GmailConnect.jsx` in SettingsPage "Integrations" section; `@gmail` in AtMentionDropdown triggers Gmail search modal in ChatPage
- **Thread attachment:** Gmail threads added via `addManual()` from `useUrlAttachment` as `gmail://thread/<id>` URLs; `buildMessageContent` in chat.js uses `[Email thread: ...]` label
- **Package:** `googleapis` ^144.0.0 added to package.json dependencies

## Response Formatting Rules
Format responses in plain prose by default. Code blocks for actual code/commands/file contents only — never for filenames. **Bold** for filenames, key terms, UI labels, important instructions. *Italics* for emphasis/clarification only. Tables only when comparing 3+ items with clear categories. Bullet points only for 3+ related items. Headers only when a response has 3+ genuinely distinct sections. Never pad with formatting.

## Known Bugs / To Revisit
- **Drag project into folder doesn't persist** — server `PUT /api/projects/:id` includes `folderId`, sidebar calls `fetchProjects()` after update. Still not working locally — suspect nodemon not picking up changes or local/Railway env difference. Needs network tab debugging.

## User Management API (Admin only)
- `GET /api/admin/users` — list users with last login and active session count
- `POST /api/admin/users` — create user `{ email, password, isAdmin }`
- `PUT /api/admin/users/:id/password` — reset user password and revoke sessions
- `PUT /api/admin/users/:id/admin` — grant/revoke admin role
- `DELETE /api/admin/users/:id` — delete user (cannot delete self or last admin)
