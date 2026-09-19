# CRM Phase 3 schema: deals, contact roles, activity, tasks

Builds on the completed `clients`/`client_contacts`/`client_touchpoints`/`client_billing_details` foundation (`docs/crm-migration.md`).

**Status: items 1, 3 (partial), 4, 5 built, frontend built.** Schema + CRUD routes (`server/db.js`/`server/routes/deals.js`) and the `ClientDetailPage.jsx` Deals section (create/edit/delete, stage badges, open-pipeline stat card, deal-tagged touchpoints) are code-complete, pushed, not yet exercised in production. Item 2 (contact roles) needs no schema change, already true today. Item 6 (dashboard/reporting beyond the basic `/api/deals/pipeline` summary and the per-client pipeline stat) is not started — a workspace-wide deals dashboard, not just per-client, would be the next piece.

## 9. Communication history — phase 1 scoping decision (2026-09-18)

Follows the touchpoint→task follow-up bridge (§5). User asked for something closer to a Salesforce-style communication history; scoped down to three separate initiatives rather than built as one ask — this entry covers only the first and smallest.

**Decision: reuse `client_touchpoints.type` as the channel field. No new column, no migration.**

Checked production data first rather than assuming: `SELECT type, COUNT(*) FROM client_touchpoints GROUP BY type` returned exactly one row (`call`, count 1) — the table is effectively unused so far, so there's no drift/inconsistency to clean up, but also nothing to validate reuse against. The decision is "no data cost either way," not "confirmed safe by volume." `type` already carries channel-shaped values (`call`/`email`/`meeting` mixed with non-channel `decision`/`milestone`/`other`, free text, no CHECK constraint) — good enough to filter/group a communication view on directly.

**Other two phase-1 questions:**
- **Manual-only for now.** No Gmail/calendar auto-ingest. Revisit only if the manual log actually gets used.
- **UI placement: filter within the existing Touchpoints section on `ClientDetailPage`, not a new tab.** Lower cost, and the page is already dense with sections.

**Explicitly deferred, not part of this decision:** auto-logging emails/calls, threading, read receipts (all imply an integration, not a data-model change); file attachments on touchpoints (own initiative, §10 candidate, sequenced after this since it depends on the channel view existing first); calendar export (independent, lowest complexity, sequenced last — see chat history for the one-way-export-first reasoning).

**Not yet built:** the actual filter-by-channel UI on the Touchpoints section. This entry is the scoping decision only.

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

## 5. Tasks integration (done)

**Status: write gap closed.** The columns below were added and the read-path query fixes described here were made, but the create/update routes in `tasks.js` never accepted `clientId`/`dealId` in the request body — so nothing could ever populate them through the app. Fixed: `POST /api/tasks` and `PUT /api/tasks/:id` now accept both fields directly (`tasks.js` insert/update statements).

**Touchpoint → task bridge:** `ClientDetailPage.jsx`'s `TouchpointsSection` has a "+ Follow up" action per touchpoint row (inline due-date picker, defaults one week out) that creates a task via `POST /api/tasks` with `clientId`, `dealId` (from the touchpoint if deal-tagged, else null), a title derived from the contact/deal, and `category: FOLLOW_UP_CATEGORY` (`'follow-up'`, `client/src/utils/taskCategories.js` — the one shared constant so the button, any future task-list filter, and digest logic can't drift on the literal). One direction only: touchpoints stay a pure past-tense log and never grow their own scheduling fields — scheduling always means "create a task."

**Known gap, not solved by this pass:** a scheduled follow-up's due date only surfaces via `MorningDigest` (in-app, once per day, pulled on load) — there is no email/push reminder for tasks (Shares/Finance have cron emails, Tasks doesn't). Acceptable for now; revisit only if the follow-up flow sees real use and misses get reported.

**Deliberately deferred:** an automated stale-contact/stale-deal nudge (`SuggestionService.captureIf` on N-days-no-touchpoint) was considered alongside this but cut — it's a different kind of work (a new heuristic/notification concern, not a data-model fix) and belongs in its own pass once usage of the follow-up flow above is observed.

`tasks` previously had no direct client link — Tasks reached a client only by joining through `projects.clientId`, which meant a task not attached to a project couldn't be tied to a client at all.

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

## 7. Dashboard/reporting

**Table view done:** workspace-wide **Pipeline** page (`client/src/pages/PipelinePage.jsx`, `/pipeline`) — flat, cross-client table of every deal (Client | Deal | Stage | Value | Expected close | Actual close), stage multi-select filter, open/all toggle, sortable by close date/value/stage. Backed by `GET /api/deals` (already existed, scoped by `clientId` — extended to support no-`clientId` = all deals, comma-separated multi-stage filter, `sortBy`/`order`). Row click navigates to that deal's client (`ClientDetailPage`) — deals stay client-owned, this is a view, not a new ownership model. Read-only, no new write endpoints.

Deliberately not built this pass (kanban/drag-drop stage changes, aggregate stats like win rate/value-by-stage) — table view first, validate it's useful before adding drag-drop; aggregate stats are the separate item below.

**Not started:** pipeline value by stage / win rate as aggregate stats (distinct from the flat table above), stale-deal flag (`stage` not `won`/`lost` and `updatedAt` > N days ago → `SuggestionService.captureIf`, matching the mandatory-suggestions convention already in this codebase).

