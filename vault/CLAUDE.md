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
- `server/db.js` — all tables in one file; every statement idempotent (`IF NOT EXISTS`); runs on every boot
- `server/middleware/auth.js` — 32-byte hex token lookup in `auth_sessions` + `requireAdmin` guard + `requireFeature`/`loadFeatureAccess` (workspace flags narrowed by per-user `featureOverrides`)
- `server/routes/admin.js` — admin dashboard stats/monitor + user management endpoints + per-user feature-access endpoints
- `server/config/featureAccess.js` — `FEATURE_ACCESS_DEFAULTS`/`FEATURE_ACCESS_KEYS`, `flagsFromSettingRows()`, `applyUserOverrides()` (per-user narrowing, see **Feature access**)
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
- `server/services/documentRedaction/` — Document redaction agent (M1–M6: candidates → HITL → apply → compare → frontier analysis → selective frontier apply → three-way → final approve + INTERNAL-ONLY audit); model card via `documentRedactionModelResolver.js`; docs: `docs/document-redaction-agent-architecture.md`
- `server/services/propertyScenario/` — Mortgage / Property Scenario agent (Stages 1–11); see `docs/property-scenario.md` + `OPEN_ITEMS.md`
- `server/services/seo/` — Google Ads campaign starter (`docs/google-ads-agent.md`) + on-page SEO audit (`docs/seo-agent.md`)
- `server/routes/clients.js` (displayed as **"CRM"** in nav/UI, internal key/route/files still say "clients", flag `clients`) — canonical client table (`clients`) + contacts, deals/pipeline (`server/routes/deals.js`), touchpoints, Gmail search, on-demand AI activity summary (`POST /:id/summary`, `light` tier). Shared by Projects, Tasks, and Finance (`server/routes/finance.js` invoices/quotes read it via `clientRef` + the `client_billing_details` extension table for abn/address — Finance's own client-management UI/routes were removed, it's picker-only now). `fin_clients` retired and dropped 2026-09-16 — see **`docs/crm-migration.md`** (clients/fin_clients merge) and **`docs/crm-deals-schema.md`** (deals) for history and rollback notes.
- `server/services/SuggestionService.js` — **all services/crons/agents call this** to emit inbox findings
- `server/routes/suggestions.js` — agent suggestion inbox API
- `server/lib/logger.js` + `server/middleware/requestContext.js` — pino-based structured logging; `getLogger()` returns the current request's child logger (tagged `requestId`/`userId`), use this instead of `console.log`/`console.error` in new/touched code. `server/middleware/httpLogger.js` logs one line per request. `server/lib/sentry.js` — error tracking, no-op unless `SENTRY_DSN` is set. `server/middleware/aiRateLimit.js` — per-user rate limit for AI-cost routes. See **`docs/observability.md`**.
- `server/services/marketData.js` — Shares quote fetching: Finnhub (NYSE/NASDAQ) + Alpha Vantage (ASX) + Frankfurter FX
- `server/services/sharesPortfolio.js` — `computeHoldingsAndRealized()`, `buildDashboard()`, quote cache, exchange-filtered snapshots
- `server/services/sharesNewsService.js` — daily briefings + monthly summaries: Finnhub/web search → AI → `share_news_briefings`
- `server/routes/productScout.js` — Product Scout run/history/settings API
- `server/services/productScoutService.js` — comparison pipeline (Rainforest + callModel + web search)
- `server/services/productScoutSettings.js` — variance % + Amazon marketplace (`workspace_settings`)
- `server/services/productScoutDelivery.js` — free delivery / within-2-days parse + filter
- `server/services/rainforestClient.js` — Amazon search via Rainforest API
- `client/src/utils/productScoutCompareTable.js` — side-by-side feature table (price/delivery first)
- `product-scout/` — standalone Python CLI (see `product-scout/README.md`)
- `server/services/sharesChartData.js` — Charts tab payloads (benchmarks, beat/lag, drawdowns, heatmap, earnings)
- `server/routes/sharesNews.js` — `GET /api/shares/news`, `POST /api/shares/news/generate`, `POST /api/shares/news/generate-summary`
- `server/routes/htmlAudit.js` — Lighthouse API (`/api/html/audits`)
- `server/routes/webExtractor.js` — Web Extractor API (`POST /api/web-extractor/extract`), 3 modes: article / images / styled
- `server/routes/youtube.js` — YouTube search/history/favourites API; `server/services/youtubeTranscript.js` — caption fetch (used elsewhere too, e.g. Video Tools' Generate reference flow); no download feature — see `docs/youtube-agent.md`
- `server/services/webExtractorService.js` — jsdom-based extraction: article text (strips ads/nav/header/footer/sidebar/images), image list, exact-scrape (absolute-URL rewrite, original inline styles kept)
- `server/routes/gsc.js` — Search Console OAuth + snapshots (`/api/gsc/*`; callback before requireAuth)
- `server/services/gscService.js` — Search Console sites + 28-day searchanalytics
- `server/routes/videos.js` — Video Tools API (`/api/videos/*`): ffmpeg tools, generate queue, library CRUD + captioned burn
- `server/services/videoFfmpeg.js` — ffmpeg/ffprobe helpers (probe, clip, convert, styled captions, thumbnail)
- `server/services/videoGenerateService.js` — LLM brief expansion (`light`) + Replicate/FAL text-to-video
- `server/services/videoLibraryService.js` — saved videos/images on disk + `video_library` metadata
- `client/src/pages/VideosPage.jsx` — grouped sidebar UI at `/videos` (mirrors Graphics layout)
- `server/routes/recipes.js` — Recipes API: suggest, expand, named tiers, grocery prices, image, library CRUD
- `server/services/recipeService.js` — leftover + recipe-by-name suggest/expand, auto dish photo via `graphicsImageService`
- `server/services/recipeGroceryService.js` — Coles/Woolworths prices sourced from Google Shopping / site-restricted search (`webSearchService.shoppingSearch`), no AI guessing — cites source + link, or "Not found"
- `server/services/graphicsImageService.js` — shared FAL image generation using admin `graphics_model` (Graphics + Recipes)
- `client/src/pages/RecipesPage.jsx` — Create (leftovers, by name) · Shop (grocery prices) · library at `/recipes`
- `server/services/fonts/` — Google Font Customizer backend, Python module — see `server/services/fonts/README.md`. Fetch/license-check: `google_fonts_repo.find_family()` (per-family) / `list_ofl_family_slugs()` (whole-catalog, backs the picker) — presence under `ofl/` in the google/fonts repo IS the license proof, one rule, no second implementation. Freeze: `pipeline.py`. Structural edits: `structural.py`/`transforms/` — stem thickness via real outline offset (`NOMINAL_STEM_UNITS_FRACTION`, recalibrated — the original coefficient was sub-pixel at normal preview sizes even at high slider values), counter width via winding-direction contour classification with growth clamped to the SPECIFIC enclosing outer contour's bounds (`glyph_edit._find_enclosing_outer_bounds` — a multi-contour glyph like 'b' has an unrelated stem contour too; clamping against the union of all outer contours isn't tight enough to stop a counter overflowing into the bowl-to-stem junction, a real bug found via user report and fixed), proportional width, ascender/descender extension (`EXTEND_ASCDESC_BOOST` — only stretches the small natural overshoot above cap-height, boosted so the effect is visible; `EXTEND_BLEND_MARGIN_FRACTION`/`EXTEND_MAX_DEPTH_FRACTION` — a hard-threshold warp has a slope kink exactly at the baseline/cap-height line, and Roboto's 'g' draws its descender tail as a contour separate from the bowl that straddles that line; found via user report, fixed with a smoothed C1-continuous transition plus a cap on how far any one point's displacement can diverge from nearby geometry — real, substantial improvement (~19px visible gap → ~4.7px at typical preview size), not a full elimination, an inherent limit of warping overlapping contours independently), sidebearing recalc, contour validation, GPOS class-kerning (`kerning.py`); composite/accented glyphs (á, é, ñ...) fully decomposed and reassembled, not skipped. Export: `export/` — OFL Reserved Font Name rename (blocks export if unchanged), table cleanup, subsetting (`fontTools.subset`, glyph selection never filtered by `numberOfContours`), genuine glyf→CFF `.otf` alongside `.ttf`/`.woff2`. **Known open gap:** the license check only runs on the Google Fonts fetch path (`family` param) — `cli_export.py`'s `font_file` branch (an uploaded font buffer) skips it entirely, so nothing stops a non-OFL font being renamed and exported through that path. Not fixed yet; flagged, not silently reintroduced.
  - **Node bridge:** `server/services/fontExportPipeline.js` (`runFontExport()`, `runFontFetchFreeze()`, subprocess pattern matching `officeConvert.js`/`videoFfmpeg.js`) + `server/services/fontSessionCache.js` (in-memory `Map`, TTL `FONTS_SESSION_TTL_MS` default 45min, sliding idle window, periodic sweep) + `server/routes/fonts.js` (flag `fonts`): `GET /catalog` (OFL-filtered picker list, `fontGoogleCatalog.js`, built by `cli_catalog.py`) · `POST /session` (`{family}` → fetch+freeze ONCE via `cli_fetch_freeze.py`, cached server-side by session id — the slow part, ~3-4s of GitHub I/O, paid once per font selection) · `POST /session/:id/preview` (`{recipe, rename, rangeIds?, formats?}` → transform+export against the CACHED bytes, no re-fetch, ~0.3-1.2s; a missing/expired session returns `{code:'SESSION_EXPIRED'}`, not a silent failure, so the frontend can re-trigger `/session`). The same preview endpoint serves both the debounced live preview (`formats:['ttf']`) and the final download (`formats` incl. `woff2`/`otf`) — download never re-runs the transform, only (re)generates requested output formats from the same cached base + same recipe, verified byte-identical in `fontSessionCache.test.js`. Legacy single-shot `POST /customize-export` (fetch-or-upload → full export in one call, no caching) still exists, unused by the current UI, kept for anyone hitting it directly.
