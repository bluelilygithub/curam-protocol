# Curam Vault

A private AI workspace — a single-user, authenticated web app for working with Claude (Anthropic) and Gemini (Google) within structured project contexts.

## What It Does

Work is organised around **Projects**. Each project holds a structured brief (goal, problem, audience, tech stack, constraints, tone, notes) that is injected as context into every AI conversation within it.

### Features

#### Projects & Workspaces

| Feature | Description |
|---|---|
| **Projects** | Workspace containers with structured briefs — organise AI work by client or topic |
| **Folders** | Group projects into folders; drag-and-drop projects in and out of folders from the sidebar |
| **Personas** | Reusable AI roles with custom system prompts (e.g. "Senior Copywriter", "Legal Reviewer") |
| **Prompts** | Prompt library — save, tag, and reuse prompt templates across projects |
| **Memory** | Global persistent notes injected into all chats (facts the AI should always know) |
| **Pinned URLs** | Attach web URLs to a project; content is fetched and stored for AI context |
| **Files** | Upload PDFs, images, and text files (txt, md, csv, json) to a project; text is extracted and AI-summarised on upload |
| **Pinned files** | Pinned files are automatically included in every chat's system prompt for that project |
| **Notes** | Quick-capture thought pad — title, date, free text body; optional project link; "Take to Chat →" opens note as a new chat session with full context preloaded |

#### Chat & AI

| Feature | Description |
|---|---|
| **Chat** | Claude and Gemini conversations scoped to a project's context; model and temperature switchable per session |
| **General Chat** | Project-free chat workspace for ad-hoc questions; sessions are saved and searchable |
| **Chat History** | Browse every session across all projects and General Chat, filterable by date range and searchable by content |
| **Project Files panel** | Side panel in the chat interface — lists all project files, upload new files, pin/unpin files to inject into every chat's context |
| **Clipboard image paste** | Paste images directly from the clipboard into the chat input; sent as inline base64 to the AI, no file upload required |
| **`@search` web search** | Type `@` in chat and select "Search the web"; results shown in a panel before attaching as URL context |
| **`@gmail` email search** | Type `@` in chat and select "Search Gmail…"; natural language query translated to Gmail search syntax via Claude Haiku; browse results, attach email threads as context; ask follow-up questions about any thread via the `/ask` endpoint (SSE streaming) |
| **@mention Tasks in Chat** | Type `@` in chat to attach a task's details as context; title, notes, and due date are injected into the conversation |
| **Document Compare** | Compare two documents side by side using any Claude or Gemini model; 4 comparison modes; save results to a project |
| **Multi-Model Debate** | Pit multiple AI models against each other on a topic; multi-file context upload; synthesis summary |
| **Export** | Export chat conversations to Markdown, JSON, or PDF; email thread export |
| **Voice input** | Mic button in chat toolbar starts browser-native speech recognition (Web Speech API); live interim transcript preview; hidden in unsupported browsers |
| **Read aloud** | Speaker button reads the last assistant message via browser text-to-speech; no external service required |
| **Token budget alerts** | Set a per-session cost limit in Settings; amber warning at 80%, red at 100% with a direct "Summarise now" button |
| **Model error handling** | Stream errors classified by type and shown in a banner: 🔑 auth (key missing/invalid), 💳 billing (credit exhausted — links to Anthropic billing), 🤖 model not found, ⏳ rate limit, ⚠️ timeout/unknown; pre-send check blocks requests immediately if the provider key is confirmed absent |

#### Tasks

| Feature | Description |
|---|---|
| **Tasks** | Full personal task manager — List, Kanban, Calendar, and Eisenhower Matrix views; drag-to-reorder; priority, urgency, due date, category, tags, project link; keyboard shortcuts |
| **Kanban Board** | Three-column board (To Do / In Progress / Done); drag cards within or across columns to reorder and change status |
| **Time-Blocking Calendar** | Day/week/month/agenda sub-views; task blocks absolutely positioned on a 24-hour CSS Grid; drag-drop to reschedule; resize bottom edge to change estimated effort; current-time indicator |
| **Subtasks** | Nested subtasks with completion tracking; AI-generate subtasks from task title and notes |
| **Eisenhower Matrix** | 4th task view — 2×2 Priority Matrix; Urgent (⚡ toggle) × Important (high priority); Q1 Do First / Q2 Schedule / Q3 Delegate / Q4 Eliminate; insight line + Show completed toggle; `m` shortcut; `?view=matrix` URL param |
| **Renewal Dimension** | Tag any task with 🏃 Physical / 📚 Mental / 🤝 Social / 🌱 Spiritual (Habit 7 — Sharpen the Saw); four-button selector in the task form (below the Urgent toggle); emoji pill on list and board cards; second filter row in the filter bar (All Dimensions · 🏃 · 📚 · 🤝 · 🌱) |
| **Task Dependencies** | Mark tasks as "blocked by" other tasks; 🔒 badge when incomplete blockers exist; dependency UI in expanded row; circular dependency detection |
| **Recurring Tasks** | Daily / Weekly / Fortnightly / Monthly / Annually; new copy created automatically when marked done |
| **Task Comments & Activity** | Per-task comment thread; system events (status, priority, due date changes) auto-logged |
| **Task Templates** | Save any task as a reusable template (with subtasks, priority, category, recurrence); apply in one click |
| **Focus Mode (Pomodoro)** | Full-screen overlay with a 25/5/15-min Pomodoro timer; SVG ring progress; subtask checklist; Web Audio API beep; auto-start breaks; time logged to task on close |
| **Time Tracking** | `timeSpentMinutes` accumulated via Focus Mode or the per-card stopwatch; running timer indicator in toolbar; time pill on cards; Time Logged 6th stat card |
| **Effort Estimation** | Set estimated effort per task (quick-select presets or custom input); effort pills on cards; Total Effort stat in toolbar |
| **Natural Language Due Dates** | Type `"tomorrow 3pm"`, `"next friday"`, `"Mar 15"` in the due date field; live resolved-date preview; 📅 calendar picker fallback |
| **Task Sharing** | Generate a public share link for any task; read-only view (no login required) with title, status, notes, tags, subtasks; revocable at any time |
| **CSV Import** | Import tasks in bulk from a CSV file; download template, drag-drop upload, preview with row-level validation, selective import |
| **Quick Capture** | Floating `+` button on every page (or `Ctrl+Shift+N`) — capture a task without leaving the current page |
| **Morning Digest** | Daily overlay on first visit — overdue + today's tasks with a Claude-generated focus suggestion |
| **Weekly Review** | Guided 3-step modal (`w` shortcut) — north star mission statement banner in Step 1 (if set); last week recap, overdue carry-forward with reschedule actions, week-ahead with Claude suggestions, Goals progress update, and 🌱 Renewal This Week row (4 dimension icons with per-dimension completed-task counts; red dot on any zero) |

