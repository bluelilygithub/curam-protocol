# Notes

Page `client/src/pages/NotesPage.jsx` (`/notes`), API `server/routes/notes.js` (`/api/notes`), table `notes`. Private to the person who wrote them (no sharing). Voice notes: `docs/voice-notes.md`.

## What it does

- **List**: `GET /api/notes` sends a short `preview`, never the whole text; 100 at a time (`X-Has-More`). Filters: search (title, text, project, client, tag), date range (edited or created), project, client, tags (a note must have ALL picked tags), `untagged`. Group by Date, Project, Client or Tag (`client/src/pages/notes/noteGroups.mjs`, pure and tested). Pinned notes lead in their own section.
- **Editor**: autosave (queued, flushes on switching notes / hiding the tab), Write / Preview (markdown through the shared `react-markdown`; tick-boxes in Preview write back into the text), project and client, tags, dictation, `@` pull-ins (web, Gmail, Calendar), AI actions (summary, to-dos to tasks, tidy up, tags, title — they only propose, `server/services/noteAi.js`).
- **Phone**: the list is the whole screen; a note opens full screen with a back arrow; filters and the AI menu are bottom sheets.
- **Tags**: table `note_tags (note_id, user_id, tag)`. One rule for what a tag is (`server/services/noteTags.js`, copied in `client/src/pages/notes/noteTags.mjs`, a test keeps them equal). Rename (merges) and remove everywhere from Manage tags.
- **Templates**: built in (`noteTemplates.mjs`, filled with `{{date}}`, `{{isodate}}`, `{{weekday}}`, `{{time}}`) and the person's own (table `note_templates`, up to 50, saved from an open note). New note → From a template.
- **Daily note**: the calendar-tick button. `POST /api/notes/daily { date, title, body }` (the person's own day, sent by the browser): returns the existing note for that day or makes it, tagged `daily`, carrying over the unticked to-dos of the most recent earlier daily note (`server/services/noteDaily.js`). One per person per day (`notes.daily_date` unique index plus an advisory lock so two devices cannot make two).
- **Saved views**: a name for a combination of search, date range, project, client, tags and grouping (table `note_views`, up to 30, unique names). The server decides what a view may hold (`server/services/noteViews.js`: known fields and values only); the browser compares and describes them (`client/src/pages/notes/noteViews.mjs`). Date ranges stay relative. A view whose project or client has been deleted drops that part with a message. Changing the filters after opening a view offers Update. The Views button sits beside Filters (`NoteViewsMenu.jsx`).
- **Reminders**: one per note (`notes.remind_at`, `remind_email`, `reminder_sent_at`, `reminder_done_at`). The clock button beside project/client sets it (quick times or a date and time, optional "also email me"). When it falls due the note shows under **Reminders due** at the top of the list (the browser decides this from the date, so it works with no server job) with a Done / Snooze banner; `PUT /api/notes/:id/reminder`, `POST /:id/reminder/done`, and `?reminder=due|upcoming|any` on the list (also part of saved views). Emails: `server/cron/noteRemindersCron.js` every five minutes (skipped where `DISABLE_EXTERNAL_CRON` is set) runs `runNoteReminders` in `server/services/noteReminders.js`: it claims each due reminder in the database first (`FOR UPDATE SKIP LOCKED`), mails the person's own login address once, puts a failed one back for the next run (not after a day late), and tells the Suggestions inbox when a send fails. Reminders are filing, so they do not change `updated_at`, and they do not repeat.
- **Ask your notes**: the speech-bubble button opens a chat that answers from the person's own notes only, with the notes it used shown as numbers to open (`AskNotesPanel.jsx`, `server/services/noteAsk.js`, `POST /api/notes/ask`, history in `note_qa`, newest 100). Three steps: a **plan** (light model: keywords, a date range, tags, a client or project, only ones that exist, checked in code), **find** (Postgres full-text search, `to_tsvector('english', ...)` with title and tags weighted above the text, prefix matching so "budgets" finds "budget"; if the filters match nothing it widens, then falls back to the most recent notes, and the answering model is told which happened) and **answer** (standard model, only the numbered notes, citations checked: a `[n]` outside the notes given is removed). The scope is All my notes, This list (the list's own filters, through the same `server/services/noteQuery.js` the list uses) or This note. Every query starts from the owner check, note text goes only into the question part of the prompt (never the instructions, and the prompt says it is data), and a question with nothing to read is answered without calling a model. About a dozen notes of up to 3,000 characters (30 shorter ones for a summary), 36,000 characters in all. No embeddings, so it works without pgvector; add them if full-text search proves too literal.
- **Recently deleted**: deleting a note, a template or a saved view goes through the shared recycle bin (`docs/recycle-bin.md`) for 30 days, with Undo in the toast and a Recently deleted window; the same items show in Settings → Recycle bin.

## Same conventions as the other tools (Video Tools, Measurements)

- **Tooltips**: the shared `components/Tooltip.jsx` on every control, never a native `title=""`. The wording is in one file, `client/src/pages/notes/noteTips.mjs`; add a tip there when you add a control.
- **(i) box**: `ToolInfoModal` "How Notes Works" (words in `notesInfo.mjs`), opens once per browser (`vault_notes_info_seen`), reachable from the (i) beside the title.
- **Tour**: `client/src/utils/tours/notesTour.js` (Shepherd, 14 steps, key `vault_tour_notes_completed`), the compass beside the title, and Settings -> Tours -> Notes Tour (`/notes?tour=1`). Steps point at `data-tour="notes-..."` attributes; on a phone the tour closes or opens a note as the step needs and creates nothing.
- **Guide chat**: `NotesTutorChat` (shared `TutorChat`), `server/services/notesTutor.js`; update the `CATALOG` and `notesTools.mjs` together.
- `client/src/pages/notes/noteTips.test.mjs` enforces all of this: no native titles, every tip used, every tour step points at something real, the step count is right, the Settings card and the guide exist.

## Rules worth remembering

- A note's tags, pin, reminder and filing (project/client) are *filing*, not editing: they do not change `updated_at`.
- `project_id` and `client_id` are checked to be the caller's own on every write.
- `daily_date` is a SQL `DATE`: always cast with `::text` (pg returns a JS Date at local midnight otherwise).
- Named routes before `/:id` in `notes.js` (`/tags`, `/templates`, `/daily`, `/options`, `/voice`).
- When a feature or control changes, update `notesTools.mjs` and the guide `CATALOG` in `server/services/notesTutor.js` together (a test fails if they drift).

## Tests

`npm run test:notes` (pure helpers, the AI service, and `server/routes/notes.test.js` against a local Postgres); `npm run test:recycle-bin`; `npm run test:notes-voice`; `npm run test:notes-tutor`.

## Not built (ideas)

Repeating reminders, semantic (embedding) search for Ask, links between notes, attachments, version history, export.