- `client/src/pages/FontsPage.jsx` + `client/src/pages/fonts/` — Font Customizer frontend (`/fonts`, flag `fonts`). **Single screen, no modes/tabs:** search a Google Font (`FontPicker.jsx` — always-browsable dropdown, not just typeahead; each row renders in its OWN typeface via `loadGoogleFontPreview.js`, lazily loading the actual webfont per visible row; OFL-filtered) → `POST /session` loads it → one settings panel (`FontTransformControls.jsx`, `FontKerningPanel.jsx`, both unchanged controlled-input components) → ~700ms after the user stops adjusting a slider/checkbox, a debounced call to `POST /session/:id/preview` runs the *real* transform+export server-side and the result is rendered via an actual `FontFace`/`@font-face` — never a client-side approximation. "Updating preview…" shows while that's in flight. Download requires a genuinely new family name (OFL Reserved Font Name), reuses the same session + recipe (no re-fetch, no re-transform — see the Node bridge note above), and actually triggers a file save (`<a download>` + `Blob`) since the exported font bytes themselves are never stored server-side. **"My Fonts"** (`font_projects` table, `GET/POST/PUT/DELETE /api/fonts/projects[/:id]`) is real, per-user, server-side persistence — a saved project is the Google Font name + transform/kerning recipe (not a rendered file); reopening one re-runs `POST /session` for that family and reapplies the saved recipe, so it survives across devices/sessions, unlike everything else in this tool. Saved presets (`fontPresetsStorage.js`, `localStorage`) are a separate, lighter mechanism — recipe only, no font, browser-local, reapplicable to whatever's currently loaded. **Text effect** (`fontEffects.js`): a small set of Google's old font-effect CSS classes (`fonts.googleapis.com/css?family=X&effect=Y`) applied on top of the preview — of the 27 Google originally documented, only 5 (fire, neon, emboss, outline, shadow-multiple) still return real CSS today (checked directly; the rest were texture/SVG-filter based and their backing assets are gone from Google's CDN, so only the working ones are offered). Rendering-layer only, saved as part of a project's recipe, never baked into the exported font. **Tutorial modal** (`FontTutorialModal.jsx`, sparkles icon in the header, auto-shows once per browser): a "Show me →" button runs a deliberately extreme demo (`DRAMATIC_DEMO` — Roboto, sliders maxed toward their limits, fire effect) so the tool's effect is unmistakable in one glance, after a real report where subtle default values looked like no change at all. Guided tour: `client/src/utils/tours/fontsTour.js` (compass icon, Shepherd.js, same pattern as `recipesTour.js`). Tooltips (`Tooltip` from `client/src/components/Tooltip.jsx`) cover every control, same convention as Graphics.
  - **Deliberately removed from the UI** (over-engineered relative to the actual goal — search a font, adjust real structural properties, see real results, export a real file): the two-mode/two-tab structure; the client-side approximate canvas preview (`opentype.js` heuristics for stem thickness/counter width/kerning — `fontCanvasRenderer.js`, `fontGlyphTransforms.js`, `fontKerningClasses.js`); the CSS color/gradient/shadow/image-fill panel (`FontEffectsPanel.jsx`, `effectsCss.js`); the SVG print-export feature (`svgExport.js`). None of these files were deleted — they're unused dead code, not wired into `FontsPage.jsx` — CSS snippets are handled conversationally instead of via a UI panel.
