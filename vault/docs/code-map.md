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
```

The accuracy test compares the analyzer with the Python prototype's output at commit 40bf883. It leaves out the Code Map's own files and blanks its single lines in shared files, so it keeps comparing like with like. As Vault changes, the differences it prints grow on purpose: read and explain them; do not tune the analyzer to hit the old numbers.

## How it works out what belongs to which tool

1. The tools are the entries in `client/src/config/appNavigation.js` (plus Tasks and Chat), joined to their page component through `App.jsx`.
2. Client code: everything reachable by imports from the tool's page. Server code: everything reachable from the route files of the tool's own API mounts in `server/index.js`. A mount belongs to the tool whose page path or feature flag matches it.
3. A file reached by three or more tools is **shared**: it belongs to none of them, and the rules do not check it for any tool. The rest is **owned** by the tools that reach it.
4. Test files count for a tool when they import its owned code.

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

## Explain and plan a fix

A button under each finding on the Overview (with a tool picker when the finding names several tools). It calls `POST /api/code-map/findings/explain` with `{ runId, ruleId, toolId, findingId }`, the only Code Map route behind `aiLimiter` (set on the route in `server/routes/codeMap.js`, since the mount has none). `server/services/codeMap/explain.js`:

- Reads the finding from the stored run: for a rule finding, that tool's check (note and full evidence); for a structural finding, its evidence.
- Reads excerpts from disk around each evidence line: up to 200 lines per location (100 either side, or the first 200 lines when the evidence has no line), overlapping windows merged, at most 8 files and 800 lines in all.
- **Only paths inside `server/` and `client/src/` are read.** Absolute paths, `..`, backslashes, other folders, `node_modules`, `.env*`, and anything whose real path (after symlinks) is outside those folders are refused and listed as "not read". The model never sees a file that is not in the finding's evidence.
- Asks `getModelsForUser(userId).standard` through `callModel` (no hardcoded model id; 503 "No AI model is set up" when there is none), logs usage as `code_map_explain`.
- The prompt asks for a short explanation and a step-by-step fix citing file:line, to say "I could not tell" rather than guess, and to say so when the finding looks like a false positive. The answer is treated as untrusted JSON: references that do not point into an excerpt it was shown are dropped (the page says how many).
- Code excerpts go to the model provider set in Settings. Nothing is stored and no code is changed.

Test: `node server/services/codeMap/explain.test.js` (path restriction, grounding, model resolution).

## Guide chat

The round button at the bottom right is the Code Map guide (`guideId` `code-map`, `POST /api/code-map-tutor`, `requireAdmin` and `aiLimiter`, `server/services/codeMapTutor.js` on `guideCore.js`, `server/routes/codeMapTutor.js` on `guideRouter.js`, wrapper `client/src/pages/codeMap/CodeMapTutorChat.jsx`). It explains how to read the page and what each rule means, and its Open buttons switch tab and scroll to the part. It sees no code, run, finding or score. `client/src/pages/codeMap/codeMapTools.mjs` is the list the page and the guide share (the tabs, their tips, the (i) box text and the controls the guide can point at); `node server/services/codeMapTutor.test.js` fails if it and the catalogue drift, or if a rule in `rules.js` is not explained in the guide's RULES. When a tab, control or rule changes, update `codeMapTools.mjs`, `CATALOG` and `RULES` together.

## Weekly run

`server/cron/codeMapCron.js` runs the analysis every Sunday at 03:17 Brisbane as the first admin, through the same job as the button, inside `withCronLock('codeMap', ...)` held until the run ends. It skips the week if a run is already going. New high findings reach the inbox through the job, as for a manual run; findings already in the inbox are refreshed, not raised again. It reads only Vault's own files and calls nothing outside, so it runs on every server (it is not behind `DISABLE_EXTERNAL_CRON`). Each weekly run counts towards the 30 kept, so about seven months of weekly history are kept if nobody runs it by hand.

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
