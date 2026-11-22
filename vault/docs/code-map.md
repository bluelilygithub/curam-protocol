# Code Map

Admin-only tool at `/code-map` (menu: Business, next to Changelog). It reads Vault's own source on the server and shows every tool, the code it owns, how each tool follows the rules in `CLAUDE.md`, and a ranked list of what to improve, with file and line evidence. It only reads. The analysis makes no model calls, needs no git and no network, and costs nothing to run; the two optional AI parts (the guide chat and Explain and plan a fix) each cost one model call per question.

The build brief, the Python prototype it was ported from and the prompts for each milestone are in `specs/code-map/`.

## Where the code is

- `server/services/codeMap/`: the analyzer. One module per stage: `files`, `imports`, `tools`, `mounts`, `ownership`, `rules`, `structure`, `findings`; `index.js` exports `analyze({ root })`. `run.js` runs it from the command line: `node server/services/codeMap/run.js [out.json]`.
- `server/services/codeMap/jobs.js` + `worker.js`: runs are background jobs. The analysis (about 2 seconds of solid work) runs in a worker thread so other requests are not held up.
- `server/routes/codeMap.js`: `/api/code-map`, mounted with `requireAdmin` and no `aiLimiter` (no model calls). `POST /runs` starts a run, `GET /runs` lists them, `GET /runs/latest` is the newest finished one, `GET /runs/:id` is polled while a run is going. `GET /compare?from=<id>&to=<id>` compares two finished runs (400 for bad ids or unfinished runs, 404 when one is gone).
- `server/services/codeMap/compare.js`: the drift between two run results (pure). See "Changes between runs" below.
- `server/cron/codeMapCron.js`: the weekly run, Sunday 03:17 Australia/Brisbane.
- Table `code_map_runs` (`server/db.js`): one row per run, the whole result as JSONB (about 115 KB). The last 30 are kept.
- `client/src/pages/CodeMapPage.jsx` and `client/src/pages/codeMap/`: the page. Tour: `client/src/utils/tours/codeMapTour.js`.
- `client/src/pages/codeMap/exportRun.mjs`: export. Pure functions that turn the stored run into Markdown or CSV; the buttons are `ExportButton` in `shared.jsx` (with `copyText` and `download`, also used by the Context tab). Everything is built in the browser from the run the page already has, so there is no API call. Where the buttons are:
  - Header: **Download .md** (the whole run: summary, findings, tools table, rules, structure, every tool in detail; about 200K characters) and **Download .json** (the run exactly as stored).
  - Overview: **Copy findings** (every finding with its tools and evidence; the evidence is capped as on the page).
  - Tools: **Download CSV** of the tools shown after the filter and group. Conventions: **Download CSV** of the grid (one column per rule).
  - Structure: **Copy structure**. Tool panel: **Copy tool** (rules, evidence, mounts, owned files, tests).
  - Not covered: Changes and the dependency map have no export yet; the Context tab has its own.

Tests, run with node:

```
node server/services/codeMap/codeMap.test.js
node server/services/codeMap/codeMap.accuracy.test.js
node server/services/codeMap/jobs.test.js
node server/routes/codeMap.test.js
node server/services/codeMap/compare.test.js
node server/cron/codeMapCron.test.js
node server/services/codeMap/explain.test.js
node server/services/codeMapTutor.test.js
node server/services/codeMap/briefing/buildBriefing.test.js
node client/src/pages/codeMap/exportRun.test.mjs
node server/services/codeMap/aiReview.test.js
node server/services/codeMap/security.test.js
node server/services/codeMap/liveCheck.test.js
```

The accuracy test runs today's analyzer on Vault exactly as it was at commit 40bf883 (read from git into a temp folder, `vault-codemap-40bf8834`, once) and compares it with the Python prototype's output from that commit. The input never changes, so new Vault code cannot make it drift: any difference it prints means the analyzer itself changed. Explain such a difference; do not tune the analyzer to hit the old numbers. It needs git and the repo history, so it skips (and passes) where there is none.

## How it works out what belongs to which tool