#### Goals

| Feature | Description |
|---|---|
| **Personal Mission Statement** | Compass-guided north star card at the top of the Goals page; write manually or use a 4-step Claude wizard (roles → character → contributions → principles) that streams a personalised statement via SSE; statement shown as a banner in Weekly Review Step 1 |
| **Goals (OKR-lite)** | Objectives → Key Results → Tasks hierarchy; set numeric targets and track progress; AI-generated KR suggestions via Claude; tag objectives with renewal dimension |
| **Renewal Balance Dashboard** | Collapsible section on Goals page (below Mission Statement); 4 dimension cards (🏃🟦 📚🟩 🤝🟨 🌱🟪) with active task/goal counts + progress; balance bar; nudge if dominant dimension >50%; AI Assessment button streams a warm coaching message |
| **7 Habits Sidebar** | Collapsible section in the project sidebar; 3 quick-links: 🧭 Mission Statement, ⚡ Priority Matrix, 🌱 Renewal Balance |
| **Goals Widget** | Home page summary showing active objective count, average progress, and top 3 progress bars |
| **Goals in Weekly Review** | Step 3 of Weekly Review shows active objectives + 🌱 Renewal This Week row (4 dimension icons with completed task counts; red dot if zero) |

#### Admin & Account

| Feature | Description |
|---|---|
| **Admin Dashboard** | Usage stats — sessions, messages, tokens, searches, debates, comparisons; filterable by date range |
| **Search** | Global search palette across projects, chats, files, and tasks |
| **Password reset** | Email-based password reset flow with 1-hour expiry tokens |
| **Password show/hide** | Eye icon on all password fields (login, change password, reset password) toggles visibility |
| **Model management** | Add, edit, delete, and test AI models from Settings → AI Models; changes persist to DB and are reflected immediately across the entire app (chat selector, compare, project settings); Reset to defaults button restores the built-in 5 models |
| **Model availability** | Settings page shows API key status (✓ configured / ⚠️ key missing) per model; Test button sends a live probe to each model and reports success or the exact error (auth, billing, model not found, rate limit) |

> **Detailed feature docs:** [TASKS.md](TASKS.md) · [GOALS.md](GOALS.md)

### Tech Stack

- **Backend:** Node.js / Express, SQLite (`better-sqlite3`), Anthropic SDK, Google Generative AI SDK (`@google/generative-ai`)
- **Frontend:** React / Vite, Zustand (auth + project + settings state), React Router, Tailwind CSS
- **Auth:** Token-based sessions (single-user via seed credentials); bcryptjs for password hashing
- **Deploy:** Railway with persistent volume for SQLite DB and file uploads

---

## AI Model Management

Models are managed centrally from **Settings → AI Models**. The active model list is stored in the `settings` table under the key `vault_models` as a JSON array. If that key is absent the app falls back to the static defaults defined in `client/src/utils/models.js`.

### How it works end-to-end

1. **Static defaults** — `utils/models.js` exports `MODELS` (5 built-in models: Haiku 4.5, Sonnet 4.6, Opus 4.6, Gemini 2.0 Flash, Gemini 2.5 Pro). This is the fallback used on first run and as the "Reset defaults" target.

2. **`useModels` hook** (`hooks/useModels.js`) — fetches `GET /api/settings` on mount; if `vault_models` exists it parses and returns that list, otherwise returns the static defaults. Exposes `models`, `saveModels(array)`, and `loading`. Used by **ChatPage** (model picker) and **SettingsPage** (CRUD UI).

3. **Settings UI** — Settings → AI Models section lets you:
   - **Add** a model (fields: Model API ID, display name, label, provider, emoji, tagline, description)
   - **Edit** any model inline
   - **Delete** any model
   - **Reset to defaults** — clears `vault_models` and restores the built-in 5
   - **Test** any model — `POST /api/chat/test-model` sends a minimal live probe and reports success or the classified error (key missing, credit exhausted, model not found, rate limit)

4. **API key status** — `GET /api/chat/model-status` returns `{ anthropic: bool, gemini: bool }` indicating which provider keys are configured. Shown as ✓ / ⚠️ badges in the Settings model list and in the chat model picker button/dropdown.

5. **Server routing** — `chat.js`, `compare.js`, and `debate.js` detect the provider by checking whether `modelId.startsWith('gemini-')`. Any model whose ID starts with `gemini-` is routed to the Google Generative AI SDK; all others go to the Anthropic SDK. Adding a new Gemini model in Settings just requires using the correct `gemini-*` ID.

6. **Pre-send validation** — `ChatPage.handleSend` checks `modelStatus` before calling the API. If the provider key is confirmed absent it shows an error banner immediately without consuming the request.

