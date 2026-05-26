# Changelog

A log of bugs found and fixed in the Curam Vault application.

---

## 2026-05-26

**Feature:** Precious metals tracker — Metals tab in Shares.

New **Metals** tab on the Shares page for tracking physical gold (and other XAU/XAG) holdings. Purchases are recorded with total troy oz, total price paid (AUD), optional spot price at time of purchase (auto-fetched via Finnhub `OANDA:XAU_USD` → Frankfurter USD/AUD), and a description field. A coin calculator (count × coin weight oz) auto-fills the total oz field.

The tab shows a summary row (total oz, total cost, current spot value, unrealised P&L) plus average premium paid over spot at purchase. Each purchase row shows date, description, weight, paid, spot at buy, premium %, current value, and per-row P&L. "Refresh spot" and inline "Use current" button keep the live price up to date. Uses the existing Finnhub API key — no new dependency.

**New files:** `server/routes/metals.js`. **Modified files:** `server/db.js` (new `metal_purchases` table), `server/services/marketData.js` (`getGoldSpotAud()`), `server/index.js` (route registration under `requireFeature('shares')`), `client/src/pages/SharesPage.jsx` (Metals tab + MetalsTab component).

---

## 2026-05-20

**Feature:** Restorable deleted chats.

Chat deletion is now reversible. `sessions` gained a nullable `"deletedAt"` timestamp; deleting a chat moves it to Deleted instead of removing `sessions` and `messages`. Normal chat lists, project/folder counts, Chat History, bookmarks, global search, and project-session RAG all ignore deleted sessions. Chat History now has a **Deleted** tab where users can filter deleted chats and restore them back to their original General or project location.

**Modified files:** `server/db.js`, `server/routes/chat.js`, `server/routes/projects.js`, `server/routes/search.js`, `server/routes/bookmarks.js`, `client/src/pages/ChatPage.jsx`, `client/src/pages/ChatHistoryPage.jsx`, `client/src/components/ProjectSidebar.jsx`.

---

## 2026-05-19 (3)

**Feature + Fix:** Global `ProcessingModal` for long-running operations; fix `slice is not a function` in 30-day summary.

**ProcessingModal:** A new global blocking overlay renders whenever any long-running server operation is in progress. It shows a spinner, a descriptive message, an optional detail line, and a "please don't navigate away" warning. It also attaches a `beforeunload` listener to prevent accidental tab close or reload. The overlay is rendered once in `App.jsx` and driven by `processingStore` (Zustand). Trigger from any component via `startProcessing(message, detail?)` / `stopProcessing()`. Currently used by: Shares News "Generate today" and "30-day summary" buttons.

**Server fix:** `buildSummaryPrompt()` in `sharesNewsService.js` called `.slice(0, 10)` directly on `dailyBriefings[0]?.date`. PostgreSQL's `pg` driver can return `DATE` columns as JavaScript `Date` objects, which are truthy but lack `.slice`. All date references in that function now go through `String(b.date).slice(0, 10)`.

**New files:** `client/src/store/processingStore.js`, `client/src/components/ProcessingModal.jsx`. **Modified files:** `client/src/App.jsx`, `client/src/pages/SharesPage.jsx`, `server/services/sharesNewsService.js`.

---

## 2026-05-19 (2)

**Feature + Fix:** Shares News — 30-day monthly summaries; date accordion; timezone from admin profile; JSONB parse fix.

**Monthly summaries:** `sharesNewsService.generateMonthlySummary()` reads the last 30 days of daily briefings and asks the AI to assess market trends and evaluate signal accuracy. Stored with `type='monthly_summary'` and never auto-deleted (daily entries are pruned after 45 days). A "30-day summary" button on the News tab triggers generation. Cron also runs on the 1st of each month at 4:30 AM. Summary cards show per-stock trend, signal accuracy, and an overall advice quality assessment. `share_news_briefings` gained a `type` column and a new unique index (`idx_share_news_user_date_sym_v2`) to allow both daily and monthly rows for the same date.

**Accordion UI:** Daily briefings are now collapsed by default. Clicking a date row opens it; opening another closes the previous one. The collapsed header shows the date, stock count, and the highest-priority signal badge (bearish > bullish > watch > neutral). Most recent date defaults to open.

**Timezone:** Moved the timezone setting from a generic `workspace_settings` key to the admin user's `user_timezone` profile field. `GET /api/settings/workspace-timezone` now queries the first admin's `settings` row. All server crons (`sharesCron.js`, `newsDigestCron.js`) and `sharesNewsService.js` read this value dynamically. `SharesPage` fetches and passes it to `NewsTab` so the "Today" label matches server-stored dates. `SettingsPage` timezone selector moved from the News Digest tab to the Profile tab.

**JSONB fix:** The `headlines` column is `JSONB`. PostgreSQL's `pg` driver returns JSONB as an already-parsed JS object, not a string. `JSON.parse(pgJsonbValue)` silently produces `{}` (via error catch), stripping all monthly summary metadata. Fixed with a `parseJsonb()` helper that checks `typeof` before parsing.

