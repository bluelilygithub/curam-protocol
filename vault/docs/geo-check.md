# Geo-check: "Countries" in Device preview — design brief

Status: **all five milestones built** (2026-11-25/26) on branch `geo-check`. Worked locally with real Chromium, the local database and a local stand-in proxy (checked on screen). **Not yet tried** against DataImpulse, on Railway, or with a real AI model (both local AI keys are invalid, so the summary was tested with a stand-in model only). The owner confirmed the recommended answers below on 2026-11-25 (DataImpulse; Device preview; countries as listed; no sign-in in v1; resized load only; 2 contexts at once).

**What it is for:** around a release, see one page as visitors in several countries see it (currency, prices, language, geo-redirects, region-only banners), side by side per device, with a plain list of what differs. Used now and then, not a monitor.

---

## What the code says that changes the request

Read before the decisions table. Each point changes something in the request.

1. **Device preview has no screenshot pipeline.** It fetches the page's HTML once (`POST /api/restyle/fetch-url`) and shows it in iframes at each device's CSS width, in *your* browser, with scripts removed. `renderPage.js` is only used to get the HTML of pages that build themselves with JavaScript; it never takes a picture. Device sizes (`deviceCatalog.mjs`) are reusable; the iframe rendering is not, because geo logic often runs in scripts (currency switchers, geo banners, redirects done in JavaScript) and the preview strips scripts. **So Countries renders real screenshots in Playwright**, as the request says, and only shares the device list and the browser-opening code with Device preview.
2. **`renderPage.js` is built for one render at a time for the whole server** (one slot, a queue of two, a new browser each render), hard-codes `en-AU`, takes no context options and blocks fonts and media. Running geo captures through that slot would block the Style editor and Web Extractor for minutes. Plan: pull the "open a page in a context" part (`renderOnce`: per-request SSRF checks, identity retry, the dropped-connection test, scroll to wake lazy pictures, script-added styles) into a shared function that takes context options; `renderPage` keeps working exactly as now on top of it. Geo runs get **their own slot**: one run at a time server-wide, up to 3 contexts at once inside it.
3. **"Hidden-content fix" does not carry over.** `NO_SCRIPT_REVEAL_CSS` exists because the preview has no scripts. In a real browser the page's own scripts reveal content, but scroll-triggered animations (AOS, WOW) only fire when scrolled to. Plan: scroll down the page in steps before the screenshot, with the reveal CSS as an optional fallback switch.
4. **Device catalog has sizes only**, no pixel ratio or phone/desktop identity. Plan: phones and tablets get `isMobile`, `hasTouch` and a matching phone/tablet browser identity; pictures at pixel ratio 1 to keep files small.
5. **Fonts:** `renderPage` blocks fonts. Screenshots without the site's fonts look wrong, so Countries allows fonts and blocks only video/audio by default (toggle to allow).
6. **Device preview has no saved data and no menu.** It uses the Style editor's switch (`restyle`) and stores nothing. Countries adds the first tables, a background job and a cost, so it gets its own switch (see Flag below).
7. **SSRF through a proxy:** the per-request check in `renderPage` still runs (it resolves the name locally before the request leaves). Through a proxy, the page is fetched from the provider's network, so an internal address would reach the provider's network rather than Vault's. Keeping the check is still right: it stops Vault being used to probe anyone's private ranges and keeps one rule for every browser load.
8. **Flag emoji do not show on Windows Chrome** (it shows the letters "AU"). Cells show the two-letter code and the country name instead of a flag picture.
9. **Seen last session, not yet explained:** on Railway, DNS Lookup showed no Country line for 103.27.34.121 (the free ipinfo.io lookup, and the registry fallback, both came back empty). I was stopped before checking why. It matters here because the exit check may use the same service; through a residential proxy the request comes from a different address, so a Railway rate limit would not apply, but a provider's own geo endpoint is preferred anyway.

---

## Decisions already made

