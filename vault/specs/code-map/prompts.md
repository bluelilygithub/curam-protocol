# Prompts for Claude Code

Paste one prompt per session, in order. Start each in plan mode (Shift+Tab) so you can approve the plan before any code is written. Each prompt assumes the kit sits at `vault/specs/code-map/`.

---

## Prompt 1: analyzer service

```
Read vault/CLAUDE.md, then vault/specs/code-map/code-map-brief.md in full. We are building the "Code Map" admin tool described there, milestone 1 only: the analyzer service and its tests. No routes, no table, no UI yet.

The reference implementation is vault/specs/code-map/reference/analyze.py (Python). Port its logic to Node in vault/server/services/codeMap/:
- one module per stage: files, imports, tools, mounts, ownership, rules, structure, findings
- rules.js holds the 14 checks as declarative entries (id, label, severity, why, fix, test function), as the brief's table describes
- index.js exports analyze({ root }) and returns the same shape as reference/sample-data.json, plus generated findings
- run.js is a command-line runner: node server/services/codeMap/run.js prints a summary and writes the JSON to a path given as an argument

Constraints:
- Do NOT add npm packages or edit package.json or package-lock.json (docs/deploy-speed.md).
- Pure functions where possible, getLogger() not console.* (except in run.js output).
- Write Tarjan's algorithm iteratively.
- Findings are generated from rules, not written by hand. Group them by rule and sort by severity, then by number of tools affected.

Tests (run with node, not npm scripts):
- unit tests on a small fixture tree under server/services/codeMap/__fixtures__/ (import resolution including index files and lazy imports, mount parsing including requireAnyFeature and router objects, mount ownership, shared-vs-owned with the 3-tool threshold, cycle detection, each rule pass/fail)
- an accuracy test that runs analyze() on this repo and compares it with the sample data: 60 tools, 145 mounts, 11 cycles, 404 test files, per-tool scores within ±5. If the code has changed since commit 40bf883, report the differences and explain them; do not tune the code to hit the numbers.

Finish by running every new test, showing the summary from run.js, and listing anything where the Node port disagrees with the Python reference and why. Then commit, and add the changelog entry as a second commit per docs/changelog.md. Do not push.
```

---

## Prompt 2: storage, API, background job, inbox

```
Read vault/CLAUDE.md and vault/specs/code-map/code-map-brief.md (sections "Data model", "API", "Conventions checklist"). Milestone 1 is done: server/services/codeMap/ exists with analyze().

Build milestone 2:
1. Add the table code_map_runs to server/db.js exactly as the brief specifies (idempotent DDL). On boot, mark queued or running rows as failed, as pdf_html_jobs does.
2. Add server/services/codeMap/jobs.js, modelled on server/services/pdfToHtmlJobs.js: one run at a time, progress per stage, timing in durationMs, commitHint from RAILWAY_GIT_COMMIT_SHA if set, keep the last 30 runs. Inject pool and analyze so tests need no database.
3. After a run succeeds, call SuggestionService.captureIf() once per HIGH finding per tool (source 'codeMap', category 'alert', fingerprint makeFingerprint('codeMap', `${ruleId}:${toolId}`)).
4. Add server/routes/codeMap.js with the five endpoints in the brief (compare can return 501 for now). Named routes before /:id. Mount it in server/index.js as app.use('/api/code-map', requireAdmin, ...), next to /api/changelog. Classify the endpoint in server/testing/routeManifest.json if that file requires it.
5. Tests: the job module (success, failure, one-at-a-time, retention, suggestion capture) with a fake pool, and the route file with a fake job service. Run them with node, plus the existing auth and cross-user tests.

No package.json changes. Commit, then add the changelog entry as a second commit. Do not push; show me git diff --stat origin/version-7..HEAD.
```

---

## Prompt 3: the page

