Read vault/CLAUDE.md, vault/client/DESIGN.md, docs/code-map.md and the Code Map code as it is now (server/services/codeMap/, server/routes/codeMap.js, client/src/pages/CodeMapPage.jsx and its parts). Use the names and patterns that actually exist, not the ones in this prompt, where they differ. Plan first and show me the plan.

GOAL
I want to start a conversation in the Claude app (not Claude Code) with no memory of Vault, and have Claude understand the whole Vault ecosystem before it helps me design the next app. Add a "Context" tab to the Code Map page with one button, "Build briefing", that produces two outputs from the same snapshot:
  1. A formatted report for me to read on the page.
  2. A plain-text Markdown briefing written for Claude, with "Copy for Claude" and "Download .md" buttons.

DATA SOURCES (read only; no model calls, no new npm packages, no package.json or lockfile edits)
- The latest done Code Map run: tools, status, size, tests, scores, links between tools, findings, structure.
- server/config/featureAccess.js and client/src/config/appNavigation.js: groups, flags, lifecycle (ga / preview / parked), admin-only.
- changelog_entries: the last 30 days, plus any entry whose concerns are not "None noted.".
- ponytail_tasks, if the table exists: a 30-day summary (cost, tasks, average reuse). Skip quietly if it doesn't.
- docs/env-vars.md and process.env: which outside services are configured, as YES/NO only. Never read, store or show a value. Group by service (Anthropic, Gemini, Google, email, Replicate, Railway and so on).
- package.json dependencies: names only, as "installed packages to reuse".
- vault/CLAUDE.md itself, for the CLAUDE.md sub-view (below).

CURATED FILES (written once by you now, kept in the repo, checked by tests)
- server/services/codeMap/briefing/about.md: what Vault is, who uses it and how it's built and deployed. Write it from CLAUDE.md and the docs; keep it to about 15 lines.
- server/services/codeMap/briefing/rules.md: the rules every tool must follow, as a numbered list in plain words (access and flags, lifecycle, guide chat, Tooltips and (i) box and tour, apiClient, getIcon, Dialog, recycle bin, aiLimiter, model selection via Settings, safeFetch, SuggestionService, logging, tests, docs, changelog, the deploy-speed rule about package.json and the base image). Store the SHA-256 of CLAUDE.md and core-conventions.md it was written from. When either file changes, the Context tab shows "The rules summary may be out of date: CLAUDE.md has changed since it was written", and a test fails, so I'm prompted to refresh it.
- server/services/codeMap/briefing/building-blocks.md: the shared modules a new tool should reuse, each with its path and one line on what it's for. A test checks that every path listed exists.

OWNER NOTES
- A text area on the Context tab ("Your notes for Claude: priorities, plans, things you've decided against, what you're unsure about"), saved per admin. Use the existing settings storage if it fits; otherwise add a small table. Notes go into both outputs.

THE BRIEFING FOR CLAUDE (Markdown, wrapped in <vault_briefing> ... </vault_briefing>)
Sections, in this order:
  0. How to use this: "This describes an existing app called Vault as of <date>, commit <commitHint or 'unknown'>. I am planning a new feature or app. Before suggesting designs: check what already exists and what can be reused, follow Vault's rules, keep to installed packages where possible, and ask me rather than assume when something isn't covered here."
  1. About Vault (about.md)
  2. Architecture and stack: server, client, database, hosting, model selection, background jobs, crons, deploy path. Mostly from about.md plus counts from the run (tools, API mounts, lines of code, test files).
  3. Rules every tool follows (rules.md), numbered.
  4. Building blocks to reuse (building-blocks.md) and installed packages.
  5. Existing tools: one compact table, one row per tool: name, group, status (ga / preview / parked / admin), one-line purpose (from the tool's doc first line or its nav label), size, tests, score, linked tools. Preview tools are listed as works in progress.
  6. Outside services: configured YES/NO and what each is used for.
  7. Current state: the top 10 Code Map findings (title, severity, tools affected), import cycles count, hotspots.
  8. Recent direction: last 30 days of changelog as short lines (date, area, subject), then open concerns.
  9. Working pattern: the Ponytail 30-day summary, if available.
  10. Owner notes.
  11. When we agree a design: "Write it as a brief for Claude Code with these sections: Decisions already made (table), Data model (SQL), API (routes, auth, limits), UI (page, views, Vault UI rules), Conventions checklist, Milestones (one Claude Code session each), Tests. Follow the rules in section 3."
Keep it under about 60,000 characters. If it's longer, shorten section 5 to one line per tool and section 8 to the last 14 days, and say so at the top. Show the character count and an estimated token count (characters / 4) next to the Copy button.

PRIVACY (enforce and test)
The briefing describes how Vault is built, never what is in it. No client names, contacts, amounts, note or email contents, task titles, file contents or env values. Changelog subjects and Ponytail task names are allowed. Add a test that builds a briefing against fixture data containing a client name, an amount and an env value, and asserts none of them appear.

THE FORMATTED REPORT
The same sections rendered on the page for reading: tiles for the counts, the tool table with status pills, findings with severity stripes. Follow Vault UI rules (theme variables, getIcon, Tooltip on every control, Skeleton and EmptyState, apiClient). If no Code Map run exists yet, show an EmptyState with a "Run analysis first" button.

CLAUDE.md SUB-VIEW
Under the report: "CLAUDE.md" shown read-only and formatted, with a Copy button. Plus checkboxes to add docs it links to (core-conventions.md, deploy-speed.md, guide-chat.md and others found in docs/) into one copied block, each under a "## File: docs/<name>" heading.

SERVER
- server/services/codeMap/briefing/buildBriefing.js: pure function (snapshot inputs in, { markdown, sections, stats } out), so it's easy to test.
- GET /api/code-map/briefing builds and returns it; behind the same admin guard as the rest of Code Map. No aiLimiter (no model call).
- Store each built briefing in a small table (generatedAt, commitHint, markdown, chars) and keep the last 10, so I can re-copy an earlier one. List them on the tab.

TESTS (node, no npm scripts added)
buildBriefing sections and order, size trimming, privacy, rules.md hash check, building-blocks paths exist, the route returns 403 to a non-admin. Run the existing route-manifest, auth and cross-user tests.

DOCS
Update docs/code-map.md with a Context section: what goes in, what never goes in, how to refresh rules.md when CLAUDE.md changes, and how to use the output in a Claude Project.

Commit, then add the changelog entry as a second commit. Show git diff --stat origin/version-7..HEAD and tell me whether the push will be a slow deploy before pushing.