## 8. AI agent layer

**MVP done:** `POST /api/clients/:id/summary` (`server/routes/clients.js`) — on-demand only, not cached. Assembles a compact context (client, contacts, up to 15 recent deals, up to 10 recent touchpoints, YTD finance snapshot) and sends it to `getModelsForUser().light` via `callModel()` for a plain-prose 3-5 sentence relationship-health brief (active deals, anything overdue, a suggested next step if obvious). Frontend: "Summarize" button on `ClientDetailPage` header — `ProcessingModal` while generating (per convention for AI calls), result shown in a dismissible panel. `/api/clients` now carries an AI-cost route, so `aiLimiter` was added to its mount in `index.js` — shared budget with the router's CRUD, 30/min is generous enough not to affect normal use.

Later phases, not started: suggest next action / draft follow-up email; auto-qualify leads / predictive scoring (explicitly out of scope per the original "don't build Salesforce's speculative complexity" call).

## Sequencing

1. `client_deals` + `deal_contacts` + basic CRUD routes — the actual missing concept, do this first.
2. `client_touchpoints."dealId"` (no query fix needed) + `tasks."clientId"/"dealId"` (**with** the two query fixes above, same PR) — small, additive, no risk to existing data, but the Tasks half isn't done until those queries are updated.
3. Client-detail page surfaces deals (reuse the existing `ClientDetailPage.jsx` pattern).
4. Auto-logging into `client_touchpoints` from Finance/Gmail.
5. Dashboard/reporting.

Nothing here requires touching the already-completed `clients`/`fin_clients` merge — nothing above is a repoint or a rename, every item is a pure addition (new tables, nullable FK columns). Lowest-risk phase of the whole CRM build so far.

## 10. Attachments — touchpoints + tasks (done, built together)

Originally scoped as touchpoints-only, deferring tasks/thumbnails/quotas/scanning until real usage justified them. User asked for all of it at once — built as one pass rather than staged, noted here so the "wait for a signal" reasoning in chat history isn't misread as still the live plan.

- `attachments` table (`server/db.js`): entity-agnostic (`entityType`/`entityId`), no FK to either `client_touchpoints` or `tasks` — a cascading delete would drop the row but leave the file on disk, worse than no cascade. Every delete path for both entities explicitly cleans up attachment rows + files first (see `server/utils/attachments.js` `deleteAttachmentsForEntityIds`, called from `clients.js`'s touchpoint-delete and client-delete routes, and `tasks.js`'s single-delete, bulk-delete, and stop-series-recurrence paths — enumerated by grep, not assumed).
- Shared policy in `server/utils/attachments.js` (extracted once tasks needed the same logic touchpoints already had): allowlist + 50MB cap matching `server/routes/files.js`'s existing convention, disk under `UPLOAD_DIR/attachments/<touchpoint|task>/...`.
- **Quota**: per-user total across all attachments, default 500MB, `ATTACHMENT_QUOTA_MB` env override. Checked at upload time.
- **"Virus scanning"**: no ClamAV/network scanning service available on Railway, so this is a magic-byte sniff rejecting a file whose actual content is a Windows PE, ELF binary, or shebang script regardless of claimed extension (`rejectIfDisguisedExecutable`) — catches a renamed executable, does **not** scan genuine PDF/DOCX/image content for embedded malware. Named honestly as that limited a control, not oversold.
- **Ownership**: via the owning entity's chain (touchpoint→client, task→userId), never `attachments."userId"` (uploader-for-display only).
- Generic cross-entity `GET /api/attachments/:id/download` and `DELETE /api/attachments/:id` (`server/routes/attachments.js`) — upload stays per-entity (`POST /api/clients/:id/touchpoints/:touchpointId/attachments`, `POST /api/tasks/:id/attachments`) since destination folder and creation-time ownership checks differ per entity.
- Frontend: shared `AttachmentChip` component (`client/src/components/AttachmentChip.jsx`) — image thumbnails (fetched as a blob for the auth header, since `<img src>` can't carry one) or a filename chip otherwise, click to open/download, per-file delete. Used on touchpoints (`ClientDetailPage`) and the task edit modal (`TasksPage`, visible only for an existing task).
- **Read-path convention differs by file on purpose**: `clients.js` bulk-joins attachments for a whole touchpoints array in one query (matches that file's existing contacts/deals/projects pattern); `tasks.js` fetches per-task inside `buildTask()` (matches that file's existing per-row `Promise.all` convention, already N+1 for tags/subtasks/etc. before this change — consistency with each file's own style over a cross-file "correct" pattern).

## 11. Calendar export — one-way `.ics` (done)

Confirmed one-way was the actual need (per `MorningDigest` being in-app-only, not a sync gap) before building. `GET /api/tasks/:id/ics` generates a minimal VCALENDAR/VEVENT from the task's title/notes/dueDate (all-day if the due date has no time component) and serves it as a download; no OAuth, no stored credentials, no cron, no new table. "Add to calendar" button in the task edit modal, shown only when the task has a due date. Two-way sync explicitly not built — different order of magnitude (OAuth, background sync, conflict handling), only worth scoping if one-way turns out insufficient after actual use.