- `server/routes/restyle.js` — **CSS** tool API (`/api/restyle/*`; displayed as "CSS" in the UI, internal key/route/files still say "restyle"): stateless HTML/CSS-in, edited-HTML-out (same pattern as PDF Tools/Web Extractor) plus real per-user saved-page persistence (`restyle_projects` table). `server/services/restyle/` — `sanitizeHtml.js` (jsdom, strips script/handlers/nested browsing contexts before render), `cssProcessor.js` (PostCSS AST auto-fix + duplicate-property/override/contrast flags), `aiEdit.js` (plain-English edit via `getModelsForUser().standard`, allow-listed property JSON incl. text-transform/letter-spacing/text-align/animation presets). Client: `client/src/pages/RestylePage.jsx` (`/restyle`) — built-in demo page, voice input via the shared `useVoice()` hook, save/load/delete saved pages. Docs: `docs/restyle.md`.
- `server/routes/pdf.js` — PDF Tools API (`/api/pdf/*`): stateless dataUrl-in/dataUrl-out — merge/split/rotate/watermark/page numbers/metadata, AcroForm inspect/fill/flatten/addfields, image↔PDF, Office↔PDF (LibreOffice), Google Drive↔PDF, chat over an uploaded file
- `client/src/pages/PdfPage.jsx` — PDF Tools UI at `/pdf`, incl. AcroForm field designer (canvas-based drag-to-place, grouped Google Font picker with live sample text)
- `docs/pdf-agent.md` — PDF Tools endpoint reference + field designer typography details

