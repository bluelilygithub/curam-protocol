> **Superseded 2026-09-21 by a scope-down addendum**: Cases' Open/Waiting/
> Closed workflow + Steps checklist is paused (schema stays, not extended
> further). The client page now has one input box + one feed (Activity)
> plus a `needsFollowUp` flag (Outstanding) instead of a state machine.
> Sections §3 (Cases) and §6 (UI collapse) below are historical — the
> resulting page shape is: Outstanding, Activity (single box + feed),
> Tasks/Deals/Contacts/Projects unchanged. `client_interactions` gained
> `needsFollowUp BOOLEAN`. Touchpoints/Communications sections retired
> (folded into Activity); their component code is left unused, not deleted.
>
> **Addendum 2 (same day):** `client_interactions` gained `taskId` (nullable
> FK -> `tasks`) so a saga spanning several log entries can be grouped under
> one Task instead of scattering unrelated-looking rows. LogActivity gained
> an optional "attach to task" picker. No `taskId` exclusion in the
> client-wide feed (unlike `caseId`) — confirmed reasoning: no competing
> "task history" view exists elsewhere on the page, so showing it in both
> places isn't the Cases-style duplication bug. `GET /api/tasks/:id/activity`
> (new) + a read-only log on each CRM task row (`TaskActivityLog`) is the
> "Task detail view" called for — there's no single app-wide Task detail
> component to hang it off (verified: TasksPage/FocusMode/ClientDetailPage
> each render tasks inline, independently), so this is scoped to CRM-linked
> tasks specifically, not retrofitted across all ~20 Task surfaces.
> Completing a `clientId`-set task from any surface now returns
> `crmFollowUp` in the `PUT /api/tasks/:id` response; `apiClient.js`'s `put()`
> — the one function all ~20 surfaces already funnel through — surfaces it
> as a toast linking to `/clients/:id?logTask=:taskId`, skipped if already on
> that client's page. Toast gained an optional `action: {label, href}`
> (`toastStore.js` + `Toast.jsx`) to support the link.

> **Locked spec (same day, supersedes chat history and prior addenda
> individually):** see the "CRM Spec — Consolidated, Locked" document text
> for the four requirements and locked decisions. Status of its open items:
> - **"+step" question — answered:** `ClientTasksSection`'s subtask button
>   (`tasks.parentTaskId`) predates Cases entirely and is unrelated to it —
>   Cases' own step mechanism (`caseId`-tagged tasks) is separately dead
>   code in `CaseDetail`. Both a subtask checklist and a task-linked
>   activity log now coexist on a task, intentionally, not by accident.
> - **Duplicate-note bug — root-caused, not a double-write:** checked the
>   two BTMB rows directly in the DB — different `createdAt` (~30 min
>   apart), slightly different text (user re-typed it). The real bug was
>   `fmtRelative()` truncating to day-only granularity, so two different
>   same-day entries rendered identically as "Today" with no way to tell
>   them apart. Fixed: today/yesterday now show time-of-day.
> - **Attachments — shipped:** reused the existing entity-attachment system
>   as-is. Activity log entries: file input on `LogActivity`, uploaded via
>   the already-existing `POST /api/clients/:id/touchpoints/:id/attachments`
>   right after the note is created; shown via `AttachmentChip` in
>   `ActivityFeed` (new: `GET /api/clients/:id/activity` now bulk-joins
>   attachments). Tasks: confirmed already covered for free — `TasksPage`'s
>   edit modal already has full attachment upload/view/delete for any task,
>   CRM-linked or not; no new code needed there.

