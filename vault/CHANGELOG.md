# Changelog

A log of bugs found and fixed in the Curam Vault application.

---

## 2026-06-24

**Feature:** WP Theme Builder — Vault integration, local dev workflow, and model policy.

New `my-wp-theme-builder/` app mounted at **`/tb`**: intake brief → wireframe → homepage design → WordPress theme export. Embedded in Vault via `ThemeBuilderPage.jsx` (`/tools/theme-builder`). Local dev: `npm run dev` (Vite proxies `/tb` to port 3001).

**Model resolution:** Vault **`default_model`** and **`vault_models`** tiers apply unless Theme Builder app overrides are set (`THEME_BUILDER_DESIGN_MODEL`, `THEME_BUILDER_DEV_DESIGN_MODEL` on local, or Settings → AI & Chat → **Theme builder design model**). Local dev expects Ollama (`THEME_BUILDER_DEV_DESIGN_MODEL=ollama:qwen2.5-coder:14b`); production uses configured cloud models and API keys. Documented in **`docs/theme-builder.md`** and **`CLAUDE.md`** (WP Theme Builder subsection).

**Stage 1 UX:** element picker with `tb-pick-*` stamp flow; direct colour patches for wireframe iterate; consolidate pick/inline styles into `style.css` on wireframe approve; generation modal (no sticky status bar); preview toolbar **Back To Projects**; wireframe iterate text vs background intent.

**Settings API:** `GET/POST /api/settings/theme-builder-design-model` — admin workspace key `theme_builder_design_model`.

**Env:** `vault/.env.example` — `THEME_BUILDER_DEV_DESIGN_MODEL` and related keys.

**Docs:** `docs/theme-builder.md`, `my-wp-theme-builder/README.md`.

---

## 2026-06-18 (4)

**Feature:** SuggestionService — automatic emission from crons and services.

All findings now funnel through `server/services/SuggestionService.js` with fingerprint dedup (refresh open items instead of flooding the inbox).

**Wired emitters:** server startup (pgvector, embeddings), `newsDigestCron` (empty topics, failures, high cost), `sharesCron` (missing API key, poll/briefing errors), `MemoryService.stats` (embedding health).

**Mandatory pattern:** every new service/cron/agent must call `capture()` / `captureIf()` when anomalies are found — documented in `CLAUDE.md` and `docs/suggestions-inbox.md`.

**Schema:** `agent_suggestions.source`, `agent_suggestions.fingerprint`.

---

## 2026-06-18 (3)

**Feature:** Agent suggestions inbox — triage queue for agent and routine findings.

New `agent_suggestions` table and `/api/suggestions` API. After substantial work, agents can POST findings (anomalies, missing rules/skills/automations, config gaps) for user review instead of losing them in chat.

**Categories:** `rule`, `skill`, `automation`, `source`, `alert`, `other`.

**Status workflow:** `new` → `opened` → `apply` | `learn` | `ignore`.

**UI:** `/suggestions` — filter by category and status, search, expandable cards, one-click status buttons, manual add form. **Inbox icon** in top nav (desktop, after Memory) with badge count for `new` items. Mobile: Suggestions in nav menu.

**Agent docs:** `CLAUDE.md` — when to suggest, `POST /api/suggestions` payload shape. See `docs/suggestions-inbox.md`.

**New files:** `server/routes/suggestions.js`, `server/constants/suggestionInbox.js`, `server/services/SuggestionService.js`, `client/src/pages/SuggestionsPage.jsx`, `docs/suggestions-inbox.md`, `docs/semantic-memory.md`, `client/DESIGN.md`, `.cursor/rules/vault-ui.mdc`, `.cursor/rules/vault-suggestions.mdc`.

---

## 2026-06-18 (2)

**Feature:** Embedding router — Ollama locally, Gemini via Settings on Railway.

Memory, file RAG, session summaries, and graph semantic compute now resolve embeddings through `embeddingResolver.js`: `APP_ENV=local` → Ollama (`OLLAMA_EMBEDDING_MODEL`, default `nomic-embed-text`); production → Gemini model from Settings (`embedding_model`, default `embedding-001`, admin fallback). Rows tagged with `embedding_source` so local and production vectors are not mixed.

