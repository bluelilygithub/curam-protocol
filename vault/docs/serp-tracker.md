# SERP Tracker

Daily Google rankings for the owner's own site, kept as history, with Search Console data and simple weekly reports to follow. Page: `/serp-tracker` (flag `serpTracker`, Web & SEO group, **off by default**, lifecycle `preview`; admins always get in).

Built from the owner's "SERP Tracker, Phase 1 Build Brief" (6 Nov 2026) as a **native Vault tool** (Node, Postgres, node-cron), not the Python service the brief describes. Built **one stage at a time**, checking in between stages. First tracked site: `www.wiwc.com.au`, Australia wide (so local-pack tracking is not relevant).

## Brief to Vault translations

| Brief | Vault |
|---|---|
| Python 3.12 service, Railway cron | node-cron in `server/cron/serpTrackerCron.js`, `0 20 * * *` UTC (6:00 am Brisbane), under `withCronLock('serp-tracker-daily')`; started only where external jobs are allowed |
| `config.yaml` | the site profile, saved in `serp_sites."profileJson"` and edited on the page; validated on save (`siteProfile.js`) |
| httpx, trafilatura, pyyaml | built-in `fetch`; the Web Extractor's `extractArticle` (stage 5); no new dependency, so **no `package.json` change and no slow deploy** |
| `runs` / `api_costs` tables | `serp_runs` / `serp_api_costs` |
| non-zero exit when a module fails | the run row is `failed`, the page shows it, and one Suggestions-inbox alert is raised per failing site |
| Search Console via service account | stage 4 will reuse Vault's existing Search Console OAuth tokens (`gsc_tokens`) unless that proves unworkable unattended; decided then |
| "no web dashboard" | a minimal page is needed anyway (flag, nav entry, and somewhere to edit keywords) |

## Stages

| Stage | What | State |
|---|---|---|
| 1. Skeleton | site profile + validation, `serp_sites` / `serp_runs` / `serp_api_costs`, DataForSEO client with the balance check and retry rules, run engine, daily cron, cost log, the page | built and deployed; balance check verified against the real account (local and production, 6 Nov 2026) |
| 2. DataForSEO test | one depth-100 test request, report its cost, wait for the owner's go-ahead before the full keyword list | code built (`postSerpTask` / `getSerpTask` / `waitForSerpTask`, `server/scripts/serpDepthTest.js`); **blocked 6 Nov 2026: DataForSEO answers HTTP 403 "Please verify your account before using the API"** until the owner verifies the account in the DataForSEO panel. No search has been placed, nothing charged. Rerun `node server/scripts/serpDepthTest.js "walk in wine cabinets" --depth 100 --go` after verification, report the cost, then optionally depth 10 to compare |
| 3. SERP collection | standard queue, parsing, fixtures and tests, spending-cap enforcement | not started |
| 4. Search Console | ingestion, 16-month backfill, the analyses | not started |
| 5. Health checks, competitor snapshots | | not started |
| 6. Weekly report, `lookup`, `costs`, README | | not started |

## Stage 1 in detail

**A run** (`services/serpTracker/runner.js`): closes any run of the site that has been "running" for over 2 hours (it died), refuses to start if one is genuinely running (409), opens a `serp_runs` row dated in the site's time zone (Brisbane by default), checks the DataForSEO balance and logs that call's cost, runs each module in `modules` **independently** (one failing never stops the next), then closes the row `ok` or `failed` with the steps and errors. A failure is always a failure, never missing data. Later stages add modules by passing `{ name, run({ pool, site, runId, runDate, isWeekly, logCost }) }`; the runner itself does not change. `isWeekly` is true on a Brisbane Monday.

**DataForSEO client** (`dataforseo.js`): the Basic header is built from `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` in code. Network errors, 5xx and 429 are retried 3 times with 1 s / 2 s / 4 s waits; any other 4xx is not retried (a refused login is not hammered); an HTTP 200 whose `status_code` is not 20000 is an error. Error messages never carry a header, the login or the password (a test checks this). Balance: `GET /v3/appendix/user_data` (free), read from `tasks[0].result[0].money.balance`; checked against the DataForSEO docs on 2026-11-06.

**Standard Queue calls (stage 2)**: `POST /v3/serp/google/organic/task_post` (the charge is made here, per SERP of up to 10 results; AI Overview via `load_async_ai_overview` may add a small charge, refunded when absent) and `GET /v3/serp/google/organic/task_get/advanced/<id>` (free, valid 30 days). Pending task codes 40601/40602 come from DataForSEO's errors list and were not on the doc pages read; any other task code is a failure, not "wait longer". Polling uses `task_get`; `tasks_ready` is unverified. Only the post is logged as a cost (task_get repeats the same figure, so logging it would double count). A 4xx error now carries DataForSEO's own message.

**Cost log and cap** (`costs.js`): every API call writes one `serp_api_costs` row (the balance check, cost 0, is logged too). Months are calendar months of the Brisbane date. The cap `MAX_MONTHLY_SPEND_USD` (default 5) protects the DataForSEO **account**, so spend is summed over every person's rows. Stage 1 shows spend and cap on the page; stage 3 enforces the cap before posting tasks.

