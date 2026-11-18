# Code Map: build brief for Claude Code

A new admin-only tool in Curam Vault that reads Vault's own source code and shows:

1. Every tool, the code it owns, and how it links to other tools.
2. How each tool follows the rules in `CLAUDE.md`.
3. A ranked list of things to improve, each with file and line evidence.
4. How these change between runs, so drift shows up early.

A working prototype is in `reference/`:

- `prototype.html` is the page.
- `sample-data.json` is its data, taken from `version-7` at commit `40bf883`.
- `analyze.py` and `slim.py` are the Python analysis that produced the data.

**Port the logic to Node. Do not ship Python.**

---

## Decisions already made (do not reopen)

| Topic | Decision | Why |
|---|---|---|
| What it analyses | Vault's own source, read from disk at runtime (`server/`, `client/src/`, `docs/`, the planner folders). `COPY . .` in the `Dockerfile` puts it in the container. | No GitHub token, cloning or network needed. |
| Git history | **Not available at runtime** (`.dockerignore` excludes `.git`). Drift comes from comparing stored runs, not from git. Churn is an optional later step (milestone 5). | Keeps the MVP self-contained. |
| Access | Admin-only, like Changelog and PC Health: `requireAdmin` on the API, `adminOnly: true` in `appNavigation.js`, no feature flag. | It shows file paths and code. |
| Language | Node only, in `server/services/codeMap/`. Regex plus path resolution, like the prototype. **No AST parser and no new npm packages.** | Any `package.json` change forces a 10–15 minute base-image rebuild (`docs/deploy-speed.md`). |
| Graph rendering | `react-force-graph-2d` (already a dependency). Charts with `recharts` (already a dependency). | No new dependencies. |
| Execution | Run as a background job with polling, copying the pattern in `server/services/pdfToHtmlJobs.js` / `youtubeAiJobs.js`. The prototype takes about 3 seconds for 1,964 files, but keep the request handler free of it. | Railway timeouts, consistency with other tools. |
| Storage | Table `code_map_runs` with the result as JSONB. Keep the last 30 runs. | Lets you compare runs. |
| Rules | Declarative: one file `server/services/codeMap/rules.js` lists every check (id, label, severity, test function, explanation). Adding a convention later means adding one entry. | `CLAUDE.md` keeps growing. |
| AI | Optional and last (milestone 5). The analysis itself makes **no model calls**. | Free to run, deterministic, testable. |

---

## How the analysis works (port from `reference/analyze.py`)

**1. Files.** Walk `server/` and `client/src/` for `.js .jsx .mjs .cjs`, skipping `node_modules`, `dist` and `build`. A test file matches `*.test.*`, `*.spec.*` or `__tests__/`.

**2. Import graph.** Use the regex below, keeping only relative specifiers:

```
(?:require\(\s*|import\s*\(\s*|from\s+|import\s+)(['"])(\.{1,2}/[^'"]+)\1
```

Resolve each specifier against the importing file. Try the path as written, then with each extension added, then `/index.<ext>`. Build the `deps` and `importers` maps from the results.

**3. Tools.** Parse `APP_NAV_GROUPS` in `client/src/config/appNavigation.js`; each item gives id, label, path, featureKey and adminOnly. Add **Tasks** (`/tasks`) and **Chat & Projects** (`/chat`), because they are core but not in that list. Skip external links and the User Guide.

**4. Client entry points.** Read `client/src/App.jsx`:
- Match `<Route path=... element=...>` to component names.
- Match component names to files through `import X from` and `lazy(() => import(...))`.
- Detail routes under a tool's path (for example `/clients/:id`) belong to that tool.

**5. Mounts.** Parse each `app.use('/api/...')` in `server/index.js` and record:
- path and line number;
- route modules required on that line (including router objects declared earlier, such as `cellarLiteConfig.staffRouter`);
- `requireFeature(...)` and `requireAnyFeature(...)` keys;
- whether `aiLimiter` and `requireAdmin` appear;
- whether the line comes before `app.use('/api', requireAuth)`, which makes it public.

**6. Mount owner.** Each mount gets one owning tool. See `mount_owner()` in `analyze.py`; the rules are applied in this order:
- the chat-related path segments go to Chat;
- then an explicit extra-segment table (for example `deals` and `cases` go to CRM, `gsc` to Search Console);
- then a path-segment match against the tool's page path or kebab id, with `-tutor` stripped;
- then the feature key.

Keep that table in a small config object so it is easy to correct. Unowned mounts are "platform".

**7. Reach and ownership.**
- **Client reach** is a breadth-first walk of imports from the tool's entry pages.
- **Server reach** is a breadth-first walk of imports from the route modules of the tool's own mounts.
- A file reached by **three or more tools** is shared. Anything else in a tool's reach is owned, and route modules of its own mounts are always owned.
- **API calls** are the `'/api/...'` strings in the tool's owned client files, matched to mounts by longest prefix. A call to another tool's mount is an API link.
- **Tool-to-tool links** are API links plus owned files that two tools share.

