'use strict';
/**
 * Builds one row for "user A" in as many tables as the schema allows, by reading the database's own
 * description of itself: required columns get type-appropriate values, foreign keys get a parent row
 * (created first), user columns point at A, and every free-text column carries a unique XMARK token
 * so a leak of A's data into another user's response is easy to spot.
 *
 * Throwaway databases only (the cross-user harness refuses anything but localhost).
 */
const crypto = require('crypto');

const MARK = 'XMARK-';
const OWNER_COLS = new Set(['userId', 'user_id', 'ownerId', 'owner_id', 'createdBy']);
const SKIP_TABLES = new Set(['users', 'auth_sessions']);
// Nullable columns that mean "this row has been removed / ended / used". A fixture row that has them filled looks deleted,
// expired or closed, and the routes rightly hide it, so the route would show nothing and prove nothing.
const ENDED_COL = /^(deleted|closed|expires?|expired|archived|dismissed|cancel+ed|revoked|completed|resolved|used|consumed|trashed)(_?at|On|Date)?$/i;
// Required expiry columns get a date a year ahead (a row that expired at birth is hidden by "expiresAt > NOW()"), and a few
// text columns that routes filter on get the value the filter wants instead of a marker.
const FUTURE_COL = /^expires?(At|On|Date)?$/i;
const VALUE_HINTS = { 'projects.projectType': 'client', 'projects.clientStatus': 'active' };
const rnd = () => crypto.randomBytes(3).toString('hex');