**Modified files:** `server/db.js`, `server/services/sharesNewsService.js`, `server/routes/sharesNews.js`, `server/cron/sharesCron.js`, `server/cron/newsDigestCron.js`, `server/routes/settings.js`, `client/src/pages/SharesPage.jsx`, `client/src/pages/SettingsPage.jsx`.

---

## 2026-05-19 (1)

**Fix:** `getSydneyDate is not defined` in `sharesNewsService.js`.

After renaming `getSydneyDate()` to `getDateInTz()`, two lingering calls to the old name remained in `getFinnhubNews()`. Server threw at runtime when generating daily news. Fixed by replacing those calls with `new Date().toISOString().slice(0, 10)` (UTC is appropriate there — Finnhub's date range is a UTC query window, not a stored date).

**Modified files:** `server/services/sharesNewsService.js`.

---

## 2026-05-18 (3)

**Feature:** Shares — daily AI news briefings tab.

New **News** tab on the Shares page. Each morning at 4 AM (workspace timezone) or on demand via "Generate today", `sharesNewsService.js` fetches recent news for each holding (Finnhub company news for US stocks; web search for ASX), plus a Nasdaq market summary, and makes a single `callModel` call (using the user's `standard` tier model). The AI returns a paragraph per stock and a market paragraph, each with a `bullish / bearish / watch / neutral` signal. Results stored in `share_news_briefings` and displayed in the News tab grouped by date with colour-coded signal badges. 45 days of daily history kept. Stocks with nothing material to report are omitted.

**New files:** `server/services/sharesNewsService.js`, `server/routes/sharesNews.js`. **Modified files:** `server/db.js` (`share_news_briefings` table), `server/cron/sharesCron.js` (4 AM news cron), `server/index.js` (route registration), `client/src/pages/SharesPage.jsx` (News tab + `NewsTab` + `SignalBadge` components).

---

## 2026-05-18 (2)

**Feature:** Shares — portfolio tracker (Phase 1 + 2 complete).

New **Shares** page (`/shares`) gated by the `shares` feature flag. Supports ASX, NYSE, and NASDAQ.

**Portfolio tab:** open holdings with live quotes, unrealised P&L, and a **Realised P&L** banner + table showing closed positions (avg-cost method). **Trades tab:** add/edit/delete buy and sell entries; all prices in AUD. **Cash tab:** add/edit/delete cash deposits and withdrawals. **Charts tab:** portfolio value over time (SVG line chart), allocation pie, and unrealised P&L bars.

**Market data:** Finnhub for NYSE/NASDAQ quotes + company news; Alpha Vantage for ASX quotes (25 req/day free tier — conserved with a 15-minute in-memory cache and 2×/day cron polls). Frankfurter API for USD→AUD conversion. See `vault/docs/shares-api-research.md` for the full account of providers trialled before settling on this stack.

**Cron:** separate schedules (Australia/Sydney timezone) — ASX at 5 AM + 1 PM; US every 2 hours across the clock. Exchange filter passed through so each cron only calls its own quote provider.

**Realized P&L:** `computeHoldingsAndRealized()` in `sharesPortfolio.js` uses the average-cost method, fees-on-sells included. Fully sold positions drop from the holdings table.

**New files:** `server/routes/shares.js`, `server/routes/sharesNews.js`, `server/services/marketData.js`, `server/services/sharesPortfolio.js`, `server/cron/sharesCron.js`, `client/src/pages/SharesPage.jsx`, `client/src/components/shares/{SimpleLineChart,AllocationPie,HorizontalBars}.jsx`. **Modified files:** `server/db.js` (5 new tables), `server/index.js`, `server/config/featureAccess.js`, `client/src/utils/featureAccess.js`, `client/src/App.jsx`, `client/src/components/Layout.jsx`, `client/src/utils/mobileConfig.js`.

---

## 2026-05-18 (1)

**Fix:** Prompt Library → "No model configured" error for members.

Members without explicit model settings could not use Prompt Library → Chat → Send because `ChatPage.jsx` ran a client-side preflight that blocked the message when `effectiveModel` resolved to null. The server resolves models correctly via `getModelsForUser` (falling back to the admin's configured models), so the client guard was incorrect. Removed the `if (!effectiveModel)` block and the `modelsLoading` early-return from `ChatPage.jsx`. Also updated `GET /api/settings` to enrich the response with the resolved `vault_models` and `default_model` for users who have no explicit settings rows, ensuring the client's model selector populates correctly.

**Modified files:** `client/src/pages/ChatPage.jsx`, `server/routes/settings.js`.

---

## 2026-05-15

**Feature:** Admin user management + admin-only access control.

Introduced role-based admin authorization with `users."isAdmin"` and `requireAdmin` middleware protecting all `/api/admin/*` routes. Admin dashboard now includes a **Users** panel to create accounts, grant/revoke admin access, reset passwords (with active-session revocation), and delete users with safety guards (cannot delete self, cannot remove last admin). Frontend admin navigation is hidden for non-admin users and `/admin` route now hard-guards by role.

**Modified files:** `server/db.js`, `server/middleware/auth.js`, `server/index.js`, `server/routes/auth.js`, `server/routes/admin.js`, `client/src/components/AuthGuard.jsx`, `client/src/components/Layout.jsx`, `client/src/components/mobile/MobileNavDropdown.jsx`, `client/src/App.jsx`, `client/src/pages/AdminPage.jsx`.

---

## 2026-05-12 (2)

**Feature:** Finance — Pay CC Statement (bulk CC settlement).

New **Pay CC Statement** button appears in the Expenses header whenever there are unsettled CC expenses. Opens a modal listing all unsettled items for the selected card account with checkboxes, total, and a date picker. Posting creates a single journal entry (`DR Credit Card / CR Bank`) and marks all selected expenses as settled — replacing the per-expense "Pay CC" workflow for month-end statement reconciliation. Also adds `POST /api/finance/expenses/cc-statement-pay` backend endpoint (named route placed before `/:id` routes).

**Modified files:** `server/routes/finance.js`, `client/src/pages/FinancePage.jsx`.

---

## 2026-05-12 (1)

**Feature:** Finance — Trial Balance (Balances tab).

New **Balances** tab in Finance shows a full trial balance drawn from the double-entry journal. Accounts grouped by type (Assets, Liabilities, Equity, Income, Expenses). Each row shows total debits, total credits, and normal balance (debit-normal for assets/expenses; credit-normal for liabilities/equity/income). Bank/Cash (1000) row highlighted. Group subtotals and grand totals with a balanced/out-of-balance indicator. No date filter — balances are all-time cumulative. Solves the problem of having no way to verify that recording an expense actually reduced the bank balance.

**Modified files:** `server/routes/finance.js`, `client/src/pages/FinancePage.jsx`.

---

## 2026-05-04 (6)

**Fix:** Embeddings — switch to `embedding-001`; `text-embedding-004` unavailable for this API key.

`text-embedding-004` returns 404 on both `v1` and `v1beta` for this API key — the model is not accessible with the current Gemini key. Switched to `embedding-001`, which is universally available on all Gemini API keys and produces the same 768-dimension vectors, keeping the schema unchanged.

**Modified file:** `server/services/embeddings.js`.

---

## 2026-05-04 (5)

**Feature:** Branch evaluation model setting.

New selector in Settings → Models: "Branch evaluation model". When set, the `/branches` endpoint uses this model for evaluation regardless of which model the chat used. Solves the problem of flash/economy models (e.g. DeepSeek Flash) consistently returning `[]` — set a capable model (Sonnet, Opus, Gemini Pro) here to ensure branches trigger reliably. Falls back to the active chat model when not set.

**Modified files:** `server/routes/chat.js`, `client/src/hooks/useModels.js`, `client/src/pages/SettingsPage.jsx`.

---

## 2026-05-04 (4)

**Fix:** Branch generation uses the session's own model, not Haiku.

`POST /api/chat/branches` now routes to Gemini, DeepSeek, or Anthropic based on the active chat model sent by the client (`effectiveModel`). Branch content quality matches the conversation. Falls back to light model only when no model is provided.

**Modified files:** `server/routes/chat.js`, `client/src/pages/ChatPage.jsx`.

---

## 2026-05-04 (3)

**Refactor:** Branch generation moved to a post-stream Haiku call, removing reliance on model compliance.

The original approach injected a `BRANCH_INSTRUCTION` into the system prompt and asked the main LLM to append a `[BRANCHES]` block. This was unreliable — models (especially DeepSeek) frequently ignored it. Branch generation is now a separate `POST /api/chat/branches` call that fires after each stream alongside follow-up suggestions. It reads the last exchange and independently decides whether branching is warranted. Returns `[]` for short responses and `quick`-type projects. Fully model-agnostic.

**Modified files:** `server/routes/chat.js`, `client/src/hooks/useChat.js`, `client/src/pages/ChatPage.jsx`.

---

## 2026-05-04 (2)

**Feature:** Smart branch suggestions — LLM-initiated chat branching within projects.

When an AI response covers a complex topic with clear sub-areas, up to 3 branch suggestions appear below the message as "Explore deeper" chips (with a git-branch icon), distinct from follow-up question chips. Clicking a branch creates a new session in the same project, pre-seeded with the opening content for that topic, and navigates to it. The parent session is preserved.

`POST /api/chat/sessions/seed` creates the pre-seeded session. `BranchSuggestions.jsx` renders below `FollowUpChips`.

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
- Settings page (AI & Chat tab) shows a "Default model" `<select>` above the model list, populated from configured models. Leaving it blank clears **`default_model`** so **`standard`** in **`modelResolver`** falls back to the first id in **`vault_models`**. Saves instantly on change.
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
