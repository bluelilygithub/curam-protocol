'use strict';

// The shared recycle bin. A tool that lets people delete things can keep them recoverable for 30 days with two small pieces:
//
//   1. at delete time, inside the same transaction that removes the row:  await moveToBin(db, { userId, type, id, title, detail, payload })
//      `payload` is whatever the tool needs to put the thing back (the row, plus any child rows).
//   2. once, in services/recycleBin/adapters/<tool>.js:                      register('type', { label, restore(db, userId, payload) })
//
// Restoring, listing, "delete forever", "empty bin" and the 30-day purge are all here, so every tool behaves the same and the
// person has one place (Settings -> Recycle bin) to look. Nothing in a tool's own tables changes: no deletedAt columns, no extra
// WHERE clauses. See docs/recycle-bin.md.

const { pool } = require('../../db');

const RETENTION_DAYS = Math.max(1, parseInt(process.env.RECYCLE_BIN_DAYS, 10) || 30);
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // one item; anything bigger is refused rather than silently dropped

const adapters = new Map();

class RestoreError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

/**
 * Teach the bin how to put one kind of thing back. `restore(db, userId, payload)` runs inside a transaction and returns { entityId }.
 * Optional `discard(db, userId, payload)` is called after an item is gone for good (30 days passed, deleted forever, bin emptied) so a tool can
 * remove what the bin does not hold itself, such as uploaded files. It must not throw; if it does the error is swallowed.
 */
function register(type, { label, restore, discard }) {
  if (!type || typeof restore !== 'function') throw new Error('register(type, { label, restore }) needs a type and a restore function');
  adapters.set(type, { label: label || type, restore, discard: typeof discard === 'function' ? discard : null });
}

const labelFor = (type) => adapters.get(type)?.label || type;

/**
 * Keep a copy of something that is about to be deleted. `db` is the pool or (better) the client of the transaction that deletes it,
 * so the copy and the delete succeed or fail together. Returns the bin id.
 */
async function moveToBin(db, { userId, type, id, title, detail, payload, maxBytes }) {
  if (!adapters.has(type)) throw new Error(`recycle bin: no adapter registered for "${type}"`);
  const json = JSON.stringify(payload ?? {});
  // `maxBytes` lets a kind of item that is naturally big (a long chat) ask for more than the default; code TOO_LARGE lets the caller decide what to do.
  if (Buffer.byteLength(json) > (maxBytes || MAX_PAYLOAD_BYTES)) throw Object.assign(new Error('recycle bin: this item is too large to keep'), { code: 'TOO_LARGE' });
  const { rows } = await db.query(
    `INSERT INTO recycle_bin ("userId", "entityType", "entityId", title, detail, payload, "expiresAt")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW() + ($7 || ' days')::interval) RETURNING id`,
    [userId, type, String(id), String(title || '').slice(0, 200), detail ? String(detail).slice(0, 300) : null, json, String(RETENTION_DAYS)]
  );
  return rows[0].id;
}

/** Remove everything past its 30 days. Safe to call any time; the list does it too, so the bin is right even if the schedule never ran. */
async function purgeExpired(db = pool) {
  const r = await db.query('DELETE FROM recycle_bin WHERE "expiresAt" < NOW() RETURNING "userId", "entityType", payload');
  await discardAll(r.rows);
  return r.rowCount;
}

/** Tell each tool that these items are gone for good. Best effort: one tool failing never stops the bin. */
async function discardAll(rows) {
  for (const row of rows || []) {
    const adapter = adapters.get(row.entityType);
    if (!adapter?.discard) continue;
    try { await adapter.discard(pool, row.userId, row.payload); } catch (err) { console.warn(`[recycle-bin] discard ${row.entityType} failed:`, err.message); }
  }
}

/** The person's bin, newest first. `types` (array) limits it to some kinds of thing. Each row says how many days are left. */
async function list(userId, { types } = {}) {
  await purgeExpired();
  const params = [userId];
  let where = '"userId" = $1';
  if (Array.isArray(types) && types.length) { params.push(types); where += ` AND "entityType" = ANY($2::text[])`; }
  const { rows } = await pool.query(
    `SELECT id, "entityType", "entityId", title, detail, "deletedAt", "expiresAt",
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - NOW())) / 86400))::int AS "daysLeft"
       FROM recycle_bin WHERE ${where} ORDER BY "deletedAt" DESC, id DESC LIMIT 500`,
    params
  );
  return rows.map((r) => ({ ...r, label: labelFor(r.entityType) }));
}

/** Put one item back. All or nothing: if the tool's restore fails, the item stays in the bin. Returns { id, type, entityId, title }. */
async function restoreItem(userId, binId) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM recycle_bin WHERE id=$1 AND "userId"=$2 FOR UPDATE', [Number(binId) || 0, userId]);
    const item = rows[0];
    if (!item) { await db.query('ROLLBACK'); throw new RestoreError('That item is no longer in the recycle bin.', 404); }
    if (new Date(item.expiresAt) < new Date()) { await db.query('ROLLBACK'); throw new RestoreError('That item has been in the recycle bin too long and was removed.', 410); }
    const adapter = adapters.get(item.entityType);
    if (!adapter) { await db.query('ROLLBACK'); throw new RestoreError('This kind of item cannot be restored from here.', 422); }
    const out = await adapter.restore(db, userId, item.payload);
    await db.query('DELETE FROM recycle_bin WHERE id=$1', [item.id]);
    await db.query('COMMIT');
    return { id: item.id, type: item.entityType, entityId: String(out?.entityId ?? item.entityId), title: item.title };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Delete one item for good. Returns true if it was there. */
async function deleteForever(userId, binId) {
  const r = await pool.query('DELETE FROM recycle_bin WHERE id=$1 AND "userId"=$2 RETURNING "userId", "entityType", payload', [Number(binId) || 0, userId]);
  await discardAll(r.rows);
  return r.rowCount > 0;
}

/** Empty the person's bin (or just some kinds). Returns how many items went. */
async function emptyBin(userId, { types } = {}) {
  const params = [userId];
  let where = '"userId" = $1';
  if (Array.isArray(types) && types.length) { params.push(types); where += ` AND "entityType" = ANY($2::text[])`; }
  const r = await pool.query(`DELETE FROM recycle_bin WHERE ${where} RETURNING "userId", "entityType", payload`, params);
  await discardAll(r.rows);
  return r.rowCount;
}

/** Load every tool's adapter. Called by the route and the schedule so the registry is complete wherever they run. */
function loadAdapters() {
  require('./adapters');
}

module.exports = { RETENTION_DAYS, RestoreError, register, moveToBin, list, restoreItem, deleteForever, emptyBin, purgeExpired, loadAdapters, _adapters: adapters };
