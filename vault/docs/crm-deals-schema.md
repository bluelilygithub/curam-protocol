# CRM Phase 3 schema: deals, contact roles, activity, tasks

Builds on the completed `clients`/`client_contacts`/`client_touchpoints`/`client_billing_details` foundation (`docs/crm-migration.md`).

**Status: items 1, 3 (partial), 4, 5 built, frontend built.** Schema + CRUD routes (`server/db.js`/`server/routes/deals.js`) and the `ClientDetailPage.jsx` Deals section (create/edit/delete, stage badges, open-pipeline stat card, deal-tagged touchpoints) are code-complete, pushed, not yet exercised in production. Item 2 (contact roles) needs no schema change, already true today. Item 6 (dashboard/reporting beyond the basic `/api/deals/pipeline` summary and the per-client pipeline stat) is not started — a workspace-wide deals dashboard, not just per-client, would be the next piece.

---

## 1. `client_deals` (new) — the actual gap vs. Salesforce/HubSpot

Right now `clients.status` (prospect/active/paused/archived) is the only pipeline concept, and it's one status per client, not per opportunity. A client can have multiple simultaneous deals (renewal + upsell), which `status` can't express.

```sql
CREATE TABLE IF NOT EXISTS client_deals (
  id                 SERIAL PRIMARY KEY,
  "userId"           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "clientId"         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title              VARCHAR(255) NOT NULL,
  stage              VARCHAR(20) NOT NULL DEFAULT 'lead'
                     CHECK (stage IN ('lead','qualified','proposal','negotiation','won','lost')),
  value              NUMERIC(12,2),
  "expectedCloseDate" DATE,
  "actualCloseDate"   DATE,
  "lostReason"        TEXT,
  notes              TEXT,
  "createdAt"        TIMESTAMP DEFAULT NOW(),
  "updatedAt"        TIMESTAMP DEFAULT NOW()
);
```

