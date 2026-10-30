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
3. **Count skipped tests in CI.** `scripts/ci-run-server-tests.sh` counts a file that exits 0 as passed even if it printed a skip (for example "skipped: DATABASE_URL not set"). Print a skipped count in the summary and fail if it rises above a recorded number.
4. **Measure ownership coverage.** `server/routes/crossUserOwnership.test.js` exists. List which user-scoped routes it does not exercise (read-only report first), then decide on a static check that flags a query on a user table with no `"userId"` filter or guard (allowlist for public/share routes).
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
