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

**One task per ticket.** A second Make a task is refused (409). Tickets made before this rule may have several, and everything below
handles them. Once a ticket has a task, the button becomes **Open task** (`/tasks?task=<id>`, which opens that task in the List view)
for the person whose task it is, and "Task in someone else's Tasks" for everyone else, as tasks are private. If the task is deleted, the
link is emptied and Make a task comes back. The task's open panel shows **From ticket T-12: title**, which opens the ticket (only for
people with Tickets). The ticket page reloads when its browser tab gets focus again, so a task finished in another tab shows at once.

## Tasks move the ticket

`tickets.syncFromTask()`, called from every place a task's status changes in Tasks (the task screen, bulk changes, a to-do ticked in a note)
whenever the task becomes done or stops being done, and after Make a task. In one transaction:

- the history notes it: "Task done: …" or "Task reopened: …";
- when **every** task made from the ticket is done, the ticket moves to **Waiting** for a last look (reply to the client, check the fix,
  add a note). It never moves to Done on its own: closing is a person's decision;
- an open task (one reopened, or a new one made) moves a **Waiting** ticket back to **In progress**, with the reason in the history;
- a **Done** ticket, and a ticket with no tasks, never move on their own.

The 7am email leaves Waiting tickets out of "overdue" and "due today". Deleting a task does not move the ticket.

## Delete and restore

Delete snapshots the ticket and its history into the deleter's recycle bin (`recycleBin/adapters/tickets.js`); restore puts it back under
the same number when free. A client, project or person that has gone since is emptied. Tasks made from it are not re-linked
(shortcut noted in the adapter).

## Page (`/tickets`, `/tickets/:id`)

Looks like the CRM page (`pages/tickets/ticketUi.jsx` copies its buttons, fields, chips and badges). The lists are in the left-hand menu (see Layout
below); search, type, priority and assignee filters sit above each list. A ticket filed under one of your clients links to
that client's page (`/clients/:id?tab=tickets`, which opens the Tickets tab) and project page; the links show only to the client's owner,
as clients live in each person's own CRM. The ticket page saves each field as it changes, has the
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
one email listing their open tickets that are **overdue**, **due today** (both leave out Waiting tickets), and **newly assigned** to them by someone else since their last digest
(raised already assigned to them, or an "Assigned: ... → them" history line); each ticket once. Nothing is sent when all three are empty.
`ticket_digest_log` holds each person's last day: claimed before sending, so a restart or a second server cannot send twice; a failed send
gives the day back. There is no per-person opt-out yet.

The Tickets item in the Apps menu shows the number of open tickets assigned to you (`GET /api/tickets/counts`; red when any are overdue), and
the Apps button gets a dot when something is overdue. It refreshes every 5 minutes and after a change on the Tickets pages.

## Guide and tour (stage 2)

The round guide button on both views is the shared guide chat (`pages/tickets/TicketsTutorChat.jsx`, `services/ticketsTutor.js`, mounted at
`/api/tickets-tutor` behind the feature and `aiLimiter`, registered in `server/config/guides.js`). Its catalogue is
`pages/tickets/ticketsTools.mjs`; `ticketsTutor.test.js` keeps the two in step. It sees no tickets. The 8-step tour
(`utils/tours/ticketsTour.js`) starts from the compass beside the menu title, Settings → Tours, or `/tickets?tour=1`.

Layout (like Skill Scanner and PDF Tools): the shared `components/ToolSidebar.jsx` menu on the left, with New ticket and the lists
(`TICKET_VIEWS` in `ticketLogic.mjs`: Active, Mine, Overdue, In progress, Waiting, Done, All tickets, and one per type), and "What do you
want to do?" job tiles (`pages/tickets/ticketGoals.mjs`, shared `components/JobStart.jsx`) as the start screen. A list is
`/tickets?view=<id>`; a link from another tool opens Active. "Next time, open on the tool I used last" skips the tiles (this browser
only), and Back to the list from a ticket returns to the last list. Search, type, priority and assignee narrow any list.
`ticketGoals.test.mjs` and `ticketLogic.test.mjs` check the tiles and lists.

## Related emails (`services/ticketEmails.js`, `client/src/pages/tickets/TicketEmails.jsx`)

On the New ticket form and on a ticket's page: **Find emails / Regrab emails** searches the person's own connected Gmail for threads about the
ticket, and shows when it last ran ("Last run 25 Nov, 3:04 pm"). Each thread can be **attached** or **dismissed (✕)**, and a dismissed thread
can be restored from "Show dismissed".

- **Private:** tickets are shared but Gmail is not. Rows in `ticket_emails` and `ticket_email_runs` carry `"userId"`, and every read and
  write filters on the signed-in person, so only the person who found or attached an email ever sees it (subject, sender, date, preview).
- **Dismissing works per ticket:** an excluded thread is never suggested again on that ticket. A regrab deletes only untouched
  `suggested` rows and adds new ones (`ON CONFLICT DO NOTHING`), so attached and excluded threads stay as they are.
- **The search** is a plain Gmail query with no AI: up to six title words, plus the client's contact addresses and email domains when the
  client is in the person's own CRM, limited to the last year. Client mail mentioning a title word comes first, falling back to any recent
  client mail. With no client, a thread has to mention two title words to be shown. At most 15 threads, ranked by matching words, then by
  date. Only headers and Gmail's snippet are read and stored.
- **New ticket form:** nothing is saved until Create, which sends `emails` and `emailsRunAt` with the ticket, both saved in the same
  transaction.
- **Recycle bin:** deleting a ticket deletes its email rows, and restoring the ticket does not bring them back (they are private, and the bin
  holds them for one person only).
- A subject opens the thread in Gmail (`mail.google.com/mail/u/0/#all/<threadId>`). If several Google accounts are signed in, this may
  open the wrong one.

## Not built

A client-facing form or portal, email-to-ticket, a board view, custom statuses or fields, time tracking, recurring tickets, attachments,
private tickets, and a per-person switch for the morning email.

## Tests

- `server/routes/tickets.db.test.js` (real database): make, refuse, share, assign, history, done/reopen, filters, comments, tasks, delete and restore.
- `server/services/ticketDraft.test.js`: the AI answer checks, the fence, and the call.
- `server/services/ticketEmails.test.js`: search words, Gmail queries, ranking, input checks.
- `server/services/ticketEmails.db.test.js` (real database, fake Gmail): emails are private to their owner, dismissed threads stay
  dismissed on a regrab, the last-run time, and the message when Gmail is not connected.
- `server/services/ticketsTutor.test.js`: the guide catalogue matches the page, and its facts, gaps and rules.
- `server/services/ticketDigest.db.test.js` (real database): who gets what, once a day, a retry after a failed send, the time zone.
- `client/src/pages/tickets/ticketLogic.test.mjs`: dates, filters, the prefill link and its round trip, labels.