Notes:
- No `currency` column — every other money field in the app (Shares, Finance) is AUD-only by convention; matches "don't build multi-currency speculatively" from the original scope.
- No `probability`/weighted-forecast field for MVP — `stage` alone is enough for a first pipeline view; add later if actually used.
- `stage != 'won'/'lost'` = open deal. `actualCloseDate` set on transition to won/lost.
- **`lostReason` is deliberately free text, not an enum — flagging this explicitly rather than leaving it implicit.** An enum would enable a real "reasons we lose deals" report later, which is a legitimate thing to want. But per the AUD-only precedent (matching this app's existing convention over building forecast-ready infrastructure speculatively), MVP philosophy wins here: free text costs nothing to add later value-constraints on top of (an enum column can be introduced alongside it once real lost-deal data exists to know what the actual categories should be), whereas guessing the category list now risks the opposite problem — a `CHECK` constraint that's wrong for how this business actually loses deals, requiring a migration to fix. Revisit once there are enough `lost` deals to see real patterns.
- One `ownerId`? Skipping for now — single-user-per-workspace-ish today (per the earlier multi-user gap finding on Shares/Finance); revisit if/when real per-user deal ownership matters.

## 2. Contact roles — extend, don't restructure

`client_contacts.role` is already a free-text `VARCHAR(100)` column with real data in it presumably. Don't force it into an enum (breaks existing rows, adds a migration for zero real gain). Instead: document suggested values in the UI (a datalist/autocomplete, not a hard CHECK constraint) — `Decision Maker`, `Billing Contact`, `Technical Contact`, `Primary`. `isPrimary` already exists and is the one role distinction that's actually enforced.

No schema change needed here.

## 3. Deal ↔ contact linking (new, small)

A deal often involves specific stakeholders, not "all contacts at the client." Many-to-many join table, optional to populate — if empty, a deal just implicitly involves all of the client's contacts (current behavior stays the default).

```sql
CREATE TABLE IF NOT EXISTS deal_contacts (
  "dealId"    INTEGER NOT NULL REFERENCES client_deals(id) ON DELETE CASCADE,
  "contactId" INTEGER NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE,
  PRIMARY KEY ("dealId", "contactId")
);
```

## 4. Activity — extend `client_touchpoints`, don't duplicate

Add an optional `dealId` so a touchpoint can be tied to a specific deal instead of just the client generally:

```sql
ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS "dealId" INTEGER REFERENCES client_deals(id) ON DELETE SET NULL;
```

**Checked against the actual rollup query** (`server/routes/clients.js:166-172`, the client-detail activity feed): it filters `WHERE tp."clientId" = $1` directly — every touchpoint is created through `POST /:id/clients/:id/touchpoints`, which always sets `clientId` from the URL param. So `dealId` is purely additive tagging on a row that's always client-scoped already, never an alternative path to the client. **No parallel join needed** — unlike the Tasks case below, this one doesn't need a query fix.

Auto-logging plan (Phase 2 of the CRM feature, not MVP): once Finance and Gmail-search touchpoints are wired to write here automatically (via `SuggestionService`-style capture, not `SuggestionService` itself — this is a direct data write, not an inbox suggestion), the client detail page's activity feed becomes real without extra UI work, since it already reads `client_touchpoints`.

## 5. Tasks integration (new, small)

`tasks` currently has no direct client link — Tasks reaches a client only by joining through `projects.clientId`, which means a task not attached to a project can't be tied to a client at all.

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "clientId" INTEGER REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "dealId"   INTEGER REFERENCES client_deals(id) ON DELETE SET NULL;
```

Both nullable, both independent of `projects.clientId` — a task can be tied to a client/deal directly, or via a project, or both, or neither.

**Unlike touchpoints, this one is a real gap that needs query fixes** — checked two concrete spots that currently reach a client *only* through `projects.clientId`, both of which would silently miss a directly-linked task once this column exists:

1. `server/routes/clients.js:182-197` — the client-detail "open tasks" list. Currently: collect `activeProjectIds` for the client, then `SELECT ... FROM tasks WHERE "projectId" = ANY($1)`. Fix: also `OR t."clientId" = $clientId`, deduped (a task could theoretically have both a matching project and a direct clientId — unlikely but dedupe by task id regardless).
2. `server/routes/tasks.js:229-244` — the morning-digest overdue/today queries, `LEFT JOIN projects p ... LEFT JOIN clients c ON c.id = p."clientId"` for display purposes (`clientName` in the digest text). Fix: add a second `LEFT JOIN clients c2 ON c2.id = t."clientId"` and use `COALESCE(c.name, c2.name) AS "clientName"`.

Both fixes land in the same PR as the column addition — not deferred, since the column is useless (data goes in, never comes back out in these two views) until they're done.

## 6. Routes/services (naming, following existing convention)

- `server/routes/deals.js` — CRUD for `client_deals` + `deal_contacts`, mounted `/api/deals`, behind the existing `clients` feature flag (not a new flag — it's part of the same CRM surface).
- Extend `server/routes/clients.js`'s client-detail endpoint to include open deals (mirrors how it already includes projects/tasks/finance summary/mood).
- Extend `server/routes/tasks.js` list/detail queries to join `clients`/`client_deals` when those FKs are set (mirrors the existing `projects` join pattern already in that file).

## 7. Dashboard/reporting (Phase 2 of the feature, not MVP)

Once `client_deals` has real data: pipeline value by stage, win rate, stale-deal flag (`stage` not `won`/`lost` and `updatedAt` > N days ago → `SuggestionService.captureIf`, matching the mandatory-suggestions convention already in this codebase).

## Sequencing

1. `client_deals` + `deal_contacts` + basic CRUD routes — the actual missing concept, do this first.
2. `client_touchpoints."dealId"` (no query fix needed) + `tasks."clientId"/"dealId"` (**with** the two query fixes above, same PR) — small, additive, no risk to existing data, but the Tasks half isn't done until those queries are updated.
3. Client-detail page surfaces deals (reuse the existing `ClientDetailPage.jsx` pattern).
4. Auto-logging into `client_touchpoints` from Finance/Gmail.
5. Dashboard/reporting.

Nothing here requires touching the already-completed `clients`/`fin_clients` merge — nothing above is a repoint or a rename, every item is a pure addition (new tables, nullable FK columns). Lowest-risk phase of the whole CRM build so far.
