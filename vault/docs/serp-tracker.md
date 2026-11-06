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

**Routes** (`/api/serp-tracker`, all `requireFeature('serpTracker')`, all filter by `"userId"`): `GET /status`, `GET|PUT /site`, `GET /runs`, `POST /run` (6 an hour per person). Sites are no longer limited to one per person: see **Several sites** below.

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

## What the first real Live answer showed (6 Nov 2026)

One real Live search ("walk in wine cabinets", desktop, location "Australia", top 10, AI summary on; cost US$0.004) was read and the findings changed the parser:
- **Targeting is Australian.** DataForSEO echoed `location_code` 2036 and `check_url` with `gl=AU`; the real results were Australian retailers (retravision.com.au, appliancesonline.com.au, winnings.com.au) plus Pinterest. It also echoed `se_domain` **google.com**, not google.com.au; whether `se_domain: google.com.au` changes the results is untested (and its parameter on the Live endpoint is unconfirmed). The page now shows a "Searched as" line so this can be seen on every lookup.
- **Results come back as Google redirect links.** Most `organic` items had `url` = `https://google.com/goto?url=<opaque>` and `domain` = `google.com`; the real website appears only in `breadcrumb` (`https://www.retravision.com.au › product › ...`, truncated), and Pinterest pins show only a site name with no address. The parser used to take `domain` at face value, so it could never have found the owner's site. It now reads the website from the breadcrumb when the link is a Google redirect (`resolveItem`), keeps the redirect link for opening, shows the breadcrumb as the address, and records `unknownDomainCount`. If the site is not found while some results hide their website, the lookup says it **may be one of them** (`mine.uncertain`) instead of a flat "not ranked". The saved page text is only as exact as the breadcrumb: its path is cut with "...".
- **No ads came back** (item types were only `ai_overview`, `organic`, `images`). The page now lists `paid` items when there are some, and otherwise says no ads came back and that this does not prove none are running. Older saved lookups say "not recorded". Why none appeared is not known: ads vary with place (a country-level location often gets fewer than a city), device, and time. Two further probes to test mobile and `google.com.au` were refused with the verification 403 (see below), so they are still to do.
- **The 403 is not constant.** The same account returned a result for this search, then refused the next two with "Please verify your account". Cause unknown (verification in progress, or a limit on unverified accounts); ask DataForSEO support if it continues.
- The raw answer is kept in the repo as `server/services/serpTracker/fixtures/live-walk-in-wine-cabinets-desktop-australia.json` (37 KB; the owner decided on 6 Nov 2026 to keep a real-results fixture in the public repo). It holds only the search request and Google's public results: no credentials, login or account details (checked). `serpParse.test.js` parses it with expected values read off it by hand, so the parser is tested against a real answer. Add further real answers (mobile, a city, one with ads) beside it as they are collected; stage 3 will use them too.

## Several sites, one per client (built 6 Nov 2026)

