# Tickets

Internal work items for running the business: client work, bugs in Vault or the sites and apps we build, admin, and ideas. **Not** a
client-facing helpdesk: nobody outside Vault raises or sees a ticket. Built 2026-11-24 (stage 1 of 2).

## Who sees what

- Behind the `tickets` feature (Settings → Feature Access). Off for members by default; admins can always open it.
  Vault's switches work workspace-wide: turning Tickets on gives it to every member, and a member can then be switched **off** individually
  (a per-person override can only turn a feature off).
- **Everyone with access sees and changes every ticket** (the owner's choice). The `tickets` table has no owner column; `createdBy` and
  `assigneeId` record who raised it and who has it. The cross-user test lists the ticket routes in `SHARED_BY_DESIGN` / `WRITES_BY_DESIGN`.
- Only people with Tickets can be assigned (`services/tickets.js people()`: admins, plus members whose flags have `tickets: true`).
- A client or client project can only be **linked** by someone whose CRM holds it (`plans.resolveClientLink`, the same check Plans and
  Diagrams use). Everyone sees the linked name. Someone without that client can still change the ticket's other fields.

## A ticket

| Field | Values |
| --- | --- |
| Number | `T-<id>` |
| Type | client (Client work), bug, admin, idea |
| Status | open, in_progress (In progress), waiting, done (`closedAt` set; cleared when reopened) |
| Priority | high, medium, low |
| Due date | a DATE (sent and returned as `YYYY-MM-DD` text) |
| Client / client project | optional (`clients`, `projects` with projectType 'client') |
| Raised by / assigned to | `users` (people have only an email; the page shows the part before @) |
| Source | `sourceKind` note, client, client_project or ef_case, plus `sourceId` and a short `sourceLabel` |

`ticket_events` holds the activity: `comment` (removable by its writer or an admin) and `change` (written by `update()` in plain words, for
example "Status: Open → In progress; Assigned: none → mike@…"; never removable).

## Routes (`server/routes/tickets.js`, mounted at `/api/tickets` behind `requireFeature('tickets')`)

List with filters (`q` also finds `T-12`; `status=active` means not done; `assigneeId=me|none|<id>`; `overdue=true`), counts for a badge,
people, AI draft, create, read, update, delete (recycle bin), comments, and "Make a task". Every change and its history line are written in
one transaction.

## AI from text

`POST /api/tickets/draft { text }` (`services/ticketDraft.js`, behind `aiLimiter`). One call on the workspace's standard model. The model
sees the text, today's date and the **names** of the caller's own clients (not archived), fenced so the text cannot pass as instructions.
Its answer is checked: unknown type or priority fall back, a past or malformed due date is dropped, the client must match a name in the
list exactly, at most 8 steps (added to the description as a check-list). Nothing is saved; the form shows the result to check.
Usage is logged as `tickets_draft`.

## Make a task

Creates a task in the **caller's own** Tasks (`tasks."ticketId"` points back) with the ticket's title (or one given), due date and
priority. The ticket's client and client project are copied only when they are in the caller's own CRM. The ticket's history records it.
Deleting the ticket leaves its tasks (the link is emptied).

## Delete and restore

Delete snapshots the ticket and its history into the deleter's recycle bin (`recycleBin/adapters/tickets.js`); restore puts it back under
the same number when free. A client, project or person that has gone since is emptied. Tasks made from it are not re-linked
(shortcut noted in the adapter).

## Page (`/tickets`, `/tickets/:id`)

Looks like the CRM page (`pages/tickets/ticketUi.jsx` copies its buttons, fields, chips and badges). The list has status chips (Active is the
default), type chips, Mine, Overdue, search, priority and assignee filters. The ticket page saves each field as it changes, has the
description, the activity thread with comments (the shared microphone everywhere text is typed), tasks made from it, Make a task and Delete
(with Undo). `/tickets?new=1&title=&clientId=&clientProjectId=&type=&sourceKind=&sourceId=&sourceLabel=` opens New ticket filled in: stage 2's
"Make a ticket" buttons will use it.

## Stage 2 (not built yet)

"Make a ticket" on Notes, client and project pages (with a Tickets list there) and Email Follow-Up cases; a daily email digest (overdue, due
today, newly assigned) and a menu badge; the guide chat, tour and job tiles.

## Tests

- `server/routes/tickets.db.test.js` (real database): make, refuse, share, assign, history, done/reopen, filters, comments, tasks, delete and restore.
- `server/services/ticketDraft.test.js`: the AI answer checks, the fence, and the call.
- `client/src/pages/tickets/ticketLogic.test.mjs`: dates, filters, the prefill link, labels.