| Area | Decision | Source |
|---|---|---|
| Where | A **Countries** view inside Device preview (`/device-preview?view=countries`), not a new tool | Owner default; *open decision 1* |
| Rendering | Playwright, one context per country (and per device, see load mode), never an outside screenshot API | Owner |
| Per-country context | `proxy` (country-targeted residential), `locale`, `timezoneId`, `geolocation` + permission, `Accept-Language` | Owner |
| Shared code | One "open a page in a context" function shared with `renderPage.js` (SSRF per request, identity retry, scroll, script-added styles) | This brief (point 2) |
| Concurrency | One geo run at a time server-wide, max **3 contexts at once**; its own slot, separate from `renderPage`'s | Owner + point 2 |
| Cap | Max **24 captures** per run (countries × devices) | Owner |
| Load mode | **One load per country, resized per device** (default, cheaper) or **fresh load per device** (exact: the site sees a phone identity from the first request) | This brief; *open decision 5* |
| Downloads | Video/audio blocked by default (toggle); fonts and pictures allowed | Owner + point 5 |
| Proxy | Provider-agnostic adapter from environment variables; missing variables = "not set up" EmptyState | Owner |
| Exit check | Before each country's capture, ask a geo endpoint *through the same context*; mismatch renders anyway and labels **Unverified: exited from XX** | Owner |
| Bandwidth | Bytes counted per capture (`request.sizes()` per finished request); run shows MB and approximate cost from `GEO_PROXY_COST_PER_GB` | Owner |
| URL safety | `normaliseHttpUrl` + `checkSsrf` before the run starts, and per request inside the browser, and on the final address | Owner + point 7 |
| Diff | Plain code, no model: redirects, `<html lang>`, currencies and prices, headings/buttons/blocks present in some countries only | Owner |
| AI summary | Optional button, last milestone; `getModelsForUser().standard`, `callModel` with `images` (already supported), behind `aiLimiter`, usage logged | Owner |
| Storage | Screenshots as JPEG files in `attachments` (`entityType` `geo-capture`) on the upload volume, counting toward the 500 MB per-person quota | Owner ("as attachments already do") |
| Runs | Saved with URL, settings, captures, diff, timestamps; delete = `moveToBin` in the same transaction; files kept until the item leaves the bin (`discard`) | Owner + docs/recycle-bin.md |
| Background | PDF → HTML pattern (`pdfToHtmlJobs.js`): start returns an id, page polls, one running run per person, Stop, restart marks a running run as stopped | Owner |
| Countries list | Default AU, NZ, US, GB, DE, JP; editable, saved per person (settings key `geo_check_countries`) | Owner; *open decision 3* |
| Flag | New switch `geoCheck`, lifecycle `preview`, default **off**; admins always see it; routes need both `restyle` and `geoCheck` | This brief (point 6) |
| Dependencies | None new. No `package.json`, lock file or `Dockerfile.base` change (Playwright and Chromium are already in the base image) | Owner |

---

## Proxy adapter

`server/services/geoCheck/proxy.js`, pure apart from reading `process.env`.

| Variable | Example | Notes |
|---|---|---|
| `GEO_PROXY_SERVER` | `http://gate.example.com:7000` | Required |
| `GEO_PROXY_USERNAME_TEMPLATE` | `customer-abc-country-{country}` | Required. `{country}` = `au`, `{COUNTRY}` = `AU` |
| `GEO_PROXY_PASSWORD` | `…` | Required. May also contain `{country}` (IPRoyal puts the country in the password) |
| `GEO_PROXY_CHECK_URL` | provider's "my IP" JSON address | Optional. Default `https://ipinfo.io/json`; the country is read from `country` / `country_code` / `countryCode` |
| `GEO_PROXY_COST_PER_GB` | `1.50` | Optional, for the cost estimate only, **in Australian dollars** (shown as A$). The owner converts the provider's US-dollar price when setting it |
| `GEO_PROXY_LABEL` | `Decodo` | Optional, shown to admins only |

`proxyFor(country)` → `{ server, username, password }` or `null`; `isConfigured()`; `describe()` for logs never includes the username or password. Credentials never reach the client, the database or a log line.

**Providers that fit this shape** (country in the username, one gateway address). I have **not** checked current prices or tested any of them.

