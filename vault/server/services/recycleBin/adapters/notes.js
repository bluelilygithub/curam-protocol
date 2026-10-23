'use strict';

// How the recycle bin puts back what Notes deletes: a note (with its tags) and a note template.
// The route that deletes them calls moveToBin(); this file only knows how to restore.

const { register } = require('../index');

const exists = async (db, sql, params) => (await db.query(sql, params)).rows.length > 0;

register('note', {
  label: 'Note',
  async restore(db, userId, payload) {
    const n = payload?.note;
    if (!n) throw new Error('This deleted note has nothing to restore.');
    // The old number is reused when it is free, so anything that pointed at the note still does. If it is somehow taken, a new one is used.
    const idTaken = await exists(db, 'SELECT 1 FROM notes WHERE id=$1', [n.id]);
    // The project or client may have been deleted since: the note comes back without it rather than not at all.
    const project = n.project_id && await exists(db, 'SELECT 1 FROM projects WHERE id=$1 AND "userId"=$2', [n.project_id, userId]);
    const client = n.client_id && await exists(db, 'SELECT 1 FROM clients WHERE id=$1 AND "userId"=$2', [n.client_id, userId]);
    // A daily note for that day may have been made again since: the restored one is then an ordinary note.
    const dailyTaken = n.daily_date && await exists(db, 'SELECT 1 FROM notes WHERE user_id=$1 AND daily_date=$2::date', [userId, n.daily_date]);
    const { rows } = await db.query(
      `INSERT INTO notes (${idTaken ? '' : 'id, '}user_id, project_id, client_id, title, body, source, pinned_at, daily_date, created_at, updated_at)
       VALUES (${idTaken ? '' : '$11, '}$1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [userId, project ? n.project_id : null, client ? n.client_id : null, n.title || 'Untitled', n.body || '', n.source || 'text',
        n.pinned_at || null, dailyTaken ? null : (n.daily_date || null), n.created_at || new Date().toISOString(), n.updated_at || new Date().toISOString(),
        ...(idTaken ? [] : [n.id])]
    );
    for (const tag of Array.isArray(payload.tags) ? payload.tags : []) {
      await db.query('INSERT INTO note_tags (note_id, user_id, tag) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [rows[0].id, userId, tag]);
    }
    return { entityId: rows[0].id };
  },
});

register('note-template', {
  label: 'Note template',
  async restore(db, userId, payload) {
    const t = payload?.template;
    if (!t) throw new Error('This deleted template has nothing to restore.');
    const idTaken = await exists(db, 'SELECT 1 FROM note_templates WHERE id=$1', [t.id]);
    const { rows } = await db.query(
      `INSERT INTO note_templates (${idTaken ? '' : 'id, '}user_id, name, title, body, tags, created_at, updated_at)
       VALUES (${idTaken ? '' : '$8, '}$1, $2, $3, $4, $5::text[], $6, $7) RETURNING id`,
      [userId, t.name, t.title || '', t.body || '', Array.isArray(t.tags) ? t.tags : [], t.created_at || new Date().toISOString(), t.updated_at || new Date().toISOString(),
        ...(idTaken ? [] : [t.id])]
    );
    return { entityId: rows[0].id };
  },
});