**New:** `GET /api/settings/embedding-config`. Settings → AI Models → **Embedding model** selector (production only; local shows Ollama status).

**Requires:** `ollama pull nomic-embed-text` locally; `GEMINI_API_KEY` on Railway; pgvector on Postgres for vector storage.

---

## 2026-06-18

**Feature:** Semantic personal memory (replaces plain-text memory list).

Upgraded the `memory` table with `content_fingerprint`, `metadata`, and `embedding vector(768)` (Gemini `text-embedding-004`, same as file RAG). Added `server/services/MemoryService.js` for capture (deduped by content hash), semantic search, list, stats, delete, and legacy backfill.

**Chat:** System prompt memory block now uses semantic recall against the current user message (top 8), with fallback to recent memories when embeddings are unavailable — replaces injecting the last 30 rows on every turn.

**API:** `GET /api/memory/search?q=`, `GET /api/memory/stats`; POST capture upserts duplicates. List triggers best-effort embedding backfill when `GEMINI_API_KEY` is set.

**UI:** `/memory` page — how-it-works copy, semantic search, stats line, expandable rows. User guide updated. See `docs/semantic-memory.md`.

---

## 2026-06-14

**Feature + UX:** Wellbeing dashboard, visual summaries, report variants, and cleaner report formatting.

Expanded AI usage tracking beyond chat and Gmail. Added a shared `logUsage` helper and wired token/cost logging into feature routes and services including wellbeing insights/modules/combined reports, compare, debate, goals, tasks, news digest, mood, prompt chains, student quizzes, clients Gmail lookup, shares news, calendar NLP, graph insights, PDF chat, YouTube parsing, pinned URL transcript summaries, and file summaries. `/api/usage/summary` now returns `byFeature`, and the Usage page displays a new **By Feature** breakdown so feature-level AI spend is visible.

Added an admin-only **Tool Update Report** in `Settings -> Tool Maintenance`. Admins can scan local Homebrew formulae, selected Python packages, and selected Ollama models, then review current versions, concrete available versions reported by Homebrew/pip, suggested manual commands, estimated update time, and notes about rollback or model cleanup. Ollama installed tags are shown as "remote tag not checked" because the report does not pull models just to detect tag movement. The report is read-only and does not run upgrades, delete models, or write restore manifests from the web app.

Documented the environment-variable strategy for secrets and runtime config: local secrets stay in ignored `.env`, production secrets stay in Railway Variables, committed examples use placeholders, and server code reads values through `process.env`. Added safe placeholders for YouTube, Fal, Finnhub, gold cache timing, and optional S3-compatible storage variables; `GOLD_CACHE_MS` is now environment-configurable with a 24-hour fallback.

Added completed-wellbeing slideshow previews and PowerPoint exports. Users can now open module-specific slideshows as soon as the module's source tests are complete, or a final recap slideshow once all eight checks are complete. Decks include a summary chart slide, module synthesis, individual test-finding slides, final synthesis/detail slides where applicable, and supportive "Suggested next steps" slides. The Vault server builds decks with Node-native `pptxgenjs`, so the feature works online in the deployed app without a local Python dependency.

Added a fifth wellbeing/personality quiz: **HEXACO-60-style Personality Check**. It uses original proof-of-concept item wording across six HEXACO-style domains, supports pause/resume, back navigation, saved attempts, model-assisted response, radar charting, PDF export, admin demo data, reset, and combined-profile inclusion.

Added a sixth wellbeing quiz: **PANAS-style Affect Check**. It captures positive affect, negative affect, and affect balance using original proof-of-concept wording, with pause/resume, review/retake, model-assisted response, PDF export, charting, admin demo data, reset, and combined-profile inclusion.

Added a seventh wellbeing quiz: **ASRS-5-style Attention Check**. It captures adult attention and self-regulation patterns using original proof-of-concept wording, with pause/resume, review/retake, model-assisted response, PDF export, charting, admin demo data, reset, saved-report cache keys, and combined-profile inclusion.

