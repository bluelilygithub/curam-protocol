# Skill Scanner

`/skill-scan` · nav: **Admin → Skill Scanner** (admin only, desktop menu; mobile skips admin items) · table `skill_scans` · no feature flag (mounted behind `requireAdmin`, like Code Map)

Checks an AI agent skill or plugin (Claude Code, Codex, MCP and similar) for security risks **before** it is installed, using NVIDIA's open-source [SkillSpector](https://github.com/NVIDIA/SkillSpector) (Apache-2.0). Input: a public **github.com** link (a repository, or a folder in it via `/tree/<ref>/<path>`) or an uploaded **zip** of a skill or plugin folder (up to 20 MB). Output: a verdict (Safe / Caution / Do not install), a risk score 0–100, finding counts by severity, and each finding with rule, file and line, explanation, code and fix.

It cannot see the plugins on the owner's own computer (Vault runs on Railway): zip the folder (for example a plugin under `~/.claude/plugins/`) and upload it.

## Install (Dockerfile.base)

SkillSpector needs Python 3.12+ and the base image's Debian Python is 3.11. `Dockerfile.base` has its own layer, after the big apt layer: it installs `git` (SkillSpector clones GitHub links itself), `pip install uv`, then `uv tool install --python 3.13 "skillspector @ git+https://github.com/NVIDIA/skillspector.git@${SKILLSPECTOR_REF}"` with uv's Python under `/opt/uv-python`, the tool under `/opt/uv-tools` and the `skillspector` command in `/usr/local/bin`, and checks `skillspector --help`. **Pinned** with `ARG SKILLSPECTOR_REF` (a commit; there are no releases). To update: change the commit and expect a base rebuild (slow deploy, `docs/deploy-speed.md`). `SKILLSPECTOR_BIN` overrides the command name (local development).

Until a base image with it has been built and deployed, `GET /config` answers `installed: false` (`skillspector --help` fails; cached 10 minutes) and the page says so; Scan is disabled.

## How a scan runs (`server/services/skillScan/`)