- **Bright Data**: `brd-customer-<id>-zone-<zone>-country-{country}` on its super-proxy gateway.
- **Oxylabs** (residential): `customer-<user>-cc-{COUNTRY}`.
- **Decodo** (was Smartproxy): `user-<user>-country-{country}`.
- **SOAX**: `package-<id>-country-{country}`.
- **IPRoyal**: the country goes in the password (`<pass>_country-{country}`), which the password template covers.

Providers that pick the country by port number or by a separate address per country need a small change (a port map variable). I'd wait until you pick one.

---

## Data model (SQL, idempotent, in `server/db.js`)

```sql
CREATE TABLE IF NOT EXISTS geo_check_runs (
  id              SERIAL PRIMARY KEY,
  "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,                       -- as typed, normalised
  label           TEXT,                                -- optional "before release 4.2"
  settings        JSONB NOT NULL,                      -- { countries:[], devices:[], loadMode, allowMedia, revealCss }
  status          VARCHAR(12) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'done', 'failed', 'stopped')),
  stage           TEXT,
  progress        INTEGER NOT NULL DEFAULT 0,          -- 0-100
  "capturesDone"  INTEGER NOT NULL DEFAULT 0,
  "capturesTotal" INTEGER NOT NULL DEFAULT 0,
  "bytesTotal"    BIGINT NOT NULL DEFAULT 0,
  diff            JSONB,                               -- plain-code diff (milestone 4)
  summary         TEXT,                                -- AI summary (milestone 5)
  "summaryModel"  TEXT,
  "errorMessage"  TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finishedAt"    TIMESTAMPTZ,
  "seenAt"        TIMESTAMPTZ DEFAULT NOW()            -- NULL after finishing = ready, not looked at (needs-attention list)
);
CREATE INDEX IF NOT EXISTS geo_check_runs_user_idx ON geo_check_runs ("userId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS geo_check_captures (
  id              SERIAL PRIMARY KEY,
  "runId"         INTEGER NOT NULL REFERENCES geo_check_runs(id) ON DELETE CASCADE,
  "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country         CHAR(2) NOT NULL,                    -- asked for
  "deviceId"      TEXT NOT NULL,                       -- deviceCatalog id or custom-WxH
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  status          VARCHAR(10) NOT NULL CHECK (status IN ('ok', 'failed', 'blocked')),
  "exitCountry"   CHAR(2),                             -- what the exit check saw; NULL = check failed
  verified        BOOLEAN NOT NULL DEFAULT FALSE,      -- exitCountry = country
  "httpStatus"    INTEGER,
  "finalUrl"      TEXT,
  "htmlLang"      TEXT,
  title           TEXT,
  extract         JSONB,                               -- currencies, prices, headings, buttons, blocks (for the diff)
  bytes           BIGINT NOT NULL DEFAULT 0,
  "attachmentId"  INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  error           TEXT,
  "capturedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS geo_check_captures_run_idx ON geo_check_captures ("runId");

-- A run cannot survive a restart: say so instead of showing it running for ever.
UPDATE geo_check_runs SET status = 'stopped', "errorMessage" = 'Stopped part-way because the server restarted (usually a Vault update).',
  stage = NULL, "finishedAt" = NOW() WHERE status = 'running';
```

The per-person country list lives in the existing `settings` table (key `geo_check_countries`, JSON array of codes); no table needed.

Screenshots: JPEG (quality 70), full page capped at 8,000 px tall (noted on the cell when cut), via `attachments` with `entityType` `geo-capture`, `entityId` = capture id. `assertWithinQuota` before each save; at the limit the run stops with a plain message. Rough size: 150-600 KB a capture, so a 24-capture run is about 5-15 MB.

---

## API

Mounted at `/api/geo-check` behind `requireFeature('restyle')`, `requireFeature('geoCheck')` (after `requireAuth`). Every query filters by `"userId"`. Named routes before `/:id`.