Added an eighth wellbeing quiz: **GAD-7-style Anxiety Check**. It captures current worry, threat anticipation, restlessness, tension, irritability, and fear signals using original proof-of-concept wording, with pause/resume, review/retake, model-assisted response, PDF export, charting, admin demo data, reset, saved-report cache keys, and combined-profile inclusion.

The wellbeing dashboard now presents the eight tests as progress tiles, with a subtly highlighted results area for the combined profile, charts, and mind map once all eight tests are complete. Completed tiles use a consistent **Review or retake** flow; the BDI-style mood tile now opens a mood-check review area with retake, latest-result review, and past-attempt access instead of jumping straight to the history list.

Added an admin-only action to pre-populate all eight wellbeing tests with random demo answers for testing. The existing reset action removes those demo attempts alongside any other completed wellbeing results and clears local drafts.

Combined profile generation now supports three report levels: **Summary**, **Detailed profile**, and **Analytical profile**. Summary is a concise overview for client or clinician orientation; Detailed profile keeps the existing client-readable formulation; Analytical profile provides a more clinician-oriented formulation with mechanisms, caveats, and clinical questions. Report rendering now preserves explicit line breaks and paragraph breaks across report sections, caveats, and clinician-style notes.

The overall report area now breaks the eight checks into three reportable modules: **Mood & Emotional State** (BDI, GAD-7, PANAS), **Personality & Traits** (IPIP-NEO-120, HEXACO-60), and **Regulation & Coping** (GAD-7, ASRS-5, CERQ, Brief COPE). Each module can generate its own cached detailed report, and final overall reports are generated from those three module outcomes rather than treating all eight tests as unrelated inputs. The dashboard now visually groups test tiles inside bordered module panels so the relationship between checks is clear.

Added a dashboard **Suggestions** button in the overall results area. It generates an eight-test personal development suggestions report covering strengths, patterns to notice, coping habits, anxiety/worry supports, attention/self-regulation supports, communication focus, and small reflective experiments while preserving the non-diagnostic proof-of-concept caveat. Detailed, summary, analytical, module, and fallback reports now also include careful **Suggested next steps** sections framed as supportive habits and reflection prompts, not treatment advice.

Combined reports are now persisted in `wellbeing_combined_reports` by report variant and the latest eight source attempt IDs, so reopening an already generated report returns the saved version immediately instead of rebuilding it until the underlying quiz results change.

Added combined visual summaries: BDI severity gauge, GAD-7 anxiety gauge, PANAS affect bar chart, ASRS-5 attention/self-regulation bar chart, IPIP domain radar chart, HEXACO domain radar chart, CERQ strategy bar chart, Brief COPE strategy bar chart, and an eight-test mind map. Both the chart view and mind map view can now be downloaded as PDFs.

Added collapsible **About this quiz** guidance to each of the eight test pages so users can understand the purpose of the test, how to answer, and the proof-of-concept caveat before completing it.

**New files:** `client/src/components/wellbeing/Gad7StylePanel.jsx`, `client/src/components/wellbeing/Asrs5StylePanel.jsx`, `client/src/components/wellbeing/PanasStylePanel.jsx`, `client/src/components/wellbeing/Hexaco60Panel.jsx`, `client/src/components/wellbeing/WellbeingCharts.jsx`, `client/src/components/wellbeing/WellbeingVisualSummaryPanel.jsx`, `client/src/components/wellbeing/QuizPurposePanel.jsx`, `client/src/components/wellbeing/SlideshowPreviewModal.jsx`, `server/services/gad7Style.js`, `server/services/asrs5Style.js`, `server/services/panasStyle.js`, `server/services/hexaco60Style.js`, `server/services/wellbeingVisualPdf.js`, `server/services/wellbeingSlideshow.js`, `docs/local-database-recovery.md`.

**Modified files:** `server/routes/wellbeing.js`, `server/services/wellbeingModelInsights.js`, `server/services/combinedProfilePdf.js`, `client/src/pages/WellbeingPage.jsx`, `client/src/components/wellbeing/CombinedProfilePanel.jsx`, `client/src/components/wellbeing/ModelInsightPanel.jsx`, `client/src/components/wellbeing/IpipNeo120Panel.jsx`, `client/src/components/wellbeing/CerqStylePanel.jsx`, `client/src/components/wellbeing/BriefCopeStylePanel.jsx`, `server/db.js`, `README.md`, `.env.example`, `PRODUCTION_MERGE_NOTES.md`, `docs/wellbeing-assessment-app.md`.

