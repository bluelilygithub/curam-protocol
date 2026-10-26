'use strict';

// One check, used wherever a row is allowed to point at one of the person's own clients or projects: does that row exist AND belong to them?
// (Notes check the same thing in routes/notes.js; new code uses this.) The table name is chosen from a fixed list, never from the request.

const TABLES = { client: 'clients', project: 'projects' };

/** true when `id` is a row of `kind` ('client' | 'project') owned by `userId`. A bad id or an unknown kind is simply false. */
async function ownsRow(pool, kind, id, userId) {
  const table = TABLES[kind];
  const n = Number(id);
  if (!table || !Number.isInteger(n) || n <= 0) return false;
  const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND "userId" = $2`, [n, userId]);
  return rows.length > 0;
}

module.exports = { ownsRow };