**8. Checks per tool.** Each check gives `pass | warn | fail | na`, a one-line note, and up to six `{file, line, text}` evidence items. The full list is in the table below; reuse the regexes from `analyze.py`.

**9. Global structure.**
- Import cycles: strongly connected components larger than one file, found with Tarjan's algorithm. Write it iteratively to avoid deep recursion.
- The 25 largest non-test files.
- The 20 files with the most importers.
- Possibly unused files: no importers, not an entry, script, seed or test file, and the file's stem is not found as a string anywhere else.
- `*_bk.js` backup copies.
- For each folder beside `client` and `server` that has a `package.json`: its file and line counts.

**10. Score.** A tool's score is passes ÷ (all checks that are not `na`), as a percentage.

**11. Findings.** In the prototype these were written by hand. The app must generate them:
- Group failed and warning checks by rule into one finding per rule. The finding lists the tools affected and their combined evidence.
- Add structural findings: cycles that cross two tools, a cron job requiring a route file, hotspots (once drift exists), backups and possibly unused files.
- Each rule in `rules.js` carries its severity (high/medium/low) and an explanation of why it matters and how to fix it, in plain words.
- Sort by severity, then by number of tools affected.

### Checks (`rules.js`)

| id | Label | Fail / warn when | Severity |
|---|---|---|---|
| `flag` | Feature flag parity | The tool's flag is missing from either `server/config/featureAccess.js` or `client/src/utils/featureAccess.js`, or the defaults differ. | high |
| `lifecycle` | Lifecycle entry | The flag defaults to `false` and `FEATURE_LIFECYCLE` is missing or differs between client and server. | medium |
| `rateLimit` | AI rate limit | One of the tool's own mounts leads to a module that calls a model, with neither the mount nor the module using `aiLimiter`. Skip admin mounts. | high |
| `models` | No hardcoded model ids | A model-id regex matches outside `costCalculator`, `pricing`, tests and `client/src/utils/models.js`. | high |
| `modelResolver` | Model resolver | Its own server code calls a model but never refers to `getModelsForUser` or a `*ModelResolver`. | medium |
| `apiClient` | apiClient | Its client code calls `fetch('/api...` directly. | medium |
| `ssrf` | SSRF guard | A URL taken from `req.body` / `req.query` / `req.params` is fetched without `safeFetch` or `htmlFetch`. | high |
| `tests` | Tests | No test file imports any file the tool owns (fail); one test for more than 3,000 lines (warn). | medium |
| `guide` | Guide chat | It never calls a `*-tutor` endpoint listed in `server/config/guides.js`. `na` for admin-only tools. | low |
| `docs` | Docs | No `docs/<kebab-id>.md` or alias. Warn if it is only mentioned in `docs/key-files.md`. | low |
| `recycleBin` | Recycle bin | It has `router.delete(` routes but no `moveToBin` (warn). | low |
| `icons` | getIcon | Its client code imports `lucide-react` directly. Skip `IconProvider` and `IconLibraryGenerator`. | low |
| `modals` | Shared Dialog | A `fixed inset-0` appears outside `Dialog.jsx` (warn). | low |
| `logging` | Logger | More than five `console.*` calls in its own server code (warn). | low |

### Accuracy check

On `version-7` at `40bf883`, the Node port should produce what the prototype did:

| Measure | Prototype result |
|---|---|
| Tools | 60 |
| Mounts | 145 |
| Import cycles | 11 |
| Test files | 404 |

Per-tool scores should be within ±5. Write a test that loads `reference/sample-data.json` (copy it into a fixtures folder) and compares the counts.

---

## Data model (`server/db.js`, idempotent)

```sql
CREATE TABLE IF NOT EXISTS code_map_runs (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- admin who ran it
  status TEXT NOT NULL DEFAULT 'queued',          -- queued | running | done | failed
  "commitHint" TEXT,                               -- RAILWAY_GIT_COMMIT_SHA if set, else null
  summary JSONB,                                   -- tile numbers + counts
  result JSONB,                                    -- full analysis (tools, edges, findings, structure)
  error TEXT,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finishedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_code_map_runs_created ON code_map_runs ("createdAt" DESC);
```

- Keep `result` under about 1 MB. Store owned-file lists, but no file contents.
- Trim to the last 30 runs after each successful run.
- On boot, set any `queued` or `running` row to `failed`, with error "Stopped by a restart". `pdfToHtmlJobs` does the same in `server/db.js`.
- Inject `pool` and `analyze` into the job module so its tests need no database.
- Runs are analysis output, not user content. Delete trimmed runs outright, and say so in the doc so the recycle-bin check is answered on purpose.