---

## 2026-06-12

**Feature:** Wellbeing & Personality Checks — four tests, deeper insights, combined profile, and reset flow.

Added a full wellbeing assessment area behind the existing heart-pulse navigation. The dashboard now includes a BDI-style mood check, IPIP-NEO-120 personality inventory, CERQ-style cognitive coping check, and Brief COPE-style coping check. All tests are proof-of-concept self-report tools with clear non-clinical disclaimers, pause/resume support, back navigation, saved attempts, delete actions, and PDF downloads.

Result analysis now includes deeper model-assisted formulation sections rather than simple score comments. The configured model is used through the existing provider-agnostic `callModel`/`getModelsForUser` path, with deterministic fallback copy when model generation is unavailable. Older saved attempts regenerate into the newer insight format when opened.

Added a fifth **Combined Profile** option that unlocks only after all four tests have been completed. It collates the latest result from each test into a detailed profile with paragraph-formatted sections, reflection questions, source attempt dates, and PDF export. The combined profile uses a dedicated formulation prompt focused on cross-test themes, tensions, strengths, growth edges, and real-world interpretation rather than scale-name restatement.

The heart-pulse icon now returns users to the wellbeing dashboard every time, even if they were previously inside an individual test or combined profile. The dashboard also includes a **Reset / erase all tests** action that deletes all completed wellbeing/IPIP/CERQ/COPE attempts for the current user and clears paused local drafts on the current device.

**New files:** `server/services/wellbeingPdf.js`, `server/services/ipipNeo120.js`, `server/services/cerqStyle.js`, `server/services/briefCopeStyle.js`, `server/services/wellbeingModelInsights.js`, `server/services/combinedProfilePdf.js`, `client/src/components/wellbeing/IpipNeo120Panel.jsx`, `client/src/components/wellbeing/CerqStylePanel.jsx`, `client/src/components/wellbeing/BriefCopeStylePanel.jsx`, `client/src/components/wellbeing/CombinedProfilePanel.jsx`, `client/src/components/wellbeing/ModelInsightPanel.jsx`, `docs/wellbeing-assessment-app.md`.

**Modified files:** `server/db.js`, `server/routes/wellbeing.js`, `client/src/pages/WellbeingPage.jsx`, `client/src/components/Layout.jsx`, `client/src/components/mobile/MobileNavDropdown.jsx`.

---

## 2026-06-07

**Feature:** Gmail Intel — incremental DB-backed classification.

The classify endpoint (`GET /api/gmail/inbox/classify`) now persists classifications in the `gmail_classifications` table (added to `server/db.js`). On each call it fetches inbox threads, queries the DB for stored results, and runs the AI model only on threads that are new or have a new `lastMessageId` (i.e. a new reply arrived). Results are batch-upserted back to the DB. The in-memory `classifyCache` is kept as a 2-minute request dedup guard only — not as the primary cache. This eliminates re-classifying hundreds of threads on every page load.

Invoice detection (`isInvoice`) is still deterministic regex, applied post-enrichment on every call; not stored in DB.

No model IDs hardcoded — uses `getModelsForUser(userId).standard`.

**Modified files:** `server/db.js`, `server/routes/gmail.js`.

---

**Feature:** Gmail Intel — invoice icon indicator.

Receipt icon (amber) shown in each email row when subject or sender matches invoice/billing regexes. Regex patterns compiled once at module level.

**Modified files:** `server/routes/gmail.js`, `client/src/pages/GmailIntelPage.jsx`, `client/src/providers/IconProvider.jsx`.

---

**Feature:** Gmail Intel — date-order sort view.

Toggle between Category (grouped) and Date (flat chronological) views in the filter bar. Date view renders all filtered emails sorted newest-first regardless of AI category.

**Modified files:** `client/src/pages/GmailIntelPage.jsx`.

---

