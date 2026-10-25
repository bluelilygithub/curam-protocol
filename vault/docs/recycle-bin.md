# Recycle bin (shared, 30 days)

One bin for every tool. When someone deletes something in a tool that uses it, a copy is kept for **30 days** (`RECYCLE_BIN_DAYS` overrides) and can be put back. After that it is removed for good. People see it in **Settings → Recycle bin** (everything) and in a tool's own "Recently deleted" window (that tool's kinds only; Notes has one).

Why a snapshot table and not a `deletedAt` column per tool: a tool's own tables and queries do not change at all. Nothing has to remember a `WHERE "deletedAt" IS NULL`, and a deleted row can never leak into a report, a search or a count. The cost is that a tool has to say how to put its thing back, which is one small function.

## What is where

| Piece | File |
|---|---|
| table `recycle_bin` (`userId`, `entityType`, `entityId`, `title`, `detail`, `payload` JSONB, `deletedAt`, `expiresAt`) | `server/db.js` |
| `moveToBin`, `register`, `list`, `restoreItem`, `deleteForever`, `emptyBin`, `purgeExpired` | `server/services/recycleBin/index.js` |
| one adapter file per tool (registers how to restore) | `server/services/recycleBin/adapters/<tool>.js`, listed in `adapters/index.js` |
| API `GET /api/recycle-bin?types=a,b`, `POST /:id/restore`, `DELETE /:id`, `DELETE /` (empty, `?types=`) | `server/routes/recycleBin.js` |
| daily clean-up (runs everywhere; the list also purges, so it is a tidy-up not a dependency) | `server/cron/recycleBinCron.js` |
| the screen, for any tool | `client/src/components/RecycleBinPanel.jsx` (`types` prop limits it) |
| wording helpers | `client/src/utils/recycleBin.mjs` |

## Adding a tool (about 15 lines)

1. **At delete time**, inside the transaction that removes the row, copy it into the bin:

```js
const db = await pool.connect();
try {
  await db.query('BEGIN');
  const { rows } = await db.query('SELECT * FROM goals WHERE id=$1 AND "userId"=$2 FOR UPDATE', [id, userId]);
  if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
  const binId = await bin.moveToBin(db, {
    userId, type: 'goal', id, title: rows[0].title, detail: 'short line shown in the list',
    payload: { goal: rows[0], keyResults: (await db.query('SELECT * FROM key_results WHERE "goalId"=$1', [id])).rows }, // the row AND anything that cascades with it
  });
  await db.query('DELETE FROM goals WHERE id=$1', [id]);
  await db.query('COMMIT');
  res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
} catch (err) { await db.query('ROLLBACK').catch(() => {}); /* log, 500 */ } finally { db.release(); }
```

2. **Register how to restore**, in `server/services/recycleBin/adapters/goals.js`, and add `require('./goals');` to `adapters/index.js`:

```js
const { register } = require('../index');
register('goal', {
  label: 'Goal', // shown to the person
  async restore(db, userId, payload) {
    // reinsert the row (reuse the old id if free), then its children; return { entityId }
    // a restore runs in a transaction: throw and nothing is changed, the item stays in the bin
  },
});
```

3. **Tell the person**: after the delete, show a toast with an Undo that calls `POST /api/recycle-bin/:binId/restore` (see `undoDelete` in `client/src/pages/NotesPage.jsx`; toast actions accept `{ label, onClick }`). If the tool should have its own "Recently deleted" window, render `<RecycleBinPanel types={['goal']} onRestored={reload} />` in a modal (see `client/src/pages/notes/RecentlyDeletedModal.jsx`). Settings → Recycle bin already shows it with no change.

4. **Test it** like `server/routes/recycleBin.test.js` does with a made-up tool: delete, list, restore, failed restore leaves the item in the bin, another person cannot see it.

## Putting a row back without listing its columns (`rowRestore.js`)

`insertRow(db, 'tasks', row, { userId, override })` in `server/services/recycleBin/rowRestore.js` re-inserts a `SELECT *` snapshot: only columns that still exist are written, the old id is reused when free, `"userId"` is set, and a link to another table whose target has gone since is left empty (so the row comes back without it instead of failing). `override` sets columns you changed by hand (for example the new parent id of a subtask). Tasks and Goals use it; adapters are then only about children, links and files.

## Cleaning up what the bin does not hold (optional `discard`)

