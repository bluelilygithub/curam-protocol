# Changelog

A log of bugs found and fixed in the Curam Vault application.

---

## 2026-05-04 (2)

**Feature:** Smart branch suggestions — LLM-initiated chat branching within projects.

When an AI response covers a complex topic with clear sub-areas, the model may append up to 3 branch suggestions at the end of its reply. These appear below the message as "Explore deeper" chips (with a git-branch icon), distinct from follow-up question chips. Clicking a branch creates a new session in the same project, pre-seeded with the LLM's opening content for that topic, and navigates to it. The parent session is preserved.

**Implementation:** `BRANCH_INSTRUCTION` injected into system prompt Block 1 for all non-`quick` project chats (all models). Server parses and strips `[BRANCHES]...[/BRANCHES]` from `fullContent` after streaming, emits a `{"branches":[...]}` SSE event before `[DONE]`, and stores clean content in DB. Client strips the block from the displayed message on receipt. `POST /api/chat/sessions/seed` endpoint creates the pre-seeded session. `BranchSuggestions.jsx` renders below `FollowUpChips`.

**New file:** `client/src/components/BranchSuggestions.jsx`. **Modified files:** `server/routes/chat.js`, `client/src/hooks/useChat.js`, `client/src/pages/ChatPage.jsx`.

---

## 2026-05-04

**Perf:** In-process cache for user profile settings — eliminates DB round-trip per chat message.

`buildSystemPrompt` previously queried `settings` for `user_name`, `user_city`, `user_state`, `user_country` on every message. These values rarely change. A `Map`-based TTL cache (5-minute expiry, per `userId`) now serves the data from memory after the first request, skipping the DB hit on subsequent messages.

**Modified file:** `server/routes/chat.js`.

---

## 2026-05-03 (5)

**Deploy test:** Toolbar progressive-disclosure refactor — PageToolbar + OverflowMenu components, TasksPage and ChatPage updated.

---

## 2026-05-03 (4)

**Feature:** `OverflowMenu` component + ChatPage declutter (toolbar stage 2).

Extracted `client/src/components/OverflowMenu.jsx` — standalone `⋯` dropdown supporting label, icon, shortcut badge, active state, danger styling, dividers, and disabled state. `PageToolbar` now delegates to `OverflowMenu` internally (DRY). ChatPage: star, summarize, download, and delete chat — previously 4 unlabelled icon-only buttons — replaced with a single `⋯` session-actions menu. Files button gains a visible "Files" label. NotesPage toolbar already satisfies labelling and grouping principles; no changes made.

**New file:** `client/src/components/OverflowMenu.jsx`. **Modified files:** `client/src/components/PageToolbar.jsx`, `client/src/pages/ChatPage.jsx`.

---

## 2026-05-03 (3)

**Feature:** `PageToolbar` — shared progressive-disclosure toolbar component, wired into Tasks.

New `client/src/components/PageToolbar.jsx` implements four named zones: title · view-controls · contextual slot · [overflow ⋯] [?] [primary CTA]. Replaces the flat 10-button row in TasksPage.

**View controls** now show icon + text label per button (labels hidden on mobile via `hidden sm:inline`). **Secondary actions** (Ask Claude, Weekly Review, Import, Templates, Tasks guide) moved into a `⋯` overflow dropdown — each item shows icon + label + optional shortcut badge (`A`, `W`). Active timer remains in the contextual slot (visible only when running). `?` shortcuts button and `+ New Task` primary CTA always visible.

`more-horizontal` and `help-circle` icons added to `IconProvider`. `PageToolbar` is ready for reuse on Chat and Notes pages.

**New file:** `client/src/components/PageToolbar.jsx`. **Modified files:** `client/src/pages/TasksPage.jsx`, `client/src/providers/IconProvider.jsx`.

---

## 2026-05-03 (2)

**Fix:** Server crash on startup when pgvector unavailable after session RAG feature.

**Root cause:** `ALTER TABLE sessions ADD COLUMN "summaryEmbedding" vector(768)` was added outside any try/catch. Environments without pgvector threw `type "vector" does not exist`, which propagated to `initSchema()` and triggered `process.exit(1)`.

**Solution:** Wrapped the column addition in a try/catch matching the same best-effort pattern already used for `file_chunks`. Server now starts cleanly without pgvector — `summaryEmbedding` column is skipped with a warning and session RAG degrades to the recency fallback.

**Modified file:** `server/db.js`.

---

## 2026-05-03

**Feature:** Project chat history RAG — semantic context across sessions.

