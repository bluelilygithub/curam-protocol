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
| **Prompts** | Prompt library — save, tag, and reuse prompt templates across projects; supports `{{variable}}` placeholders that turn any prompt into a fill-in-the-blanks template |
| **Memory** | Global persistent notes injected into all chats (facts the AI should always know) |
| **Pinned URLs** | Attach web URLs to a project; content is fetched and stored for AI context; YouTube URLs (`youtube.com/watch`, `youtu.be`) are automatically detected — the full video transcript is fetched directly from YouTube's InnerTube API (no third-party service), stored up to 50,000 chars; on pin and refresh, Claude Haiku summarises the transcript to ~20% of its original length (prose, not bullets) and stores the summary in `transcript_summary`; the summary is injected into chat context instead of the raw transcript, reducing token usage significantly; transcripts under 5,000 chars are injected as-is; raw transcript is always preserved; regular pages use the SSRF-protected fetch route (4,000 chars in context); 📺 icon for YouTube, 🌐 for web pages; each card shows "Last fetched: today / yesterday / X days ago" and a refresh button; the Project Files Panel in chat lists all pinned pages with a paperclip attach button |
| **Files** | Upload PDFs, images, text files (txt, md, csv, json), spreadsheets (xlsx, xls, ods), Word documents (docx, doc), and code files (js, jsx, ts, tsx, php, py, css, html, sql, sh, .env.example) to a project; text is extracted and AI-summarised on upload for all supported formats; spreadsheets converted to CSV per sheet; Word docs extracted via mammoth; code files stored as plain text, 500 KB limit, prompt-injection sanitised |
| **Pinned files** | Pinned files are automatically included in every chat's system prompt for that project |
| **Session files** | Select any project file to include in the current chat session only; persisted to `session_files` table so context survives page refresh; visible in the context bar above the message list |
| **Notes** | Quick-capture thought pad — title, date, free text body; optional project link; "Take to Chat →" opens note as a new chat session with full context preloaded; "Convert to Task" button on each note card and in the editor toolbar opens Quick Capture pre-filled with the note title, body (truncated to 500 chars), and linked project; a "↳ task created" pill appears on the note card after conversion |

#### Chat & AI