If the thing has files (or anything else outside the snapshot), register `discard(db, userId, payload)` next to `restore`. It is called once the item is gone for good (30 days passed, Delete forever, Empty bin) and should remove those files; it must not throw (errors are logged and swallowed). Notes uses it for attached files.

## Rules for adapters

- **Snapshot everything that disappears with the row** (children with `ON DELETE CASCADE`, join rows, tags). A restore must not need anything that is gone.
- **Reuse the old id when it is free** so anything that pointed at the row still does; fall back to a new id if it was somehow taken.
- **Links to other things may have gone** (a project deleted in the meantime): check they still exist and restore without the link rather than failing. Unique constraints too (Notes' daily note comes back as an ordinary note if that day was made again).
- **Do not restore files on disk** unless the tool keeps them: if a tool stores uploads on the Railway volume, deleting the row must not delete the file until the item leaves the bin, or the restored row will point at nothing. (No adapter does this yet; decide per tool.)
- One item is limited to 5 MB of payload; a bigger one is refused (`moveToBin` throws an error with `code: 'TOO_LARGE'`) rather than silently dropped, so do not put file contents in a payload. A kind that is naturally big can pass `maxBytes` and decide what to do on `TOO_LARGE` (chats: 25 MB, then the old Deleted list).
- Never put anything in a payload the person could not already see.

## Used by

- **Notes**: `note` (with its tags), `note-template` and `note-view` (a saved view). Delete a note or a template and it lands here. See `docs/notes.md`.
- **Tasks**: `task` (`adapters/tasks.js`): the task with its subtasks, tags, comments, blocked-by links, share link and files; single delete and bulk delete (one bin item per task; a subtask picked with its parent travels inside the parent's item). The files stay on disk and in `attachments` while it waits (the payload lists them) and are removed by `discard`. **Stopping a series** bins the task you deleted only; the later not-yet-done repeats are removed for good as before. Links from CRM follow-ups / fitness sessions / touchpoints that pointed at the task are not restored (they were cleared by the database when it went). Undo toast: `client/src/utils/binUndo.js` (`offerUndo`).
- **Goals**: `goal`: the objective with its key results and which tasks were linked to them (a restore links them again, unless the task was linked elsewhere meanwhile). Deleting a single key result is still permanent.

- **Chats**: `chat` (`adapters/chats.js`): the session, every message (same ids, so bookmarks still match), the bookmarks, which files were attached and which study decks came from it. `DELETE /api/chat/sessions/:id` snapshots it, puts it in the bin and then removes it for good (messages have no foreign key to sessions, so `removeChat` deletes them by hand); the session owner or the owner of its project may delete. Restore puts it back under its project if that still exists (otherwise as an ordinary chat), still belonging to the person it belonged to, moved to the top of the list; files and decks that have gone are skipped. Undo toast in `ChatPage.jsx`; Chat History -> Deleted shows the bin's chats first (`<RecycleBinPanel types={['chat']}>`). **Chats that were already in the old Deleted list (`sessions."deletedAt"`) were left there**: they are not in the bin and are never removed after 30 days; restore them with `POST /api/chat/sessions/:id/restore` as before. A chat over 25 MB of text does not fit the bin: the delete falls back to that old Deleted list (`legacy: true` in the response) instead of failing. Local tests cannot check `summaryEmbedding` (needs pgvector); it is copied back as text like the chat code writes it. Test: `server/routes/chatRecycleBin.test.js`.

- **Route Tracer**: `route-track` (`adapters/routeTracks.js`): a saved track with its line and directions; single and multi-select delete; Undo on the page. See `docs/route-tracer.md` ("Delete and the recycle bin").

- **Graphics recipes**: `graphics-recipe` (`adapters/graphicsRecipes.js`): a saved Graphics recipe (its steps and output format; settings only, no pictures). `DELETE /api/graphics/recipes/:id` in `server/routes/graphics/recipes.js`; Undo toast on the Pipeline screen; a restore is refused with a plain message past the 50-recipe limit. See `docs/graphics-tools.md` ("Saved recipes").

Candidates to adopt next (not done): saved CSS pages, Room/Garden/Cellar planner projects, Finance documents, saved fonts. Each needs the three steps above; for planner projects the whole project JSON is the payload.

Chats are in the bin since 2026-10-24 (see Used by).
