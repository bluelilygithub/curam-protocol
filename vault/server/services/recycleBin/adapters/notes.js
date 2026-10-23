'use strict';

// How the recycle bin puts back what Notes deletes: a note (with its tags) and a note template.
// The route that deletes them calls moveToBin(); this file only knows how to restore.

const fs = require('fs');
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
    const { rows } = await db.query(
      `INSERT INTO notes (${idTaken ? '' : 'id, '}user_id, project_id, client_id, title, body, source, pinned_at, created_at, updated_at,
                          remind_at, remind_email, reminder_sent_at, reminder_done_at, remind_repeat, remind_tz, remind_day)
       VALUES (${idTaken ? '' : '$17, '}$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [userId, project ? n.project_id : null, client ? n.client_id : null, n.title || 'Untitled', n.body || '', n.source || 'text',
        n.pinned_at || null, n.created_at || new Date().toISOString(), n.updated_at || new Date().toISOString(),
        n.remind_at || null, !!n.remind_email, n.reminder_sent_at || null, n.reminder_done_at || null,
        ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly'].includes(n.remind_repeat) ? n.remind_repeat : 'none', n.remind_tz || null, n.remind_day || null,
        ...(idTaken ? [] : [n.id])]
    );
    for (const tag of Array.isArray(payload.tags) ? payload.tags : []) {
      await db.query('INSERT INTO note_tags (note_id, user_id, tag) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [rows[0].id, userId, tag]);
    }
    // The files stayed where they were while the note was in the bin; point them at the note again (it may have a new number).
    const fileIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds.filter(Number.isInteger) : [];
    if (fileIds.length) {
      await db.query(`UPDATE attachments SET "entityId"=$1 WHERE id = ANY($2::int[]) AND "userId"=$3 AND "entityType"='note'`, [rows[0].id, fileIds, userId]);
    }
    return { entityId: rows[0].id };
  },
  // Gone for good (30 days, deleted forever, bin emptied): remove the files too.
  async discard(db, userId, payload) {
    const fileIds = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds.filter(Number.isInteger) : [];
    if (!fileIds.length) return;
    const { rows } = await db.query(`SELECT id, "storedPath" FROM attachments WHERE id = ANY($1::int[]) AND "userId"=$2 AND "entityType"='note'`, [fileIds, userId]);
    for (const a of rows) {
      try { if (fs.existsSync(a.storedPath)) fs.unlinkSync(a.storedPath); } catch { /* the row goes anyway */ }
    }
    await db.query(`DELETE FROM attachments WHERE id = ANY($1::int[]) AND "userId"=$2 AND "entityType"='note'`, [rows.map((r) => r.id), userId]);
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

register('note-view', {
  label: 'Notes view',
  async restore(db, userId, payload) {
    const v = payload?.view;
    if (!v) throw new Error('This deleted view has nothing to restore.');
    const idTaken = await exists(db, 'SELECT 1 FROM note_views WHERE id=$1', [v.id]);
    // The name may have been used again since: the restored view gets "(restored)" rather than failing.
    let name = v.name;
    for (let n = 1; await exists(db, 'SELECT 1 FROM note_views WHERE user_id=$1 AND lower(name)=lower($2)', [userId, name]); n++) {
      name = `${String(v.name).slice(0, 28)} (restored${n > 1 ? ` ${n}` : ''})`;
    }
    const { rows } = await db.query(
      `INSERT INTO note_views (${idTaken ? '' : 'id, '}user_id, name, filters, created_at, updated_at)
       VALUES (${idTaken ? '' : '$6, '}$1, $2, $3::jsonb, $4, $5) RETURNING id`,
      [userId, name, JSON.stringify(v.filters || {}), v.created_at || new Date().toISOString(), v.updated_at || new Date().toISOString(), ...(idTaken ? [] : [v.id])]
    );
    return { entityId: rows[0].id };
  },
});