1. The tools are the entries in `client/src/config/appNavigation.js` (plus Tasks and Chat), joined to their page component through `App.jsx`.
2. Client code: everything reachable by imports from the tool's page. Server code: everything reachable from the route files of the tool's own API mounts in `server/index.js`. A mount belongs to the tool whose page path or feature flag matches it.
3. A file reached by three or more tools is **shared**: it belongs to none of them, and the rules do not check it for any tool. The rest is **owned** by the tools that reach it.
4. Test files count for a tool when they import its owned code.
5. **Embedded apps.** DocCompare, the cellar, room and garden planners and Route Tracer are separate apps shown in an iframe. Their `src/` and `tests/` folders (TypeScript included) are read too, and every file in them is owned by that tool (`EMBEDDED_APPS` in `files.js`). The apiClient, icons and modals rules (`vaultOnly`) skip that code, because those apps have their own conventions. `import type` lines are not counted as links, since TypeScript drops them. `planner-core/src/` (code the planners, DocCompare and Vault's client share) is read too, and its `@planner-core/...` imports are followed (`ALIASES` in `files.js`). It belongs to no single tool: each file goes to the tools that import it, shared at three or more like any file (for example the speech recognizer, used by every Vault tool with voice input), and the Vault-only rules skip it.

The import graph is built with regexes and path resolution, not a parser. `require()` and `import` with a literal path are followed; a path built at runtime is not.

## How to read a check

Each cell is one rule for one tool:

- **Green, follows**: the rule's pattern was satisfied.
- **Amber, check**: worth a look, not necessarily wrong.
- **Red, gap**: the rule's pattern was broken.
- **Grey, not applicable**: the rule does not apply to this tool (for example, no AI routes).

A tool's score is the share of the rules that apply to it that it follows, rounded half to even. Open a cell (Conventions tab) or a tool (any tool name) to see the note and the evidence: file and line, with the matching text.

Findings on the Overview are generated from the rules: one finding per rule that has failing or amber tools, plus three structural ones (a cron job that requires a route file, an import cycle across tools, leftover backups and possibly unused files). They are sorted by severity, then by how many tools they touch. Each high finding is also raised in the Suggestions inbox, once per rule and tool (fingerprint `codeMap:<ruleId>:<toolId>`), so a repeat run refreshes the item instead of adding another.

## Changes between runs

The **Changes** tab compares two finished runs, by default the latest and the one before. Git history is not in the deploy, so drift comes from comparing stored runs.

A finding is split into items, so a change shows even when the finding as a whole is still there:

- a rule finding gives one item per tool (matched by rule id and tool id);
- an import cycle across tools is matched by its set of files, in any order;
- a cron requiring a route file is matched by the cron file and the path it requires, not the line, so moving the line is not a change;
- housekeeping gives one item per backup or possibly unused file (from the full lists, not the capped evidence).

It shows new items (in the newer run only, high first), resolved items, items that moved from amber to red ("got worse") or back, each tool's score movement (biggest drop first), tools added or removed, and import cycles gained or lost (all cycles, not only cross-tool ones). The summary numbers (tools, lines, tests, gaps, findings, cycles) are shown as differences.

Renaming a tool's id or a rule's id makes its items look resolved and new at once. A change to a rule (a new rule, a tighter regex) shows up as drift too, so note rule changes in the changelog.

**Security** (added 2026-11-20, `compareSecurity` in `compare.js`, returned as `security` by `/compare`): a section at the bottom of the tab, and a count in the summary line. It compares the Security tab's code checks only (the live site check and the AI security review are not part of a run):

- each check's **status** (gap, check, for review, passes): checks that got worse first (high first), then better; a check new in the newer run counts as changed from "not in the older run";
- each check's **lines**, matched by check, file and text, not line number, so moving code is not a change: lines found only in the newer run ("new lines found") and only in the older one ("lines no longer found"), high-severity checks first;
- a check whose stored lines hit the cap (`MAX_ITEMS`, 50) in either run is compared **partly**, and the section lists it;
- a run made before the Security tab has no checks, so the section says "Not compared" and which run is the older one.

Changing a check's pattern or note shows up as drift too (a tighter pattern makes lines "no longer found").

## Explain and plan a fix

A button under each finding on the Overview (with a tool picker when the finding names several tools). It calls `POST /api/code-map/findings/explain` with `{ runId, ruleId, toolId, findingId }`, the only Code Map route behind `aiLimiter` (set on the route in `server/routes/codeMap.js`, since the mount has none). `server/services/codeMap/explain.js`:

- Reads the finding from the stored run: for a rule finding, that tool's check (note and full evidence); for a structural finding, its evidence.
- Reads excerpts from disk around each evidence line: up to 200 lines per location (100 either side, or the first 200 lines when the evidence has no line), overlapping windows merged, at most 8 files and 800 lines in all.
- **Only paths inside `server/` and `client/src/` are read.** Absolute paths, `..`, backslashes, other folders, `node_modules`, `.env*`, and anything whose real path (after symlinks) is outside those folders are refused and listed as "not read". The model never sees a file that is not in the finding's evidence.
- Asks `getModelsForUser(userId).standard` through `callModel` (no hardcoded model id; 503 "No AI model is set up" when there is none), logs usage as `code_map_explain`.
- The prompt asks for a short explanation and a step-by-step fix citing file:line, to say "I could not tell" rather than guess, and to say so when the finding looks like a false positive. The answer is treated as untrusted JSON: references that do not point into an excerpt it was shown are dropped (the page says how many).
- Code excerpts go to the model provider set in Settings. Nothing is stored and no code is changed.

Test: `node server/services/codeMap/explain.test.js` (path restriction, grounding, model resolution).

## Security

The **Security** tab: eleven pattern checks for common security mistakes, in `server/services/codeMap/security.js` (a stage of `analyze`, after the rules because it reuses each tool's SSRF check). Free like the rest of the analysis, so it runs with every run, including the weekly one, and is stored in the run result as `security: { checks, counts }`. This is layer 1 of the security review agreed on 2026-11-20; layer 3 (the live site checks) and layer 2 (the AI security review) are below.

Each check returns a status: **gap** (fail), **check** (warn), **for review** (info, a list to keep an eye on) or **passes**, a note, its why and fix, and up to 50 items (file, line, text, owning tool) with the full count.

| Check | Severity | Looks for | Does not see |
| --- | --- | --- | --- |
| Every route is in the access list | high | `router.<method>('<path>')` in a mount's route file, joined to its mount, missing from `server/testing/routeManifest.json` | routers built by a factory or taken off a module (`require(...).helperRouter`): about 300 manifest routes are not found this way, so the check only reports routes in the code that are missing from the list, never the reverse |
| Public routes (no sign-in) | medium (info) | manifest entries with class `public` | |
| Request values pasted into SQL | high | `${...req.body/query/params...}` inside a template string holding SQL; a `cond ? 'A' : 'B'` choice of fixed text is allowed | a request value copied into a variable first |
| Routes by id with no per-user check | medium (warn) | route files with a `:param` route that never mention `userId`, `req.user`, `ownerId` or `accountantOf` | whether each query really filters by user |
| Secrets written in the code | high | Anthropic, OpenAI, Google, GitHub, AWS and Slack key shapes and private-key headers; values with SECRET/FAKE/TEST/EXAMPLE/DUMMY/do-not in them count as made-up | `.env` files and anything outside `server/` and `client/src/` |
| Running code or shell commands from strings | high | `eval(` / `new Function(` anywhere; `exec(`/`execSync(` with a template string, or `shell: true`, in server files that load `child_process` | |
| File paths built from request values | medium | `path.join/resolve`, `fs.*`, `sendFile`, `res.download` with a request value, unless the same file tests that value against a pattern (`/^\d+$/.test(req.params.x)`) | validation in another file |
| Raw HTML put into the page | medium | `dangerouslySetInnerHTML` in client files that do not mention DOMPurify or sanitize | |
| Sign-in routes are rate-limited | high | `router.post` routes in `server/routes/auth.js` named login / register / reset / forgot / password / verify / mfa without a limiter on the line; a route whose next line answers 403 (closed) is skipped | |
| Security headers and CORS | medium | `helmet(` missing, `contentSecurityPolicy: false`, or `cors()` / `origin: '*'` / `origin: true` in `server/index.js` | headers actually sent by the live site |
| Web addresses fetched safely (SSRF) | high | the tools' SSRF guard rule results, gathered in one place | |

**Secret values are never stored**: a matched key is cut to its first six characters plus "(hidden)" before it goes into the run, the export or the inbox. **Inbox**: a failing high check is raised once per check (fingerprint `codeMap:security:<check id>:all`; `jobs.js` `inboxItems`). The Changes tab compares the checks between runs (see "Changes between runs"). The test file builds its fake keys at run time so the real scan never flags it.

First run on 2026-11-20: no gaps; 2 to check (three route files that serve shared or token-based data, two `dangerouslySetInnerHTML` uses for generated SVG); 30 public routes listed.

Page: `client/src/pages/codeMap/SecurityView.jsx` (tiles, one card per check, gaps first, Copy security via `securityMd` in `exportRun.mjs`; the full-run download includes it). **Adding a check**: one entry in `CHECKS` in `security.js` with `run({ files, tools, mounts, manifest })` returning `{ status, note, items }`, plus a case in `security.test.js`.

### Live site checks (layer 3)

Under the code checks on the Security tab: **Check the live site** tests the running site instead of the code. `server/services/codeMap/liveCheck.js`, `POST /api/code-map/live-checks` (runs in the request, about 5 seconds; one at a time, 409 otherwise) and `GET /api/code-map/live-checks/latest`. From the button, and **weekly after the Sunday analysis** (see "Weekly run"); no AI, no cost. Table `code_map_live_checks` keeps the last 10 (deleted outright). A failing high check goes to the inbox once per check (fingerprint `codeMap:live:<check id>`).

**The address** is `getAppUrl(req)` (`APP_URL`, else the request's own host), never anything from the request body, so it cannot be pointed at another site. **The requests**, with `redirect: 'manual'` and a 10-second timeout each: GET `/` (headers), GET `http://<host>/` (the redirect), a TLS connection for the certificate date, GET `/api/health` with `Origin: https://code-map-check.invalid` (CORS), up to 10 GET routes from `routeManifest.json` with class `admin` or `authed` and no `:param` (half each, spread through the list), each once with no token and once with `Bearer 000…` (64 zeros), every public GET route with no `:param`, and one POST with a broken JSON body to `/api/code-map-live-check-probe` (a path that does not exist; the JSON parser rejects it before any route). Nothing is changed.

| Check | Severity | Passes when |
| --- | --- | --- |
| The site answers | high | `/` answers below 500 (otherwise the rest is skipped) |
| HTTPS only | high | `http://` answers 3xx to an `https://` address |
| Certificate not about to expire | high | 21 days or more left (warn under 21, fail under 7) |
| HSTS | medium | `Strict-Transport-Security` with max-age of at least 180 days |
| Content Security Policy | medium | a policy is sent and `script-src` (or `default-src`) has no `'unsafe-inline'` / `'unsafe-eval'` |
| nosniff | low | `X-Content-Type-Options: nosniff` |
| Cannot be framed | medium | `frame-ancestors 'self'`/`'none'` or `X-Frame-Options` DENY / SAMEORIGIN |
| Referrer-Policy | low | the header is sent |
| No X-Powered-By | low | the header is absent |
| CORS | high | `/api/health` does not answer the foreign origin with `Access-Control-Allow-Origin` `*` or that origin |
| Protected routes refuse anonymous requests | high | every sampled route answers 401 or 403 to both requests |
| Public routes answer without errors | low | none answers 5xx or fails to answer |
| Errors do not show code details | medium | the broken body's answer has no stack line, `node_modules`, `SyntaxError:` or `file.js:1:2` |

On a local `http://localhost` address, HTTPS, the certificate and HSTS are **not applicable**, and so is the policy when it is missing (helmet sends it only when `NODE_ENV=production`). Run locally in development, the broken-body check can fail because Express shows stack traces outside production.

First run against production (https://curam-vault.up.railway.app, 2026-11-20, from a developer machine): all 13 pass; certificate 36 days left; HSTS max-age 15552000.

**Cannot check**: that an admin route refuses a signed-in non-admin (it has no such login; `crossUser.test.js` covers it), routes with an id, POST/PUT/DELETE routes, cookies (Vault signs in with a bearer token), or anything behind a sign-in. Export: Copy live checks (`liveMd` in `exportRun.mjs`). Test: `node server/services/codeMap/liveCheck.test.js` (a fake site; safe-request guarantees: only GETs plus the probe, redirects not followed, no `:id` routes).

### AI security review (layer 2)

The last part of the Security tab: **Run AI security review**. The standard model reads every route file and reports concrete problems the pattern checks cannot judge. It is a second **kind** of the AI review engine in `server/services/codeMap/aiReview.js` (`KINDS.security`; the AI review tab is `plainCode`), so it shares the job runner, the table (`code_map_ai_reviews`, column `kind`), reuse of unchanged files, progress polling and the routes (`?kind=security` on `/api/code-map/ai-reviews`, `/estimate`, `/latest`; `POST` behind aiLimiter). **Only one AI review runs at a time across both kinds** (one running row, partial unique index); a 409 carries `runningKind` so each tab only follows its own. Button only, no cron. The last 10 of each kind are kept.

- **What it reads**: every file under `server/routes/` except tests (173 files, about 52,000 lines on 2026-11-20), in parts of 500 lines (`SEC_CHUNK`), so about 230 model calls and roughly 630,000 tokens of code for a first full run. Later parts carry the file's first 40 lines (requires, helpers). It does **not** read the services a route calls, so a check done in a helper is invisible: the prompt asks for confidence "low" in that case.
- **Context given**: how the file is mounted in `server/index.js` (`mountNote`: public before the sign-in check or behind it, admin only, feature flag, AI rate limit; for a module with several routers, which export is mounted), and Vault's rules (requireAuth, requireAdmin, `"userId"` ownership, `$1` parameters, safeFetch, multer).
- **What it reports**: `{ line, severity, category, title, why, fix, confidence }` per finding, categories access / injection / ssrf / upload / xss / secrets / validation / other. Checked as untrusted: the line must be inside the part reviewed, unknown values fall back to low / other, the code line shown comes from the file (not the model), at most 20 per part; an unreadable answer fails that file (tried again next run).
- **Inbox**: severity high **and** confidence high, once per finding (fingerprint `codeMapAiSec:<file>:<hash of title and code line>`, category alert).
- **Cost**: shown before running (model calls and characters / 4 of the changed files). Usage logs it as `code_map_ai_security`; the row stores tokens and an approximate cost.
- **Page**: `client/src/pages/codeMap/AiSecurityReview.jsx`, using `useReviewJob('security')` (shared with the AI review tab). Severity filter, cards (severity, category, confidence, tool, file:line, title, why, fix), Copy findings and Download CSV (`aiSecurityMd` / `aiSecurityCsv`).
- **Limits**: a model's reading of part of a file, so expect some false positives and misses; read the code before changing it. Not run against a real model yet (2026-11-20).

Test: `node server/services/codeMap/aiReview.test.js` (route-file chunking, the prompt and mount note, finding checks, the job with kind security and the shared one-at-a-time slot).

## AI review (where plain code would beat a model call)

The **AI review** tab. For every place the server calls a model, the workspace's standard model judges whether a deterministic approach (regex, parsing, a lookup, arithmetic, fixed rules, a template) would do the job as well or better. **It runs only when an admin presses Run review; there is no cron**, by the owner's decision (2026-11-20). Unlike the analysis it costs model calls, so the button first shows an inline confirm with the number of calls.

- `server/services/codeMap/aiReview.js`. **Call sites**: lines in `server/` (tests, comments and `callModel.js` itself left out) matching `callModel(`, `.messages.create(` / `.messages.stream(`, or `.generateContent(` / `.generateContentStream(`. Plain text search, so a call made some other way is missed (113 sites in 65 files on 2026-11-20). Each site is tagged with the tool that owns its file in the latest analysis run (`shared` or none otherwise).
- **One model call per 4 sites of a file**, with excerpts read through `explain.js` `gatherExcerpts` (up to 200 lines around each site, 800 per call, `server/` and `client/src/` only). The prompt asks for `replace`, `hybrid`, `keep` or `unclear` per line, with confidence, what the call does, why, the alternative and the likely saving. The answer is untrusted JSON: verdicts are matched to the real lines, unknown lines and refs outside the excerpts are dropped, and a missing line becomes `unclear`.
- **Reuse**: a file whose content (and the prompt version, `PROMPT_VERSION`) is unchanged since the last finished review keeps that review's verdicts with no model call. A file whose call failed is recorded with its error and tried again next time; the review only fails as a whole when every call failed.
- **Job**: one review at a time (in memory, and a partial unique index on `code_map_ai_reviews`), three files at a time, progress "File x of y" polled by the page every 3 seconds. A restart marks a running review failed (`server/db.js`). The last 10 are kept and older ones deleted outright. Token totals and an approximate cost (`costCalculator.calculateCost`) are stored on the row; each call is logged in Usage as `code_map_ai_review`.
- **Inbox**: each `replace` verdict with high confidence is raised once per call site (fingerprint `codeMapAi:<file>:<hash of the call line>`, so moving the line does not raise it again).
- **Routes** (behind the mount's `requireAdmin`): `GET /ai-reviews/estimate` (sites, files, files changed, model calls a run would make; reads the source, no model), `POST /ai-reviews` (**aiLimiter**; 202 with the id, 409 with `runningId` while one runs, 503 with no model), `GET /ai-reviews`, `GET /ai-reviews/latest`, `GET /ai-reviews/:id`.
- **Page**: `client/src/pages/codeMap/AiReviewView.jsx`. Works before any analysis run. Last-run line (date, model, sites, model calls, files reused, tokens, cost), verdict filter, one card per site (file:line, what it does, why, instead), Copy review (Markdown) and Download CSV (`aiReviewMd` / `aiReviewCsv` in `exportRun.mjs`).
- **Limits**: verdicts are a model's reading of the code shown, so check them before changing anything. A prompt built in another file often comes back `unclear`. Code excerpts go to the model provider set in Settings.

Test: `node server/services/codeMap/aiReview.test.js` (site search, answer checking, reuse, splitting, the job with a fake database and model).

## Context (a briefing for Claude)

The **Context** tab makes a briefing about how Vault is built, to start a conversation in the Claude app (not Claude Code) that has no memory of Vault, usually before designing the next tool. **Build briefing** produces one snapshot shown two ways: a report on the page (tiles, tool table with status pills, findings with severity stripes, services, recent direction) and Markdown for Claude, wrapped in `<vault_briefing>`, with **Copy for Claude**, **Download .md** and its size (characters, and tokens estimated as characters / 4). It makes no model call and needs a finished run (before one, the card says "Run analysis first"; CLAUDE.md and the notes still work).

Code: `server/services/codeMap/briefing/` — `buildBriefing.js` (pure: snapshot in, `{ markdown, sections, stats }` out), `snapshot.js` (gathers the inputs), `sources.js` (the curated files and the hash check), `index.js` (store, notes, CLAUDE.md and docs). Routes in `server/routes/codeMap.js`, all behind the mount's `requireAdmin`, no `aiLimiter`: `POST /briefings` builds and stores one (a POST, not a GET, because it writes), `GET /briefings` (the last 10), `GET /briefings/:id`, `GET`/`PUT /briefing/notes`, and the docs routes below. Table `code_map_briefings` keeps the last 10 per admin; older ones are deleted outright (rebuilt in seconds, so no recycle bin). Page: `client/src/pages/codeMap/ContextView.jsx`.

**What goes in**, in this order: 0 how to use it (date in Brisbane time, commit or "unknown"), 1 about Vault (`about.md`), 2 architecture and the run's counts, 3 the rules every tool follows (`rules.md`), 4 building blocks (`building-blocks.md`) and the names of the installed packages, 5 every tool (name, group, ga / preview / parked / admin, purpose, lines, tests, score, linked tools), 6 outside services as YES / NO with what each is for, 7 the top 10 findings, import cycles, hotspots (always "not available" on Railway: no git history) and the largest files, 8 the changelog's last 30 days (date, area, subject) and open concerns (any age, not "None noted.", 300 characters each, at most 40), 9 a 30-day Ponytail summary (skipped if there is none), 10 the owner's notes, 11 how to write the agreed design up as a Claude Code brief. A tool's purpose is its line in `tool-purposes.md`, else the descriptive sentences of the first prose lines of its doc (paths, routes and flags dropped), else its menu name; add a line there for a new tool. Over about 60,000 characters, section 5 becomes one line per tool and section 8 the last 14 days, and the top says so.

**What never goes in:** what is in Vault. No client names, contacts, amounts, note or email contents, task titles, file contents or secret values. The builder only reads named fields (tool names, sizes, scores, finding titles, changelog dates, areas, subjects and concerns, package names, Ponytail totals). Outside services are checked with `Boolean(process.env[name])`, so no value is ever copied (`snapshot.js` `SERVICES` lists the variable names; a test checks each is documented in `docs/env-vars.md` or read by server code). The one free text is your own notes. The test builds a briefing from fixture data holding a client name, an amount and an env value in the fields it must ignore, and checks none of them appear.

**Owner notes** ("Your notes for Claude") are saved per admin in the `settings` table, key `code_map_briefing_notes`, up to 20,000 characters. Building a briefing saves unsaved notes first.

**Refreshing rules.md when CLAUDE.md changes.** `rules.md` starts with a comment holding the SHA-256 of `CLAUDE.md` and `docs/core-conventions.md` as they were when it was written (line endings normalised, so Windows and Railway agree). When either file changes, the tab shows "The rules summary may be out of date" and `buildBriefing.test.js` fails, printing the new first line. Re-read the change, update the numbered rules if a rule changed, and replace the first line with the one the test prints. The same applies to `building-blocks.md` when a shared module moves: the test fails on any path that no longer exists.

**Using it in Claude.** Paste the copied briefing as the first message of a new conversation, then describe what you want to build. For repeated work, make a Claude Project and add the downloaded `.md` as Project knowledge (rebuild and replace it after big changes). Section 11 asks Claude to write the agreed design as a brief for Claude Code. The **CLAUDE.md** part at the bottom shows CLAUDE.md read-only and copies it, with the ticked docs, as one block, for when Claude needs the full rules rather than the summary.

**Docs to include** (`server/services/codeMap/briefing/docs.js`). CLAUDE.md is always in the copy. The checkboxes above it:

- **Always included (you can untick):** `DEFAULT_BRIEFING_DOCS` in `briefing/sources.js`: `client/DESIGN.md`, `docs/hardening.md`, `docs/guide-chat.md`. A test fails if one of them stops existing. The default copy is about 19,000 tokens (CLAUDE.md, the three docs and the not-included list). `docs/video-tools.md` was a default until 2026-11-19 and is now optional (about 20,000 tokens, mostly ffmpeg detail; its conventions are already in CLAUDE.md, DESIGN.md and guide-chat.md), marked "tick only for a media-heavy tool or one with background jobs". An admin who saved their own ticks keeps them until **Reset to defaults**.
- **Optional:** the docs CLAUDE.md links to, then `EXTRA_BRIEFING_DOCS` (exact paths outside `docs/`: `ROADMAP.md`, `BACKUP.md`, `planner-core/README.md`, `room-planner/README.md`; an allow-listed path that does not exist is skipped and named on the page), and **Other docs** for the rest of `docs/*.md`. `docs/finance.md` is marked "holds real business figures". Docs with a note are shown in Optional, not hidden under Other docs. Weak first sentences are replaced by written lines in `docs.js` `DOC_SUMMARIES` (for docs that are not a tool; tool docs use `tool-purposes.md`).
- Each shows its size (characters and ~tokens = characters / 4). A path is read only if it is relative, has no `..`, backslash or drive, and its real path is a file inside the repo (the same rules as Explain and plan a fix).
- The ticks are saved per admin in `settings` key `code_map_briefing_docs` (a JSON list); **Reset to defaults** deletes the key. Routes: `GET /briefing/claude-md` (CLAUDE.md, the docs on offer, the ticked paths), `PUT /briefing/docs`, `DELETE /briefing/docs`, `POST /briefing/docs-copy` (the block is built on the server from the allow-list, never from a path the page sends unchecked).
- **Both outputs end with "## Docs not included in this copy":** one line per unticked doc (path, ~tokens, and one sentence: a written line in `docs.js` `DOC_SUMMARIES`, else the tool's line in `tool-purposes.md`, else the doc's first real prose sentence), then "If the work needs any of these, ask me to include them next time." It is a list only; no doc's contents. In the briefing the list follows section 11 and says which docs come in the separate CLAUDE.md copy; it does not count towards the 60,000-character limit, so it never trims the tool table (about 3,000 tokens for ~90 docs).

## Knowledge graph (Understand-Anything)

The **Knowledge graph** tab shows the graph [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (MIT, a Claude Code plugin) makes of the code: files, functions, classes and more, each with an AI-written summary, plus layers and a guided tour. **Vault never makes or updates it.** The owner does, on their own machine:

1. `/plugin marketplace add Egonex-AI/Understand-Anything`, then `/plugin install understand-anything` (once).
2. In `vault/`: `/understand`. It uses model calls on the owner's Claude plan; later runs only re-read changed files.
3. Commit `.ua/` (`.gitignore` leaves out `.ua/intermediate/` and `.ua/diff-overlay.json`) and push.

- **Server:** `server/services/codeMap/knowledgeGraph.js` reads `.ua/knowledge-graph.json` (or the older `.understand-anything/knowledge-graph.json`), drops nodes without an id and edges to nodes that are not in the file, and sorts the tour. Files over 30 MB and broken JSON are a 422 with a message for the admin. `GET /api/code-map/knowledge-graph` → `{ graph }`, or `{ graph: null }` when nothing is committed. No model calls, no database, no network. Test: `node server/services/codeMap/knowledgeGraph.test.js`.
- **Client:** `client/src/pages/codeMap/KnowledgeGraphView.jsx` (lazy, `react-force-graph-2d` like the Dependency map). Colour = kind of node, size = complexity. Functions and classes start hidden because there can be thousands of them. Filter by layer, Find by name or path, click a node for its detail and links, or pick a tour step to light up its nodes.
- **Shape:** `KnowledgeGraph` in that repo's `understand-anything-plugin/packages/core/src/types.ts` (`project`, `nodes`, `edges`, `layers`, `tour`). It is not a published schema, so a new upstream version can change it; the loader only needs `nodes[].id` and `edges[].source/target`.
- **Gotcha:** the graph shows the code as of the commit in `project.gitCommitHash`, not as deployed now. The page shows that commit; run `/understand` again after big changes.

## Guide chat

The round button at the bottom right is the Code Map guide (`guideId` `code-map`, `POST /api/code-map-tutor`, `requireAdmin` and `aiLimiter`, `server/services/codeMapTutor.js` on `guideCore.js`, `server/routes/codeMapTutor.js` on `guideRouter.js`, wrapper `client/src/pages/codeMap/CodeMapTutorChat.jsx`). It explains how to read the page and what each rule means, and its Open buttons switch tab and scroll to the part. It sees no code, run, finding or score. `client/src/pages/codeMap/codeMapTools.mjs` is the list the page and the guide share (the tabs, their tips, the (i) box text and the controls the guide can point at); `node server/services/codeMapTutor.test.js` fails if it and the catalogue drift, or if a rule in `rules.js` is not explained in the guide's RULES. When a tab, control or rule changes, update `codeMapTools.mjs`, `CATALOG` and `RULES` together.

## Weekly run

`server/cron/codeMapCron.js` runs the analysis every Sunday at 03:17 Brisbane as the first admin, through the same job as the button, inside `withCronLock('codeMap', ...)` held until the run ends. It skips the week if a run is already going. New high findings reach the inbox through the job, as for a manual run; findings already in the inbox are refreshed, not raised again. It reads only Vault's own files and calls nothing outside, so it runs on every server (it is not behind `DISABLE_EXTERNAL_CRON`). Each weekly run counts towards the 30 kept, so about seven months of weekly history are kept if nobody runs it by hand.

**Then the live site check** (added 2026-11-20), as the same admin, inside the same lock: the Security tab's Check the live site against `APP_URL`, so a removed header or a route left open shows up within a week; failing high checks reach the inbox through the check. It is **skipped** when `APP_URL` is not set (a cron has no request to take the address from) or is a local address (`localhost`, `127.x.x.x`, `[::1]`: a dev machine would report its own server as down). It runs even when the weekly analysis was skipped because one was already going. Neither part's failure stops the other: a failed live check is logged and recorded in the result as `live: { error }`; a failed analysis is still thrown for the scheduler to log, after the live check has run (`err.live`). Its requests go to this app's own public address only. Each weekly check counts towards the 10 live checks kept (about ten weeks of history).

## The 14 rules

| Rule | Severity | Passes when |
|---|---|---|
| Feature flag parity | high | The tool's flag is in both featureAccess.js lists with the same default |
| Lifecycle entry | medium | A flag that ships off has the same FEATURE_LIFECYCLE value on both sides |
| AI rate limit | high | Each mount whose route file calls a model has aiLimiter (at the mount or in the file); admin mounts are skipped |
| No hardcoded model ids | high | No quoted claude-, gemini-, gpt- or deepseek- id in owned code (pricing tables, models.js and tests are allowed) |
| Model resolver | medium | Owned server code that calls a model also uses getModelsForUser or a resolver |
| apiClient | medium | No raw `fetch('/api...')` in owned client code |
| SSRF guard | high | No owned server file fetches a URL taken from the request without safeFetch, htmlFetch or checkSsrf |
| Tests | medium | At least one test file covers its code (two if it is over 3,000 lines) |
| Guide chat | low | It calls a tutor endpoint listed in server/config/guides.js (admin-only pages are not applicable) |
| Docs | low | docs/<tool>.md exists (or the name in DOC_ALIAS) |
| Recycle bin | low | Its own delete routes use moveToBin |
| getIcon | low | No direct lucide-react import |
| Shared Dialog | low | No hand-written `fixed inset-0` overlay |
| Logger | low | Five or fewer console.* calls in owned server code |

## Known false positives

The checks are pattern matches, so they can be wrong both ways. The ones seen so far:

- **Shared Dialog** flags any line containing `fixed inset-0`, including `Dialog raw` overlays (which do use the shared Dialog) and deliberate full-screen modes. Code Map's own tool panel is one of these.
- **SSRF guard** works per file: a file that validates the URL another way, or only fetches a fixed host built from a request field, is still amber. The evidence has no line number.
- **AI rate limit** decides "calls a model" from the route file's text, so a route that only mentions a helper such as callModel in a branch it never reaches still counts. A limiter added in a sub-router in another file is not seen.
- **No hardcoded model ids** also matches ids in comments and in lists of defaults offered in the settings UI.
- **Recycle bin** is amber for deletes of trivial records (sessions, cache rows, links) where the bin is not wanted. Record the reason in the tool's doc.
- **Tests** only counts tests that import the tool's owned code. A tool tested through shared modules, or by an end-to-end harness, can show a gap.
- **Logger** counts console.* in comments and strings too.
- **Possibly unused** files can be loaded by a path built at runtime (`require(path.join(...))`, a registry of names). Check before deleting.
- **Ownership**: a problem in a shared file (three or more tools) is not charged to any tool.

## Adding a rule

Add one entry to `RULES` in `server/services/codeMap/rules.js`:

```js
{
  id: 'myRule',              // stable: the inbox fingerprint and stored runs use it
  label: 'Short name',       // column header and finding title
  severity: 'medium',        // high | medium | low; high findings go to the inbox
  area: 'Conventions',
  why: 'One sentence on what goes wrong without it.',
  fix: 'One sentence on what to do.',
  test(t, ctx) {             // t: the tool (ownedServer, ownedClient, mounts, tests, apiCalls ...); ctx.files: path -> source
    return check('pass', 'What was found.', [{ file, line, text }]);
  },
},
```

`check(status, note, evidence)` takes `pass`, `warn`, `fail` or `na`. `linesMatching(files, list, regex)` returns evidence lines. The new rule appears as a column, a dot on each card, a row in each tool panel and, when it finds something, a finding, with no page change. Add a passing and a failing case to `codeMap.test.js` (the fixture repo is in `__fixtures__/repo/`). The accuracy test's per-tool scores will move; that is expected.

## Why runs skip the recycle bin

Older runs are deleted outright once there are more than 30. They are analysis output that can be made again in seconds, not user content, so the 30-day recycle bin (`docs/recycle-bin.md`) would only hold copies nobody needs.

## Gotchas

- One run at a time across the workspace: checked in the job and by a partial unique index, so two clicks at once cannot start two.
- A restart marks a queued or running run as failed ("Stopped by a restart"). Only runs created before this boot's schema setup are touched, because the server answers requests before setup finishes.
- The current stage of a run is kept in memory, not in the table, so it is only known to the server process running it.
- The commit hint comes from `RAILWAY_GIT_COMMIT_SHA`; locally it is empty.
- Hotspots (big files that change often) need git history, which is not in the deploy. The panel stays empty. Churn from the GitHub API was an optional part of the brief's milestone 5 and has not been built (it would need a GITHUB_TOKEN and safeFetch).
- The Dependency map loads `react-force-graph-2d` only when its tab is opened.
