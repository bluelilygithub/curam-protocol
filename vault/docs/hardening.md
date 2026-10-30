# Hardening roadmap

Started 2026-10-30 from a review brief ("solidifying Vault before the next feature"). The aim is a ratchet, not a freeze: feature work carries on, and each feature should cost the same to add as the last one. This file records what is done, what was checked and found already fine, what is next, and the checklist a new feature should pass.

## What was checked and found already fine

- **Root SQL dumps** (`dump-railway-*.sql`): never in git history, gitignored (`*.sql`), no password/token/hash strings in them. No rotation needed.
- **CI** (`.github/workflows/ci.yml`): already exists, with a pgvector Postgres service, every `*.test.*` file, the cross-user route tests on their own database, client build and the four sub-apps. It is **on demand and on pull requests on purpose** so Railway deploys are not held up (see the comment at the top of the file). Do not add `push:` triggers without deciding that again.

## Done (2026-10-30)

1. **Feature flag parity.** `translate` and `guitar` existed only in the client list (`client/src/utils/featureAccess.js`), so an admin could not switch them off. They are now in `server/config/featureAccess.js` (default `true`, so nothing changes for members; their routes are not gated by `requireFeature`). `server/config/featureAccess.test.js` now fails if the client and server flag keys, defaults, or the Feature Access menu entries differ. Effect on accountant logins: both are off for them (accountants get Finance, and Shares only if ticked).
2. **Cron single-flight lock.** `server/utils/cronLock.js` `withCronLock(name, fn)` takes a Postgres session-level advisory lock (namespace `7100`, key `hashtext(name)`) on one pooled connection for the length of the job. During a rolling deploy two instances run at once; the second skips instead of double-sending. If the lock cannot be taken (database unreachable) the job runs unguarded, as before. Wraps: note reminders, weekly digest, news digest, finance reminders (per user, plus the annual vehicle/home-office check), fitness, expense review, recurring entries, the five shares jobs, topic research refresh. Not wrapped (harmless to run twice): purge and expiry jobs. Test: `DATABASE_URL=... node server/utils/cronLock.test.js`. **New cron that sends mail, creates records or calls a paid API: wrap it.**

Log lines to look for after a deploy: `[cron-lock] <name>: another instance is running it, skipped` (working), `could not take the lock` (investigate). Pool is 10 connections and a locked job holds one for its whole run.

## Not yet proven

- Two real instances overlapping on Railway. Watch the first staging deploy.
- Restore from a production backup (see Next, item 1).

## Next, in order

1. **Restore rehearsal.** Restore a production Postgres backup into staging, **and the uploads volume** (`UPLOAD_DIR`: attachments, finance documents, videos), start the app, open Finance and a project with files. Write the steps in `BACKUP.md` once they have worked. Until done, "we have backups" is unproven.
2. **Back up `ENCRYPTION_KEY` outside Railway.** Losing it kills every stored Gmail/Calendar/Drive token.
3. **Skipped tests in CI** (built 2026-10-30, report-only). `scripts/ci-run-server-tests.sh` now spots a test file that exits 0 but printed a skip marker ("SKIP ...", "tests skipped", "skipped - ...") and lists it as `passed-but-skipped`, with a warning per file and a line in the run summary. It does not fail by default. **To do:** read the count from the first CI run, then set `SKIP_MAX` to that number in `ci.yml` so it can only go down. Known limit: a test that exits silently with no message is not seen.
4. **Ownership coverage** (measured 2026-10-31, after the derived-list pass). `crossUser.test.js` and `crossUserOwnership.test.js` pass and give identical results on repeat runs (background writes are switched off in `server/testing/crossUserHarness.js`). The route manifest classifies all 1,274 routes (32 admin, 26 public, rest signed-in). Of 475 GET routes, **227 are proven** (up from 197) and 47 user-specific; 297 write routes were probed with the other member's ids in the path (up from 284). The jump came from fixing the test data, not the app: the fixture builder filled every nullable `deletedAt`/`closedAt`/`archived_at` with "now" and every `expiresAt` with "already", so A's rows looked deleted or expired and the routes rightly hid them (rules now in `server/testing/ownershipFixtures.js`: `ENDED_COL`, `FUTURE_COL`, `VALUE_HINTS`; id-to-table answers in `ownershipBindings.json`). `node server/routes/crossUserOwnership.test.js --vacuous` lists what is left, with what user A was actually told. **What is left (about 150 routes), by reason:**
   - Static or config answers with no user data (wellbeing question sets, Graphics/Video/Music status and capabilities, model and settings config, fonts catalogue, DNS options, property-scenario lenders and rates). Nothing to leak; no action.
   - Answers that need an outside service or a key (Gmail, Search Console, YouTube, Ollama, CDR lender rates). Blocked by design.
   - Files on disk or jobs kept in memory (finance and shares document files, receipts, video stream/library file, music, video and Graphics batch jobs, translate download, export-social, isolate-voice, shelf installer, document-redaction jobs). They answer 404 for any fixture row because no real file or job exists; ownership is checked in the handler by user id, so these need a real upload in the test to be proven.
   - Derived lists. Done: subtasks, chats with no project, deleted chats, projects not yet client projects, mood tied to a task, search, current mission statement, bookmarks, pinned URLs (extra link rows are added by `seedDerived()` in `server/testing/ownershipFixtures.js`; `--probe=<text>` prints what user A is told by matching GET routes). **Still empty** (each needs a parent set up through the app, not a copied row): the Finance charts, interest, depreciation preview, unread documents and home-office gaps (need the chart of accounts and journal lines the Finance routes create), contract-review obligations and clause search, guitar loops (keyed on the song id, not the row id), shares news, translate drift and glossary, translate language order.
   - Needs a query value to answer (`clientId`, `weekStart`, `dob`, `tool`): 400 to a bare call.
   **Rule: a new route fails `crossUser.test.js` until it is added to `server/testing/routeManifest.json` (`--update`, then review the class).** **Fixed 2026-10-31:** `GET /api/search` used to show every `search_index` row with no project to every member (nothing wrote such a row, so nothing leaked); it now returns only rows in the caller's own projects, and the ownership test seeds an orphan row to keep it that way (it fails without the fix). Still to decide: a static check for a query on a user table with no `"userId"` filter.
