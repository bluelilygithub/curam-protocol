# CRM data model migration: `clients` / `fin_clients` merge

Foundation work for the CRM agent build. `clients` (CRM table, used by Projects/Tasks) becomes canonical; `fin_clients` (Finance-local) retires. See chat history / project notes for the full rationale — short version: `clients` is already the cross-feature link (`projects.clientId`, `tasks` via projects), `fin_clients` is newer and Finance-only, so merging the other direction would mean rewiring Projects/Tasks instead of just Finance.

Bridge approach — no data is deleted until a full billing cycle has run clean against the new join.

---

## Phase 0 — Bridge schema (done)

`server/db.js`:
- `fin_clients."clientId"` — nullable FK to `clients(id)`, `ON DELETE SET NULL`. Records the match once one is found; stays `NULL` for anything unreconciled.
- `client_billing_details` — new 1:1 extension table on `clients(id)`: `abn`, `address`. Finance-only fields, kept out of the core CRM `clients` table per the "extension table, not merge" rule. `contactName` is not migrated as a column — it becomes a `client_contacts` row (Phase 1 script does this automatically when a match is made).

## Phase 1 — Backfill / reconciliation (done, run required)

`server/scripts/migrateFinClientsToClients.js`

Matches each `fin_clients` row to a `clients` row, scoped to the same `userId`, in order:
1. Exact email match against `client_contacts.email` — only if exactly one candidate client.
2. Exact case-insensitive name match — only if exactly one candidate.

Anything else is left `clientId = NULL` and printed at the end. **Never auto-merged on a fuzzy match** — a wrong merge here corrupts financial records, so ambiguous or absent matches always go to manual reconciliation (`UPDATE fin_clients SET "clientId"=<id> WHERE id=<fc.id>` by hand, or create a new `clients` row first).

Idempotent — only touches rows where `clientId IS NULL`, safe to re-run after manual fixes.

```bash
node server/scripts/migrateFinClientsToClients.js --dry-run   # preview matches, writes nothing
node server/scripts/migrateFinClientsToClients.js              # apply
```

**Run this now, on Railway's DB, before Phase 2.** Check the "Unmatched" list — reconcile every row by hand before moving on. Do not proceed to Phase 2 with unmatched rows; they'll silently drop off invoices once queries are repointed.

## Phase 1b — Create clients for unmatched rows (done)

`server/scripts/createClientsForUnmatched.js` — for the 3 `fin_clients` rows that had no candidate in `clients` at all (expected: `clients` was empty pre-migration), creates a new `clients` row + `client_contacts` row + `client_billing_details` row per unmatched row, transactionally, and links the bridge column. Run against production 2026-09-16 — all 3 rows (`Diamond Plate`, `BTMB pty ltd`, `NZL Supply`) created and linked cleanly, zero failures. Every `fin_clients` row now has a non-null `clientId`.

## Phase 2 — Repoint Finance queries (done)