> **Addendum 3 (same day):** new `client_custom_fields` table (id, clientId,
> label, value, createdAt) — durable facts about a client (ABN, an AdWords
> login, a reference number), distinct from the timestamped Activity/Tasks
> log; edited in place, nothing written to `client_interactions`. New
> "Info" section on the client page (peer of Outstanding/Activity/Tasks)
> shows Notes/How-they-work (existing fields, moved here from a standalone
> always-visible block above the sections — one place for client reference
> info instead of two), the custom-field list, and client-level attachments
> (entityType `'client'` on the existing generic attachment system — no new
> upload code; `loadOwnedAttachment` in `server/routes/attachments.js`
> gained a `'client'` case). **Never for credentials** — enforced via UI
> copy + this doc, not a technical filter (no reliable way to detect "this
> value is a password" from free text).

# CRM Data Model — Activity/Case/Contact Unification

Spec for the CRM's overlapping concepts (Touchpoints, Tasks, Communications, Cases), written to replace reactive per-feature additions with one design checked up front. Where old code conflicted with this spec, the spec won unless noted "fixed, unchanged." Decisions below are final for this phase — do not re-derive intent from old code or extend beyond what's written here without flagging the addition and reason first.

## 1. Fixed points — do not touch

**`clients`** — core entity table, unchanged.

**`tasks`** — verified genuinely mature (20 frontend surfaces: Kanban, Calendar, Goals, Projects, mobile tile, focus mode, weekly review, quick capture, imports, at-mentions). A forward-looking work-item engine (status, priority, recurrence, time tracking, OKR linkage via `keyResultId`, share tokens, Kanban ordering) — structurally distinct from a past-tense activity log. Does **not** absorb Touchpoints/Communications/Case updates as a "type" of task.

One additive change: `tasks."contactId"` (nullable FK → `client_contacts`) — enables "everything involving this contact" queries that had no join path before.

## 2. `client_interactions` — the "what happened" layer

Kept this name (not renamed to `activities` — renaming for spec-word-match with zero functional gain repeats the exact pattern this spec exists to stop). Single past-tense log; every touchpoint, deal stage-change, contact add/remove, and case update is one row here.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `clientId` | FK → clients | required |
| `contactId` | FK → client_contacts | nullable |
| `dealId` | FK → client_deals | nullable |
| `caseId` | FK → client_cases | nullable |
| `type` | enum | `call, email, meeting, decision, milestone, other, deal_stage, contact, note, case_update` — the spec's original five plus the pre-existing real distinctions (`decision`/`milestone`/`other` are live Touchpoints dropdown options; `deal_stage`/`contact` are system-generated bookkeeping types). Collapsing these into a generic `note` would be a regression, not compliance. |
| `source` | enum | `manual, gmail_sync, system` — `system` covers `deal_stage`/`contact` rows (nobody typed them); `manual` covers everything a user typed, including a Case's quick-log entry |
| `date` | `TIMESTAMPTZ`, default `NOW()` | widened from `DATE` — a same-day chronological feed doesn't sort correctly on date-only precision, which undermines the one thing this whole model exists to deliver. Manual entry defaults to "now," editable. |
| `title` | text | |
| `note` | text | |
| `userId` | FK → users | who logged it (`system`-source rows still record who triggered the action, e.g. who changed the deal stage) |

## 3. `client_cases` — the "open thread" layer

Stays a distinct table — a stateful container (`open`/`waiting`/`closed`), not a timeline. A case's detail view is `client_interactions` + `tasks` both filtered by `caseId` — no separate log structure of its own.

Additive: `client_cases."contactId"` (nullable FK → `client_contacts`).

**Status:** shipped, not yet validated against a real workflow. Don't add Case-specific features speculatively until one real case has been run end-to-end.

## 4. Contacts — extend, don't rebuild

`client_contacts` is real but thin (1 frontend consumer, only FK is to `clients`) — low-risk to extend precisely because nothing has calcified around it yet.

Open question, deliberately not built ahead of a decision: should an interaction ever reference *multiple* contacts (e.g. a meeting with two stakeholders)? `deal_contacts` already solves this pattern for deals — reuse it (`activity_contacts` join table) if/when needed. A single nullable `contactId` is sufficient for now.

## 5. Gmail / Communications

Two very different builds were hiding behind "wire Gmail sync":
- **Small (chosen):** a "Save as activity" button on a search result → one `client_interactions` row, `source: 'gmail_sync'`. Not yet built.
- **Large (explicitly rejected for this phase):** background polling/cron, dedup, retry — a separate project, not scoped here.

Once built, Communications stops being a separate section — a synced email is a `source` filter on the Activity feed, same as everything else.

## 6. UI collapse (not yet done)

Target end state on the client detail page:
- **Tasks** — stays its own section, unchanged.
- **Activity** — one feed, filterable by `type`/`source`. Must port Touchpoints' existing features (file attachments per entry, the "+ Follow up → creates a Task" bridge) into the feed UI — collapsing sections must not drop functionality.
- **Cases** — stays its own section; its expanded view is `client_interactions`/`tasks` filtered by `caseId`, not a separate rendering path.

Deals/Contacts/Projects sections are explicitly out of scope for this collapse — stay as-is.

## 7. Build order

1. ✅ Additive schema: `tasks.contactId`, `client_cases.contactId`, `client_interactions` widened (`source` column, `date`→`TIMESTAMPTZ`, `type` enum extended).
2. Wire Gmail's "Save as activity" button (small version only).
3. Validate one real case end-to-end before adding anything else to Cases.
4. Collapse the client detail page UI (§6) — port attachments + follow-up bridge into the Activity feed, retire the standalone Touchpoints/Communications sections.
5. Workspace-level views (last): "my open cases," "recent activity," "contacts untouched in 30 days" — all `clientId`-scope-dropping queries, cheap once the above is consistent.

Do not add columns, tables, or UI sections beyond what's written here without flagging the addition and the reason first.
