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

## Cleaning up what the bin does not hold (optional `discard`)

If the thing has files (or anything else outside the snapshot), register `discard(db, userId, payload)` next to `restore`. It is called once the item is gone for good (30 days passed, Delete forever, Empty bin) and should remove those files; it must not throw (errors are logged and swallowed). Notes uses it for attached files.

## Rules for adapters

- **Snapshot everything that disappears with the row** (children with `ON DELETE CASCADE`, join rows, tags). A restore must not need anything that is gone.
- **Reuse the old id when it is free** so anything that pointed at the row still does; fall back to a new id if it was somehow taken.
- **Links to other things may have gone** (a project deleted in the meantime): check they still exist and restore without the link rather than failing. Unique constraints too (Notes' daily note comes back as an ordinary note if that day was made again).
- **Do not restore files on disk** unless the tool keeps them: if a tool stores uploads on the Railway volume, deleting the row must not delete the file until the item leaves the bin, or the restored row will point at nothing. (No adapter does this yet; decide per tool.)
- One item is limited to 5 MB of payload; a bigger one is refused with an error rather than silently dropped, so do not put file contents in a payload.
- Never put anything in a payload the person could not already see.

## Used by

- **Notes**: `note` (with its tags), `note-template` and `note-view` (a saved view). Delete a note or a template and it lands here. See `docs/notes.md`.

Candidates to adopt next (not done): tasks, goals, saved CSS pages, recipes, Room/Garden/Cellar planner projects, Finance documents, saved fonts. Each needs the three steps above; for planner projects the whole project JSON is the payload.

Chats keep their older soft-delete (`sessions."deletedAt"` with a Deleted view); they are not in this bin.
