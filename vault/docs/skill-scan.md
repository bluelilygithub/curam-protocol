# Skill Scanner

`/skill-scan` · nav: **Admin → Skill Scanner** (admin only, desktop menu; mobile skips admin items) · table `skill_scans` · no feature flag (mounted behind `requireAdmin`, like Code Map)

Checks an AI agent skill or plugin (Claude Code, Codex, MCP and similar) for security risks **before** it is installed, using NVIDIA's open-source [SkillSpector](https://github.com/NVIDIA/SkillSpector) (Apache-2.0). Input: a public **github.com** link (a repository, or a folder in it via `/tree/<ref>/<path>`) or an uploaded **zip** of a skill or plugin folder (up to 20 MB). Output: a verdict (Safe / Caution / Do not install), a risk score 0–100, finding counts by severity, and each finding with rule, file and line, explanation, code and fix.

It cannot see the plugins on the owner's own computer (Vault runs on Railway): zip the folder (for example a plugin under `~/.claude/plugins/`) and upload it.

## Install (Dockerfile.base)

SkillSpector needs Python 3.12+ and the base image's Debian Python is 3.11. `Dockerfile.base` has its own layer, after the big apt layer: it installs `git` (SkillSpector clones GitHub links itself), `pip install uv`, then `uv tool install --python 3.13 "skillspector @ git+https://github.com/NVIDIA/skillspector.git@${SKILLSPECTOR_REF}"` with uv's Python under `/opt/uv-python`, the tool under `/opt/uv-tools` and the `skillspector` command in `/usr/local/bin`, and checks `skillspector --help`. **Pinned** with `ARG SKILLSPECTOR_REF` (a commit; there are no releases). To update: change the commit and expect a base rebuild (slow deploy, `docs/deploy-speed.md`). `SKILLSPECTOR_BIN` overrides the command name (local development).

Until a base image with it has been built and deployed, `GET /config` answers `installed: false` (`skillspector --help` fails; cached 10 minutes) and the page says so; Scan is disabled.

## How a scan runs (`server/services/skillScan/`)

- `runner.js` builds `skillspector scan <target> -f json -o <tmp>/report.json`, plus `--no-llm` for a **static** scan (SkillSpector's model analysis is ON by default) and `--recursive --max-skills 32` for "Scan each skill separately". It runs with `spawn` (`shell: false`), a hard timeout (6 minutes static, 20 minutes deep, and `SKILLSPECTOR_MAX_WORKFLOW_SECONDS` 30 s under that), inside a `fs.mkdtemp` folder that is deleted afterwards (the zip, SkillSpector's clone and the report). The JSON is read from the `-o` file, not stdout (stdout also carries a "Report saved" line).
- **Environment:** the child gets a minimal environment built in `scanEnv` — `PATH`, a throwaway `HOME` in the temp folder, UTF-8 locale, `NO_COLOR`, the workflow limit — and, for a **deep** scan only, `SKILLSPECTOR_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` and `SKILLSPECTOR_MODEL` (the user's standard model from Settings, which must be a Claude model). None of Vault's other secrets reach it. A test checks this.
- **Exit codes:** 0 no policy failure, **1 = risk score above 50 (a normal result, saved as done)**, 2 = SkillSpector could not complete. When no JSON was written, the scan fails with the last lines of its stderr; `-1` (the command could not start) is reported as "not installed".
- **What SkillSpector itself guarantees** (read from its source at the pinned commit): it never runs the scanned code or installs its packages; clones are shallow, `https` only, with git hooks and global config disabled; ingest is capped at 100 MB, 10,000 files and 60 s; zips are checked for path traversal, symlinks, encrypted and special entries; files over 1 MB / 16 MB are only partly analysed and the report says so. Static mode still sends **dependency names and versions to OSV.dev** (known-vulnerability lookups); there is no switch to turn that off.
- `normalizeReport` keeps the page's shape only (verdict, score, severity, counts, and per finding: id, category, pattern, severity, confidence, file, line, short finding, explanation, remediation, code snippet up to 800 characters, number of places), up to 2,000 findings per skill. A `--recursive` run (`multi_skill: true`) becomes one section per skill; a skill that failed keeps its `error`. SkillSpector's own downgrade (an incomplete scan never says Safe) is kept and shown.
- `index.js` stores the scan (`skill_scans`: source, `sourceType` github/zip, file name, mode static/deep, recursive, model, status running/done/failed, score, severity, recommendation, `issueCount`, `exitCode`, `report` JSONB, error, times) and runs it as a background job through `services/bip/jobs.js` (the generic in-memory registry; the page polls `GET /jobs/:id` every 2.5 s). At most **two scans at once** on the server (429 otherwise). On boot, any row still `running` is marked failed (a restart cut it off). A deep scan logs usage as `skill_scan_deep` when SkillSpector reports token counts.
- **Delete** moves the row to the recycle bin (kind `skill-scan`, `recycleBin/adapters/skillScan.js`); a running scan cannot be deleted.

## API (`/api/skill-scan`, behind `requireAdmin`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/config` | `{ installed, deepAvailable, deepReason, model, maxZipMb }` |
| `GET` | `/scans` | Saved scans, newest first (no report) |
| `POST` | `/scans` | multipart: `url` **or** `file` (.zip, 20 MB), `deep`, `recursive` (`'true'`). `202 { jobId, scanId }`. Deep scans go through `aiLimiter` |
| `GET` | `/scans/:id` | One scan with its report |
| `DELETE` | `/scans/:id` | To the recycle bin |
| `GET` | `/jobs/:jobId` | Background progress |

All are class `admin` in `server/testing/routeManifest.json`. The guide chat is `POST /api/skill-scan-tutor` (`requireAdmin`, `aiLimiter`).

## Page and help

`client/src/pages/SkillScanPage.jsx`: Scan a skill (GitHub link with the shared mic, or Upload a zip; "Scan each skill separately"; "Deep scan (AI: model)" disabled with the reason when no Claude model or key), Report (verdict pill, score, severity counts, completeness and deep-scan warnings, findings sorted by severity and expandable), Saved scans (Open, Delete with Undo). `?scan=<id>` opens one. Tooltips on every control, (i) box (`HOW_IT_WORKS`), compass tour (`utils/tours/skillScanTour.js`), guide chat (`skillScan/SkillScanTutorChat.jsx`, `server/services/skillScanTutor.js`, registered in `server/config/guides.js`). Page wording and tool list: `client/src/pages/skillScan/skillScanTools.mjs`; the guide's `CATALOG` must match it.

## Tests

- `node --test server/services/skillScan/skillScan.test.js`: GitHub link checks, the child's environment (no Vault secrets; the key only for deep), arguments (`--no-llm`), report parsing for one skill and `--recursive`, exit 1 as a normal result, zip handling, temp-folder cleanup, errors (SkillSpector failure, not installed, timeout), the routes (link or zip, .zip only, deep through the limiter, ids) and the Dockerfile pin. SkillSpector itself is never run in tests.
- `node server/services/skillScanTutor.test.js` (guide), `npm run test:guides`, `npm run test:nav`.
- Not covered: a real SkillSpector run (needs the base image) and the cross-user tests (need the local test database).