---

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

**Known gap:** client's `FEATURE_ACCESS_OPTIONS` (`client/src/utils/featureAccess.js`) lists `translate` and `guitar`, which are not in server `FEATURE_ACCESS_KEYS` — those two can't be toggled workspace-wide or per-user server-side yet.

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
- `toast-in` animation, sidebar collapse, icon rotation: all 200ms. Single `--duration-fast: 200ms` if ever extracted.

---

## Schema Notes

- 49 tables. All schema in `server/db.js`. No migration tool — idempotent DDL on every boot.
- `font_projects` stores the Font Customizer's saved-project *recipe* (`"googleFont"` name + `recipe` JSONB `{transforms, kerning}`), never a rendered font file — reopening a project re-fetches the font and reapplies the recipe.
- `sessions.sessionId` is `TEXT PRIMARY KEY` (UUID), not SERIAL.
- `sessions."deletedAt"` is a soft-delete timestamp. Chat delete moves sessions to Deleted; messages remain for restore. Normal lists/search/RAG must filter `s."deletedAt" IS NULL`.
- `users."isAdmin"` is `BOOLEAN NOT NULL DEFAULT FALSE`; first user is promoted to admin during bootstrap/backfill.
- `users."featureOverrides"` is nullable `JSONB` — per-user feature narrowing, see **Feature access**. `null` = no narrowing.
- `tasks."order"` double-quoted everywhere (SQL reserved word).
- `tasks."keyResultId"` FK added via `ALTER TABLE` after `key_results` is created (avoids forward reference).
- `gmail_tokens.expiryDate` is `BIGINT` (Unix ms). Cast to `Number()` in routes.
- Multi-user `"userId"` columns added post-hoc. Every query filters by `"userId"=$1`.
- `share_trades.exchange` CHECK constraint `('ASX','NYSE','NASDAQ')` added via `ALTER TABLE` (post-DDL, inside `DO $$ ... EXCEPTION WHEN OTHERS THEN NULL $$` to survive re-runs).
- `share_trades.pricePerShare` is stored in **AUD** for all new trades. Legacy USD rows carry `currency='USD'` + `fxRateToAud` for backward compatibility.
- `share_news_briefings`: `symbol IS NULL` row = market summary for that date. `type` column: `'daily'` (45-day retention, auto-pruned) or `'monthly_summary'` (never deleted). Unique index `idx_share_news_user_date_sym_v2` on `(userId, date, COALESCE(symbol,''), COALESCE(exchange,''), type)`. Daily generate deletes then re-inserts today's `type='daily'` rows. Monthly summaries stored separately and retained permanently. **`DATE` columns from pg come back as strings `'YYYY-MM-DD'`; always `String(b.date).slice(0,10)` before string ops — do not assume it's always a primitive.**