A person can track up to **20 sites** (`MAX_SITES`), one per client or website. A **site switcher** sits above the tabs (a site, or **Quick lookup (no site)**; the choice is remembered per browser in `localStorage` `vault_serp_site`), with **Add site** and **Delete site**. Site setup, Lookup and Runs all follow the chosen site. A site has an optional **name** (in the profile JSON, shown instead of the domain) and an optional **CRM client** (`serp_sites."clientId"`, `ON DELETE SET NULL`, checked with `ownsRow` like Topic Research's link). Each web address can be tracked **once per person** (another person may track the same one).

- **Routes** (all behind the flag, all filtered by `"userId"`; ownership is checked before anything else): `GET|POST /sites`, `GET|PUT|DELETE /sites/:id`, `GET /sites/:id/runs`, `POST /sites/:id/run`; lookups take `siteId` (omitted = Quick lookup) and `GET /lookups?siteId=<n>|quick`. The old single-site `/site`, `/runs`, `/run` routes are gone.
- **Migration:** the stage 1 unique index on `"userId"` is dropped at boot (`idx_serp_sites_user`), so the existing site stays as the person's first site.
- **Daily job and cost:** the cron already iterates every site (one run each, each with its own balance step); all sites share the one monthly cap and the one DataForSEO balance.
- **Delete a site** moves it **and its saved lookups** to the recycle bin (type `serp-site`, `adapters/serpSite.js`, one transaction, 30 days, Undo). Its run history is not restored; its past spending stays in `serp_api_costs` (the `siteId` becomes empty). Undo is refused if the same domain has been added again, or at 20 sites. The latest **50 lookups are kept per site** (and 50 Quick lookups); "Delete all" applies to the list being viewed.
- **Not done:** the CRM client page does not show its SERP sites yet (the link only says whose site it is).

## Australian index and the real place (7 Nov 2026)

Site setup has a **Google site** setting (`profile.searchDomain`, default `google.com.au`, sent to DataForSEO as `se_domain` on Live and queued searches; sites saved before it existed get the default). A line under the place/language boxes says what will really be used, for example "Searching as: Bowen Hills,Queensland,Australia (city, place 9060847) · google.com.au · language en". The place is checked against DataForSEO's Australian list (`GET /api/serp-tracker/location-check?name=`, a **free** call, list cached in memory, `findLocation` in `dataforseo.js`); an unknown place turns the line red. Typed exactly, "Bowen Hills,Queensland,Australia" exists (9060847). The existing default "Australia" stays national (2036): change the site's place to use the suburb.

**Use my location / Use Australia** (under the place box): the first reads the browser's position, `POST /api/serp-tracker/location-from-point { lat, lng }` (body not URL, not logged, 10 a minute) names the suburb through the shared geocoder (`reverse(lat, lng, { parts: true })`, Nominatim, memory cache only) and matches it to DataForSEO's list (suburb, then city, tries in that order); it only fills the box, nothing is saved until Save. **Use Australia** puts "Australia" back; an empty box also means Australia. Checked with the coordinates of Bowen Hills: Nominatim gave Bowen Hills / Brisbane / Queensland, DataForSEO matched 9060847.

Verified with one real Live search (US$0.002): DataForSEO echoed `se_domain` google.com.au, `location_code` 9060847 and `check_url` on google.com.au (gl=AU). This supersedes the earlier "se_domain did not help" note: it did reach Google, but the ranking difference from the owner's browser was not shown to be caused by it.

## Finding where the site is (Find my site)

Lookup depths are 10, 20, 50, 100 and 200 (the Live maximum; deeper needs the queued mode, which is not switched on). **Find my site** asks for the top 100 without the AI summary and reports the position and `bestPage` = `ceil(position / 10)` ("#118, page 12"; approximate: ten ordinary results a page). If a full answer does not have the site, a button offers the top 200. The page shows an **expected cost before** searching (`estimateLiveUsd`: US$0.002 per 10 results plus US$0.002 for the AI summary, from one real search and the docs; an upper bound) and the real cost after; the server refuses a search that is over the monthly limit **or expected to pass it**.

**What the real searches showed (6 Nov 2026), and what it changed:**
- Asking for **100** results returned only **8 to 14** ordinary results on most tries (2 pages, cost US$0.002 to 0.004) and about **97** (10 pages, US$0.02) on one. The same request, repeated, differs from try to try. `mobile`, `max_crawl_pages` and `se_domain: google.com.au` did not help (each returned 11). So the depth of a lookup is **not** guaranteed, and "Not found in the top 100" would have been false after a short answer.
- The parser now records `coverage { asked, returned, complete }` (complete = 90% of what was asked, or fewer than 20 asked), and the page says "Not found in the N results returned (asked for D)" with a **Try again** button instead of claiming the top 100. Saved lists say "Not in first 13".
- A deep search (50 or more) whose answer is **short** is **tried again, up to 4 attempts in all** (`RETRY_FROM_DEPTH`, `MAX_ATTEMPTS`), stopping as soon as an answer is complete or the site is found. Each attempt's cost is logged (`... (try 2)`), a retry is only made if it still fits under the monthly limit, and the fullest answer is kept. Short answers cost a fraction of a cent, so retries are cheap; a full one costs about 2 cents.
- The **queued mode** (`serpDepthTest.js`, `task_post`) at depth 100, desktop, no AI summary, cost **US$0.006** and also came back short (14 ordinary results), so the shortfall is not a Live-mode problem. That is the stage 2 cost number for a short answer; a full 10-page answer costs about US$0.02 (the Live price). Saved as `fixtures/serp-walk-in-wine-cabinets-d100-desktop.json` (the `task_get` shape, for the stage 3 parser).
- **First real success:** on the Lookup tab, Find my site for "walk in wine cabinets" on `wiwc.com.au` was short on the first try and returned 58 results on the second, with the site at **#18 (page 2)**, two of its pages appearing, cost US$0.016 in all (2 tries). That also confirms the breadcrumb fix: the answer's domains were all `google.com` redirect links. No sponsored ads came back in any of the real searches so far (country-level location, desktop).