```
Read vault/CLAUDE.md, vault/client/DESIGN.md, and vault/specs/code-map/code-map-brief.md (section "UI"). Open vault/specs/code-map/reference/prototype.html: it is the layout to match, loaded with reference/sample-data.json. Restyle it with Vault's design system, not the prototype's colours.

Build milestone 3:
- client/src/pages/CodeMapPage.jsx and its parts in client/src/pages/codeMap/: Overview, Tools, Conventions, Dependency map, Structure, and the tool detail side panel.
- The header shows the latest run and has a Run analysis button that starts a run and polls GET /api/code-map/runs/:id until it is done or failed.
- Keep the selected tab in the URL query.
- Dependency map: react-force-graph-2d (already installed). Node size is √(lines of code), colour is the score band, API links solid, shared-code links dashed, click to highlight neighbours, click again to open the detail, a toggle to hide tools with no links.
- Follow the Vault rules: apiClient for every call, getIcon only, Tooltip on every control, Skeleton and EmptyState, Dialog for any modal, the (i) box and compass tour as Video Tools does. Theme variables only. Hover opacity, 200ms transitions, keyboard focus visible, prefers-reduced-motion respected.
- Add the page to client/src/config/appNavigation.js under Business next to Changelog (adminOnly: true, icon via the semantic map), and the route in App.jsx. Run npm run test:nav.
- Write docs/code-map.md (what it checks, how to read a check, known false positives, how to add a rule to rules.js, why runs skip the recycle bin). Add a key-files.md entry and one line to CLAUDE.md under "Where things are".

Run the client build. Then commit, add the changelog entry as a second commit, show git diff --stat origin/version-7..HEAD, and tell me before pushing whether the deploy will be slow.
```

---

## Prompt 4: drift between runs

```
Read vault/specs/code-map/code-map-brief.md (milestone 4). Build:
- server/services/codeMap/compare.js: given two run results, return new findings, resolved findings (matched by ruleId plus toolId, or the file set for structural findings), per-tool score changes, tools added or removed, and cycles gained or lost. Write unit tests for it.
- GET /api/code-map/compare?from=&to= (replace the 501).
- A "Changes" tab in CodeMapPage: two run pickers that default to the latest and the one before, then new, resolved and score movement, with the worst regressions first.
- A weekly cron in server/cron/ (Sunday 03:17 Australia/Brisbane) wrapped in withCronLock('codeMap', ...). It runs the analysis as the first admin. Raising new high findings already happens through the job.
- Update docs/code-map.md.

Tests with node; no package.json changes. Commit, add the changelog entry, show the diff stat. Do not push.
```

---

## Prompt 5 (optional): guide chat and "Explain and plan a fix"

```
Read vault/docs/guide-chat.md, vault/docs/core-conventions.md (Model selection), and vault/specs/code-map/code-map-brief.md (milestone 5).

1. Guide chat: add 'code-map' to server/config/guides.js and mount /api/code-map-tutor with requireAdmin and aiLimiter, using guideCore like the other tutors. It explains how to read the page and what each rule means. It sees no code and no run data. Wire the shared TutorChat into CodeMapPage. Run npm run test:guides.
2. "Explain and plan a fix" button on each finding: POST /api/code-map/findings/explain with { runId, ruleId, toolId }, behind aiLimiter. The server reads the finding's evidence from the stored run, then up to 200 lines around each file:line from disk (only paths inside server/ and client/src/; refuse anything else). It calls getModelsForUser(userId).standard through callModel and logs usage. Ask for a short explanation and a step-by-step fix plan that cites file:line, and say "I could not tell" rather than guessing. Show the answer under the finding with its references.
3. Tests: path restriction, prompt grounding (only evidence files read), model resolution (no hardcoded ids).

Commit, add the changelog entry, show the diff stat. Do not push.
```

---

## Small follow-up prompts

- **Fix the top finding:** `Open the Code Map's latest run, take the highest-severity finding, and fix it for every tool listed. Re-run the analyzer and show that the finding is resolved. Follow CLAUDE.md (changelog entry, no package.json changes).`
- **Add a rule:** `Add a Code Map rule to server/services/codeMap/rules.js: <describe the convention>. Include a fixture test for pass and fail, and update docs/code-map.md.`
- **Investigate a false positive:** `The Code Map flags <tool> for <rule>, but I think it is wrong because <reason>. Check the code, then either fix the code or narrow the rule, with a test that covers it.`