async function introspect(pool) {
  const cols = (await pool.query(`
    SELECT table_name t, column_name c, data_type dt, udt_name udt, is_nullable nullable, column_default def,
           character_maximum_length len, is_generated gen, is_identity ident
    FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`)).rows;
  const tables = {};
  for (const r of cols) {
    const t = (tables[r.t] = tables[r.t] || { name: r.t, cols: [], pk: [], fks: {}, checks: {} });
    t.cols.push({ name: r.c, type: r.dt, udt: r.udt, nullable: r.nullable === 'YES', hasDefault: r.def != null || r.ident === 'YES' || r.gen === 'ALWAYS', len: r.len });
  }
  const real = new Set((await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`)).rows.map((r) => r.table_name));
  for (const n of Object.keys(tables)) if (!real.has(n)) delete tables[n];
  const pks = (await pool.query(`
    SELECT tc.table_name t, kcu.column_name c FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
    WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' ORDER BY kcu.ordinal_position`)).rows;
  for (const r of pks) if (tables[r.t]) tables[r.t].pk.push(r.c);
  const fks = (await pool.query(`
    SELECT cl.relname child, a.attname col, pcl.relname parent, pa.attname pcol
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname='public'
    JOIN pg_class pcl ON pcl.oid=c.confrelid
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=c.confkey[1]
    WHERE c.contype='f' AND array_length(c.conkey,1)=1`)).rows;
  for (const r of fks) if (tables[r.child]) tables[r.child].fks[r.col] = { parent: r.parent, pcol: r.pcol };
  const checks = (await pool.query(`
    SELECT cl.relname t, pg_get_constraintdef(c.oid) def FROM pg_constraint c
    JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname='public' WHERE c.contype='c'`)).rows;
  for (const r of checks) {
    if (!tables[r.t]) continue;
    const lits = [...r.def.matchAll(/'([^']*)'::/g)].map((m) => m[1]);
    for (const col of tables[r.t].cols) if (new RegExp(`\\(?"?${col.name}"?\\)?(::\\w+)?\\s*(=|IN|<>)|\\b${col.name}\\b`).test(r.def) && lits.length) (tables[r.t].checks[col.name] = tables[r.t].checks[col.name] || []).push(...lits);
  }
  return tables;
}

function valueFor(table, col) {
  const hint = VALUE_HINTS[`${table.name}.${col.name}`];
  if (hint !== undefined) return hint;
  if (FUTURE_COL.test(col.name) && /^timestamp/.test(col.type)) return new Date(Date.now() + 365 * 86400000);
  const chk = table.checks[col.name];
  if (chk && chk.length) return chk[0];
  switch (col.type) {
    case 'integer': case 'bigint': case 'smallint': return 1;
    case 'numeric': case 'real': case 'double precision': return 1;
    case 'boolean': return false;
    case 'timestamp with time zone': case 'timestamp without time zone': return new Date();
    case 'date': return new Date();
    case 'time without time zone': case 'time with time zone': return '00:00:00';
    case 'uuid': return crypto.randomUUID();
    case 'jsonb': case 'json': return JSON.stringify(col.name === 'rounds' || /s$/.test(col.name) ? [] : {});
    case 'bytea': return Buffer.from('x');
    case 'ARRAY': return '{}';
    case 'text': case 'character varying': case 'character': case 'citext': {
      const base = `${MARK}${table.name}-${col.name}-${rnd()}`;
      return col.len && col.len < base.length ? base.slice(0, col.len) : base;
    }
    default: return undefined; // USER-DEFINED (vector) and anything unknown
  }
}

/**
 * fx.build(tableName) -> { table, pk: {col: value}, row } or throws; results cached in fx.rows.
 */
function makeBuilder(pool, tables, userA) {
  const rows = {}; const failed = {}; const building = new Set();
  async function build(name) {
    if (rows[name]) return rows[name];
    if (failed[name]) throw new Error(failed[name]);
    const t = tables[name];
    if (!t) throw new Error(`no table ${name}`);
    if (SKIP_TABLES.has(name)) throw new Error('skipped table');
    if (building.has(name)) throw new Error('cycle');
    building.add(name);
    try {
      const vals = {};
      for (const col of t.cols) {
        const fk = t.fks[col.name];
        if (OWNER_COLS.has(col.name) && (!fk || fk.parent === 'users')) { vals[col.name] = userA; continue; }
        if (fk) {
          if (fk.parent === 'users') { vals[col.name] = userA; continue; }
          if (col.nullable && fk.parent === name) continue;
          try { const p = await build(fk.parent); vals[col.name] = p.row[fk.pcol]; }
          catch (e) { if (col.nullable) continue; throw new Error(`parent ${fk.parent}: ${e.message}`); }
          continue;
        }
        const isPk = t.pk.includes(col.name);
        if (col.nullable && !isPk && ENDED_COL.test(col.name)) continue;
        if (col.hasDefault && !(isPk && false)) {
          // let the database fill it, except text columns where a marker is wanted and no CHECK stops us
          if (!['text', 'character varying'].includes(col.type) || isPk) continue;
        }
        const v = valueFor(t, col);
        if (v === undefined) { if (!col.nullable && !col.hasDefault) throw new Error(`cannot fill ${col.name} (${col.type})`); continue; }
        vals[col.name] = v;
      }
      const names = Object.keys(vals);
      const sql = names.length
        ? `INSERT INTO "${name}" (${names.map((n) => `"${n}"`).join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`
        : `INSERT INTO "${name}" DEFAULT VALUES RETURNING *`;
      let res;
      try { res = await pool.query(sql, names.map((n) => vals[n])); }
      catch (e) {
        // a marker or value a CHECK / format rule rejects: retry with only the required columns
        const req = t.cols.filter((c) => !c.nullable && !c.hasDefault || t.fks[c.name] || OWNER_COLS.has(c.name)).map((c) => c.name).filter((n) => n in vals);
        if (!req.length || req.length === names.length) throw e;
        res = await pool.query(`INSERT INTO "${name}" (${req.map((n) => `"${n}"`).join(',')}) VALUES (${req.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, req.map((n) => vals[n]));
      }
      const row = res.rows[0];
      const pk = {}; for (const c of t.pk) pk[c] = row[c];
      rows[name] = { table: name, pk, row };
      return rows[name];
    } catch (e) {
      failed[name] = e.message;
      throw e;
    } finally { building.delete(name); }
  }
  return { build, rows, failed };
}

async function reread(pool, tables, entry) {
  const t = tables[entry.table];
  if (!t.pk.length) return null;
  const where = t.pk.map((c, i) => `"${c}"=$${i + 1}`).join(' AND ');
  const r = await pool.query(`SELECT * FROM "${entry.table}" WHERE ${where}`, t.pk.map((c) => entry.pk[c]));
  return r.rows[0] || null;
}

/**
 * Lists that are built from a link between two rows (a subtask, a chat with no project, a mood tied to a task) stay empty
 * when every fixture row stands alone. This adds the few extra rows that make those routes answer with A's data.
 * Each is a copy of A's fixture row with the link columns changed; a failure to add one is reported, not fatal.
 */
async function seedDerived(pool, tables, fx, finance) {
  const notes = [];
  async function clone(table, overrides) {
    const e = fx[table]; if (!e) throw new Error(`no fixture row for ${table}`);
    const t = tables[table];
    const row = { ...e.row, ...overrides };
    // a serial/identity key is left for the database to assign; a key the caller overrides (a text id) is kept
    for (const k of t.pk) if (!(k in overrides)) { const c = t.cols.find((x) => x.name === k); if (c && c.hasDefault) delete row[k]; }
    const names = Object.keys(row);
    const res = await pool.query(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, names.map((n) => row[n]));
    return res.rows[0];
  }
  const step = async (label, fn) => { try { await fn(); } catch (e) { notes.push(`${label}: ${String(e.message).slice(0, 90)}`); } };
  const idOf = (t) => fx[t] && Object.values(fx[t].pk)[0];

  await step('subtask', () => clone('tasks', { parentTaskId: idOf('tasks'), shareToken: null }));
  await step('chat with no project', () => clone('messages', { projectId: null, sessionId: idOf('sessions') }));
  await step('deleted chat', () => clone('sessions', { sessionId: `${MARK}deleted-${rnd()}`, deletedAt: new Date() }));
  await step('project not yet a client project', () => clone('projects', { projectType: 'standard' }));
  await step('mood tied to a task', () => clone('mood_checkins', { entity_type: 'task', entity_id: String(idOf('tasks')) }));
  await step('current mission statement', () => pool.query('UPDATE mission_statements SET is_current = true WHERE id = $1', [idOf('mission_statements')]));
  await step('search index entry', () => pool.query(`INSERT INTO search_index (type,"projectId",title,body) VALUES ('project',$1,$2,$3)`, [String(idOf('projects')), `${MARK}search-title`, `${MARK}search-body`]));
  // Finance lists are built from journal lines on the chart of accounts the Finance routes create, so the accounts are made
  // the way the app makes them, then A gets an interest entry on the bank account, a readable unread receipt, an asset that
  // still needs depreciation and a fixed-rate home-office year. `finance` is passed in by the test, which has the app loaded.
  if (finance) {
    const A = finance.userId;
    await step('finance accounts', () => finance.ensureAccounts(A));
    await step('journal entry on the bank account', async () => {
      const acc = async (where) => (await pool.query(`SELECT id FROM fin_accounts WHERE "userId"=$1 AND ${where} ORDER BY code LIMIT 1`, [A])).rows[0].id;
      const bank = await acc(`code='1000'`); const expense = await acc(`type='expense'`);
      const e = (await pool.query(`INSERT INTO fin_journal_entries ("userId", date, description, type) VALUES ($1, CURRENT_DATE, $2, 'interest') RETURNING id`, [A, `${MARK}interest`])).rows[0].id;
      await pool.query(`INSERT INTO fin_journal_lines ("entryId","accountId",debit,credit) VALUES ($1,$2,50,0),($1,$3,0,50)`, [e, expense, bank]);
    });
    await step('unread receipt', () => pool.query(`UPDATE fin_documents SET "mimeType"='application/pdf', kind='receipt', "readAt"=NULL WHERE "userId"=$1`, [A]));
    await step('asset needing depreciation', () => pool.query(`UPDATE fin_assets SET method='prime_cost', "effectiveLifeYears"=5, "dateFirstUsed"='2025-07-01', amount=1000, "accumulatedDepreciation"=0, "lastDepreciatedFy"=NULL, "disposedDate"=NULL WHERE "userId"=$1`, [A]));
    await step('overdue invoice', () => pool.query(`UPDATE fin_invoices SET status='sent', "issueDate"=CURRENT_DATE-40, "dueDate"=CURRENT_DATE-10, subtotal=100, gst=10, total=110 WHERE "userId"=$1`, [A]));
    await step('invoice document type', () => pool.query(`UPDATE fin_invoices SET "docType"='invoice' WHERE "userId"=$1`, [A]));
    await step('paid invoice', () => clone('fin_invoices', { number: `${MARK}paid-${rnd()}`, status: 'paid', paidAt: new Date(), issueDate: new Date(), dueDate: new Date() }));
    await step('fixed-rate home-office year', async () => {
      const map = {};
      for (let i = 0; i <= 16; i++) map[finance.finYearForDate(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10))] = 'fixed_rate';
      await pool.query(`INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_home_office_method_by_year',$2) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`, [A, JSON.stringify(map)]);
    });
  }
  // an entry with no project: the app never writes one, but search must not show it to anyone if one ever exists
  await step('search index entry with no project', () => pool.query(`INSERT INTO search_index (type,"projectId",title,body) VALUES ('project',NULL,$1,$2)`, [`${MARK}search-orphan-title`, `${MARK}search-orphan-body`]));
  return notes;
}

module.exports = { MARK, introspect, makeBuilder, reread, OWNER_COLS, seedDerived };