After each AI reply in a project chat, a ~150-word summary of the session is generated (Claude Haiku) and embedded (Google `text-embedding-004`) then stored in `sessions.summary` and `sessions.summaryEmbedding`. On every new message, the user's message is embedded and cosine-searched against all other summarised sessions in the same project. The top-5 most semantically relevant summaries are injected as a non-cached "Related project conversations" block in the system prompt — giving the model awareness of decisions, discoveries, and context from prior chats in the project. Falls back to most-recent sessions if Gemini is unavailable.

**Schema:** `summary TEXT` and `"summaryEmbedding" vector(768)` added to `sessions` table.

**Modified files:** `server/db.js`, `server/routes/chat.js`.

---

## 2026-05-02 (6)

**Feature:** Apple Touch Icon — Curam AI logo used when site saved to iOS home screen.

Added `<link rel="apple-touch-icon" href="/favicon.png" />` to `client/index.html`.

---

## 2026-05-02 (5)

**Feature:** Favicon — Curam AI logo (`curam-ai-logo.png`) set as browser tab icon.

Copied logo to `client/public/favicon.png` (Vite serves `public/` as static root). Added `<link rel="icon" type="image/png" href="/favicon.png" />` to `client/index.html`.

---

## 2026-05-02 (4)

**Fix:** Notes mic dictation appends transcript on same line as existing content.

Changed append logic from space-separator (`current + ' ' + transcript`) to newline-separator (`current + '\n' + transcript`). Empty body still gets no leading newline.

**Modified file:** `client/src/pages/NotesPage.jsx`.

---

## 2026-05-02 (3)

**Fix:** iOS Safari mic dictation — transcription never captured on iPhone.

**Root cause:** `interimResults: false` (the default) means the browser only fires `onresult` when it marks a segment `isFinal: true`. iOS Safari's Web Speech API implementation never sets `isFinal`, so no results were ever delivered despite the mic appearing active.

**Solution:** Set `interimResults: true` so iOS fires `onresult` with interim segments. The `onresult` handler captures `sessionFinal || sessionInterim` — on iOS the interim value is the only one present; on desktop the final value is preferred. Live transcript now shown as italic preview text inside the red listening banner. Added `micError` state so permission-denied and other errors surface visibly below the banner rather than failing silently.

**Modified file:** `client/src/pages/NotesPage.jsx`.

---

## 2026-05-02 (2)

**Feature:** Mobile notes — slide-in list drawer and mic dictation.

**List drawer:** On mobile (`window.innerWidth < 640`), the 256px notes list side panel is replaced with a fixed slide-in overlay drawer (285px wide). It auto-opens when `/notes` loads. Selecting a note or tapping the backdrop closes it. A `≡ Notes` button in the editor toolbar re-opens it. The desktop layout is completely unchanged.

**Mic dictation:** A mic button appears in the editor toolbar whenever `SpeechRecognition` (or `webkitSpeechRecognition`) is available — Chrome on Android, Safari iOS 14.5+. Tap to start continuous dictation; tap again to stop. A red "Listening…" banner with a pulsing dot shows while active. On stop, the full transcript is appended to the note body (space-separated) and autosaved. Implemented using value refs (`bodyValueRef`, `titleValueRef`, `selectedRef`) to prevent stale closure issues in the Speech API callbacks.

**Toolbar cleanup on mobile:** Convert to Task and Take to Chat buttons are hidden on mobile to prevent toolbar overflow. Both remain visible on desktop.

**Modified file:** `client/src/pages/NotesPage.jsx`.

---

## 2026-05-02

**Feature:** Mobile dashboard — dedicated landing page for mobile users.

Logging in on a mobile device (`window.innerWidth < 640`) now redirects from `/` to `/mobile-dashboard` instead of the desktop project list. The mobile top bar is simplified: all individual icon links are hidden, replaced with a Home button (returns to dashboard when inside a feature), a Menu button (≡), and Logout.

**Dashboard tiles** — five cards stacked vertically, each with live data and quick actions:
- **Tasks** — today's due tasks with a count badge and inline quick-add form (title only, status `todo`). "View all" footer → `/tasks`.
- **Projects** — 2-column grid of all projects with colour-coded left border. Footer → `/`.
- **Finance** — YTD revenue, outstanding invoices (amber if > 0), overdue invoices (red if > 0), YTD expenses. Footer: "Add Expense" and "View all" → `/finance`.
- **Chat History** — last 12 sessions with relative timestamps and project name. Footer: "New Chat" → `/chat`, "All history" → `/history`.
- **Notes** — list of notes with body preview and inline quick-create (creates note then navigates to `/notes`). Footer → `/notes`.