| Route | What it does |
|---|---|
| `GET /config` | `{ configured, countries (saved or default), catalogue of supported countries, maxCaptures: 24, costPerGb }`. Never any credentials |
| `PUT /countries` | Save the person's list (codes from the supported list only, 1-12) |
| `GET /runs` | Newest 50 runs, no captures (id, url, label, status, counts, bytes, createdAt) |
| `POST /runs` | Start: checks the address (`normaliseHttpUrl` + `checkSsrf`), the cap, that the proxy is set up, one running run per person. Returns `{ id }` at once. **Limit: 6 runs an hour per person** (proposed; the request did not give one) |
| `GET /runs/:id` | The run with its captures and progress (the page polls this every 2 s while running) |
| `POST /runs/:id/stop` | Stop a running run; finished captures stay |
| `GET /runs/:id/captures/:captureId/image` | The JPEG, owner-checked, `Cache-Control: private` |
| `DELETE /runs/:id` | `moveToBin` + delete in one transaction; adapter `geo-check-run` restores the run and captures (`insertRow`), files kept until `discard` |
| `POST /runs/:id/summary` | Milestone 5, behind `aiLimiter`; usage logged as `geo_check_summary` |
| `POST /api/geo-check-tutor` | The guide chat (milestone 5), behind `aiLimiter` |

Logging: `getLogger()`; never the proxy username or password, never the page address with any sign-in details, never page text.