---

## Features

Projects · Folders · Chat (project + general) · Files (RAG) · Personas · Prompts · Memory · **Suggestions inbox** · Pinned URLs · Document Compare · **Document redaction** · Multi-Model Debate · Tasks (list/board/calendar/matrix) · Goals (OKR-lite) · Chat History · Web Search (`@search`, Brave/Serper/SerpAPI) · Gmail integration · Google Calendar · Google Drive backup · News Digest · Finance · **CRM** (contacts, deals/pipeline, touchpoints, Gmail search — internal key "clients") · Admin dashboard + user management · Password reset · Shared task public links · **Student** (Quiz + Cards + Saved decks) · **Shares** (portfolio tracker) · **Product Scout** (Amazon comparison agent) · **Video Tools** (ffmpeg + FAL generate) · **YouTube** (search + favourites + history, no download — see `docs/youtube-agent.md`) · **Recipes** (leftover cooking assistant) · **Google Ads** (site scrape + keywords / RSA) · **SEO** (crawl + per-page recommendations) · **Search** (Google Search Console queries/pages) · **HTML** (Lighthouse / PageSpeed) · **Property Scenario** (mortgage / property calcs + CDR + document insights) · **PDF Tools** (merge/split/rotate/watermark, AcroForm field designer, Office↔PDF, Drive↔PDF) · **Font Customizer** (search an OFL Google Font, adjust real structural properties — stem thickness, width, ascender/descender, counter width, kerning — see the actual transformed font via debounced server-side preview, download a real renamed `.ttf`/`.woff2`/`.otf`; single screen, no client-side approximation) · **CSS** (non-technical CSS editor, internal key "restyle" — built-in demo page, upload/paste HTML + reorderable CSS, sandboxed live preview, click-to-edit property panel incl. text enhancements + animation presets, voice or plain-English AI requests, save pages to revisit later, PostCSS auto-fix/flags, no CSS jargon in any UI copy)

**Document redaction** (`/document-redaction`): Privacy-preserving DOCX redaction. Local LLM proposes candidates → HITL approve/reject/edit → synthetic apply (`redacted.docx` + `sanitized.pdf`) → local compare / leftover scan → HITL₂ → frontier residual-risk analysis on **sanitized PDF only** (entity map never leaves the machine) → selective frontier apply (shared apply pipeline on redacted base) → three-way compare → final approve + INTERNAL-ONLY audit trail. Feature flag `documentRedaction`. Model card `document-redaction-agent`. Docs: **`docs/document-redaction-agent-architecture.md`**.

**Student → Quiz** (`/student/quiz/*`): Dashboard, Quiz Library (AI-generated pools via `POST /api/student-quizzes`), Take Quiz, Results. Uses **`getModelsForUser` `standard`** for generation/marking — not hardcoded model ids. Tables: `student_quizzes`, `student_quiz_attempts`. Routes: `server/routes/studentQuizzes.js`.

**Property Scenario** (`/property-scenario`): Free-text mortgage/property scenarios → span pre-extraction → LLM field assignment → grounding → clarify loop → deterministic AU calc orchestration (stamp duty, CGT, refinance, early payout, bridging). **Qualification proforma** (featured): strict AU checks + levers + per-bank **Fit** (capacity headroom / LVR / DTI / posture knobs — separate from overall PASS/FAIL) + indicative capacity (curated overtime/rental/HEM knobs) + live CDR rates + PDF executive summary (all banks, Fit legend, ASCII-safe check text). Completing proforma/lite check writes a shared browser **file profile** that pre-fills other agents. Lite serviceability check for a fast snapshot. Interest rate / target rate inputs default from `GET /api/property-scenario/market-rate` (CDR OO variable/fixed averages). Stage 6 charts/tables; Stage 11 quarantined T&Cs/PDS insights (cited Q&A, never writes scenario totals). Feature flag `propertyScenario`. Routes: `server/routes/propertyScenario.js`. Docs: **`docs/property-scenario.md`**. Open items: `server/services/propertyScenario/OPEN_ITEMS.md`.