**Navigation dropdown** — tapping ≡ opens a full-screen overlay listing all 21 features, with "Dashboard" pinned at the top. Active route highlighted. Closes on backdrop tap or item selection.

**Settings → Mobile tab** (new tab between "News Digest" and "Tours") — two sections:
- *Dashboard Tiles*: toggle each tile on/off and reorder with ▲▼ arrows.
- *Navigation Menu*: toggle each of the 21 nav items on/off.
- Save button persists to `mobile_dashboard_tiles` and `mobile_nav_items` settings keys.

**New files:** `client/src/utils/mobileConfig.js` (shared defaults + `mergeWithDefaults`), `client/src/pages/MobileDashboard.jsx`, `client/src/components/mobile/{TasksTile,FinanceTile,ChatHistoryTile,ProjectsTile,NotesTile,MobileNavDropdown}.jsx`.

**Modified files:** `App.jsx` (HomeRoute + `/mobile-dashboard` route), `Layout.jsx` (mobile header + dropdown), `SettingsPage.jsx` (Mobile tab), `IconProvider.jsx` (`menu`, `smartphone` icons added).

---

## 2026-04-28

**Feature:** Configurable default model for chat and new projects.

Previously the "standard" model slot (used for all general chat and new projects) was derived positionally from the `vault_models` list — always the second Anthropic model. There was no way to set it explicitly.

**Changes:**
- `modelResolver.js` now fetches both `vault_models` and `default_model` settings in one query. If `default_model` is set, it overrides the positional standard-slot logic.
- `useModels` hook exposes `defaultModel` and `saveDefaultModel`, loaded from the `default_model` settings key.
- Settings page (AI & Chat tab) shows a "Default model" `<select>` above the model list, populated from configured models. Blank option = system default (Sonnet 4.6). Saves instantly on change.
- `NewProjectModal` loads `default_model` on open and uses it as the initial model instead of the hardcoded `claude-haiku-4-5-20251001`.

---

## 2026-04-23

**Change:** Token optimisation pass on `buildSystemPrompt()` in `chat.js`.

Removed filler instructions and shortened verbose field labels throughout the system prompt. No behaviour change — purely cosmetic text reduction.

**Specific changes:**
- Block 1: removed `'You are a helpful AI assistant.'` fallback (no-op instruction); `'You are an AI assistant for the project X'` → `Project: "X"`
- Block 2: removed `'Provide focused, actionable assistance based on this project context.'` (pure filler); shortened labels — `Problem being solved:` → `Problem:`, `Target audience:` → `Audience:`, `Success criteria:` → `Success:`, `Communication tone:` → `Tone:`, `Additional notes:` → `Notes:`
- Block 3: `Persistent user memory:` → `Memory:`
- Block 4: `The following project files are pinned and included in full below:` → `Pinned files:`; `Files selected for this session:` → `Session files:`; `Pinned web pages:` → `Web pages:`
- Block 5 (web search): trimmed ~25 tokens from the web search instruction; security warning preserved but tightened
- Summarised session injection: assistant filler response (~19 tokens) → `'OK.'` (1 token)
- Summarise prompt: tightened
- Suggestions prompt: tightened

---

## 2026-04-15

**Issue:** Invoices (and other finance records) saved with wrong date — off by one day for Australian users.

**Root cause:** `todayStr()` in `FinancePage.jsx` used `new Date().toISOString().slice(0, 10)`, which returns the UTC date. In Australia (AEST = UTC+10), any time before 10am means the UTC date is still the previous day. This caused new invoices, expenses, wages, journal entries, and mark-paid dates to default to yesterday's local date.

**Solution:** Rewrote `todayStr()` to use local-time methods (`getFullYear()`, `getMonth()`, `getDate()`) so the returned `YYYY-MM-DD` string always reflects the user's local date, consistent with how the date range filter (`getPresetRange`) already worked.

---

## 2026-04-15

**Issue:** "Invoice created" toast fires but no invoice is saved to the database.

**Root cause:** Two problems working together. First, `BLANK_ITEM` initialises `unitPrice` as an empty string (`''`). The server computed correct numeric values but then passed the original `item.unitPrice` (still `''`) as a PostgreSQL parameter for a `NUMERIC(10,2)` column — PostgreSQL cannot cast an empty string to numeric and throws an error, rolling back the entire transaction. Second, `api.post` in `apiClient.js` only throws on 401 responses, so the 500 error was silently ignored and the success toast fired anyway.

**Solution:** Server now stores the parsed numeric values (`item._qty`, `item._up`) during the calculation loop and uses those in the INSERT — both POST and PUT invoice routes. Added `res.ok` checking in the frontend `save()` function so server errors surface as a visible error message instead of a false success toast.

---
