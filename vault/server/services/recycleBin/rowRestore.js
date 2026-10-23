'use strict';

// Helper for adapters that put a deleted row back from a `SELECT *` snapshot, so an adapter does not list every column of its table
// (and does not break when a column is added later). See docs/recycle-bin.md.
//
// insertRow(db, 'tasks', row, { userId, override }) inserts the row and returns its new id:
//   - only columns that still exist are written, and the table and column names come from the database, never from the payload;
//   - the old id is reused when it is free, so anything that pointed at the row still does; otherwise a new one is made;
//   - "userId" is set to the person restoring;
//   - a link to another table (a foreign key) whose target has gone since is left empty, so the row comes back without the link
//     rather than not at all (a column that cannot be empty makes the restore fail, which leaves the item in the bin);
//   - `override` sets columns by hand (for ids that changed, such as the parent of a subtask) and skips the check for them.

const columnCache = new Map();

async function describe(db, table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const cols = new Set((await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table])).rows.map((r) => r.column_name));
  if (!cols.size) throw new Error(`recycle bin: unknown table "${table}"`);
  const fks = (await db.query(
    `SELECT a.attname AS col, cf.relname AS ref, af.attname AS refcol
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_class cf ON cf.oid = c.confrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND cl.relname = $1 AND array_length(c.conkey, 1) = 1`, [table])).rows;
  const info = { cols, fks: new Map(fks.map((f) => [f.col, f])) };
  columnCache.set(table, info);
  return info;
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

// `idColumn` is the table's key when it is not called id (sessions use "sessionId"); it is the value returned.
async function insertRow(db, table, row, { userId, override = {}, keepId = true, idColumn = 'id' } = {}) {
  const { cols, fks } = await describe(db, table);
  const values = {};
  for (const [k, v] of Object.entries(row || {})) if (cols.has(k)) values[k] = v;
  if (cols.has(idColumn) && values[idColumn] != null) {
    const taken = !keepId || (await db.query(`SELECT 1 FROM ${q(table)} WHERE ${q(idColumn)} = $1`, [values[idColumn]])).rows.length > 0;
    if (taken) delete values[idColumn];
  }
  if (userId != null && cols.has('userId')) values.userId = userId;
  for (const [col, fk] of fks) {
    if (col === 'userId' || col in override || values[col] == null) continue;
    const there = await db.query(`SELECT 1 FROM ${q(fk.ref)} WHERE ${q(fk.refcol)} = $1`, [values[col]]);
    if (!there.rows.length) values[col] = null;
  }
  for (const [k, v] of Object.entries(override)) if (cols.has(k)) values[k] = v;
  const keys = Object.keys(values);
  const { rows } = await db.query(
    `INSERT INTO ${q(table)} (${keys.map(q).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${q(idColumn)} AS id`,
    keys.map((k) => values[k]));
  return rows[0].id;
}

module.exports = { insertRow };