## API (`server/routes/codeMap.js`, mounted with `requireAdmin` and **no** `aiLimiter`, since there are no model calls)

Register named routes before `/:id`.

- `POST /api/code-map/runs`: start a job and return `{ id }`. Refuse while another run is `running` (one at a time).
- `GET /api/code-map/runs`: list `{ id, status, createdAt, durationMs, summary }`.
- `GET /api/code-map/runs/latest`: the latest `done` run with its full result.
- `GET /api/code-map/runs/:id`: that run, including status, so the page can poll it.
- `GET /api/code-map/compare?from=:id&to=:id`: drift between two runs (milestone 4).

**Inbox.** After each run, call `SuggestionService.captureIf()` for each **high** finding, with:
- `source: 'codeMap'`
- `category: 'alert'`
- `fingerprint: makeFingerprint('codeMap', '<ruleId>:<toolId>')`

The fingerprint means a finding is not raised again on every run. This answers the "every service that detects a gap must use SuggestionService" rule.

## UI (`client/src/pages/CodeMapPage.jsx` + `client/src/pages/codeMap/*`)

- Read `client/DESIGN.md` first. Use the theme variables, `getIcon`, `Tooltip` on every control, `Skeleton` and `EmptyState`, `Dialog` for modals, and `apiClient` for every call.
- The (i) box and compass tour follow the Video Tools conventions.
- Add it to `appNavigation.js` under Business, next to Changelog, with `adminOnly: true` and the route in `App.jsx`.
- **Header:** when the run happened, how long it took, the commit hint, and a **Run analysis** button. The button starts the job, shows progress through `ProcessingModal` or an inline status, and polls every 1.5 seconds.
- **Views** (tabs, kept in the URL query so links work):
  1. **Overview:** tiles (tools, lines, test files, mounts, cycles, gaps) and the ranked findings. Each finding shows a severity stripe, the tools affected as chips that open the tool detail, and collapsible evidence.
  2. **Tools:** a grid of cards. Each card shows label, group, lifecycle pill, score bar, lines, tests and a row of 14 check dots. Filter by group, search, and sort by score, size or name.
  3. **Conventions:** a table of tools against checks with a sticky header and first column. Clicking a cell shows the note and evidence underneath.
  4. **Dependency map:** `react-force-graph-2d`.
     - Node size is √(lines of code); node colour is the score band.
     - API links are solid lines; shared-code links are dashed.
     - Clicking a node highlights its neighbours; clicking it again opens the detail.
     - A toggle hides tools with no links.
  5. **Structure:** hotspots (after milestone 5), largest files, cycles, shared foundations, separate packages, possibly unused files.
  6. **Changes** (milestone 4): pick two runs. Show new and resolved findings and how each tool's score moved.
- **Tool detail:** a side panel with the 14 rules (note and evidence for each), the APIs it owns (index.js line, aiLimiter, public), linked tools, the biggest files, and collapsible owned client, server and test files.
- `reference/prototype.html` is the layout to match. Restyle it with Vault's design system rather than the prototype's palette.

## Conventions checklist (from `CLAUDE.md`; every milestone)

- **No `package.json` or lockfile edits.** Run tests with `node path/to/file.test.js`.
- One changelog entry per commit in `server/config/changelogEntries.json`, as a second `Changelog:` commit before pushing (`docs/changelog.md`).
- Raw parameterised SQL. Quote camelCase columns. Wrap `COUNT` in `Number()`.
- `getLogger()`, not `console.*`, in new server code.
- The page goes in `appNavigation.js` and nowhere else; then run `npm run test:nav` (an existing script).
- Write `docs/code-map.md`, add an entry in `docs/key-files.md`, and a line in `CLAUDE.md` under "Where things are".
- For the guide chat (milestone 5): an entry in `server/config/guides.js`, the shared `TutorChat`, then `npm run test:guides`.
- Before pushing, run `git diff --stat origin/version-7..HEAD` and report any slow-deploy files.

## Milestones (one Claude Code session each; commit at the end of each)

1. **Analyzer service and tests.** Pure functions and a command-line runner; matches the accuracy check. No routes or UI.
2. **Storage, API, jobs and inbox.** Table, routes, background job, retention, SuggestionService.
3. **Page.** All views except Changes. Navigation entry, docs.
4. **Drift.** Compare two runs and the Changes view. An optional weekly cron (Sunday, under `withCronLock`) that runs the analysis and raises new high findings.
5. **Extras, each optional.**
   - **Guide chat.** It sees no code.
   - **"Explain and plan a fix."** For one finding: `getModelsForUser(userId).standard`, behind `aiLimiter`, with usage logged. The prompt is grounded only in the finding's evidence and up to 200 lines of excerpts from the files named. The answer is shown with its file:line references.
   - **Churn from the GitHub API.** Use `safeFetch`, with an optional `GITHUB_TOKEN` added to `docs/env-vars.md`. Only if wanted.