Went with `clientRef` (already meaning "→ `clients`" everywhere, including `server/routes/clients.js`'s existing revenue-summary queries) as the single surviving FK, rather than repurposing `clientId` — avoids touching `clients.js` at all and avoids a live column rename/retarget.

- `server/routes/finance.js`: `GET /clients` now reads straight from `clients` + `client_contacts` (primary) + `client_billing_details` (`CLIENT_SELECT` helper). `POST`/`PUT`/`PATCH`/`DELETE /clients` write to those three tables transactionally instead of `fin_clients`. Every invoice/quote read (list, single, PDF, email-send, BAS unpaid-list, reports/ledger) dropped the `fin_clients fc` join and `COALESCE(fc.x, cr.x)` pattern — single join on `clients cr` (+ `client_contacts`/`client_billing_details` where contact/billing fields are needed). Invoice create/update no longer accepts a `clientId` field, only `clientRef`.
- `server/cron/financeRemindersCron.js`: same simplification, single `clients cr` join.
- `server/cron/recurringCron.js`: writes only `clientRef` on new recurring-generated invoices now. Reads `t.clientRef` from the template; if an old template only has `t.clientId` (pre-merge), resolves it through the `fin_clients."clientId"` bridge column at run time rather than losing the link — one-time compatibility shim, safe to remove once all recurring templates have been re-saved.
- `client/src/pages/FinancePage.jsx`: dropped the `crm:<id>`/`fin:<id>` prefix scheme in the client picker and save/load logic — `form.clientRef` is now a plain client id. Billing-records list (the finance-specific client management UI) no longer branches on `c.source` (removed from the API response) — every row now gets the same actions (View in Clients module, Deactivate/Edit/Delete), since they're all real `clients` rows now.

**Not yet done**: dropping the now-unused `fin_invoices.clientId` / `fin_recurring` template `clientId` values — left in place as historical/compat data, cleaned up in Phase 3 alongside `fin_clients` itself.

### Phase 2 follow-up fix (done)

Deploying Phase 2 surfaced a gap: existing invoices/quotes created before the merge had `clientId` set but `clientRef` NULL (never backfilled), so they showed as unlinked once Finance's queries switched to reading `clientRef` only. Fixed via `server/scripts/backfillInvoiceClientRef.js` — maps `clientId` → `clientRef` through the `fin_clients."clientId"` bridge column, also covers `fin_recurring` templates with the same gap. Run against production 2026-09-16: 6 invoices/quotes backfilled cleanly (all 3 clients represented), 0 recurring templates affected.

**Verify before Phase 3**: run a full invoice create → send → paid cycle, a quote → convert-to-invoice, the finance reminders cron, and at least one recurring-invoice firing, against the repointed queries in production.

## Phase 3 — Drop `fin_clients` + leftover columns (ready to run)

`server/scripts/dropFinClients.js` — finds the real FK constraint name via `information_schema` (no guessing), refuses to proceed if any `fin_clients` row still has no `clientId` bridge value (would silently lose data), then transactionally drops the FK, `fin_invoices."clientId"`, and `fin_clients` itself.

```bash
node server/scripts/dropFinClients.js --dry-run   # reports counts + FK name, changes nothing
node server/scripts/dropFinClients.js              # applies
```

`server/db.js` already updated for fresh installs: `fin_clients` CREATE TABLE removed, `fin_invoices` no longer declares a `clientId` column, the bridge-column ALTER removed. Existing/production databases still have the old column/table until the script above is run against them — that's expected, matches the "add schema first, migrate data, then drop" sequence used throughout this migration.

**Irreversible** — once run, the only way back is restoring from a database backup. Run against production 2026-09-16: 3 `fin_clients` rows (all linked), 6 `fin_invoices` rows with the old `clientId` set — constraint `fin_invoices_clientId_fkey`, `fin_invoices."clientId"` column, and `fin_clients` table all dropped cleanly.

**Migration complete.** `clients` is now the single canonical client table across Projects, Tasks, and Finance.

Also: sweep `fin_recurring.template` JSONB rows for leftover `clientId` keys after (informational only, not FK-enforced, safe to leave — but tidy to strip once confirmed unused). Not done by the script above.

## Rollback

- **Phase 0/1 rollback** (before Phase 2 starts): `fin_clients` is untouched except the added `clientId` column — `ALTER TABLE fin_clients DROP COLUMN "clientId"` and drop `client_billing_details` fully reverses it. Nothing else was changed, so this is zero-risk to revert.
- **Phase 2 rollback**: harder — once `fin_invoices.clientRef`/`clientId` are collapsed and Finance code no longer reads `fin_clients`, reverting means restoring the old dual-FK code from git and re-deriving `clientRef` from `client_billing_details`/`clients` back to whichever `fin_clients` row it came from (the `fin_clients.clientId` bridge column, kept until Phase 3, is exactly what makes this possible — that's why Phase 3 doesn't happen until a full cycle has run clean).
- **Phase 3 rollback**: none — `fin_clients` is dropped. This is why Phase 3 is explicitly last and gated on a clean production cycle, not bundled with Phase 2.

## Status

- [x] Phase 0 — bridge schema in `server/db.js`
- [x] Phase 1 — migration script run against production 2026-09-16. 3 `fin_clients` rows, 0 matched (expected — `clients` was empty), all 3 flagged unmatched.
- [x] Phase 1b — `createClientsForUnmatched.js` run against production 2026-09-16. All 3 created + linked. Every `fin_clients` row now has `clientId` set.
- [x] Phase 2 — Finance queries repointed to `clients`/`client_contacts`/`client_billing_details` (server + frontend). Verified in production, incl. a follow-up backfill for pre-merge invoices/quotes.
- [x] Phase 3 — `fin_clients` + `fin_invoices.clientId` dropped from production 2026-09-16. Migration complete.