### Adding a new model

1. Go to **Settings → AI Models → + Add model**
2. Enter the exact API model ID (e.g. `claude-opus-4-5` or `gemini-2.0-flash-exp`)
3. Set provider to **Anthropic** or **Google Gemini** (controls which SDK is used server-side)
4. Click **Test** to verify the model is reachable before using it in chat

No server restart or code deploy is required.

---

## Gmail Integration

Users can connect their personal Gmail account via Google OAuth 2.0 and query their inbox using natural language directly from the chat `@gmail` mention.

### How it works end-to-end

1. **OAuth flow** — `GET /api/gmail/auth` generates an OAuth URL with a short-lived state nonce stored in the `settings` table. Google redirects back to `GET /api/gmail/callback` (registered *before* `requireAuth` — no session cookie required during callback). Tokens are stored in `gmail_tokens`.

2. **Natural language → Gmail query** — `GET /api/gmail/search?q=` passes the user's natural language input through `translateToGmailQuery()` in `server/services/gmailNLP.js`, which calls Claude Haiku to produce a valid Gmail search query, intent classification, max result count, and response mode. All date arithmetic is pre-computed in JavaScript and injected into the system prompt — Claude never invents dates.

3. **Thread attachment** — selecting a search result fetches the full email thread via `GET /api/gmail/thread/:threadId`. The thread text is injected into the chat as a `gmail://thread/<id>` URL attachment (using the existing URL attachment system) with pre-fetched content, so no additional API call is made when the message is sent.

4. **Ask endpoint** — `POST /api/gmail/ask` streams a Claude Haiku answer about a specific thread via SSE. The system prompt strongly asserts inbox ownership to prevent content-policy refusals on financial/legal/personal emails. Any suspected refusal is logged to the console with the email subject and question for prompt tuning.

### Date ranges supported

The `gmailNLP` service pre-computes all commonly needed date ranges from today's date: today, yesterday, this/last week (Mon-Sun), this/last month, this/last year, last 7/14/30/90 days, this/last quarter, current and last Australian financial year (Jul–Jun), and the most recent January.

### Setup