**Product Scout** (`/product-scout`): Amazon value comparison + external alternatives. **Buy guide** (primary): LLM feature brief with category-specific measurable specs (`kind: spec` + tailored `spec_options`) and a compact feature grid (must/nice/skip) → scout per price tier → final recommendation. Rainforest API → LLM scoring (`standard` tier) → web search. Quick scout: single comparison without the guide. Optional max price + stretch variance, delivery filters, admin marketplace. UI: cards, feature comparison table, run history. Tables: `product_scout_runs`. Routes: `server/routes/productScout.js`, `productScoutGuideService.js`. Client: `ProductScoutFeatureBrief.jsx`, `productScoutFeatureTypes.js`. Docs: **`docs/product-scout.md`**. CLI: **`product-scout/`**.

**Video Tools** (`/videos`): Phase 1 video suite mirroring Graphics — grouped sidebar (Create / Optimise / Transform / Compose / Library / Analyse). **Generate** expands brief via `light` tier then **Replicate** (`minimax/hailuo-2.3`, default when `REPLICATE_API_TOKEN` set) or FAL fallback. **ffmpeg** tools: clip, convert/compress, join (+ crossfade), reframe/crop, speed, mute/replace audio, overlay/watermark, extract audio, annotate (drawtext), probe, thumbnail. **Caption studio** — upload or library video + styled SRT (font, weight, size, colour). **Saved media** — save tool results (video/image) + transaction JSON to `video_library` (disk + DB), preview, delete, re-caption later. Local dev: optional whisper-cli transcribe; hosted → paste SRT. Feature flag `videos`. Docs: **`docs/video-tools.md`**. Dockerfile installs `ffmpeg`.

**Recipes** (`/recipes`): Cooking assistant in Content tools. **Leftover recipes** — ingredients in → four cards → full recipe (steps, nutrition, links, auto dish photo). **Recipe by name** — Basic / Advanced / Master with accessible ingredient swaps. **Grocery prices** — "Get prices" inline under any open recipe (also standalone in Shop) → Coles/Woolworths prices **sourced from live search** (Google Shopping via Serper/SerpApi, or `site:` organic fallback), each row cites its source link; unmatched items show "Not found" + manual search link, never a guessed price. Requires `SEARCH_API_KEY`; no text model needed for pricing. Save to **`recipes`** table with tags. Text: `light`/`standard` tiers; images: **`graphicsImageService`** + **`graphics_model`**. Feature flag `recipes`. Docs: **`docs/recipes.md`**.

