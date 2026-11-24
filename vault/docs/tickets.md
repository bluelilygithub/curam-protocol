# Tickets

Internal work items for running the business: client work, bugs in Vault or the sites and apps we build, admin, and ideas. **Not** a
client-facing helpdesk: nobody outside Vault raises or sees a ticket. Built 2026-11-24 in two stages.

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

## Make a ticket (stage 2)

`pages/tickets/MakeTicketButton.jsx` (hidden without the feature) opens New ticket through `newTicketHref` (`pages/tickets/makeTicket.mjs`):
from an open note (beside Make a plan: title, text cut to 1,500 characters, the note's client) and from an Email Follow-Up case (name, what is
owed, client). Client pages have a **Tickets** tab and client project pages a **Tickets** section (`components/ClientTickets.jsx`, like
ClientPlans): open first, New ticket already filed under them, and Open in Tickets (the list filtered by `?clientId=` or `?clientProjectId=`,
with a Show all chip). Each ticket made this way links back to its source.

## Daily digest and badge (stage 2)

`cron/ticketDigestCron.js` runs `runDigest()` (`services/ticketDigest.js`) at 07:00 in the workspace time zone (the first admin's
`user_timezone`, default Australia/Sydney), with the other email crons (off under DISABLE_EXTERNAL_CRON). Each person who can use Tickets gets
one email listing their open tickets that are **overdue**, **due today**, and **newly assigned** to them by someone else since their last digest
(raised already assigned to them, or an "Assigned: ... → them" history line); each ticket once. Nothing is sent when all three are empty.
`ticket_digest_log` holds each person's last day: claimed before sending, so a restart or a second server cannot send twice; a failed send
gives the day back. There is no per-person opt-out yet.

The Tickets item in the Apps menu shows the number of open tickets assigned to you (`GET /api/tickets/counts`; red when any are overdue), and
the Apps button gets a dot when something is overdue. It refreshes every 5 minutes and after a change on the Tickets pages.

## Guide and tour (stage 2)

The round guide button on both views is the shared guide chat (`pages/tickets/TicketsTutorChat.jsx`, `services/ticketsTutor.js`, mounted at
`/api/tickets-tutor` behind the feature and `aiLimiter`, registered in `server/config/guides.js`). Its catalogue is
`pages/tickets/ticketsTools.mjs`; `ticketsTutor.test.js` keeps the two in step. It sees no tickets. The 6-step tour
(`utils/tours/ticketsTour.js`) starts from the Tour button, Settings → Tours, or `/tickets?tour=1`.

Job tiles ("What do you want to do?", `pages/tickets/ticketGoals.mjs`, shown with the shared `components/JobStart.jsx`) sit above the
filters. Tickets has no tool list, so each job does one thing: it opens New ticket filled in (a type and priority) or sets the filters
(Mine, Overdue). Hide these stores the choice in this browser; the Jobs button brings them back. `ticketGoals.test.mjs` checks them.

## Not built

A client-facing form or portal, email-to-ticket, a board view, custom statuses or fields, time tracking, recurring tickets, attachments,
private tickets, and a per-person switch for the morning email.

## Tests

- `server/routes/tickets.db.test.js` (real database): make, refuse, share, assign, history, done/reopen, filters, comments, tasks, delete and restore.
- `server/services/ticketDraft.test.js`: the AI answer checks, the fence, and the call.
- `server/services/ticketsTutor.test.js`: the guide catalogue matches the page, and its facts, gaps and rules.
- `server/services/ticketDigest.db.test.js` (real database): who gets what, once a day, a retry after a failed send, the time zone.
- `client/src/pages/tickets/ticketLogic.test.mjs`: dates, filters, the prefill link and its round trip, labels.