| Feature | Description |
|---|---|
| **Chat** | Claude and Gemini conversations scoped to a project's context; model and temperature switchable per session; today's date injected into every system prompt so the model always knows the current date; pinned file context served via RAG when `GEMINI_API_KEY` is set — only the most relevant chunks are injected rather than the full file text; AI responses exceeding 2500 characters auto-collapse with a fade-out and "Show more" toggle — messages containing code blocks are always shown in full; the most recent response is always expanded |
| **Anthropic prompt caching** | The Anthropic system prompt is structured as a layered array of content blocks — persona + base (1), project brief (2), memory (3), file/URL context (4) — each marked `cache_control: { type: "ephemeral" }`; today's date and web-search notice are appended last with no cache marker so they are always evaluated fresh; the `prompt-caching-2024-07-31` beta header is sent automatically whenever cache blocks are present; Gemini calls receive the same content flattened to a plain string |
| **RAG file context** | Pinned project files are chunked (~500 tokens, 50-token overlap at sentence boundaries) and embedded with Google `text-embedding-004` on upload; at chat time the user's message is embedded and the top-5 most semantically relevant chunks are retrieved via pgvector cosine similarity and injected under `## Relevant context from project files`; falls back to full-text injection if embeddings are unavailable; full-text fallback is capped at 32,000 characters with a truncation note appended if exceeded; `ragFallbackActive: true` is sent in the usage SSE event when fallback fires — the context bar shows an amber "⚠ RAG unavailable" chip and a server warning is logged with session ID, project ID, and raw vs capped character counts; session files (explicitly attached by the user) are always injected in full |
| **General Chat** | Project-free chat workspace for ad-hoc questions; sessions are saved and searchable |
| **Auto-generated session titles** | After the first AI response in a new session, Claude Haiku automatically generates a concise 4-6 word title using both the user message and AI response as context; saved in the background without blocking the chat response; sidebar updates within ~2 seconds; never overwrites a title the user has manually set |
| **Chat History** | Browse every session across all projects and General Chat, filterable by date range and searchable by content |
| **Message bookmarks** | Star any individual message (user or AI) in a chat by hovering and clicking the ★ icon; bookmarks are persisted to the database; a Bookmarks tab on the Chat History page shows all bookmarked messages grouped by session with a 100-character preview, each clickable to navigate back to that session; an amber dot badge appears on the Chat History nav icon when any bookmarks exist |
| **Project Files panel** | Side panel in the chat interface — lists all project files, upload new files, pin/unpin for permanent context, or click the paperclip icon on any file to add it to the current session; session files shown in the context bar above messages |
| **Clipboard image paste** | Paste images directly from the clipboard into the chat input; sent as inline base64 to the AI, no file upload required |
| **Native AI web search** | Globe/Search toggle in the chat header enables provider-native real-time web search — Anthropic's `web_search_20250305` tool for Claude models (capped at 3 searches per turn), Google Search grounding for Gemini models; the model decides when to search based on whether the query requires current information; a "Searching the web…" indicator replaces the loading dots while a search is in progress; on by default, toggleable per session |
| **`@search` web search** | Type `@` in chat and select "Search the web"; results shown in a panel before attaching as URL context |
| **`@gmail` email search** | Type `@` in chat and select "Search Gmail…"; natural language query translated to Gmail search syntax via Claude Haiku; browse results, attach email threads as context; ask follow-up questions about any thread via the `/ask` endpoint (SSE streaming) |
| **`@calendar` event search** | Type `@` in chat and select "Search Calendar…"; natural language query (e.g. "meetings next week", "party time") translated to Google Calendar API parameters via Claude Haiku; time-based queries search a 30-day forward window; name-based searches automatically use a 90-day past/future window to find events regardless of date; browse results, attach events as context with title, time, and location; click outside the modal to dismiss |
| **@mention in Chat** | Type `@` in chat to insert context or trigger actions — attach a task's details (title, notes, due date), switch project context, insert a prompt from the library (with variable fill-in modal if placeholders are present), trigger web search, query Gmail, or search Calendar |
| **Document Compare** | Compare two documents side by side using any Claude or Gemini model; 4 comparison modes; save results to a project |
| **Multi-Model Debate** | Pit multiple AI models against each other on a topic; multi-file context upload; synthesis summary |
| **Export** | Export chat conversations to Markdown, JSON, or PDF; email thread export |
| **Voice input** | Mic button in chat toolbar starts browser-native speech recognition (Web Speech API); live interim transcript preview; hidden in unsupported browsers |
| **Read aloud** | Speaker button reads the last assistant message via browser text-to-speech; no external service required |
| **Token budget alerts** | Set a per-session cost limit in Settings; configurable amber warning threshold (50–90%, default 80%) and red critical threshold (90/95/100%, default 100%); both banners are dismissible with an ✕ button; re-alert frequency configurable (don't show again / every 10 messages / every 20 messages / at 95%); red banner includes a "Save to Notes" checkbox (checked by default) — on summarisation, automatically creates a note titled "[Session title] — Summary [date]" linked to the current project with a confirmation toast |
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
| **Recurring Tasks** | Daily / Weekly / Fortnightly / Monthly / Annually; new copy created automatically when marked done; fires even without a due date (uses today as the base date); guarded against double-creation on already-done tasks; all instances in a series share a `recurrenceGroupId` UUID; deleting a recurring task shows a 3-option modal — cancel, delete this task only, or delete this and all future (non-done) recurrences |
| **Task Duplication** | Duplicate any task via the copy icon on kanban cards and list rows; copies all fields including recurrence, renewal dimension, key result link, and estimated effort; subtasks are also duplicated |
| **Task Comments & Activity** | Per-task comment thread; system events (status, priority, due date changes) auto-logged |
| **Task Templates** | Save any task as a reusable template (with subtasks, priority, category, recurrence); apply in one click |
| **Focus Mode (Pomodoro)** | Full-screen overlay with a 25/5/15-min Pomodoro timer; SVG ring progress; subtask checklist; Web Audio API beep; auto-start breaks; time logged to task on close |
| **Time Tracking** | `timeSpentMinutes` accumulated via Focus Mode or the per-card stopwatch; running timer indicator in toolbar; time pill on cards; Time Logged 6th stat card |
| **Effort Estimation** | Set estimated effort per task (quick-select presets or custom input); effort pills on cards; Total Effort stat in toolbar |
| **Natural Language Due Dates** | Type `"tomorrow 3pm"`, `"next friday"`, `"Mar 15"` in the due date field; live resolved-date preview; 📅 calendar picker fallback |
| **Task Sharing** | Generate a public share link for any task; read-only view (no login required) with title, status, notes, tags, subtasks; revocable at any time |
| **CSV Import** | Import tasks in bulk from a CSV file; download template, drag-drop upload, preview with row-level validation, selective import |
| **Quick Capture** | Floating `+` button on every page (or `Ctrl+Shift+N`) — capture a task without leaving the current page |
| **Inline task creation from chat** | Select any text in a chat message to reveal a floating "+ Task" button; Claude Haiku suggests a priority and due date based on the selected text and surrounding context (1.5s timeout with medium/null fallback); opens Quick Capture pre-filled; the created task records the source session ID so it links back to the conversation |
| **Source chat link** | Tasks created from a chat selection show "Created from chat: [session title]" as a clickable link in the expanded task view; navigates directly to that chat session |
| **Morning Digest** | Daily overlay on first visit — overdue + today's tasks with a Claude-generated focus suggestion |
| **Task Reminder Popups** | Configurable time-of-day reminder popups — select up to 7 daily times (5 AM, 8 AM, 10 AM, 12 PM, 2 PM, 5 PM, 8 PM) in Settings → Task Reminders; at each scheduled time a modal overlay lists overdue tasks (red) and today's tasks (amber) if any exist; tasks are clickable and navigate to the Tasks page; "Go to Tasks" and "Dismiss" buttons; reminders are tracked per-day in localStorage so they never double-show; on login, the most recent missed reminder from the past 4 hours is shown automatically; a "Pause all reminders" toggle suppresses all popups without clearing the schedule; settings persisted to both `settings` table (DB) and Zustand localStorage |
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
| **Getting Started Wizard** | 7-step full-screen guided setup triggered automatically on first visit when no objectives exist; steps: Personal Context → Mission Statement (Claude drafts from context, editable) → First Objective (AI-suggested with colour picker) → Key Results (3 AI-suggested, toggle/edit) → Connect Tasks (link existing open tasks to the new objective) → Renewal Balance (four 0–10 sliders + streaming AI observation) → Review & Save; draft auto-saved to `localStorage`; ✨ button in Goals header reopens the wizard at any time; Settings page "Redo Setup" button resets the completion flag |

#### Prompt Chains

| Feature | Description |
|---|---|
| **Prompt Chains** | Build reusable multi-step AI pipelines — each step's output feeds into the next; accessible via the ⛓ icon in the top nav |
| **Template variables** | Use `{{input}}` for the initial run input, `{{output}}` for the previous step's output, or `{{step_N}}` to reference any specific step by number |
| **Per-step model selection** | Each step in a chain can use a different model — mix Claude and Gemini models within a single pipeline |
| **Starter templates** | Three built-in starter chains (Blog Post Generator, Code Review Pipeline, Meeting Notes Processor) shown when no chains exist yet |
| **SSE streaming** | Chain runs stream output step-by-step in real time; each step shows a progress indicator, live output, and a copy button on completion |
| **Stop & re-run** | Abort a running chain mid-stream; re-run from the beginning with new input once complete |

#### Knowledge Graph

| Feature | Description |
|---|---|
| **Canvas** | Full-screen D3 force-simulation canvas at `/graph`; accessible via the 🕸 share-2 icon in the top nav (desktop) or directly by URL on mobile |
| **Node types** | Projects (large indigo circle), Files (blue rectangle), Notes (amber rounded rect), Chat Sessions (green circle), Tasks (orange diamond), Goals (purple hexagon), Pinned URLs (teal circle) |
| **Explicit edges** | Structural connections drawn automatically: `contains` (project→file/note/session), `subtask` (task→task), `branch` (session→session), `created` (session→task), `tracks` (task→key result), `key_result` (objective→KR), `blocks` (task dependency) |
| **Semantic edges** | AI-computed dashed pink lines via pgvector + Gemini embeddings; computed on demand via the "Find connections" button; cached in the `graph_edges` table; similarity threshold 0.82 |
| **Interactions** | Zoom and pan the canvas; drag nodes to reposition; click any node to open a detail side panel showing the node type, title, and a "Go to →" button for direct in-app navigation; hover a node to highlight its immediate neighbours and dim everything else |
| **Search** | Search bar in the toolbar filters nodes by name; matched nodes glow amber; unmatched nodes dim |
| **Type filters** | Per-type colour-coded checkboxes hide/show node categories without recomputing the graph |
| **Insights panel** | Claude Haiku analyses the graph structure (orphaned nodes, cross-project clusters, top-connected nodes) and generates 4–6 specific observations; each insight has a "Show me" button that highlights and zooms to the relevant nodes; cached in the `settings` table and refreshed on demand |
| **Label behaviour** | Node labels hidden when zoomed out below threshold; always shown on hover, search match, or selection |
| **Scale-aware layout** | Logarithmic force scaling — charge and link distance computed from `ln(n)` so the graph looks correct at 5 nodes or 50+ nodes without manual tuning |

#### Admin & Account

| Feature | Description |
|---|---|
| **Token Budget Settings** | Settings → Token Budget Alerts — configure initial alert threshold, critical threshold, and re-alert frequency after dismissal; settings persisted to DB and take effect immediately without page refresh |
| **Task Reminder Settings** | Settings → Task Reminders — toggle any of 7 reminder times on/off; pause all reminders with a single toggle; yellow banner shown when paused; times saved as JSON to `task_reminder_times` in the settings table; pause state saved to `task_reminders_paused` |
| **Admin Dashboard** | Usage stats — sessions, messages, tokens, searches, debates, comparisons; filterable by date range |
| **Search** | Global search palette across projects, chats, files, and tasks |
| **Password reset** | Email-based password reset flow with 1-hour expiry tokens |
| **Password show/hide** | Eye icon on all password fields (login, change password, reset password) toggles visibility |
| **Model management** | Add, edit, delete, and test AI models from Settings → AI Models; changes persist to DB and are reflected immediately across the entire app (chat selector, compare, project settings); Reset to defaults button restores the built-in 5 models |
| **Model availability** | Settings page shows API key status (✓ configured / ⚠️ key missing) per model; Test button sends a live probe to each model and reports success or the exact error (auth, billing, model not found, rate limit) |

> **Detailed feature docs:** [TASKS.md](TASKS.md) · [GOALS.md](GOALS.md)

### Tech Stack

- **Backend:** Node.js / Express, PostgreSQL (`pg`), Anthropic SDK, Google Generative AI SDK (`@google/generative-ai`)
- **Frontend:** React / Vite, Zustand (auth + project + settings state), React Router, Tailwind CSS, `react-force-graph-2d` (D3 force simulation — Knowledge Graph)
- **Auth:** Token-based sessions (single-user via seed credentials); bcryptjs for password hashing
- **Deploy:** Railway with PostgreSQL service and persistent volume for file uploads

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

## Gmail & Calendar Integration

Users can connect their personal Gmail account via Google OAuth 2.0 and query their inbox using natural language directly from the chat `@gmail` mention. The same single OAuth flow also grants read-only Google Calendar access, enabling `@calendar` event search. Both integrations share the `gmail_tokens` table.

### Gmail — how it works end-to-end

1. **OAuth flow** — `GET /api/gmail/auth` generates an OAuth URL with a short-lived state nonce stored in the `settings` table. Google redirects back to `GET /api/gmail/callback` (registered *before* `requireAuth` — no session cookie required during callback). Tokens are stored in `gmail_tokens`.

2. **Natural language → Gmail query** — `GET /api/gmail/search?q=` passes the user's natural language input through `translateToGmailQuery()` in `server/services/gmailNLP.js`, which calls Claude Haiku to produce a valid Gmail search query, intent classification, max result count, and response mode. All date arithmetic is pre-computed in JavaScript and injected into the system prompt — Claude never invents dates.

3. **Thread attachment** — selecting a search result fetches the full email thread via `GET /api/gmail/thread/:threadId`. The thread text is injected into the chat as a `gmail://thread/<id>` URL attachment (using the existing URL attachment system) with pre-fetched content, so no additional API call is made when the message is sent.

4. **Ask endpoint** — `POST /api/gmail/ask` streams a Claude Haiku answer about a specific thread via SSE. The system prompt strongly asserts inbox ownership to prevent content-policy refusals on financial/legal/personal emails. Any suspected refusal is logged to the console with the email subject and question for prompt tuning.

### Calendar — how it works end-to-end

1. **Shared OAuth** — the same Google OAuth flow requests `calendar.readonly` alongside `gmail.readonly`. If a user connected Gmail before Calendar was added, the Settings page shows a "Reconnect Google" prompt. Calendar access is confirmed by checking `scope.includes('calendar')` on the stored token.

2. **Natural language → Calendar query** — `GET /api/calendar/search?q=` passes the query through `translateToCalendarQuery()` in `server/services/calendarNLP.js`, which calls Claude Haiku and returns `{ timeMin, timeMax, searchQuery, maxResults, calendarId, intent }`. All date ranges are pre-computed in JavaScript — Claude never calculates dates. Two default range strategies: time-based queries use today → +30 days; name-based searches (no time context) use −90 → +90 days so past and future events are both found.

3. **Event attachment** — selecting a result fetches the full event via `GET /api/calendar/event/:eventId` and injects it as a `calendar://event/<id>` URL attachment with pre-formatted plain text (title, date/time, location, organiser, attendees, description).

4. **Dismiss on outside click** — the search modal closes when clicking anywhere outside it, same as the Gmail and web search modals.

### Date ranges supported

The `gmailNLP` service pre-computes all commonly needed date ranges from today's date: today, yesterday, this/last week (Mon-Sun), this/last month, this/last year, last 7/14/30/90 days, this/last quarter, current and last Australian financial year (Jul–Jun), and the most recent January.

The `calendarNLP` service pre-computes the same ranges plus named weekdays for the current week (Monday–Sunday) and time-of-day boundaries (morning 06:00–12:00, afternoon 12:00–17:00, evening 17:00–22:00 UTC).

### Setup

1. Enable the **Gmail API** in [Google Cloud Console](https://console.cloud.google.com/) and create an OAuth 2.0 Client ID (Web application type).
2. Enable the **Google Calendar API** in the same Google Cloud project.
3. Add the redirect URI: `https://your-app.up.railway.app/api/gmail/callback` (and `http://localhost:3001/api/gmail/callback` for local dev).
4. Add the three env vars (see Environment Variables below).
5. Connect from **Settings → Integrations → Connect Google** (one flow covers both Gmail and Calendar).

### NLP test harness

Run `node server/services/gmailNLP.test.js` to execute 45 test cases across 11 categories (direction, name resolution, time ranges, content keywords, attachments, status, count/extract/summary/thread intent, and combined queries). Output includes per-category breakdown and an overall score.

---

## File Structure

```
vault/
├── server/
│   ├── index.js                  # Express server entry point
│   ├── db.js                     # PostgreSQL schema + pool
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
│       ├── files.js              # File upload, extraction, AI summary; RAG chunking + embedding pipeline runs after extraction (skipped silently if GEMINI_API_KEY absent)
│       ├── personas.js           # Persona CRUD
│       ├── prompts.js            # Prompt library CRUD
│       ├── memory.js             # Global memory CRUD
│       ├── folders.js            # Folder management
│       ├── pinnedUrls.js         # URL pinning + content fetch; YouTube URLs detected and routed to youtubeTranscript.js (InnerTube API); summariseTranscript() calls Claude Haiku to compress transcripts to ~20% on pin/refresh; SSRF-protected for all other URLs
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
│       ├── calendar.js           # Google Calendar search + event fetch + ask (SSE); shares gmail_tokens table; scope check ensures calendar.readonly was granted
│       ├── sharedTasks.js        # Public shared task view — no auth (registered before requireAuth)
│       ├── settings.js           # App settings key/value store (API keys, config)
│       ├── bookmarks.js          # Bookmark CRUD — toggle, session lookup, all-bookmarks with message+session context, count endpoint
│       └── health.js             # Health check endpoint
│   ├── services/
│   │   ├── embeddings.js         # RAG embedding service — embedText() calls Google text-embedding-004 (768-dim); retrieveRelevantChunks() queries file_chunks via pgvector cosine similarity; returns empty array on any error so callers fall back gracefully
│   │   ├── chunker.js            # Text chunking — splits extracted text into ~500-token chunks at sentence boundaries with 50-token overlap; used by the file upload route and migration script
│   │   ├── gmailNLP.js           # Natural language → Gmail query translator; calculateDates() pre-computes all date ranges; translateToGmailQuery() calls Claude Haiku; GMAIL_LIMITS constants
│   │   ├── gmailNLP.test.js      # 45-case test harness with scoring and ANSI colour output; run: node server/services/gmailNLP.test.js
│   │   ├── calendarNLP.js        # Natural language → Calendar API query translator; calculateDates() pre-computes ISO 8601 time ranges for named days/weeks/time-of-day; translateToCalendarQuery() calls Claude Haiku; CALENDAR_LIMITS constants
│   │   └── youtubeTranscript.js  # YouTube transcript fetcher — no npm dependency; isYoutubeUrl() detects YT links; fetchYoutubeTranscript() POSTs to InnerTube API for caption tracks, fetches caption XML, strips timestamps, fetches title via oEmbed; stores up to 50,000 chars; chat.js uses transcript_summary if present, otherwise falls back to raw transcript up to 40,000 chars; falls back to webpage fetch on failure
│   ├── scripts/
│   │   └── migrateEmbeddings.js  # One-time idempotent backfill — chunks and embeds all existing files that have extracted text but no file_chunks rows; run: npm run migrate:embeddings
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
│       │   ├── ChatPage.jsx      # Main chat interface (project and general); uses useModels for dynamic model list; MemoMessageList defined at module level and wrapped in React.memo so the message list only re-renders on message/streaming changes, not on every keystroke; handleOpenArtifact/handleRegenerate/handleBranch wrapped in useCallback; stableSuggestionSelect uses latest-ref pattern for stable FollowUpChips callback; @mention query debounced 150ms
│       │   ├── ChatHistoryPage.jsx    # Browse all sessions by date / search; Bookmarks tab shows all starred messages grouped by session
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
│       │   ├── MessageBubble.jsx # Chat message rendering; ★ bookmark button on hover for both user and assistant messages
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
│       │   ├── CalendarConnect.jsx # Calendar OAuth status/connect component (used in SettingsPage → Integrations; shares Gmail OAuth flow)
│       │   ├── FollowUpChips.jsx # Suggested follow-up prompts
│       │   ├── ExportMenu.jsx
│       │   ├── EmailModal.jsx
│       │   ├── NewProjectModal.jsx
│       │   ├── KeyboardShortcutsModal.jsx
│       │   ├── TasksCalendar.jsx # Time-blocking calendar (day/week/month/agenda; drag-drop; block resize)
│       │   ├── MorningDigest.jsx # Daily task digest overlay (once per day)
│       │   ├── TaskReminderModal.jsx # Scheduled task reminder overlay — shows overdue + today tasks at configured times; localStorage-keyed per day/time to prevent double-show; "Go to Tasks" + "Dismiss" buttons
│       │   ├── QuickCapture.jsx  # Floating quick-capture FAB (Ctrl+Shift+N)
│       │   ├── PromptVariableModal.jsx  # Fill-in-the-blanks modal for {{variable}} prompt templates; live preview; used by ChatPage and PromptsPage
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
│       │   └── settingsStore.js  # Zustand settings state — persists font, theme, icon pack, session budget, file types, task reminder times + paused flag
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
│       │   ├── promptVariables.js  # extractVariables(), fillVariables(), labelFor() — parse and resolve {{variable}} placeholders in prompt templates
│       │   ├── parseDate.js      # Natural language date parser (pure frontend, no API calls)
│       │   ├── exportMd.js       # Markdown export formatter
│       │   └── exportHelpers.js
│       └── providers/
│           ├── ThemeProvider.jsx
│           └── IconProvider.jsx
│
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
| `pinned_urls` | URLs pinned to projects with fetched content, `lastFetchedAt` timestamp, `isYoutube` boolean (drives 📺/🌐 icon and transcript vs webpage fetch), and `transcript_summary` (Claude Haiku-generated ~20% summary of YouTube transcripts; injected in chat instead of the raw transcript when present) |
| `folders` | Folder organisation |
| `debates` | Multi-model debate rounds and results |
| `comparisons` | Saved document comparison results linked to projects |
| `search_logs` | Web search query log (powers admin dashboard search count) |
| `settings` | Key/value store for API keys and app config — includes `vault_models` (JSON array of active AI models); if `vault_models` is absent the app uses the built-in defaults from `utils/models.js`; `task_reminder_times` (JSON array of HH:MM strings); `task_reminders_paused` (boolean string) |
| `tasks` | Task records — status, priority, urgency (`isUrgent`), renewal dimension (`renewalDimension`), due date, category, tags, recurrence, estimated effort, time spent, share token, parent task link, key result link, `recurrenceGroupId` (UUID linking all non-done instances in a recurring series) |
| `task_tags` | Many-to-many tag associations for tasks |
| `task_comments` | Per-task comments and auto-logged activity events (status/priority/due-date changes) |
| `task_dependencies` | Directed blocker relationships between tasks — `taskId` is blocked by `blockedByTaskId`; unique constraint prevents duplicates; circular dependency detection on insert |
| `task_templates` | Reusable task templates with predefined priority, category, recurrence, and tags |
| `template_subtasks` | Subtask definitions belonging to a task template |
| `objectives` | OKR Objectives — title, description, timeframe, colour, status, renewal dimension (`renewalDimension`) |
| `key_results` | Key Results linked to an Objective — numeric target/current values, unit, due date |
| `gmail_tokens` | Gmail + Calendar OAuth tokens per user — `accessToken`, `refreshToken`, `tokenType`, `expiryDate`, `scope`, `email`; access token auto-refreshed and persisted via `googleapis` token event; `scope` field used to detect whether `calendar.readonly` was granted |
| `notes` | User-scoped quick-capture notes — title, body, optional project link |
| `session_files` | Files selected for a specific chat session — `sessionId` + `fileId` composite PK; content injected into system prompt for that session only |
| `bookmarks` | Starred messages — `messageId` (FK → messages, unique), `sessionId` (FK → sessions); cascade-deleted when the message or session is deleted |
| `file_chunks` | RAG chunk store — each row holds a ~500-token chunk of a file's extracted text, its chunk index, and a 768-dimensional Google `text-embedding-004` embedding (`vector(768)`); queried at chat time via pgvector cosine similarity to retrieve the top-5 most relevant chunks for the user's message; cascade-deleted when the parent file is deleted |

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `SEED_EMAIL` | Yes | Initial user email (created on first startup if no users exist) |
| `SEED_PASSWORD` | Yes | Initial user password (change via Settings after first login) |
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/vault`) |
| `UPLOAD_DIR` | Yes | Absolute path to file uploads directory |
| `NODE_ENV` | Yes | `production` or `development` |
| `APP_URL` | Yes | Base URL for password reset emails and task share links (e.g. `https://curam-vault.up.railway.app`) |
| `PORT` | Optional | HTTP port (default `3001` in dev; Railway sets this automatically) |
| `GEMINI_API_KEY` | Optional | Google Gemini API access — enables Gemini 2.0 Flash and Gemini 2.5 Pro models |
| `SEARCH_API_KEY` | Optional | Web search API key — supports Brave Search (`BSA…` prefix), Serper.dev (40-char hex), or SerpAPI (default) |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth 2.0 client ID — enables Gmail + Calendar integration (`@gmail`, `@calendar` in chat, Settings → Integrations) |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Optional | OAuth redirect URI — must match exactly in Google Cloud Console (e.g. `https://your-app.up.railway.app/api/gmail/callback`) |
| `ENCRYPTION_KEY` | Optional² | 64 hex char key (32 bytes) for AES-256-GCM encryption of Gmail OAuth tokens at rest. Generate: `openssl rand -hex 32`. If absent, tokens stored plaintext with a startup warning. |
| `MAIL_CHANNEL_API_KEY` | Optional | MailChannels API key for email; if absent, falls back to SMTP (see below) |
| `SMTP_HOST` | Optional¹ | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | Optional¹ | SMTP port — `587` for TLS (default), `465` for SSL |
| `SMTP_USER` | Optional¹ | SMTP username / email address; also used as the sender `From` address |
| `SMTP_PASS` | Optional¹ | SMTP password or app-specific password |

¹ Required together if `MAIL_CHANNEL_API_KEY` is not set and you want email features to work.

² Strongly recommended in production. Without it Gmail OAuth tokens are stored unencrypted in the database.

### `.env.example`

```env
# ── Required ──────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3001
NODE_ENV=development   # set to "production" on Railway (handled via railway.toml)

# ── Database ───────────────────────────────────────────────────────────────────
# Local dev
DATABASE_URL=postgresql://vault:vault@localhost:5432/vault_dev

# Railway production: set DATABASE_URL to your Railway PostgreSQL service URL
# (available under the PostgreSQL service → Variables → DATABASE_URL)

# ── Storage ───────────────────────────────────────────────────────────────────
UPLOAD_DIR=./uploads

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
| **Code file isolation** | Uploaded code files (`.js`, `.ts`, `.php`, `.py`, etc.) are stored on disk with a `.txt` extension appended (e.g. `index.js` → `index_js.txt`). The original filename is preserved in DB metadata only. `mimetype` is forced to `text/plain` in the database regardless of what the browser sent. No route serves code file content publicly — it is only injected into LLM context server-side. |
| **Code file size limit** | Code uploads hard-capped at 500 KB. Files exceeding this are deleted immediately and the upload returns a 400 error explaining the limit, preventing context overflow. |
| **Prompt injection sanitisation** | `server/utils/sanitiseCodeFile.js` scans every uploaded code file line by line for injection patterns (`Ignore previous instructions`, `You are now`, `SYSTEM:`, `###Instructions`, etc.). Matching lines are replaced with `// [REMOVED: potential prompt injection]` and a server-side warning is logged. Legitimate code constructs (`eval()`, `exec()`, `require()`) are not affected. |
| **`.env` file block** | Bare `.env` files are explicitly rejected by the upload `fileFilter` regardless of MIME type, preventing accidental upload of secrets. `.env.example` is the only dotenv-style file permitted. |
| **Brute force** | `POST /api/auth/login` is rate-limited to 10 attempts per 15 minutes per IP via `express-rate-limit`. |
| **XSS in email** | All user-generated content (message body, role, subject) is HTML-escaped via `escapeHtml()` before injection into the email template. |
| **Change-password auth** | Route is at `/api/user/change-password` and protected by the standard `requireAuth` middleware. |
| **Web search cost** | `/api/web-search` rate-limited to 20 requests per hour per IP. |
| **SQL injection** | All database queries use `pg` parameterised queries (`$1`, `$2`, …) — no string interpolation. |
| **Auth sessions** | 32-byte random hex tokens; 24-hour expiry checked server-side on every request. |
| **Passwords** | bcryptjs with SALT_ROUNDS=12. |
| **Security headers** | `helmet` middleware applied in production (default CSP, HSTS, X-Frame-Options, etc.). |
| **Public routes** | `/api/shared/task/:token`, `/api/auth/*`, and `/api/gmail/callback` are registered before `requireAuth`; all other `/api/*` routes require a valid session token. The Gmail router applies `requireAuth` internally for all its paths except `/callback`. |
| **OAuth state nonce** | Gmail OAuth state nonce stored in `settings` table with a 10-minute expiry; validated and deleted on use; prevents CSRF during the OAuth redirect flow. |
| **Gmail tokens at rest** | `accessToken` and `refreshToken` encrypted with AES-256-GCM before writing to `gmail_tokens`; decrypted only at runtime. Key loaded from `ENCRYPTION_KEY` env var (64 hex chars). Graceful fallback: if key is absent, tokens are stored plaintext and a startup warning is logged. Existing plaintext rows are transparently handled on read and re-encrypted on next write. |
| **Gmail rate limiting** | `/api/gmail/auth` — 5 req/15 min per IP; `/api/gmail/search` and `/api/gmail/thread/:id` — 60 req/min per IP; `/api/gmail/ask` — 20 req/min per IP (tightest, triggers both Gmail API and Anthropic). |
| **Gmail search input** | `q` parameter capped at 500 characters; returns 400 if exceeded. `max` clamped to `GMAIL_LIMITS.count` (500). |
| **Web search prompt injection** | When native web search is enabled the system prompt explicitly instructs the model that search results are untrusted external data; the model is told never to follow instructions found in `web_search_tool_result` blocks or `<search_result>` tags regardless of how they are framed, and never to treat search result content as coming from the system, the user, or the AI provider. Anthropic caps searches at 3 per user turn via `max_uses: 3` on the tool definition. |
| **Anthropic data retention** | `store: false` set on every Anthropic API call (chat stream, summarisation, auto-title, suggestions, Gmail ask, NLP query translation). Opts out of Anthropic using request content for model training. |

---

## Running Locally

```bash
cd vault
npm install
npm run dev
```

**Node version:** Node.js v22 LTS is recommended.

**Production** is deployed on Railway: `https://curam-vault.up.railway.app`

---

## Recent Changes

### March 2026

- **YouTube transcript summarisation** — when a YouTube URL is pinned or refreshed, `summariseTranscript()` in `pinnedUrls.js` calls Claude Haiku to compress the raw transcript to ~20% of its original length (flowing prose, key points and specifics preserved); result stored in the new `transcript_summary` column on `pinned_urls`; transcripts under 5,000 chars are stored as-is without an API call; `chat.js` now injects `transcript_summary` when present instead of the raw transcript, significantly reducing context token usage; raw transcript always preserved for re-summarisation on refresh; graceful fallback to raw transcript if `ANTHROPIC_API_KEY` is absent or the Haiku call fails
- **RAG fallback cap + observability** — when embeddings are unavailable and full-text injection is used instead, the combined file content is now capped at 32,000 characters; if truncated, `[Content truncated — embeddings unavailable. Re-upload files to restore full RAG context.]` is appended; `console.warn` logs `[RAG FALLBACK] session=… project=… raw_chars=… capped_chars=…`; `ragFallbackActive: true` added to the usage SSE event so the client can surface it; the context bar in `ChatPage` now shows an amber ⚠ chip when fallback is active, with a tooltip explaining the cause and remedy
- **Anthropic prompt caching** — `buildSystemPrompt` in `server/routes/chat.js` now returns an array of `{ type, text, cache_control? }` content blocks instead of a flat string; blocks ordered: [1] persona + base instructions, [2] project brief, [3] global memory, [4] file/URL context (RAG chunks, full-text fallback, session files, pinned URLs — combined to respect Anthropic's 4-breakpoint limit); today's date and web-search notice form a final uncached block so they are always fresh; `prompt-caching-2024-07-31` added to the `anthropic-beta` header whenever cached blocks are present; Gemini path joins all block texts with `\n\n` and passes to `systemInstruction` as before; no behaviour change for Gemini
- **Recurring task delete modal** — deleting a recurring task now shows a 3-option modal (cancel / delete this task only / delete this and all future recurrences); all tasks in a series share a `recurrenceGroupId` UUID generated at creation and carried forward on each recurrence spawn; `DELETE /api/tasks/:id?stopSeries=true` deletes all non-done tasks in the group (cleaning up their subtasks first); existing series gain group IDs on next recurrence spawn
- **Task duplication** — copy icon on kanban cards duplicates the task with all fields intact (recurrence, `renewalDimension`, `keyResultId`, `estimatedMinutes`, `isUrgent`) plus all subtasks; `POST /api/tasks/:id/duplicate` endpoint
- **Eisenhower Matrix Q2 prominence** — Q2 (Schedule — Important, not Urgent) visually elevated in the Matrix view; two-column flex layout (Q2 at 58% width right, Q1/Q3/Q4 stacked at 42% left); Q2 has a stronger border, subtle surface tint, larger shadow, and bolder task titles; mobile-first — Q2 appears at top on small screens
- **Getting Started Tour** — Shepherd.js product tour on the Goals page that introduces the Getting Started Wizard before users run it; 6 steps in a warm, encouraging tone; "I'm ready" finish step does not auto-launch the wizard; `TOUR_KEY = 'vault_tour_getting_started_completed'` in localStorage; tour takes priority over the Goals tour when both are pending on `/goals`; replayable from Settings → Product Tours
- **Getting Started Wizard** — 7-step full-screen guided setup for the Goals page; steps: Personal Context (what matters most, what you're improving, life stage) → Mission Statement (Claude drafts from context, editable + regenerate) → First Objective (AI-suggested with colour picker, fully editable) → Key Results (3 AI-suggested, toggle/edit/add) → Connect Tasks (link existing open tasks to the objective) → Renewal Balance (four 0–10 sliders + streaming AI observation) → Review & Save (sequential save of mission, objective, KRs, task links, and completion flag); draft auto-saved to `localStorage`; wizard triggered automatically on first visit when no objectives exist; ✨ button in Goals header to reopen; Settings page "Redo Setup" button resets completion flag; `GET /api/goals/wizard/status`, `POST /api/goals/wizard/complete`, `POST /api/goals/wizard/reset`, `POST /api/goals/wizard/generate-mission`, `POST /api/goals/wizard/suggest-objective`, `POST /api/goals/wizard/suggest-krs`, `POST /api/goals/wizard/renewal-observation` — completion state stored in the `settings` table
- **Knowledge Graph — Phase 3: Proactive Insights** — Insights panel powered by Claude Haiku; analyses graph structure (orphaned nodes, cross-project semantic clusters, top-connected nodes) and generates 4–6 specific observations; each insight has a "Show me" button that highlights and zooms to the relevant nodes; insights cached in the `settings` table and refreshed on demand
- **Knowledge Graph — Phase 2: Semantic Connections** — `POST /api/graph/compute-semantic` SSE endpoint; file↔file similarity via pgvector SQL; note and session embeddings via Gemini; note↔note, file↔note, and session↔note comparisons; connections cached in the `graph_edges` table; dashed pink lines on canvas; "Find connections" / "Re-compute" button with live progress bar
- **Knowledge Graph — Phase 1** — New `/graph` route with a full-screen `react-force-graph-2d` canvas; all vault content (projects, files, notes, sessions, tasks, goals, pinned URLs) rendered as typed, shaped nodes; explicit structural edges; hover highlights adjacency; click opens node detail panel with "Go to" navigation; search, type filters, Insights panel, scale-aware logarithmic force layout
- **Prompt Chains** — New `/chains` page for building and running multi-step prompt sequences; output from each step passed as context to the next; per-step model selection; starter templates; SSE streaming
- **RAG (Retrieval-Augmented Generation) for file context** — replaces full pinned-file injection with semantic chunk retrieval; `pgvector` extension enabled on PostgreSQL; new `file_chunks` table stores text chunks with 768-dimensional embeddings from Google's `text-embedding-004` model (reuses the existing `GEMINI_API_KEY`); `server/services/chunker.js` splits extracted text into ~500-token chunks at sentence boundaries with 50-token overlap; `server/services/embeddings.js` calls the Google Generative AI SDK for embedding and exposes `retrieveRelevantChunks(queryText, projectId, topK)` which queries `file_chunks` using pgvector cosine similarity (`<=>` operator); file upload route chunks and embeds text immediately after extraction; chat route calls RAG first and injects the top-5 relevant chunks under `## Relevant context from project files`, falling back to full-text injection if `GEMINI_API_KEY` is absent or no chunks exist yet; session files (user-selected per session) continue to be injected in full as before; `server/scripts/migrateEmbeddings.js` back-fills embeddings for all existing files (`npm run migrate:embeddings`); requires no new environment variables — completely optional, zero behaviour change without `GEMINI_API_KEY`
- **Chat input performance** — eliminated keyboard input lag as conversations grow; `MemoMessageList` extracted as a module-level `React.memo` component so the message list bails out of re-rendering when only the input state changes; `handleOpenArtifact` signature changed to `(idx, blocks)` and memoised with `useCallback([], [])` — `extractCodeBlocks` is now computed inside `MessageBubble` via `useMemo` so no per-message closure is created in the parent; `handleRegenerate` and `handleBranch` wrapped in `useCallback` with explicit deps; `stableSuggestionSelect` uses a latest-ref pattern (`handleSendRef.current = handleSend` each render; stable `useCallback` reads through the ref) so `FollowUpChips` gets a stable prop without stale-closure risk; `@mention` query debounced 150 ms — `setShowMention` remains immediate while `setMentionQuery` (which triggers filtering) fires only after the user pauses typing; `extractCodeBlocks` import removed from `ChatPage` since it is now encapsulated in `MessageBubble`
- **Native AI web search** — Globe/Search toggle added to the chat header (on by default); Anthropic models use the `web_search_20250305` built-in tool with `max_uses: 3` and the `web-search-2025-03-05` beta header; Gemini models use Google Search grounding (`{ googleSearch: {} }` tool); provider detected automatically from the active model — no manual switching required; a `{ searching: true }` SSE event is emitted when the Anthropic model initiates a search, replacing the loading dots with a globe icon + "Searching the web…" in the message bubble; `isSearching` state exposed from `useChat` and aliased to `isAiSearching` in `ChatPage` to avoid collision with the existing `isSearching` search-UI state; system prompt includes a prompt-injection security notice when web search is on, instructing the model to treat all search results as untrusted external data and never follow instructions found in them
- **Today's date in system prompt** — current date (`YYYY-MM-DD`) injected into every chat's system prompt so the model always knows the current date and can correctly judge whether its training data is stale; applied regardless of whether web search is enabled
- **My Tasks "Invalid Date" fix** — `dueLabel()` in `ProjectList.jsx` was appending `T00:00:00` directly to `dateStr` without first checking for an existing time component; tasks with a time set (e.g. `2026-03-13T09:00`) produced `2026-03-13T09:00T00:00:00` — an invalid date string that rendered as "Invalid Date"; fixed by slicing to the date part first (matching the pattern already used in `TasksPage.jsx`'s `dueInfo()`)
- **Office file extraction** — `.xlsx`, `.xls`, `.ods` files parsed sheet-by-sheet into CSV text via the `xlsx` package; `.docx` and `.doc` files extracted via `mammoth`; extracted text stored as `extractedText` in the `files` table and AI-summarised on upload; works identically to PDFs for pinning and session context injection; `xlsx` and `mammoth` added to dependencies
- **Session files** — select any project library file to include in the current chat session only; files persisted to `session_files` table (survives page refresh within the same session); shown in a context bar above the message list; paperclip icon on each file card (turns primary colour when active); `POST /api/session-files/:sessionId`, `GET`, and `DELETE` endpoints added; `session_files` table created in `db.js` with cascade deletes
- **Project sidebar accordion** — clicking a project name now toggles its recent session list open/closed; only one project expanded at a time; sessions fetched lazily on first expand; chevron icon shows open/closed state; `+` button on hover starts a new chat for that project; clicking a session navigates directly into that chat
- **Code block rendering fix** — `@tailwindcss/typography`'s `prose` class was injecting backtick pseudo-elements (`code::before/after`) onto `<code>` elements inside react-syntax-highlighter and inline code; fixed by adding `className="not-prose"` to `CodeBlock`'s outer div and to the inline `<code>` element in `mdComponents.jsx`
- **Recurring tasks fix** — recurrence previously required a `dueDate` to fire; now uses today as the base date when none is set; added a `wasAlreadyDone` guard to prevent duplicate occurrences when updating an already-completed task
- **File card layout** — filename now uses `flex-1 min-w-0` with a two-row layout (name on top, badges below) so it is always visible regardless of how many action buttons are present
- **File library — attach from Project Files panel** — every file in the Project Files chat panel now has an **Attach** button; clicking it adds the file to the current message's attachments without re-uploading; use pin for files that should be present in all chats in a project, and Attach for on-demand per-message access; `ProjectFilesPanel`, `FileList`, and `FileCard` updated; `onAttach` callback wired from `ChatPage` via `attachExisting` in `useFileAttachment`
- **Markdown table rendering** — tables in AI responses, document compare, and debate now render with proper styling; `mdComponents.jsx` updated with `table`, `thead`, `tbody`, `tr`, `th`, `td` renderers; tables scroll horizontally on overflow rather than breaking layout
- **Anthropic SDK upgraded to 0.78.0** — `@anthropic-ai/sdk` updated from `^0.36.3` to `^0.78.0`; required for `anthropic.beta.files` API support; `beta.files.upload` and `beta.files.del` are now available
- **Chat context fix** — `betas: ['files-api-2025-04-14']` was incorrectly placed inside the message params object; moved to request options (`{ headers: { 'anthropic-beta': '...' } }` as second argument to `messages.stream()`); incorrect placement caused streaming failures when any file document block was present, breaking conversation context
- **Code file uploads** — new file types accepted: `.js`, `.jsx`, `.ts`, `.tsx`, `.php`, `.py`, `.css`, `.html`, `.sql`, `.sh`, `.env.example`; stored on disk with `.txt` appended to the extension (original filename kept in DB); `mimetype` forced to `text/plain` in the database; 500 KB hard limit with a clear error message; UTF-8 validation rejects binary files; all content passed through `server/utils/sanitiseCodeFile.js` before storage — prompt injection patterns replaced with a comment and a server-side warning logged; `.env` files (without `.example`) explicitly blocked; `FileUploader` now reads `allowedFileTypes` from the settings store instead of a hardcoded string, so the file picker respects user settings
- **Settings file type save** — `allowedFileTypes` in Settings → Upload File Types now persists to the database (`settings` table, key `allowedFileTypes`) via `POST /api/settings` on blur; on page load the value is fetched from `GET /api/settings` and synced to the Zustand store, so the setting survives across browsers and devices; previously the value was Zustand/localStorage only

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