- `runner.js` builds `skillspector scan <target> -f json -o <tmp>/report.json`, plus `--no-llm` for a **static** scan (SkillSpector's model analysis is ON by default) and `--recursive --max-skills 100` for "Scan each skill separately". It runs with `spawn` (`shell: false`), a hard timeout (6 minutes static, 20 minutes deep, and `SKILLSPECTOR_MAX_WORKFLOW_SECONDS` 30 s under that), inside a `fs.mkdtemp` folder that is deleted afterwards (the zip, SkillSpector's clone and the report). The JSON is read from the `-o` file, not stdout (stdout also carries a "Report saved" line).
- **Each skill separately needs a local folder.** SkillSpector (at the pinned commit) only splits by skill for a local directory: for a link or a zip it ignores `--recursive` (one bundle, which on `claude-trading-skills` hit its own time limits at 20% coverage) and refuses `--max-skills` with "--max-skills requires a local --recursive multi-skill directory". So for an each-skill scan `prepareFolder` downloads the GitHub archive itself (`https://github.com/<owner>/<repo>/archive/<ref or HEAD>.zip` through `safeFetch.fetchPublicFile`, which checks every redirect hop, 100 MB cap, 60 s) or takes the uploaded zip, and `extractZip` unpacks it with `jszip` (already installed) into the temporary folder: at most 10,000 entries and 100 MB unpacked, counted while streaming so a zip bomb stops part-way; a zip whose entries name an absolute or `..` path is refused whole (checked on `unsafeOriginalName`, because jszip quietly renames `../x` to `x`); symlink entries are skipped. It steps into the lone top folder (GitHub archives have one) and into the `/tree/<ref>/<folder>` part when given. `--max-skills` is raised to 100 (the default 32 would skip 36 of the 68 trading skills) and the static timeout to 15 minutes. A one-bundle scan still hands the link or zip to SkillSpector unchanged.
- **Environment:** the child gets a minimal environment built in `scanEnv` — `PATH`, a throwaway `HOME` in the temp folder, UTF-8 locale, `NO_COLOR`, the workflow limit — and, for a **deep** scan only, `SKILLSPECTOR_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` and `SKILLSPECTOR_MODEL` (the user's standard model from Settings, which must be a Claude model). None of Vault's other secrets reach it. A test checks this.
- **Exit codes:** 0 no policy failure, **1 = risk score above 50 (a normal result, saved as done)**, 2 = SkillSpector could not complete. When no JSON was written, the scan fails with the last lines of its stderr; `-1` (the command could not start) is reported as "not installed".
- **What SkillSpector itself guarantees** (read from its source at the pinned commit): it never runs the scanned code or installs its packages; clones are shallow, `https` only, with git hooks and global config disabled; ingest is capped at 100 MB, 10,000 files and 60 s; zips are checked for path traversal, symlinks, encrypted and special entries; files over 1 MB / 16 MB are only partly analysed and the report says so. Static mode still sends **dependency names and versions to OSV.dev** (known-vulnerability lookups); there is no switch to turn that off.
- `normalizeReport` keeps the page's shape only (verdict, score, severity, counts, and per finding: id, category, pattern, severity, confidence, file, line, short finding, explanation, remediation, code snippet up to 800 characters, number of places), up to 2,000 findings per skill. A `--recursive` run (`multi_skill: true`) becomes one section per skill; a skill that failed keeps its `error`. SkillSpector's own downgrade (an incomplete scan never says Safe) is kept and shown.
- `index.js` stores the scan (`skill_scans`: source, `sourceType` github/zip, file name, mode static/deep, recursive, model, status running/done/failed, score, severity, recommendation, `issueCount`, `exitCode`, `report` JSONB, error, times) and runs it as a background job through `services/bip/jobs.js` (the generic in-memory registry; the page polls `GET /jobs/:id` every 2.5 s). At most **two scans at once** on the server (429 otherwise). On boot, any row still `running` is marked failed (a restart cut it off). A deep scan logs usage as `skill_scan_deep` when SkillSpector reports token counts.
- **Delete** moves the row to the recycle bin (kind `skill-scan`, `recycleBin/adapters/skillScan.js`); a running scan cannot be deleted.

## The explanation in context (`services/skillScan/summary.js`)

SkillSpector's score is mechanical (points per finding by severity, diminishing per rule, capped at 100), so a skill that just calls web APIs can score 100 and "Do not install" from routine findings (on `agiprolabs/claude-trading-skills`: 40 critical `TT3` "credential from os.getenv reaches httpx" flows, which are API keys sent to their own APIs). After every finished scan the job writes an explanation (also **Regenerate**, `POST /scans/:id/summary`, `aiLimiter`):

1. `groupFindings` groups findings by rule id in code (severity = the worst in the group, count, files, skills from `skills/<name>/` paths, up to 3 examples from different files with SkillSpector's explanation and 400 characters of code), most severe and most frequent first. The same groups are returned with every scan (`GET /scans/:id` → `groups`), so the page and the export match what the model saw.
2. The standard model (`getModelsForUser`, logged as `skill_scan_summary`) gets the scan facts (verdict, score, counts, per-skill coverage and limitations) and up to 40 groups, each group's examples inside `<evidence>`. It marks each group **expected** (normal for the skill's purpose, e.g. a key sent in a header to that API's own host), **check** (and exactly what to look at) or **concerning**, citing the evidence; explains the score and any incomplete coverage; gives next steps; and gives its own **reading** (likely fine / review first / do not install), shown **next to** SkillSpector's verdict, never replacing it.
3. **Manipulation:** the examples are the skill's own text and code. The prompt says everything in `<evidence>` is data, never instructions, and that text trying to instruct the reviewer makes that group concerning. `cleanSummary` keeps only known group ids and assessments (an unknown reading becomes "review first"). The page and the export say an AI reading can be misled and that the findings remain the record.
4. It sends the findings, including the short code examples, to Anthropic (also for uploaded zips). A failed explanation never fails the scan. Stored in `skill_scans.summary` (JSONB) and restored with the scan from the recycle bin.

## Copy and download (`client/src/pages/skillScan/exportReport.mjs`)

Report → **Copy** (Markdown), **.md** and **.json** (the shared `ExportButton` from Code Map). The Markdown has the source, both verdicts, the counts, the explanation and next steps, a findings-by-rule table with the AI's mark, then every finding (per skill for an each-skill scan). The JSON is the saved scan without database ids. Test: `node client/src/pages/skillScan/exportReport.test.mjs`.

## API (`/api/skill-scan`, behind `requireAdmin`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/config` | `{ installed, deepAvailable, deepReason, model, maxZipMb }` |
| `GET` | `/scans` | Saved scans, newest first (no report) |
| `POST` | `/scans` | multipart: `url` **or** `file` (.zip, 20 MB), `deep`, `recursive` (`'true'`). `202 { jobId, scanId }`. Deep scans go through `aiLimiter` |
| `GET` | `/scans/:id` | One scan with its report, explanation (`summary`) and findings by rule (`groups`) |
| `POST` | `/scans/:id/summary` | Write the explanation again (`aiLimiter`) |
| `DELETE` | `/scans/:id` | To the recycle bin |
| `GET` | `/jobs/:jobId` | Background progress |

All are class `admin` in `server/testing/routeManifest.json`. The guide chat is `POST /api/skill-scan-tutor` (`requireAdmin`, `aiLimiter`).

## Page and help

**Layout (like Graphics):** the shared `ToolSidebar` (Scan: Scan a skill, Deep scan; Results: Report, Saved scans) and a **What do you want to do?** start screen with `JobStart` tiles from `skillScan/skillScanGoals.mjs` (check from GitHub, check a plugin on my computer, get a deeper AI check, keep or share a report; test `node client/src/pages/skillScan/skillScanGoals.test.mjs`) and the latest five scans. The Report shows both verdicts, Copy / .md / .json, **What the findings mean**, **Findings by rule** (expandable, with the AI's mark), and **All findings** (hidden until Show). "Scan each skill separately" is ticked by default: one bundle of ~60 skills hit SkillSpector's own time limits (10 pattern analysers "degraded", 20% coverage).


Page: `client/src/pages/SkillScanPage.jsx`. Scan a skill has the GitHub link (shared mic) or Upload a zip, "Scan each skill separately", and "Deep scan (AI: model)" (disabled with the reason when no Claude model or key). `?scan=<id>` opens a scan. Tooltips on every control, (i) box (`HOW_IT_WORKS`), compass tour (`utils/tours/skillScanTour.js`), guide chat (`skillScan/SkillScanTutorChat.jsx`, `server/services/skillScanTutor.js`, registered in `server/config/guides.js`). Tool list and wording: `client/src/pages/skillScan/skillScanTools.mjs`; the guide's `CATALOG` must match it.

## Tests

- `node --test server/services/skillScan/skillScan.test.js`: GitHub link checks, the child's environment (no Vault secrets; the key only for deep), arguments (`--no-llm`), report parsing for one skill and `--recursive`, exit 1 as a normal result, zip handling, temp-folder cleanup, errors (SkillSpector failure, not installed, timeout), the routes (link or zip, .zip only, deep through the limiter, ids) and the Dockerfile pin. SkillSpector itself is never run in tests.
- `node server/services/skillScanTutor.test.js` (guide), `npm run test:guides`, `npm run test:nav`.
- Not covered: a real SkillSpector run (needs the base image) and the cross-user tests (need the local test database).