**Routes** (`/api/serp-tracker`, all `requireFeature('serpTracker')`, all filter by `"userId"`): `GET /status`, `GET|PUT /site`, `GET /runs`, `POST /run` (6 an hour per person). One tracked site per person for now (unique index on `"userId"`); lifting that is additive.

**Data.** `serp_sites` (`"profileJson"`), `serp_runs` (`"runDate"`, status `running|ok|failed`, trigger `cron|manual`, `"balanceUsd"`, `"totalCostUsd"`, `"stepsJson"`, `"errorsJson"`), `serp_api_costs`. All cascade with the user.

**Tests.** `node server/services/serpTracker/siteProfile.test.js`, `dataforseo.test.js`, `costs.test.js`, `runner.test.js` (no database, no network), `node client/src/pages/serpTracker/profileForm.test.mjs`, and `DATABASE_URL=... node server/routes/serpTrackerRouter.db.test.js` (real database, fake DataForSEO: ownership, validation, overlap, dead-run recovery, failed-step-is-failed-run, rate limit; mutation-checked against the ownership filter). Per the deploy-speed rule these run as plain `node file` commands, with no `package.json` script.

## Decisions and limits

- The brief's "registrable domain with a public suffix list" needs a library or a hand-kept list of Australian suffixes. `tldts` is in `node_modules` only as a dependency of `jsdom`/`tough-cookie`; using it directly would mean adding it to `package.json` (a slow deploy). To be decided in stage 3. Stage 1 only does a simple "same host or subdomain" test on the typed domains (`hostBelongsTo`).
- No guide chat, compass tour or (i) box yet (Vault's new-tool convention): deferred until there is data worth explaining. Tooltips are on every control.
- Voice input (mic) is not on the text fields yet.
- Not verified: the balance call against the real DataForSEO account, and the page in a browser at phone width.

## Lookup (built 6 Nov 2026, between stages 2 and 3)

A **Lookup** tab on the page: type any search, choose Desktop or Mobile, how many results (top 10, 20, 50 or 100) and whether to include Google's AI summary, and Vault asks DataForSEO's **Live** mode (`POST /v3/serp/google/organic/live/advanced`, one task per call, answered at once, dearer per search than the Standard Queue the daily run will use). The answer is parsed (`serpParse.js`) and saved. It shows where the saved site is (or `not_in_top_N`, never 0), how many non-organic boxes sit above it, whether an AI Overview appears and whether it names the site or a configured competitor, the top 10 and the order of everything on the page.

**Rules:** the cost is logged **before** parsing, because DataForSEO charges whether or not the answer can be read; a result with no organic results is a failed search (502, cost still shown), never "not ranked"; the monthly cap (`capStatus`, whole workspace) refuses the search with 402 before DataForSEO is called; no credentials is 503; a DataForSEO refusal (for example an unverified account) shows DataForSEO's own message and saves nothing. 30 lookups an hour per person.

**Saved lookups** (`serp_lookups`, `lookups.js`): the latest 50 per person are kept (older ones tidied automatically). The raw DataForSEO answer is stored gzipped in `"rawGz"` and emptied after 90 days by a daily 03:40 job (`startSerpTrackerPurge`, runs everywhere, sends nothing); the parsed `"summaryJson"` stays. **Select and delete:** tick any lookups, or Select all, then Delete selected / Delete all, each with an inline Yes / No. `DELETE /api/serp-tracker/lookups` takes `{ ids: [...] }` or `{ all: true }`, moves each row to the shared **recycle bin** (type `serp-lookup`, 30 days, in the same transaction as the delete) and the message offers Undo. The bin copy leaves out the raw answer (big, and fetching it again costs money), so a restored lookup has its readable result but no raw. Restore is also in Settings, Recycle bin.

**Routes added:** `POST|GET|DELETE /lookups`, `GET /lookups/:id`, all behind the flag and filtered by `"userId"`.

**Not verified:** a real Live answer. The account was unverified (403) when this was built, so the Live endpoint, its success status code (assumed 20000) and the AI Overview `references` field names are checked only against the docs and hand-made fixtures (`serpParse.test.js`). Run one lookup on a verified account and compare the saved result with Google before trusting the AI Overview part.

## Help on the page

An (i) box ("How SERP Tracker works", opens once on first visit, `vault_serp_tracker_info_seen`), a tooltip on every control, and the round **SERP Tracker guide** (`guideId` `serp-tracker`, `POST /api/serp-tracker-tutor`, `server/services/serpTrackerTutor.js` on `guideCore.js`, wrapper `client/src/pages/serpTracker/SerpTrackerTutorChat.jsx`). The page and the guide share `client/src/pages/serpTracker/serpTrackerTools.mjs`; `node server/services/serpTrackerTutor.test.js` fails if they drift. The guide sees no site, search, result or cost, and says plainly that daily collection, history, reports and alerts are not built yet. **When a tab or control changes, update `serpTrackerTools.mjs` and the `CATALOG` together.** Not yet done: the compass tour and the microphone on the text boxes.

**More tests:** `serpParse.test.js`, `client/src/pages/serpTracker/lookupHelpers.test.mjs`, and the Lookup section of `serpTrackerRouter.db.test.js` (ownership of list/open/delete/delete-all, validation, spending cap, charged-but-unreadable answer, DataForSEO refusal, bulk delete with bin and Undo, the 50 limit, 90-day raw clean-up, rate limit; the delete-all ownership filter was mutation-checked).