1. Enable the **Gmail API** in [Google Cloud Console](https://console.cloud.google.com/) and create an OAuth 2.0 Client ID (Web application type).
2. Add the redirect URI: `https://your-app.up.railway.app/api/gmail/callback` (and `http://localhost:3001/api/gmail/callback` for local dev).
3. Add the three env vars (see Environment Variables below).
4. Connect from **Settings → Integrations → Connect Gmail**.

### NLP test harness

Run `node server/services/gmailNLP.test.js` to execute 45 test cases across 11 categories (direction, name resolution, time ranges, content keywords, attachments, status, count/extract/summary/thread intent, and combined queries). Output includes per-category breakdown and an overall score.

---

## File Structure

```
vault/
├── server/
│   ├── index.js                  # Express server entry point
│   ├── db.js                     # SQLite schema + migrations
│   ├── typePrompts.js            # AI type-specific prompt helpers
│   ├── seed.js                   # Initial user seeding from env vars
│   ├── middleware/
│   │   └── auth.js               # requireAuth middleware (protects /api/*)
│   └── routes/
│       ├── auth.js               # Login (rate-limited) / logout / session / password reset
│       ├── user.js               # Change password (protected by requireAuth)
│       ├── projects.js           # Project CRUD
│       ├── chat.js               # Claude/Gemini streaming chat + session management; GET /model-status (key config check); POST /test-model (live model probe)
│       ├── compare.js            # Document comparison (Claude + Gemini, SSE streaming)
│       ├── debate.js             # Multi-model debate rounds
│       ├── files.js              # File upload, extraction, AI summary
│       ├── personas.js           # Persona CRUD
│       ├── prompts.js            # Prompt library CRUD
│       ├── memory.js             # Global memory CRUD
│       ├── folders.js            # Folder management
│       ├── pinnedUrls.js         # URL pinning + content fetch (SSRF-protected)
│       ├── fetchUrl.js           # URL content fetching (SSRF-protected)
│       ├── webSearch.js          # Web search — Brave / Serper.dev / SerpAPI (rate-limited)
│       ├── search.js             # Global search (vault-internal full-text)
│       ├── admin.js              # Usage stats for dashboard (sessions, tokens, searches, debates)
│       ├── export.js             # Chat export (JSON, PDF, Markdown, email)
│       ├── email.js              # Email sending (HTML-escaped)
│       ├── pdf.js                # PDF text extraction
│       ├── tasks.js              # Task CRUD + subtasks + comments + templates + AI generate/extract + SSE weekly review + CSV import + share
│       ├── taskTemplates.js      # Task template CRUD + apply
│       ├── goals.js              # Objectives + Key Results CRUD + dashboard + AI KR suggestions (SSE)
│       ├── gmail.js              # Gmail OAuth flow + search + thread fetch + ask (SSE); registered before requireAuth; applies auth internally for all paths except /callback
│       ├── sharedTasks.js        # Public shared task view — no auth (registered before requireAuth)
│       ├── settings.js           # App settings key/value store (API keys, config)
│       └── health.js             # Health check endpoint
│   ├── services/
│   │   ├── gmailNLP.js           # Natural language → Gmail query translator; calculateDates() pre-computes all date ranges; translateToGmailQuery() calls Claude Haiku; GMAIL_LIMITS constants
│   │   └── gmailNLP.test.js      # 45-case test harness with scoring and ANSI colour output; run: node server/services/gmailNLP.test.js
│
├── client/
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx              # React entry point
│       ├── App.jsx               # Router setup + keyboard shortcuts
│       ├── index.css
│       ├── themes.js             # Theme definitions
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── ResetPasswordPage.jsx  # Email-based password reset
│       │   ├── ProjectList.jsx   # Home — projects + Goals widget + Tasks widget
│       │   ├── ProjectDetail.jsx # Project brief + files + pinned URLs
│       │   ├── ChatPage.jsx      # Main chat interface (project and general); uses useModels for dynamic model list
│       │   ├── ChatHistoryPage.jsx    # Browse all sessions by date / search
│       │   ├── ComparisonPage.jsx     # Document compare tool
│       │   ├── DebatePage.jsx         # Multi-model debate tool
│       │   ├── PersonasPage.jsx  # Manage AI personas
│       │   ├── PromptsPage.jsx   # Prompt library
│       │   ├── MemoryPage.jsx    # Global memory management
│       │   ├── SettingsPage.jsx  # Account settings, password change, and AI model management (add/edit/delete/test)
│       │   ├── AdminPage.jsx     # Usage dashboard
│       │   ├── UserGuidePage.jsx # In-app user guide
│       │   ├── TasksPage.jsx     # Full task manager — List / Kanban / Calendar / Matrix views
│       │   ├── GoalsPage.jsx     # OKR Goals — Objectives + Key Results
│       │   └── SharedTaskPage.jsx     # Public read-only task view (no auth required)
│       ├── components/
│       │   ├── Layout.jsx        # App shell with sidebar + top nav
│       │   ├── ProjectSidebar.jsx
│       │   ├── AuthGuard.jsx     # Route protection
│       │   ├── MessageBubble.jsx # Chat message rendering
│       │   ├── ArtifactPanel.jsx # Rendered code/content panel
│       │   ├── ChatFileBar.jsx   # Files attached to a chat
│       │   ├── ChatFilePicker.jsx
│       │   ├── FileUploader.jsx
│       │   ├── FileList.jsx
│       │   ├── ProjectFilesPanel.jsx # Side panel for project file management in chat
│       │   ├── UrlBar.jsx        # URL chips above textarea
│       │   ├── SearchPalette.jsx # Global search modal
│       │   ├── AtMentionDropdown.jsx  # @file/@prompt/@search/@task/@gmail mentions in chat
│       │   ├── GmailConnect.jsx   # Gmail OAuth connect/disconnect component (used in SettingsPage → Integrations)
│       │   ├── FollowUpChips.jsx # Suggested follow-up prompts
│       │   ├── ExportMenu.jsx
│       │   ├── EmailModal.jsx
│       │   ├── NewProjectModal.jsx
│       │   ├── KeyboardShortcutsModal.jsx
│       │   ├── TasksCalendar.jsx # Time-blocking calendar (day/week/month/agenda; drag-drop; block resize)
│       │   ├── MorningDigest.jsx # Daily task digest overlay (once per day)
│       │   ├── QuickCapture.jsx  # Floating quick-capture FAB (Ctrl+Shift+N)
│       │   └── tasks/            # Task-specific sub-components (extracted from TasksPage)
│       │       ├── TaskFilters.jsx        # Quick-filter chips, category/project/status dropdowns, search, sort
│       │       ├── TaskStatsBar.jsx       # 6-card stats bar + 14-day completion chart
│       │       ├── TaskTemplatesPanel.jsx # Templates side panel (create, apply, delete)
│       │       ├── FocusMode.jsx          # Pomodoro timer overlay with subtask checklist + time tracking
│       │       ├── WeeklyReviewModal.jsx  # 3-step guided weekly review modal
│       │       └── TaskImportModal.jsx    # CSV import modal (template download, drag-drop, preview, validation)
│       ├── store/
│       │   ├── authStore.js      # Zustand auth state (persisted)
│       │   ├── projectStore.js   # Zustand project state
│       │   └── settingsStore.js  # Zustand settings state
│       ├── hooks/
│       │   ├── useChat.js        # Chat logic + streaming (Anthropic + Gemini)
│       │   ├── useModels.js      # Dynamic model list — loads from DB (settings.vault_models), falls back to static defaults; used by ChatPage and SettingsPage
│       │   ├── useFileAttachment.js
│       │   ├── useUrlAttachment.js
│       │   ├── useSearch.js
│       │   ├── useSystemPrompt.js
│       │   └── useVoice.js       # Browser speech recognition + TTS
│       ├── utils/
│       │   ├── apiClient.js      # Authenticated fetch wrapper (use for all /api/ calls)
│       │   ├── models.js         # Default Claude + Gemini model definitions (static fallback); active list is managed via useModels hook and stored in settings.vault_models
│       │   ├── pricing.js        # Token pricing helpers
│       │   ├── parseDate.js      # Natural language date parser (pure frontend, no API calls)
│       │   ├── exportMd.js       # Markdown export formatter
│       │   └── exportHelpers.js
│       └── providers/
│           ├── ThemeProvider.jsx
│           └── IconProvider.jsx
│
├── data/                         # SQLite database (gitignored)
│   └── vault.db
├── uploads/                      # Uploaded files (gitignored)
├── railway.toml                  # Railway build + deploy config
├── .env.example                  # Environment variable template
└── package.json
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Single user account |
| `auth_sessions` | Active login tokens (32-byte hex, 24-hour expiry) |
| `password_resets` | Email-based reset tokens (1-hour expiry) |
| `projects` | Project workspaces with context briefs |
| `sessions` | Chat session metadata — title, star, summary state, token counts |
| `messages` | Chat message history (linked to session and optionally a project) |
| `files` | Uploaded files with extracted text + AI summaries |
| `personas` | Saved AI personas with system prompts |
| `prompts` | Reusable prompt templates |
| `memory` | Global persistent memory entries |
| `pinned_urls` | URLs pinned to projects with fetched content |
| `folders` | Folder organisation |
| `debates` | Multi-model debate rounds and results |
| `comparisons` | Saved document comparison results linked to projects |
| `search_logs` | Web search query log (powers admin dashboard search count) |
| `settings` | Key/value store for API keys and app config — includes `vault_models` (JSON array of active AI models); if `vault_models` is absent the app uses the built-in defaults from `utils/models.js` |
| `tasks` | Task records — status, priority, urgency (`isUrgent`), renewal dimension (`renewalDimension`), due date, category, tags, recurrence, estimated effort, time spent, share token, parent task link, key result link |
| `task_tags` | Many-to-many tag associations for tasks |
| `task_comments` | Per-task comments and auto-logged activity events (status/priority/due-date changes) |
| `task_dependencies` | Directed blocker relationships between tasks — `taskId` is blocked by `blockedByTaskId`; unique constraint prevents duplicates; circular dependency detection on insert |
| `task_templates` | Reusable task templates with predefined priority, category, recurrence, and tags |
| `template_subtasks` | Subtask definitions belonging to a task template |
| `objectives` | OKR Objectives — title, description, timeframe, colour, status, renewal dimension (`renewalDimension`) |
| `key_results` | Key Results linked to an Objective — numeric target/current values, unit, due date |
| `gmail_tokens` | Gmail OAuth tokens per user — `accessToken`, `refreshToken`, `tokenType`, `expiryDate`, `scope`, `email`; access token auto-refreshed and persisted via `googleapis` token event |
| `notes` | User-scoped quick-capture notes — title, body, optional project link |

> **Roadmap:** PostgreSQL migration is scoped and planned on branch `postgres-migration` (258 db calls across 24 files + FTS5 → tsvector). Currently deferred — SQLite on Railway mounted volume with daily backups.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `SEED_EMAIL` | Yes | Initial user email (created on first startup if no users exist) |
| `SEED_PASSWORD` | Yes | Initial user password (change via Settings after first login) |
| `DB_PATH` | Yes | Absolute path to SQLite database file |
| `UPLOAD_DIR` | Yes | Absolute path to file uploads directory |
| `NODE_ENV` | Yes | `production` or `development` |
| `APP_URL` | Yes | Base URL for password reset emails and task share links (e.g. `https://curam-vault.up.railway.app`) |
| `PORT` | Optional | HTTP port (default `3001` in dev; Railway sets this automatically) |
| `GEMINI_API_KEY` | Optional | Google Gemini API access — enables Gemini 2.0 Flash and Gemini 2.5 Pro models |
| `SEARCH_API_KEY` | Optional | Web search API key — supports Brave Search (`BSA…` prefix), Serper.dev (40-char hex), or SerpAPI (default) |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth 2.0 client ID — enables Gmail integration (`@gmail` in chat, Settings → Integrations) |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Optional | OAuth redirect URI — must match exactly in Google Cloud Console (e.g. `https://your-app.up.railway.app/api/gmail/callback`) |
| `ENCRYPTION_KEY` | Optional² | 64 hex char key (32 bytes) for AES-256-GCM encryption of Gmail OAuth tokens at rest. Generate: `openssl rand -hex 32`. If absent, tokens stored plaintext with a startup warning. |
| `MAIL_CHANNEL_API_KEY` | Optional | MailChannels API key for email; if absent, falls back to SMTP (see below) |
| `SMTP_HOST` | Optional¹ | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | Optional¹ | SMTP port — `587` for TLS (default), `465` for SSL |
| `SMTP_USER` | Optional¹ | SMTP username / email address; also used as the sender `From` address |
| `SMTP_PASS` | Optional¹ | SMTP password or app-specific password |

¹ Required together if `MAIL_CHANNEL_API_KEY` is not set and you want email features to work.

² Strongly recommended in production. Without it Gmail OAuth tokens are stored unencrypted in the SQLite file.

### `.env.example`

```env
# ── Required ──────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development   # set to "production" on Railway (handled via railway.toml)

# ── Storage ───────────────────────────────────────────────────────────────────
# Local dev: relative paths work fine
DB_PATH=./data/vault.db
UPLOAD_DIR=./uploads

# Railway production: point both at your mounted Volume path, e.g.
#   DB_PATH=/data/vault.db
#   UPLOAD_DIR=/data/uploads
# Then mount the Volume at /data in the Railway dashboard.

# ── Google Gemini (optional — enables Gemini models in chat, compare, debate) ─
# Get a key at https://aistudio.google.com/app/apikey
# You can also set this via Settings in the app UI
GEMINI_API_KEY=

# ── Web search (optional — enables @search in chat) ──────────────────────────
# Supports Brave Search (BSA… prefix), Serper.dev (40-char hex), or SerpAPI
# You can also set this via Settings in the app UI
SEARCH_API_KEY=

# ── Email ─────────────────────────────────────────────────────────────────────
# Option A: MailChannels API (preferred — set MAIL_CHANNEL_API_KEY, or via Settings UI)
MAIL_CHANNEL_API_KEY=

# Option B: SMTP via nodemailer (fallback if MAIL_CHANNEL_API_KEY not set)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password

# ── Password reset & task share links ─────────────────────────────────────────
# Base URL used in reset email links and public task share URLs (no trailing slash)
# Local: http://localhost:5173 | Railway: https://your-app.up.railway.app
APP_URL=http://localhost:5173

# ── Gmail integration (optional — enables @gmail in chat) ─────────────────────
# Create credentials at https://console.cloud.google.com/ → APIs & Services → Credentials
# Enable the Gmail API and create an OAuth 2.0 Client ID (Web application)
# Add redirect URIs: http://localhost:3001/api/gmail/callback (dev) and
#                   https://your-app.up.railway.app/api/gmail/callback (prod)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback

# ── Gmail token encryption (recommended in production) ────────────────────────
# Encrypts OAuth access and refresh tokens at rest using AES-256-GCM.
# Generate with: openssl rand -hex 32
# If absent, tokens are stored in plaintext (a warning is logged on startup).
ENCRYPTION_KEY=
```

---

## Security

| Area | Protection |
|---|---|
| **SSRF** | `fetchUrl.js` and `pinnedUrls.js` resolve hostnames via `dns.lookup()` before connecting; requests to private/internal IP ranges (`127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `::1`) are rejected with 400. Check runs on every redirect hop. |
| **Response size** | Both URL-fetch routes cap the response body at 2 MB; the request is destroyed if exceeded. |
| **Path traversal** | File upload and list routes validate `projectId` is numeric-only before constructing any filesystem path. Validation runs *before* multer processes the upload. |
| **Brute force** | `POST /api/auth/login` is rate-limited to 10 attempts per 15 minutes per IP via `express-rate-limit`. |
| **XSS in email** | All user-generated content (message body, role, subject) is HTML-escaped via `escapeHtml()` before injection into the email template. |
| **Change-password auth** | Route is at `/api/user/change-password` and protected by the standard `requireAuth` middleware. |
| **Web search cost** | `/api/web-search` rate-limited to 20 requests per hour per IP. |
| **SQL injection** | All database queries use `better-sqlite3` prepared statements with parameterised values — no string interpolation. |
| **Auth sessions** | 32-byte random hex tokens; 24-hour expiry checked server-side on every request. |
| **Passwords** | bcryptjs with SALT_ROUNDS=12. |
| **Security headers** | `helmet` middleware applied in production (default CSP, HSTS, X-Frame-Options, etc.). |
| **Public routes** | `/api/shared/task/:token`, `/api/auth/*`, and `/api/gmail/callback` are registered before `requireAuth`; all other `/api/*` routes require a valid session token. The Gmail router applies `requireAuth` internally for all its paths except `/callback`. |
| **OAuth state nonce** | Gmail OAuth state nonce stored in `settings` table with a 10-minute expiry; validated and deleted on use; prevents CSRF during the OAuth redirect flow. |
| **Gmail tokens at rest** | `accessToken` and `refreshToken` encrypted with AES-256-GCM before writing to `gmail_tokens`; decrypted only at runtime. Key loaded from `ENCRYPTION_KEY` env var (64 hex chars). Graceful fallback: if key is absent, tokens are stored plaintext and a startup warning is logged. Existing plaintext rows are transparently handled on read and re-encrypted on next write. |
| **Gmail rate limiting** | `/api/gmail/auth` — 5 req/15 min per IP; `/api/gmail/search` and `/api/gmail/thread/:id` — 60 req/min per IP; `/api/gmail/ask` — 20 req/min per IP (tightest, triggers both Gmail API and Anthropic). |
| **Gmail search input** | `q` parameter capped at 500 characters; returns 400 if exceeded. `max` clamped to `GMAIL_LIMITS.count` (500). |
| **Anthropic data retention** | `store: false` set on every Anthropic API call (chat stream, summarisation, auto-title, suggestions, Gmail ask, NLP query translation). Opts out of Anthropic using request content for model training. |

---

## Running Locally

```bash
cd vault
npm install
npm run dev
```

**Node version:** `better-sqlite3` requires a pre-built native binary. **Node.js v22 LTS** has pre-built binaries and requires no compilation — this is the recommended version for a clean local setup. Node v23+ has no pre-built binaries and will fail on Windows without Visual Studio C++ Build Tools.

> **Windows / Node v24 note:** Local dev is currently broken on machines running Node v24 — `better-sqlite3` was removed during a failed WASM migration attempt. See [`local-setup-issues.md`](../local-setup-issues.md) in the project root for the full history and recovery options. Railway deployment is unaffected.

**Production** is deployed on Railway: `https://curam-vault.up.railway.app`

---

## Recent Changes

### March 2026

- **Security hardening** — `store: false` added to every Anthropic API call (chat stream, summarisation, auto-title, suggestions, Gmail ask, NLP translation) opting out of Anthropic data retention; Gmail OAuth tokens (`accessToken`, `refreshToken`) encrypted at rest with AES-256-GCM via `server/utils/encryption.js` (`ENCRYPTION_KEY` env var, 64 hex chars); existing plaintext rows transparently handled and re-encrypted on next write; one-time migration script at `server/scripts/reencrypt-gmail-tokens.js`; rate limiting added to all Gmail endpoints (auth: 5/15 min, search/thread: 60/min, ask: 20/min); 500-char length cap on Gmail search `q` param
- **Gmail integration** — connect personal Gmail via Google OAuth 2.0 from Settings → Integrations; `@gmail` mention in chat opens a search modal; natural language queries translated to Gmail search syntax via Claude Haiku (`gmailNLP.js` service with `calculateDates()` for pre-computed date ranges — today/yesterday/this week/last week/month/year/quarter/Australian FY); browse results, attach email threads as context (`gmail://thread/<id>` URL attachments via `addManual()`); ask follow-up questions about any thread via SSE `/ask` endpoint with ownership-framing system prompt; refusal detection logged to console; `GMAIL_LIMITS` constants control max result counts (count:500/extract:200/list:50/prose:50); 45-case NLP test harness (`gmailNLP.test.js`)
- **Chat stream error handling** — `classifyStreamError` extended with a dedicated `billing` code for Anthropic credit exhaustion (HTTP 402 or "credit balance too low" message) and improved Gemini patterns (`API_KEY_INVALID`, `RESOURCE_EXHAUSTED`, `models/*/is not found`); unknown errors now surface the raw API message in the hint; chat error banner redesigned with per-code icons (🔑 auth, 💳 billing, 🤖 model, ⏳ rate limit, ⚠️ other) and distinct colours; billing errors styled orange with a direct link to `console.anthropic.com/settings/billing`; `preflightError` state in ChatPage surfaces key-missing errors before any API call is made, avoiding wasted requests
- **Search — chat result navigation fixed** — clicking a message result in the global search palette now opens the correct chat session; `search.js` extracts the `sessionId` from the stored `Chat: <id>` title, looks up the session's human title from the `sessions` table, and returns both; `SearchPalette.navigateTo` now uses the same navigate-then-dispatch pattern as the history page (`vault:load-session` event after 80ms); general chat sessions (no project) correctly navigate to `/chat` instead of `/projects/null/chat`
- **Dynamic AI Model Management** — models are now managed from Settings → AI Models; add, edit, delete, and reorder models without a code deploy; model list stored in `settings.vault_models` (JSON) with static `utils/models.js` as fallback; `useModels` hook used by ChatPage and SettingsPage for a single source of truth; API key status shown per model (✓ / ⚠️); Test button sends a live probe via `POST /api/chat/test-model` and reports success or classified error (auth, billing, model not found, rate limit); pre-send validation in ChatPage blocks requests when the provider key is missing; `GET /api/chat/model-status` endpoint returns `{ anthropic: bool, gemini: bool }` for key config checks
- **Renewal Dimension Tracking (Habit 7)** — tag any task or objective with 🏃 Physical / 📚 Mental / 🤝 Social / 🌱 Spiritual; emoji pills on task cards; dimension chip row in filter bar; dimension prefix in Matrix view insight line; Renewal Balance Dashboard on Goals page (4 dimension cards + balance bar + nudge + AI Assessment SSE via Claude Haiku); Renewal This Week row in Weekly Review Step 3 (4 icons + per-dimension count + red dot if zero); `?view=matrix` and `?section=renewal/mission` query params for deep-linking
- **7 Habits Sidebar Navigation** — collapsible section in ProjectSidebar; 3 links: 🧭 Mission Statement (`/goals?section=mission`), ⚡ Priority Matrix (`/tasks?view=matrix`), 🌱 Renewal Balance (`/goals?section=renewal`); state persisted in `localStorage sidebarHabitsOpen`
- **Eisenhower Matrix** — new 4th Tasks view (`m` shortcut or view toggle); 2×2 Priority Matrix grid (Q1 Do First / Q2 Schedule / Q3 Delegate / Q4 Eliminate); `isUrgent` toggle in task form and Quick Capture; ⚡ Urgent badge on list and board cards; insight line summarising most critical quadrant; "Show completed" toggle in matrix sub-header
- **Personal Mission Statement** — compass-guided north star card at the top of Goals page; 4-step Claude wizard generates a personalised statement via SSE streaming; statement shown as context banner in Weekly Review Step 1
- **TasksPage refactoring** — `TasksPage.jsx` split into focused sub-components under `components/tasks/`: `TaskFilters` (quick-filter chips, dropdowns, search, sort), `TaskStatsBar` (6-card stats bar + 14-day chart), `TaskTemplatesPanel` (templates side panel with internal form state), `FocusMode`, `WeeklyReviewModal`, `TaskImportModal`; no behaviour or API changes — pure structural extraction
- **Time-Blocking Calendar** — full rewrite of `TasksCalendar.jsx`; day/week/month/agenda sub-views (persisted in `localStorage`); task blocks absolutely positioned on a 24-hour CSS Grid (`64px` per hour); drag-drop tasks to reschedule (updates `dueDate` via `PUT /api/tasks/:id`); drag from unscheduled panel to assign a time; resize block bottom edge to update `estimatedMinutes` (snaps to 15-min); current-time red indicator line; inline popover on block click; click empty slot opens New Task form pre-filled with that datetime
- **Task Dependencies** — `task_dependencies` table; `blockerCount` computed field on every task response; dependency UI in expanded task row (Blocked by + Blocking subsections with live search to add blockers); `🔒` badge on cards with incomplete blockers; blocker-confirm warning when marking a blocked task done; circular dependency detection via BFS on `POST /api/tasks/:id/dependencies`
- **Focus Mode (Pomodoro)** — `FocusMode.jsx` full-screen overlay; four timer modes (Focus 25m / Short break 5m / Long break 15m / Custom); SVG ring progress indicator; subtask checklist; Web Audio API beep (440Hz sine, 0.3s) at timer zero; auto-start breaks/focus toggles; session counter (N of 4); settings persisted in `localStorage`; accumulated focus time logged to `timeSpentMinutes` on close; accessible via 🎯 card button or `Shift+F` on expanded task
- **Time Tracking** — `timeSpentMinutes` column on `tasks` (via migration); per-card ⏱ stopwatch button (one timer at a time); running `⏱ title — HH:MM:SS` indicator in toolbar; time pill on task cards; expanded view shows logged time vs estimate with progress bar; 6th **Time Logged** stat card in toolbar; `timeSpentMinutes` included in CSV import and public shared-task response
- **Natural Language Due Dates** — single text input replaces separate date+time fields in the task form; `parseDate.js` utility handles: `today`, `tomorrow`, `yesterday`, `next friday`, `this monday`, `in 3 days/weeks/months`, `end of week/month`, `mar 15`, `15/03`, `2027-03-15`, `tomorrow 3pm`, `friday 14:30`; live green "Resolved: …" preview; amber warning when unparseable; 📅 icon opens native date picker fallback
- **Goals (OKR-lite)** — new `/goals` page with two-panel layout; create Objectives with timeframe and colour; add measurable Key Results (target value, current value, unit); progress bars colour-coded green/amber/red; AI Suggest KRs streams SMART Key Result suggestions via Claude; inline editing throughout; Goals widget on home page shows active count, average progress, and top 3 progress bars; Goals section in Weekly Review Step 3 for end-of-week KR updates
- **Key Result ↔ Task linking** — task form "Link to Goal" two-step dropdown (Objective → Key Result); linked tasks show a 🎯 badge with KR title on cards; completed linked tasks count toward KR task progress
- **Effort Estimation** — `estimatedMinutes` field on tasks; quick-select presets (15m / 30m / 1h / 2h / 4h / 1d / 2d) plus free-text input (`45m`, `3h`, `1.5h`); effort pill on list and kanban cards; "Total Effort" 5th stat card in toolbar (sum of incomplete tasks with estimates in current filter)
- **Weekly Review** — `w` keyboard shortcut or toolbar button opens a 3-step guided modal: (1) last week completed tasks grouped by category, (2) overdue carry-forward with mark-done / reschedule / remove-date actions, (3) week-ahead task list + Claude SSE focus suggestions + effort total + quick-add + Goals progress panel
- **CSV Import** — toolbar Import button opens modal; download CSV template; drag-drop or browse to upload; client-side parsing with quoted-field support; row-level validation (missing title, invalid priority/status, bad date format); preview table with per-row checkboxes; bulk `POST /api/tasks/import`
- **Public Task Sharing** — hover any task card to reveal share icon; generates a `shareToken` and public URL (`/shared/task/:token`); read-only view accessible without login (title, priority, status, notes, tags, subtasks); Revoke button deletes the token
- **Clipboard image paste** — paste screenshots or images directly into the chat input with Ctrl/Cmd+V; sent as inline base64, works in both project and General Chat without a file upload
- **Session delete from dropdown** — native `<select>` replaced with a custom dropdown; hover any session to reveal a trash icon with an inline confirmation; non-active sessions can now be deleted without switching to them first
- **General Chat** — project-free workspace at `/chat`; "General" section at the top of the sidebar with session list and new-chat button; sessions persisted with `projectId = null`
- **Chat History browser** — `/history` page with date filter chips (Today, Yesterday, This Week, Last 7 days, This Month, Last Month, Last 30 days, Custom), text search across title/project/content, click-to-navigate
- **Gemini models everywhere** — `gemini-2.0-flash` and `gemini-2.5-pro-preview-05-06` available in chat, document compare, and multi-model debate; centrally defined in `models.js` with `provider: 'gemini'`; server routes auto-detect and call Google SDK
- **`@search` web search** — type `@` in chat and select "Search the web"; results shown in a panel (title, snippet, clickable URL) before attaching as URL context; supports Brave Search (auto-detected via `BSA` key prefix), Serper.dev, and SerpAPI

### February 2026

- **Tasks** — full task manager at `/tasks` with List (grouped by category, drag-to-reorder), Kanban (3-column board, drag cards within/across columns), and Calendar (day/week/month/range, drag to reschedule) views; priority, due date + time, category, tags, project and parent task links; keyboard shortcuts (`n` new, `/` search, `f` cycle filter, `1-3` status filter, `b` cycle view, `?` help)
- **Task Templates** — save any task as a template; templates panel in sidebar; apply with one click to create a pre-filled task
- **Recurring Tasks** — set recurrence (daily/weekly/fortnightly/monthly/annually) on any task with a due date; new instance auto-created when marked done; ↻ badge with recurrence count on cards
- **Subtasks** — nested subtasks on any top-level task; expand row to add/complete; AI-generate subtasks from task title + notes
- **Task Comments & Activity** — per-task comment thread visible in expanded row; status/priority/due-date changes are auto-logged as system events
- **Quick Capture** — floating `+` FAB in bottom-right corner of every page; `Ctrl+Shift+N` from anywhere; opens minimal capture modal (title, priority, optional due date)
- **Morning Digest** — on first visit each day, overlay shows overdue + today's tasks with Claude-generated focus suggestion; dismissed once per day
- **Task Search** — global search palette (`Ctrl+K`) includes tasks (title + notes matching) alongside projects, files, and messages
- **`@mention` tasks in chat** — type `@` in chat input and scroll to Tasks section to attach a task's title, notes, and due date as conversation context
- **Multi-Model Debate** (`/debate`) — pit multiple Claude and Gemini models against each other; multi-file context; round navigation; NO_CHANGE detection; synthesis summary; save to project
- **Document Compare** (`/compare`) — compare two text blocks or vault files with any Claude or Gemini model; 4 modes (differences, similarities, improvements, summary); SSE streaming; save result to project
- **Admin Dashboard** (`/admin`) — stat cards for projects, sessions, messages, searches, debates, comparisons, and tokens; period selector (Today / Week / Month / Last month / 6 months / 12 months / Custom)
- **Password reset** — email-based flow at `/reset-password`; token stored in `password_resets` table with 1-hour expiry; `APP_URL` env var controls the link domain
- **Token budget alerts** — set a per-session cost limit in Settings; amber warning at 80%, red at 100% with a direct "Summarise now" button
- **Password show/hide** — eye icon toggles visibility on all password fields (login, change password, reset password)
- **Voice input** — mic button in chat toolbar starts browser-native speech recognition (Web Speech API, no API key needed); pulses red with a live transcript preview; hidden in unsupported browsers
- **Read aloud** — speaker button reads the last assistant message via browser text-to-speech; no external service required

### Earlier

- **Security hardening** — SSRF blocked in all URL-fetch routes (DNS-based private IP check); path traversal fixed in file upload; login brute-force rate-limited; HTML escaping in email export; web search rate-limited; 2 MB response cap on URL fetching
- **Mobile-responsive** — sidebar becomes a slide-over drawer; chat header collapses on small screens; artifact and file panels open full-screen on mobile; iOS keyboard zoom prevented; safe-area insets for notch and home bar
