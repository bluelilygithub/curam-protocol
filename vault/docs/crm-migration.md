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

## Phase 2 — Repoint Finance queries (not started)

Once every `fin_clients` row has a `clientId`:

1. `server/routes/finance.js`:
   - Delete the `UNION ALL source:'fin'/'crm'` query in `GET /clients` — replace with `SELECT c.*, b.abn, b.address FROM clients c LEFT JOIN client_billing_details b ON b."clientId"=c.id WHERE c."userId"=$1`.
   - Every invoice/quote read/write currently branching on `clientId` (→ `fin_clients`) vs `clientRef` (→ `clients`) collapses to one FK. Backfill `fin_invoices.clientId` from `fin_clients.clientId` (a straight join-and-update), then drop `fin_invoices.clientRef` — keep the column named `clientId`, now pointing at `clients` instead of `fin_clients`.
   - Repeat for whatever recurring-invoice-template table `recurringCron.js` reads (`t.clientId`/`t.clientRef`).
   - Delete the `POST/PUT/PATCH/DELETE /clients` routes' writes to `fin_clients` — they become plain proxies to the `clients`/`client_billing_details` tables (or get removed if `client/src/pages/ClientsPage.jsx` already covers client CRUD and Finance only needs a picker).
2. `server/cron/financeRemindersCron.js`: drop the `fin_clients` join branch, use `clients` + `client_billing_details` directly.
3. `client/src/pages/FinancePage.jsx`: point client picker/management UI at `/api/clients`; surface `abn`/`address` fields (now on `client_billing_details`) in whatever inline client form it has.

**Verify**: run a full invoice create → send → paid cycle, and the finance reminders cron, against the repointed queries before Phase 3.

## Phase 3 — Drop `fin_clients` (not started, do last)

Only after Phase 2 has run clean through at least one full billing/reporting cycle in production:

```sql
ALTER TABLE fin_invoices DROP CONSTRAINT IF EXISTS fin_invoices_clientid_fkey; -- old FK to fin_clients, if named differently check \d fin_invoices
-- (clientId column already repointed to clients in Phase 2 — this just drops the stale constraint if it wasn't already replaced)
DROP TABLE IF EXISTS fin_clients;
```

## Rollback

- **Phase 0/1 rollback** (before Phase 2 starts): `fin_clients` is untouched except the added `clientId` column — `ALTER TABLE fin_clients DROP COLUMN "clientId"` and drop `client_billing_details` fully reverses it. Nothing else was changed, so this is zero-risk to revert.
- **Phase 2 rollback**: harder — once `fin_invoices.clientRef`/`clientId` are collapsed and Finance code no longer reads `fin_clients`, reverting means restoring the old dual-FK code from git and re-deriving `clientRef` from `client_billing_details`/`clients` back to whichever `fin_clients` row it came from (the `fin_clients.clientId` bridge column, kept until Phase 3, is exactly what makes this possible — that's why Phase 3 doesn't happen until a full cycle has run clean).
- **Phase 3 rollback**: none — `fin_clients` is dropped. This is why Phase 3 is explicitly last and gated on a clean production cycle, not bundled with Phase 2.

## Status

- [x] Phase 0 — bridge schema in `server/db.js`
- [x] Phase 1 — migration script written (`server/scripts/migrateFinClientsToClients.js`) — **needs to be run against Railway's DB and unmatched rows reconciled**
- [ ] Phase 2 — repoint Finance queries
- [ ] Phase 3 — drop `fin_clients`