Cost guard: a run refuses to start when the estimate (captures × the person's last average bytes, or 3 MB a capture when unknown) would exceed `GEO_PROXY_MAX_MB_PER_RUN` (default 150 MB). Proposed; the request did not give a ceiling.

---

## Rendering, step by step (one country)

1. New context: proxy for that country, `locale` / `timezoneId` / `geolocation` (+ permission) / `Accept-Language` from `geoCheck/countries.js` (one line per country: code, name, locale, timezone, latitude, longitude; adding a country is one line).
2. **Exit check** in that context: open `GEO_PROXY_CHECK_URL`, read the country. Same → verified. Different → render anyway, label **Unverified: exited from XX**. No answer → **Unverified: exit not confirmed**. Never a silent label.
3. Open the page with the shared function (SSRF check per request, identity retry for refusals, dropped-connection test). A "robot check" page (Cloudflare and others often challenge residential proxy traffic) is saved as status `blocked` with its screenshot, so you see what the visitor got.
4. Scroll through the page in steps (wakes lazy pictures and scroll animations), back to top, then for each device: set the viewport (resize mode) or open a fresh context with that device's identity (fresh mode), wait for layout, take the screenshot, read the page facts for the diff (final address, `<html lang>`, title, currency symbols and codes, price strings, h1-h3, button and link texts, landmark blocks, cookie/consent banner present).
5. Count bytes from every finished request; close the context.

---

## UI (inside Device preview)

- A two-part switch at the top of Device preview: **Screens** (today's page, unchanged) and **Countries**. The address box is shared.
- **Countries view**, without the proxy set up: an `EmptyState` saying it is not set up and that an admin adds the proxy details on Railway (no technical words for members).
- **Set up a run:** country chips (code + name, add from the supported list, remove, "Save as my list"), device chips from the same catalogue (default: one phone, one laptop), load mode, "Allow video and sound" toggle, an optional label ("before release 4.2"), and a live line: "6 countries × 2 screens = 12 captures, about 25 MB, about A$0.04". **Check these countries** starts the run.
- **While it runs:** a progress panel (not the blocking ProcessingModal, since you can leave): stage, captures done of total, Stop. Leaving is fine; when it finishes, a needs-attention item "Your country check is ready" (`server/routes/attention.js`), like PDF → HTML.
- **Result:** the plain-code diff on top ("Redirects: US → /en-us/", "Currency: AUD in AU, NZD in NZ, USD in US…", "Shown only in DE, GB: cookie banner"). Below it a grid: countries (rows) × screens (columns). Each cell: a picture cut to the first screen, the code and country name, **Verified** or **Unverified: exited from XX**, the time, and the size downloaded. Click a cell for a full-size `Dialog` with **two-up compare** (pick any other cell; both scroll together).
- **Saved runs:** a list in the Countries view (`Skeleton` while loading, `EmptyState` when none), each with open and inline "Delete? Yes / No" (Undo toast). Picking two runs of the same address shows **what changed between them** (milestone 4).
- House rules: `getIcon` (register any new icon first), `Tooltip` on every control, `VoiceInput` on the address and label boxes, theme variables only (status colours `#16a34a` / `#f59e0b` / `#ef4444` as allowed), 200 ms transitions, `hover:opacity-*`, full desktop width (grid uses the width; two columns from `xl` where it helps), (i) box text extended, compass tour steps for Countries, guide chat.

---

## Conventions checklist

- [ ] No `package.json`, lock file, `Dockerfile` or `Dockerfile.base` change; tests run with `node path/to/file.test.js`
- [ ] Raw parameterised SQL; idempotent DDL in `server/db.js`; camelCase columns quoted; `COUNT`/`SUM` wrapped in `Number()`
- [ ] Every query filters by `"userId"`; named routes before `/:id`
- [ ] `requireAuth` + `requireFeature('restyle')` + `requireFeature('geoCheck')`; flag in **both** `server/config/featureAccess.js` and `client/src/utils/featureAccess.js` with `FEATURE_LIFECYCLE` `preview`, default off; `node server/config/featureAccess.test.js`
- [ ] `checkSsrf` before the run, per request and on the final address
- [ ] Proxy credentials only from env; never logged, stored or sent to the client
- [ ] `getLogger()`, never `console.*`; no page text or addresses with credentials in logs
- [ ] Background job: one per person, Stop, restart handling, progress saved
- [ ] Deletes through `moveToBin` in the same transaction; adapter registered; `discard` removes files
- [ ] Screenshots through `attachments` with `assertWithinQuota`
- [ ] Cron? None planned. If one is added (for example clean-up), wrap it in `withCronLock`
- [ ] AI calls: `getModelsForUser`, no hardcoded ids, `aiLimiter`, usage logged
- [ ] `SuggestionService.captureIf` when a run finds something worth triage (for example "proxy exit country did not match for 3 of 6 countries", or "the proxy is set up but every run fails")
- [ ] `apiClient` for every client call; `Dialog` for the full-size view; `Tooltip`, `Skeleton`, `EmptyState`, `VoiceInput`, (i) box, tour, guide chat (`server/config/guides.js`, catalogue in step, `npm run test:guides` and the guide's own drift test)
- [ ] New page parts go through `appNavigation.js` only if Countries gets its own address (it does not: same page, `?view=countries`)
- [ ] `docs/env-vars.md`, `docs/key-files.md`, `docs/geo-check.md`, Device preview entry updated
- [ ] One admin Changelog entry per commit, in its own `Changelog:` commit, with honest concerns (what was not tried in a browser or against a real proxy)
- [ ] Branch `geo-check`; nothing to `version-7` until approved

---

## Milestones (one Claude Code session each)

1. **Proxy, exit check, one capture.** `countries.js`, `proxy.js`, the shared "open a page in a context" function (`renderPage.js` refactored onto it, behaviour unchanged), `capture.js` (one country, one screen → JPEG + page facts + bytes). Flag `geoCheck` (preview, off). An admin-only `POST /api/geo-check/try` that returns one picture without saving, to prove it on Railway with a real proxy. Env vars documented. Tests for the pure parts; existing `renderPage` tests still pass.
2. **Runs as a background job.** Tables, jobs module (injectable like `pdfToHtmlJobs.js`), 3 contexts at once, Stop, restart handling, attachments + quota, cost guard, runs API, recycle-bin adapter with `discard`, needs-attention item.
3. **Countries view.** The Screens/Countries switch, set-up panel with the estimate, progress panel, grid, full-size two-up compare `Dialog`, saved runs list with delete and Undo, (i) text, tooltips, tour steps.
4. **Plain-code diff.** `diff.js` (pure): within a run (across countries, per screen) and between two runs of the same address. Shown above the grid.
5. **AI summary, guide chat, docs.** Summary button, the Countries part of the Device preview guide (catalogue and drift test), this file finalised, `key-files.md`.

---

## Tests

All run with `node <file>`; none added to `package.json`.

- `server/services/geoCheck/proxy.test.js`: templates (`{country}`, `{COUNTRY}`, in password), missing variables → not configured, `describe()` and thrown errors never contain the username or password.
- `server/services/geoCheck/countries.test.js`: every country has locale, timezone, coordinates; codes unique; defaults are in the list.
- `server/services/geoCheck/exitCheck.test.js`: reads the country from the known JSON shapes; mismatch and no answer give the right labels.
- `server/services/geoCheck/capture.test.js`: with a fake browser/context (no Chromium): context options per country, media blocked unless allowed, bytes summed, SSRF refusal aborts the request.
- `server/services/geoCheck/jobs.test.js`: fake pool and capture: cap of 24, max 3 at once, Stop, a failed country does not fail the run, restart marking, quota stop.
- `server/services/geoCheck/diff.test.js`: fixtures for redirect, language, currency/price, block present in some countries only, run-vs-run.
- `server/routes/geoCheck.db.test.js` (local Postgres, like `serpTrackerRouter.db.test.js`): owner scoping, delete → bin → restore, image route refuses another person's capture.
- Existing: `server/services/restyle/restyleLoad.test.js`, `node server/config/featureAccess.test.js`, `npm run test:guides`, `npm run test:device-preview`, `npm run test:device-preview-tutor`.
- **Not automated:** a real proxy and real Chromium. Milestone 1 ends with a manual check on Railway through `/try`, recorded in the Changelog entry; until then every entry says it was not tried against a real proxy.

---

## Assumptions (tell me if any is wrong)

- Screenshots count toward the same 500 MB per-person attachment quota as task and CRM files (not a separate quota).
- Runs are kept until you delete them (no automatic expiry).
- Costs are shown in Australian dollars (A$), from `GEO_PROXY_COST_PER_GB` set in A$ (owner, 2026-11-25).
- The supported country list starts with about 30 countries (your six plus major markets); more are one line each.
- Members can use Countries if an admin turns the switch on for them; the proxy cost is the workspace's.
- 6 runs an hour per person and a 150 MB ceiling per run are reasonable starting limits.
- Railway has enough memory for 3 Chromium contexts at once on top of the app (I have not measured it; milestone 1 measures one context).

## Confirmed answers (owner, 2026-11-25)

Setup taken into account: one owner, a few members, used now and then around releases, Railway, public sites, no package changes wanted, costs in A$.

| Decision | Most expedient | Why |
|---|---|---|
| 1. Where | Inside Device preview (Screens / Countries switch) | Reuses the address box, device list, (i) box, tour and guide; no new menu item |
| 2. Proxy | **DataImpulse, pay as you go** (about US$1/GB ≈ A$1.45/GB, traffic does not expire, US$5 ≈ A$7 to start). Fallback: **IPRoyal** (about US$7/GB ≈ A$10/GB at 1 GB, also does not expire, more established) | Intermittent use: traffic that does not expire means nothing is wasted between releases. Both fit the adapter with no code change (DataImpulse puts the country in the username, IPRoyal in the password). At about 30 MB a run, one release check costs cents either way. Prices are from third-party comparison pages, not checked on the providers' own sites; DataImpulse's exact username format is to be confirmed at sign-up |
| 3. Countries | AU, NZ, US, GB, DE, JP, editable, saved per person | As asked |
| 4. Staging sign-in | **None in the first version.** Public pages only; add the browser's own password box (Basic auth, `httpCredentials`) later only if a staging site uses it | No password handling, no lock-out risk, no extra traffic. Form sign-in reuse stays possible later |
| 5. Load mode | **One load per country, resized per screen**, only mode in the first version | Cheapest and simplest; fresh-per-screen can be added if a site serves phones different HTML |
| Concurrency | 2 contexts at once to start (not 3), raised after milestone 1 measures memory on Railway | Avoids an out-of-memory restart taking the whole app down |

Effect on milestones: milestone 1 needs only the three proxy variables set on Railway after you sign up; no sign-in work anywhere; the load-mode option drops out of the set-up panel.

## Open decisions as first asked (answered above; kept for the reasoning)

1. **Extend Device preview, not a new tool?** I recommend yes (same address box, same devices; a switch at the top). The cost is that Device preview, which today saves nothing, gets tables and its own switch.
2. **Proxy provider.** The adapter fits Bright Data, Oxylabs, Decodo, SOAX and IPRoyal as written. Which one, or should I keep it generic until you sign up?
3. **Default countries** AU, NZ, US, GB, DE, JP, editable and saved per person: confirmed as the plan unless you say otherwise.
4. **Staging sign-in.** The Web Extractor's sign-in code can be reused (it works inside any browser context). The costs are:
   - it signs in once per country (once per country *and screen* in fresh-load mode), through the proxy, so extra bandwidth;
   - the password is typed for each run and held only in memory for that run (a restart loses it);
   - sign-ins from six countries within a minute can look like an attack to the site's security and lock the account or bring up a CAPTCHA;
   - code sign-ins (two-factor) and "Sign in with Google" are not possible.

   Cheaper alternatives: staging behind a browser password box (Basic auth, one line, no form), or a secret header or cookie your staging site lets through. I recommend Basic auth or a header first and form sign-in only if needed. Which does your staging use?
5. **Load mode default.** "One load per country, resized per screen" uses about a third to a sixth of the bandwidth, but a site that serves different HTML to phones would only show its desktop version. "Fresh load per screen" is exact and costs more. I recommend resized as the default with fresh as an option. Agree?

---

## Milestone 1: how to try it

1. Sign up with DataImpulse, then on Railway set `GEO_PROXY_SERVER`, `GEO_PROXY_USERNAME_TEMPLATE` (country as `{country}` where DataImpulse wants it; check their dashboard for the exact form) and `GEO_PROXY_PASSWORD`; optionally `GEO_PROXY_COST_PER_GB` in A$ and `GEO_PROXY_LABEL`.
2. Turn on **Geo-check** in Settings → Feature Access (admins get through anyway).
3. As an admin: `POST /api/geo-check/try` with `{ "url": "example.com", "country": "DE", "width": 390, "height": 844, "mobile": true }`. The answer has `status` (ok / blocked / failed), `label` (Verified / Unverified: exited from XX / exit not confirmed), `bytes`, `costAud`, the page facts and `image` as a `data:` address.

What milestone 1 found: Chromium answers a refused proxy password by asking again forever, so the only sign is a time-out. A timed-out exit check therefore stops the capture with "The proxy did not answer" (16 s) instead of also waiting 30 s for the page. Measured locally on apple.com/au: about 2.4 MB downloaded and a 300 KB picture for a phone-width capture, 3.7 MB for a laptop width, about 6 s each.

## Milestone 2: what was built and measured

- `jobs.js`: start / stop / list / get / imagePath / remove; one shared browser per run, `GEO_CHECK_CONTEXTS` (default 2) countries at once; each country is one load resized to each screen. The site sees a phone only when every screen chosen is a phone.
- A failed country is saved as failed pictures with its reason; the run fails only when every country failed. Proxy failing everywhere, or half the countries exiting from the wrong place, raises an inbox suggestion.
- Stops early, with a plain message: Stop (captures kept), the byte ceiling, a full attachment space. Refused before the start: not set up, another run going (anyone's), 6 runs in the last hour, over 24 pictures or 12 countries, an estimate over the ceiling (average of the person's last 5 runs, else 4 MB a country).
- Measured locally (real Chromium, stand-in proxy): booking.com, 3 countries x 2 screens, 30.5 MB and 28 s; Japan came back in Japanese from the browser language alone. Heavy sites run about 10 MB a country, so 4 MB is a low first guess; the estimate learns from the person's runs.
- `seenAt` is NULL when a run finishes and set when it is opened; the needs-attention list shows unopened finished runs.

## Milestone 3: the Countries view

- `DevicePreviewPage.jsx`: a Screens / Countries switch, shown only when `GET /api/geo-check/config` answers (so only to people with both switches); `?view=countries` opens it (the needs-attention link). The address box keeps its value across the two views. (i) box and tour (step 3 of 7, `dp-switch`) mention Countries.
- `devicePreview/CountriesView.jsx`: not-set-up `EmptyState`; set-up (address, optional name, country chips with Add and "Save as my list", up to 4 screens from the device catalogue, video and sound toggle, live estimate line in MB and A$, refuses over 24 pictures); progress panel with Stop while running (polls every 2 s; you can leave); result grid (countries x screens, first screen of each picture, label, language, redirect, size, "cut at 8,000 pixels"); full-size `Dialog` with a second picture beside it that scrolls in step; saved checks list with inline Delete? Yes / No and Undo. Opening the view opens the newest check (a running one first).
- `devicePreview/countriesModel.mjs` (+ test): estimate line, labels, grid, screens sent to the server (phones as phones).
- Found on screen: the picture route failed when `UPLOAD_DIR` is relative (it is locally); fixed with `path.resolve`, and the database test now uses a relative folder.
- Not yet: the guide chat does not know about Countries (milestone 5); with two countries at once the progress line names the one started last.

## Milestone 4: what differs (plain code, no model)

- `server/services/geoCheck/diff.js` (+ `diff.test.js`): `diffRun` across the countries of one check (redirects, language, page title, currency, first five prices, cookie notice, headings and buttons shown in some countries only) and `diffRuns` for the same country in two checks of one address (what is new and gone). A country is compared from all its pictures (headings and buttons are the union over screens; the rest from the first picture, one load serves every screen). Failed and blocked countries are named under "Not compared".
- Headings and buttons are only compared between countries that got the same language: on booking.com (AU English, JP Japanese) every heading differed, which buried the four lines that mattered.
- The across-countries result is worked out the first time a finished check is opened and kept in `geo_check_runs.diff` (so checks ended by a restart get one too). `GET /runs/:id/compare/:otherId` compares two finished checks of the same page (host and path, ignoring www., a trailing slash and the query), older first.
- The view shows "What differs between the countries" above the grid and a "Compare with an earlier check of this page" choice under it.
- Known noise: a site that rotates its offers between visits (booking.com does) shows many price and heading changes between two checks minutes apart; that is the site, not the check.

## Milestone 5: AI summary, guide chat, docs

- `server/services/geoCheck/summary.js` (+ `summary.test.js`): `POST /runs/:id/summary` (behind `aiLimiter`) asks the person's **standard** model (`getModelsForUser`, never a hardcoded id) for a short release-check note. It sends each country's facts, the plain differences and the top 1,600 pixels of one picture per country (shrunk to 800 px wide with sharp). Page text goes inside `<page-data>` tags that the model is told to treat as data only. A model that cannot look at pictures is asked again with the facts alone, and the note says so. Usage is logged as `geo_check_summary`. The note is kept on the run (`summary`, `summaryModel`) and shown with "It can be wrong: check the pictures".
- Device preview guide: a Countries area (`countries`) and 8 entries (switch, countries, screens, start, pictures, differences, summary, saved) in `devicePreviewTools.mjs` and `server/services/devicePreviewTutor.js`; what it cannot do now names Countries' limits. The guide's Open buttons switch to the Countries view (or back to Screens) before scrolling. `npm run test:device-preview-tutor`, `npm run test:guides`.

## Using it (owner)

1. Railway: `GEO_PROXY_SERVER`, `GEO_PROXY_USERNAME_TEMPLATE` (with `{country}` where DataImpulse wants the country), `GEO_PROXY_PASSWORD`; optional `GEO_PROXY_COST_PER_GB` (A$), `GEO_PROXY_LABEL`, `GEO_CHECK_CONTEXTS` (default 2), `GEO_PROXY_MAX_MB_PER_RUN` (default 150).
2. Settings → Feature Access: turn on **Geo-check** for members who should have it (admins always do; it also needs the Style editor switch).
3. Device preview → Countries. If the first check says "The proxy did not answer", the username or password is wrong or the account has no traffic; "Unverified: exited from XX" on every country means the country is in the wrong place in the username template.

## All tests

`node server/services/geoCheck/{countries,proxy,exitCheck,capture,diff,summary}.test.js`, `DATABASE_URL=... node server/routes/geoCheck.db.test.js`, `node client/src/pages/devicePreview/countriesModel.test.mjs`, `node server/services/attention.test.js`, `node server/config/featureAccess.test.js`, `npm run test:device-preview`, `npm run test:device-preview-tutor`, `npm run test:guides`.