5. **Lifecycle status per flag.** Add `lifecycle: 'ga' | 'preview' | 'parked'` for each key in the one registry, and show it in the Feature Access panel.
6. **Deploy rollback note.** Write down the fastest way to revert a bad production push (Railway redeploy of previous build vs `git revert`) in `BACKUP.md` or `OPERATIONS`.
7. **New-feature gate** as a short PR template (below).

## Only when something forces it

- **Migration baseline.** Boot-time idempotent DDL in `server/db.js` (about 208 tables, about 4,750 lines) works for additive change. It cannot express drop, rename or type change, and the `DO $$ ... EXCEPTION WHEN OTHERS THEN NULL` blocks hide real failures. Build the baseline **from a production schema dump, not from reading `db.js`**, at the first destructive schema change. Keep boot DDL as a no-op safety net for one release, measure boot time before and after, test the migration and its rollback in staging.
- **Logging.** New and touched code uses `getLogger()`; `console.*` is retired file by file as files are opened, not in a sweep.
- **Large files** (`FinancePage.jsx`, `VideosPage.jsx`, `PropertyScenarioPage.jsx`, `finance.js`). Split along existing seams (Finance into invoices/expenses/reports/journal; Video into per-tool modules), only when a feature already forces a change in that file.
- **Naming and entry points** before any merging of Projects / Client Projects / Pipeline: terminology, where do I start, a one-page workspace map.

## Avoid

A repo-wide reformat while branches are open; an ORM; Redis/queues before a second instance is the plan; merging CRM entities before the naming work; a stabilisation phase with no exit.

## The gate for every new feature

Before it ships, answer yes to each:

- One flag in the one registry (`server/config/featureAccess.js` + client list, test enforces parity), with a lifecycle status once item 5 lands.
- An ownership rule, and a test proving another user cannot reach it (extend `crossUserOwnership.test.js`).
- A schema change delivered as a migration once the baseline exists; until then, idempotent DDL in `db.js`.
- `getLogger()` logging; a cost/rate-limit decision if it calls a paid API; a retention/recycle-bin decision if it stores user data.
- Any cron that sends, creates or pays is wrapped in `withCronLock`.
- A guide entry and docs, so the drift tests keep passing.
- If it lands in an already-large file: a named extraction target, or a reason it needs none.

## Signals to note in the changelog each release

Baseline taken 2026-10-30:

| Signal | Baseline |
|---|---|
| `CREATE TABLE` in `server/db.js` | 208 |
| `db.js` lines | about 4,750 |
| Test files (`*.test.js/mjs/cjs`, excluding node_modules/dist) | 276 |
| Feature flags | 46 |
| Largest client file | `FinancePage.jsx`, about 7,100 lines |
| `console.*` calls in `server/` | about 1,300 (rough, includes test files) |
| Skipped-but-green test files | not yet measured (item 3) |
| Surfaces marked preview/parked | 0 (item 5) |
| Boot time | not yet measured |