**PDF Tools** (`/pdf`): Stateless PDF toolkit — every tool posts a `dataUrl` (base64 PDF/image), gets a `dataUrl` back; no DB table, no persistence. Merge, split (page ranges `1-3,5,7-9`), rotate, watermark, page numbers, metadata read/write, image↔PDF, Office↔PDF (LibreOffice headless: DOCX/XLSX/PPTX/ODT/RTF/CSV/TXT etc.), Google Drive↔PDF (Docs/Sheets/Slides export or binary Office re-upload, reuses `gmail_tokens` OAuth), AcroForm inspect/fill/flatten/**field designer**, and chat over an uploaded file's extracted text. Not currently behind a feature flag. Route: `server/routes/pdf.js`. Docs: **`docs/pdf-agent.md`**.

Custom fonts on a *live* AcroForm field (`field.updateAppearances`) render as Helvetica in Chrome/Edge/Adobe Reader regardless of correct embedding — inherent viewer limitation. Fix used everywhere: stamp the value as static page content (`page.drawText()`, same as watermark/page numbers) instead of a fillable field — immune to that substitution since content-stream text isn't re-rendered by the viewer. **Field designer**: a `text` field with a value typed in at design time stamps rather than becoming a field. **`/fill`** defaults to the same (`flatten: true` — stamps each value at its field's position and removes the field; `flatten: false` for old live-field behaviour). Font picker is pdf-lib's 14 built-in standard fonts (Sans Serif/Serif/Monospace) everywhere a live AcroForm field is possible (dropdown, empty fillable text field); a **Script** group (10 manually-verified Google Fonts, fetched as TTF via `fetchScriptFontBytes()`) is additionally offered wherever the stamp path is guaranteed (Fill Form's picker, a field-designer `text` field) — never on `dropdown`, which stays a live field.

**Google Ads** (`/google-ads`): Content-tools agent with its own projects (not Vault chat projects). Paste a URL plus **what they sell** (offer is ground truth) → SSRF-safe scrape → **`standard`** model builds 100 Google Ads keywords, 100 negatives, and RSA copy. Ads tab can generate RSA (15/4) or a 10-headline / 10-description pack. Lists follow the offer if the live page is a different industry. Copy or CSV for Ads Editor. Tables: `seo_projects` (includes `offer`), `seo_artifacts`. API: `/api/google-ads`. Feature flag `googleAds`. Docs: **`docs/google-ads-agent.md`**.

**SEO** (`/seo`): Crawl a URL (1–40 same-origin HTML pages, default 25) for organic campaigns — indexation, SERP titles/descriptions, thin/duplicate URLs, schema, hreflang, sitemap vs crawl, click depth, internal links. Not Lighthouse (use **HTML**), not Ads (use **Adwords**), not query data (use **Search**). Table: `seo_audits`. Flag `seo`. Docs: **`docs/seo-agent.md`**.

**Search** (`/search-console`): Google Search Console — OAuth (`webmasters.readonly`), 28-day queries, pages, and query/URL cannibalisation. Tables: `gsc_tokens`, `gsc_snapshots`. Flag `searchConsole`. Redirect: `GSC_REDIRECT_URI` or `{APP_URL}/api/gsc/callback`. Docs: **`docs/search-console-agent.md`**.

**Lighthouse** (`/html`, nav label "Lighthouse"): Google Lighthouse via PageSpeed Insights (mobile **and** desktop). Performance, accessibility, best practices, Lighthouse SEO, lab metrics, opportunities with file URLs, failed checks, copyable developer brief. Table: `html_audits`. Flag `html`. Requires `PAGESPEED_API_KEY`. Docs: **`docs/html-agent.md`**.

**Web Extractor** (`/web-extractor`): Pull content from any public URL, three modes — **Article content** (jsdom strips nav/header/footer/sidebar/ads/comments/images, returns readable text + title/byline, downloadable as PDF via `server/services/webExtractorPdf.js`), **Extract images** (dedup'd `<img>`/`<picture>` + `og:image`, prefers lazy-load attrs `data-src`/`data-lazy-src`/`data-original` over placeholder `src`, absolute URLs, alt text; per-image download or "Download all" as zip), **Exact scrape** (original HTML with relative asset/link URLs rewritten absolute, inline styles/`<style>` untouched, rendered read-only in a sandboxed iframe). No persistence — stateless single-shot API. Uses the same SSRF-safe `htmlFetch.fetchHtml()` as Translate/SEO/pinned URLs; image downloads use a binary-safe SSRF-checked fetch (`webExtractorService.fetchBinary`, htmlFetch decodes everything as utf8 text so it can't carry binary). Flag `webExtractor`. Route: `server/routes/webExtractor.js`. Service: `server/services/webExtractorService.js`.

**Shares** (`/shares`): Personal share portfolio tracker. Tabs: Portfolio · Trades · Cash · Charts · News.

- **Charts tab** — observation-aligned analytics: portfolio vs benchmark day move, beat/lag movers, HWM drawdown alerts, 5-day trailing returns, allocation by sector proxy, relative performance from stored observations, earnings timeline, move heatmap, metals spot/book. See **`docs/shares-charts.md`**. API: `GET /api/shares/charts?days=1|7|30|90`.

- **Holdings + P&L:** `computeHoldingsAndRealized()` in `sharesPortfolio.js` processes trades chronologically (avg-cost method). Returns open holdings + realized P&L per sell. `buildDashboard()` fetches live quotes and returns `positions`, `realized`, `totalRealizedPnlAud`, `unrealizedPnlAud`.
- **Quotes:** Finnhub (`FINNHUB_API_KEY`) for NYSE/NASDAQ; Alpha Vantage (`ALPHA_VANTAGE_API_KEY`) for ASX. Frankfurter for USD→AUD. In-memory quote cache (15 min for user page loads) prevents burning Alpha Vantage's 25 req/day free-tier limit.
- **Cron schedules** (timezone = admin user's `user_timezone` setting, fallback `Australia/Sydney`): ASX snapshots 5 AM + 1 PM; US snapshots hourly 10:00–16:00 ET Mon–Fri; daily news briefings 4 AM; **Portfolio Note email 7 AM**; monthly summary 1st of month 4:30 AM. US poll also runs hourly shares drop/update emails to admins (metals spot + metals tables are daily-only — see `docs/shares-portfolio-note.md`).
- **Exchange filter:** cron passes `['ASX']` or `['NYSE','NASDAQ']` to `recordSnapshots()` so each run only calls the relevant quote API; stale cache covers the other exchange for the portfolio snapshot.
- **Timezone:** All date storage and cron scheduling use the admin user's `user_timezone` profile setting (read via `GET /api/settings/workspace-timezone`, which queries the first admin's `settings` row). Hardcoded `Australia/Sydney` was removed in favour of this dynamic lookup.
- **News tab — daily briefings:** `sharesNewsService.generateDailyBriefing()` fetches Finnhub company news (US) or web search (ASX), plus a Nasdaq market search, then makes one AI call (`callModel` → `standard` tier) producing per-stock paragraphs + `bullish/bearish/watch/neutral` signals. Stored with `type='daily'`. Auto-pruned after 45 days. Manual "Generate today" button triggers `ProcessingModal`. UI groups by date in an **accordion** — one day open at a time, most recent open by default, collapsed header shows signal badge and stock count.
- **News tab — 30-day summaries:** `sharesNewsService.generateMonthlySummary()` reads 30 days of daily briefings, sends to AI for trend + signal-accuracy review. Stored with `type='monthly_summary'`, never deleted. Triggered via "30-day summary" button (also uses `ProcessingModal`). Cron also runs on the 1st of each month.
- **Portfolio Note (daily email):** `sharesNewsService.generateObservation()` — structured analyst note (TOP LINE, MOVERS & CAUSALITY, SECTOR & MACRO, NEWS WORTH ACTING ON, RISK WATCH, DECISION TRIGGERS, ONE-LINER). Pre-computes portfolio day move, per-holding beat/lag vs SOX/Nasdaq/ASX proxies, and mover list before a 3-stage LLM pipeline. Records metals spot once and includes **METALS & MINERALS** when holdings exist. Stored `type='observation'`, emailed 7 AM + on manual observe/refresh. Full spec: **`docs/shares-portfolio-note.md`**.
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
| `RAINFOREST_API_KEY` | Product Scout — Amazon search/product data via Rainforest API |
| `AMAZON_DOMAIN` | Product Scout — Amazon locale (default `amazon.com.au`) |
| `FAL_API_KEY` | Graphics, Video Tools (generate fallback), Recipes (dish photos) |
| `REPLICATE_API_TOKEN` | Video Tools — preferred AI clip generation (`minimax/hailuo-2.3`); also Graphics upscale/bg |
| `VIDEO_GENERATE_PROVIDER` | Force `replicate` or `fal` for video generate |
| `VIDEO_REPLICATE_MODEL` | Replicate text-to-video model (default `minimax/hailuo-2.3`) |
| `VIDEO_GENERATE_MODEL` | Video Tools — FAL model id (default `fal-ai/minimax/video-01-live`) |
| `VIDEO_MAX_UPLOAD_MB` | Video Tools — upload cap for ffmpeg routes (default 80) |
| `FONTS_PYTHON_BIN` | Font Customizer — Python binary for `server/services/fonts/` subprocess (default tries `python3` then `python`); needs `server/services/fonts/requirements.txt` installed |
| `GITHUB_TOKEN` | Font Customizer — optional, raises the Google Fonts repo license-check lookup from 60/hr to 5000/hr |
| `PAGESPEED_API_KEY` | HTML Lighthouse — PageSpeed Insights API (optional; anonymous quota is small) |
| `GSC_REDIRECT_URI` | Search Console OAuth callback (default `{APP_URL}/api/gsc/callback`) |
| `SENTRY_DSN` | Error tracking — unset disables Sentry entirely (no-op). See **`docs/observability.md`** |
| `SENTRY_TRACES_SAMPLE_RATE` | Sentry performance trace sample rate (default `0.1`); only relevant if `SENTRY_DSN` is set |
| `LOG_LEVEL` | pino log level (default `info`) |

---

## Local Dev

App is broken locally (Node env issues — see `local-setup-issues.md`). Use Railway for testing production behaviour. Git remote: push `version-7` → Railway auto-deploys.

Run from project root `C:\Users\micha\Local Sites\Curam-Protocol` for all git commands.