**Fix:** Gmail Intel — emails beyond position 100 not appearing.

Raised `maxResults` cap from 100 to 200 in the Gmail threads list call. Email count is still user-configurable in Settings (up to 200).

**Modified files:** `server/routes/gmail.js`.

---

**Feature:** Dashboard — New Chat button above My Tasks widget.

A full-width "New Chat" card now appears on the home dashboard (`ProjectList.jsx`) between the Goals widget and the My Tasks widget. Navigates to `/chat` (General chat). Styled to match the GoalsWidget/TasksWidget card style with primary-colour icon and `hover:opacity-70`.

**Modified files:** `client/src/pages/ProjectList.jsx`.

---

**Feature:** Sidebar — collapsed icon rail as default startup state.

Desktop sidebar now starts **collapsed** (48px icon rail) on first load instead of fully expanded. When collapsed, the sidebar shows five icon-only navigation buttons: New Chat · Home · Tasks · Chat History · Settings, with active-route primary-colour highlight. User preference is persisted in `localStorage` key `vault:sidebarOpen`. The toggle button in the top bar and the `vault:toggle-sidebar` keyboard event both read/write this key. Mobile behaviour is unchanged (hidden slide-in overlay; no icon rail).

`ProjectSidebar` accepts a new `collapsed` prop; `Layout` passes `collapsed={!sidebarOpen && !isMobile}`. The icon rail is an early-return before the full sidebar JSX, so all hooks still initialise (session/project data loads in the background, ready when the sidebar expands).

**Modified files:** `client/src/components/Layout.jsx`, `client/src/components/ProjectSidebar.jsx`.

---

## 2026-06-06

**Feature:** Inbox Intel — AI-classified Gmail dashboard.

New `/gmail-intel` page that fetches the last 50 inbox messages and classifies them in a single Claude prompt. Each email is assigned one of four categories: **urgent** (action required, time-sensitive), **waiting** (sender blocked on a reply from the user), **fyi** (informational, no action needed), or **noise** (newsletters, automations, promotions). Claude also writes a one-line summary (max 12 words) per email.

The dashboard shows four metric cards (Urgent / Waiting / Unread / Noise), category filter pills, and a client-side search that filters by summary, sender, or subject. Emails are grouped by category when viewing All. An amber banner appears if Claude classification fails — raw emails are shown without categorisation rather than crashing. The page auto-refreshes every 5 minutes with a live countdown. A "not connected" empty state links users to Settings when no Gmail token exists.

Uses the existing `getGmailClient()` helper and stored OAuth tokens from `gmail_tokens` — no additional OAuth setup required. Classification uses the `standard` model tier via `getModelsForUser`. The inbox classify endpoint is rate-limited to 10 requests/min. The feature is gated behind a new `gmailIntel` flag in feature access (default enabled), visible in the Admin feature access panel.

**New files:** `client/src/pages/GmailIntelPage.jsx`. **Modified files:** `server/routes/gmail.js` (two new routes: `GET /api/gmail/inbox` and `GET /api/gmail/inbox/classify`), `client/src/App.jsx`, `client/src/components/Layout.jsx`, `client/src/components/mobile/MobileNavDropdown.jsx`, `client/src/providers/IconProvider.jsx`, `client/src/utils/featureAccess.js`, `client/src/utils/mobileConfig.js`.

---

## 2026-05-26

**Feature:** Precious metals tracker — Metals tab in Shares.

New **Metals** tab on the Shares page for tracking physical gold (and other XAU/XAG) holdings. Purchases are recorded with total troy oz, total price paid (AUD), optional spot price at time of purchase (auto-fetched via Finnhub `OANDA:XAU_USD` → Frankfurter USD/AUD), and a description field. A coin calculator (count × coin weight oz) auto-fills the total oz field.

The tab shows a summary row (total oz, total cost, current spot value, unrealised P&L) plus average premium paid over spot at purchase. Each purchase row shows date, description, weight, paid, spot at buy, premium %, current value, and per-row P&L. "Refresh spot" and inline "Use current" button keep the live price up to date. Gold spot sourced from metals.live (free, no API key) — USD/oz converted to AUD via Frankfurter.

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
