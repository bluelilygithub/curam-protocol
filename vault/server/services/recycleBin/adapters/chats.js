'use strict';

// How the recycle bin handles chats (sessions). DELETE /api/chat/sessions/:id calls snapshotChat + moveToBin() and then removes the
// chat for good; this file also says how to put it back. See docs/recycle-bin.md.
//
// A chat is bigger than most things in the bin: the session, every message, the bookmarks on them, the files attached to it and which
// study decks came from it. Messages have no foreign key to sessions, so they are removed by hand at delete time and put back here.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

/** One chat can carry long replies, so it may use more of the bin than the default (see moveToBin's maxBytes). */
const CHAT_MAX_BYTES = 25 * 1024 * 1024;

const ids = (list) => (Array.isArray(list) ? list.filter(Number.isInteger) : []);

/**
 * Everything that disappears with a chat. Run inside the delete's transaction. The person may delete a chat they own or one in a project they own.
 * Returns null when there is no such chat for them (or it is already in the old Deleted list).
 */
async function snapshotChat(db, userId, sessionId) {
  const { rows } = await db.query(
    `SELECT s.*, p.name AS "projectName"
       FROM sessions s LEFT JOIN projects p ON p.id = s."projectId"
      WHERE s."sessionId" = $1 AND s."deletedAt" IS NULL AND (s."userId" = $2 OR (s."projectId" IS NOT NULL AND p."userId" = $2))
      FOR UPDATE OF s`,
    [sessionId, userId]
  );
  const { projectName, ...session } = rows[0] || {};
  if (!rows[0]) return null;
  const messages = (await db.query('SELECT * FROM messages WHERE "sessionId" = $1 ORDER BY id', [sessionId])).rows;
  const bookmarks = (await db.query('SELECT "messageId", "createdAt" FROM bookmarks WHERE "sessionId" = $1 ORDER BY id', [sessionId])).rows;
  const fileIds = (await db.query('SELECT "fileId" FROM session_files WHERE "sessionId" = $1', [sessionId])).rows.map((r) => r.fileId);
  const deckIds = (await db.query('SELECT id FROM study_decks WHERE "sessionId" = $1', [sessionId])).rows.map((r) => r.id);
  const firstQuestion = messages.find((m) => m.role === 'user')?.content || '';
  const title = (session.title || firstQuestion.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled chat');
  const bits = [`${messages.length} message${messages.length === 1 ? '' : 's'}`];
  if (projectName) bits.push(projectName);
  return { title, detail: bits.join(' · '), payload: { session, messages, bookmarks, fileIds, deckIds } };
}

/** Remove a chat for good once its snapshot is in the bin (same transaction). Bookmarks and file links go with the session. */
async function removeChat(db, sessionId) {
  await db.query('DELETE FROM messages WHERE "sessionId" = $1', [sessionId]);
  await db.query('DELETE FROM sessions WHERE "sessionId" = $1', [sessionId]);
}

register('chat', {
  label: 'Chat',
  async restore(db, userId, payload) {
    const s = payload?.session;
    if (!s?.sessionId) throw new Error('This deleted chat has nothing to restore.');
    if ((await db.query('SELECT 1 FROM sessions WHERE "sessionId" = $1', [s.sessionId])).rows.length) {
      throw new RestoreError('This chat is already back.', 409);
    }
    // The chat belongs to whoever it belonged to (a project owner may have deleted someone else's chat in their project).
    // It comes back under its project if that still exists, otherwise as an ordinary chat; it is not marked deleted, and it is
    // moved to the top of the list the way the old restore did.
    await insertRow(db, 'sessions', s, { userId, idColumn: 'sessionId', override: { userId: s.userId ?? userId, deletedAt: null, updatedAt: new Date() } });
    const projectId = (await db.query('SELECT "projectId" FROM sessions WHERE "sessionId" = $1', [s.sessionId])).rows[0].projectId;

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const oldIds = ids(messages.map((m) => m.id));
    const taken = oldIds.length ? (await db.query('SELECT id FROM messages WHERE id = ANY($1::int[]) LIMIT 1', [oldIds])).rows.length > 0 : false;
    const idMap = new Map(); // old message id -> id now
    if (!taken && messages.length) {
      // The usual case: the old ids are all free, so keep them (bookmarks and anything that pointed at a message still match), in one statement.
      await db.query(
        `INSERT INTO messages (id, "sessionId", "projectId", role, content, "createdAt")
         SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::timestamptz[])`,
        [oldIds, messages.map(() => s.sessionId), messages.map(() => projectId), messages.map((m) => m.role), messages.map((m) => m.content), messages.map((m) => m.createdAt)]
      );
      for (const id of oldIds) idMap.set(id, id);
    } else {
      for (const m of messages) {
        const r = await db.query(
          'INSERT INTO messages ("sessionId", "projectId", role, content, "createdAt") VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [s.sessionId, projectId, m.role, m.content, m.createdAt]
        );
        idMap.set(m.id, r.rows[0].id);
      }
    }
    for (const b of Array.isArray(payload.bookmarks) ? payload.bookmarks : []) {
      const messageId = idMap.get(b.messageId);
      if (messageId) await db.query('INSERT INTO bookmarks ("messageId", "sessionId", "createdAt") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [messageId, s.sessionId, b.createdAt]);
    }
    // Files may have been deleted since: only the ones still there are attached again.
    const fileIds = ids(payload.fileIds);
    if (fileIds.length) {
      await db.query(
        'INSERT INTO session_files ("sessionId", "fileId") SELECT $1, id FROM files WHERE id = ANY($2::int[]) ON CONFLICT DO NOTHING', [s.sessionId, fileIds]);
    }
    // A study deck made from this chat is linked to it again, unless it was linked somewhere else meanwhile.
    const deckIds = ids(payload.deckIds);
    if (deckIds.length) await db.query('UPDATE study_decks SET "sessionId" = $1 WHERE id = ANY($2::int[]) AND "sessionId" IS NULL', [s.sessionId, deckIds]);
    return { entityId: s.sessionId };
  },
});

module.exports = { snapshotChat, removeChat, CHAT_MAX_BYTES };
