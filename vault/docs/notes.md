# Notes

Page `client/src/pages/NotesPage.jsx` (`/notes`), API `server/routes/notes.js` (`/api/notes`), table `notes`. Private to the person who wrote them (no sharing). Voice notes: `docs/voice-notes.md`.

## What it does

- **List**: `GET /api/notes` sends a short `preview`, never the whole text; 100 at a time (`X-Has-More`). Filters: search (title, text, project, client, tag), date range (edited or created), project, client, tags (a note must have ALL picked tags), `untagged`. Group by Date, Project, Client or Tag (`client/src/pages/notes/noteGroups.mjs`, pure and tested). Pinned notes lead in their own section.
- **Editor**: autosave (queued, flushes on switching notes / hiding the tab), Write / Preview (markdown through the shared `react-markdown`; tick-boxes in Preview write back into the text), project and client, tags, dictation, `@` pull-ins (web, Gmail, Calendar), AI actions (summary, to-dos to tasks, tidy up, tags, title — they only propose, `server/services/noteAi.js`).
- **Phone**: the list is the whole screen; a note opens full screen with a back arrow; filters and the AI menu are bottom sheets.
- **Tags**: table `note_tags (note_id, user_id, tag)`. One rule for what a tag is (`server/services/noteTags.js`, copied in `client/src/pages/notes/noteTags.mjs`, a test keeps them equal). Rename (merges) and remove everywhere from Manage tags.
- **Templates**: built in (`noteTemplates.mjs`, filled with `{{date}}`, `{{isodate}}`, `{{weekday}}`, `{{time}}`) and the person's own (table `note_templates`, up to 50, saved from an open note). New note → From a template.
- **Daily note**: the calendar-tick button. `POST /api/notes/daily { date, title, body }` (the person's own day, sent by the browser): returns the existing note for that day or makes it, tagged `daily`, carrying over the unticked to-dos of the most recent earlier daily note (`server/services/noteDaily.js`). One per person per day (`notes.daily_date` unique index plus an advisory lock so two devices cannot make two).
- **Recently deleted**: deleting a note or a template goes through the shared recycle bin (`docs/recycle-bin.md`) for 30 days, with Undo in the toast and a Recently deleted window; the same items show in Settings → Recycle bin.

## Rules worth remembering

- A note's tags, pin and filing (project/client) are *filing*, not editing: they do not change `updated_at`.
- `project_id` and `client_id` are checked to be the caller's own on every write.
- `daily_date` is a SQL `DATE`: always cast with `::text` (pg returns a JS Date at local midnight otherwise).
- Named routes before `/:id` in `notes.js` (`/tags`, `/templates`, `/daily`, `/options`, `/voice`).
- When a feature or control changes, update `notesTools.mjs` and the guide `CATALOG` in `server/services/notesTutor.js` together (a test fails if they drift).

## Tests

`npm run test:notes` (pure helpers, the AI service, and `server/routes/notes.test.js` against a local Postgres); `npm run test:recycle-bin`; `npm run test:notes-voice`; `npm run test:notes-tutor`.

## Not built (ideas)

Reminders on a note, "ask your notes" chat, saved views, links between notes, attachments, version history, export.
