#!/usr/bin/env node
/**
 * Cross-user ownership test. Boots the real app, gives user A a row in nearly every table (each text
 * column holds an XMARK token), then lets user B (a different ordinary member) call the routes:
 *
 *   1. LEAK SWEEP   every GET route (lists and single items), with A's real ids in the path:
 *                   B's response must never contain an XMARK token. The same call as A is the control:
 *                   if A cannot see the data either, the route is reported "vacuous", never "covered".
 *   2. ID PROBES    every POST/PUT/PATCH/DELETE route with an id in the path, A's id plugged in and a
 *                   body copied from A's row: nothing in the database may change and nothing may leak.
 *   3. BODY REFS    every other write route, sent a body that names A's projects, sessions, clients...:
 *                   no new row may end up attached to A's data (B filing something under A's records).
 *
 * Needs a throwaway Postgres on THIS machine; the harness blocks outside network and blanks all keys.
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/routes/crossUserOwnership.test.js
 */
'use strict';
const harness = require('../testing/crossUserHarness');
const fs = require('fs');
const path = require('path');
const { listRoutes } = require('../testing/listRoutes');
const { introspect, makeBuilder, MARK, OWNER_COLS } = require('../testing/ownershipFixtures');
const { bindingsFor, HINTS } = require('../testing/ownershipBindings');
const { FEATURE_ACCESS_KEYS } = require('../config/featureAccess');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'testing', 'routeManifest.json'), 'utf8')).routes;
const key = (r) => `${r.method} ${r.path}`;
// Routes that show one member's rows to others ON PURPOSE. Each needs a written reason.
const SHARED_BY_DESIGN = {
  'GET /api/recipes/grocery/corrections': 'the grocery-price correction glossary is workspace-shared (docs/recipes.md, "Correction glossary")',
};
const REF_ALIASES = {
  projects: ['projectId'], sessions: ['sessionId'], clients: ['clientId', 'clientRef'], tasks: ['taskId', 'parentId'],
  objectives: ['goalId', 'objectiveId'], key_results: ['krId', 'keyResultId'], fin_invoices: ['invoiceId'], fin_suppliers: ['supplierId'],
  client_deals: ['dealId'], client_cases: ['caseId'], files: ['fileId'], notes: ['noteId'], folders: ['folderId'], personas: ['personaId'],
  messages: ['messageId'], prompts: ['promptId'], memory: ['memoryId'], client_contacts: ['contactId'], client_touchpoints: ['touchpointId'],
};

(async () => {
  const h = await harness.start();
  const { pool } = h;
  for (const k of FEATURE_ACCESS_KEYS) await pool.query(`INSERT INTO workspace_settings (key,value) VALUES ($1,'true') ON CONFLICT (key) DO UPDATE SET value='true'`, [`feature_${k}`]).catch(() => {});

  const A = await h.makeUser('A', false);
  const B = await h.makeUser('B', false);
  const tables = await introspect(pool);
  const builder = makeBuilder(pool, tables, A.id);
  const unbuildable = {};
  for (const t of Object.keys(tables)) { try { await builder.build(t); } catch (e) { unbuildable[t] = e.message.slice(0, 80); } }
  const fx = builder.rows;
  console.log(`fixtures: ${Object.keys(fx).length} of ${Object.keys(tables).length} tables hold a row for user A`);

  const tableNames = new Set(Object.keys(tables));
  const idOf = (t) => (fx[t] && fx[t].pk && Object.values(fx[t].pk)[0]);

  // ── snapshots ──────────────────────────────────────────────────────────────────────────────────
  const snapTables = Object.keys(tables).filter((t) => !['users', 'auth_sessions'].includes(t));
  const snapSql = snapTables.map((t) => `SELECT '${t}' t, count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) h FROM "${t}" x`).join(' UNION ALL ');
  const snapshot = async () => { const m = {}; for (const r of (await pool.query(snapSql)).rows) m[r.t] = `${r.n}:${r.h}`; return m; };
  const fkEdges = [];
  for (const t of Object.values(tables)) for (const [col, fk] of Object.entries(t.fks)) if (fx[fk.parent] && fx[fk.parent].row[fk.pcol] != null && snapTables.includes(t.name)) fkEdges.push({ child: t.name, col, parent: fk.parent, val: fx[fk.parent].row[fk.pcol] });
  const fkSql = fkEdges.map((e, i) => `SELECT ${i} i, count(*)::int n FROM "${e.child}" WHERE "${e.col}"::text = $${i + 1}::text`).join(' UNION ALL ');
  const fkCounts = async () => { const m = {}; for (const r of (await pool.query(fkSql, fkEdges.map((e) => String(e.val)))).rows) m[r.i] = r.n; return m; };

  // A's own fixture rows, one by one: exact, so background writes elsewhere can't be blamed on a probe
  const rowEntries = Object.values(fx).filter((e) => tables[e.table].pk.length === 1 && snapTables.includes(e.table));
  const rowSql = rowEntries.map((e, i) => `SELECT ${i} i, (SELECT to_jsonb(x)::text FROM "${e.table}" x WHERE "${tables[e.table].pk[0]}"::text = $${i + 1}::text) j`).join(' UNION ALL ');
  const rowSnapshot = async () => { const m = {}; for (const r of (await pool.query(rowSql, rowEntries.map((e) => String(Object.values(e.pk)[0])))).rows) m[r.i] = r.j; return m; };
  const changedRows = (a, b) => Object.keys(a).filter((i) => a[i] !== b[i]).map((i) => rowEntries[i].table);

  // which tables change on their own (logging, caches)? exclude them from comparisons
  const s0 = await snapshot();
  for (const p of ['/api/projects', '/api/tasks', '/api/chat/all-history']) await harness.call(h.base, 'GET', p, { token: B.token });
  const s1 = await snapshot();
  const noisy = new Set(Object.keys(s0).filter((t) => s0[t] !== s1[t]));
  const diffTables = (a, b) => Object.keys(a).filter((t) => !noisy.has(t) && a[t] !== b[t]);

  // ── routes, bindings, urls ─────────────────────────────────────────────────────────────────────
  const routes = listRoutes(h.app).filter((r) => MANIFEST[key(r)] && MANIFEST[key(r)].class === 'authed');
  const plan = routes.map((r) => {
    const binds = bindingsFor(r.path, tableNames);
    let url = r.path; const boundTables = []; let unresolved = false;
    for (const b of binds) {
      let v;
      if (b.table) { v = idOf(b.table); if (v == null) { unresolved = true; v = '1'; } else boundTables.push(b.table); }
      else if (b.table === null) v = HINTS[b.param] || '1';
      else { unresolved = true; v = '1'; }
      url = url.replace(new RegExp(`:${b.param}(\\([^)]*\\))?\\??`), encodeURIComponent(String(v)));
    }
    return { ...r, url: url.replace(/\*/g, 'x'), binds, boundTables, unresolved };
  });

  const bodyFor = (table) => {
    const body = {};
    if (table && fx[table]) for (const [k, v] of Object.entries(fx[table].row)) {
      if (OWNER_COLS.has(k) || tables[table].pk.includes(k) || Buffer.isBuffer(v)) continue;
      // never send A's XMARK tokens in a request: a route that echoes its input would then look like a leak
      body[k] = v instanceof Date ? v.toISOString() : (typeof v === 'string' ? v.replace(MARK, 'BODY-') : v);
    }
    return body;
  };
  const refs = {};
  for (const [t, e] of Object.entries(fx)) {
    const id = Object.values(e.pk)[0]; if (id == null) continue;
    const base = t.replace(/ies$/, 'y').replace(/s$/, '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    for (const k of [`${base}Id`, ...(REF_ALIASES[t] || [])]) if (!(k in refs)) refs[k] = id;
  }

  const results = { leaks: [], violations: [], accepted: [], verified: 0, vacuous: [], unresolved: [], broken: [] };
  const hasMark = (s) => s.includes(MARK);

  // 1. leak sweep ────────────────────────────────────────────────────────────────────────────────
  for (const r of plan.filter((p) => p.method === 'GET')) {
    const b = await harness.call(h.base, 'GET', r.url, { token: B.token });
    if (hasMark(b.text) && !SHARED_BY_DESIGN[key(r)]) results.leaks.push(`${key(r)} -> ${b.status} ${r.url}`);
    const a = await harness.call(h.base, 'GET', r.url, { token: A.token });
    if (hasMark(a.text)) results.verified++;
    else if (r.unresolved) results.unresolved.push(key(r));
    else results.vacuous.push(`${key(r)} (A got ${a.status})`);
  }

  // 2. id probes ─────────────────────────────────────────────────────────────────────────────────
  let base = await rowSnapshot(); let fkBase = await fkCounts();
  for (const r of plan.filter((p) => p.method !== 'GET' && p.boundTables.length)) {
    const body = { ...refs, ...bodyFor(r.boundTables[r.boundTables.length - 1]) };
    const b = await harness.call(h.base, r.method, r.url, { token: B.token, body });
    const after = await rowSnapshot(); const fkAfter = await fkCounts();
    const changed = changedRows(base, after);
    const grew = Object.keys(fkAfter).filter((i) => fkAfter[i] !== fkBase[i]).map((i) => `${fkEdges[i].child}.${fkEdges[i].col}`);
    if (hasMark(b.text)) results.leaks.push(`${key(r)} -> ${b.status} ${r.url} (response)`);
    if (changed.length || grew.length) results.violations.push(`${key(r)} as B with A's ids: ${changed.length ? `changed/removed A's rows in ${[...new Set(changed)].join(', ')}` : ''}${grew.length ? ` attached rows to ${[...new Set(grew)].join(', ')}` : ''} (status ${b.status})`);
    else if (b.status >= 200 && b.status < 300) results.accepted.push(`${key(r)} -> ${b.status}`);
    base = after; fkBase = fkAfter;
  }

  // 3. body references ───────────────────────────────────────────────────────────────────────────
  let fk0 = await fkCounts();
  for (const r of plan.filter((p) => p.method !== 'GET' && !p.boundTables.length)) {
    const b = await harness.call(h.base, r.method, r.url, { token: B.token, body: { ...refs } });
    const fk1 = await fkCounts();
    const grew = Object.keys(fk1).filter((i) => fk1[i] !== fk0[i]).map((i) => `${fkEdges[i].child}.${fkEdges[i].col}`);
    if (hasMark(b.text)) results.leaks.push(`${key(r)} -> ${b.status} (response)`);
    if (grew.length) results.violations.push(`${key(r)} as B attached rows to A's data: ${[...new Set(grew)].join(', ')}`);
    fk0 = fk1;
  }

  // ── report ─────────────────────────────────────────────────────────────────────────────────────
  const gets = plan.filter((p) => p.method === 'GET').length;
  const idw = plan.filter((p) => p.method !== 'GET' && p.boundTables.length).length;
  const bodyw = plan.filter((p) => p.method !== 'GET' && !p.boundTables.length).length;
  console.log(`\nGET routes: ${gets} | A could read its own data on ${results.verified} (covered), ${results.vacuous.length} returned nothing even to A (vacuous), ${results.unresolved.length} had an id we could not bind`);
  console.log(`write routes: ${idw} with A's ids in the path, ${bodyw} sent a body naming A's records`);
  console.log(`tables that change on their own and were left out of comparisons: ${[...noisy].join(', ') || 'none'}`);
  if (Object.keys(unbuildable).length) console.log(`tables without an A row: ${Object.keys(unbuildable).join(', ')}`);
  if (h.blocked.length) console.log(`outside network attempts that were blocked: ${[...new Set(h.blocked)].slice(0, 6).join(', ')}`);
  console.log(`write routes that answered 2xx to B with no change and no leak (check these): ${results.accepted.length}`);
  results.accepted.slice(0, 40).forEach((x) => console.log(`   accepted  ${x}`));
  if (process.argv.includes('--vacuous')) results.vacuous.forEach((x) => console.log(`   vacuous   ${x}`));
  if (process.argv.includes('--unresolved')) results.unresolved.forEach((x) => console.log(`   unbound   ${x}`));

  let failed = 0;
  if (results.leaks.length) { failed++; console.log(`\n  FAIL  ${results.leaks.length} response(s) leaked user A's data to user B:`); results.leaks.slice(0, 40).forEach((x) => console.log(`        ${x}`)); }
  else console.log('\n  ok    no response to user B contained user A\'s data');
  if (results.violations.length) { failed++; console.log(`  FAIL  ${results.violations.length} write(s) by user B reached user A's data:`); results.violations.slice(0, 40).forEach((x) => console.log(`        ${x}`)); }
  else console.log('  ok    no write by user B changed or attached to user A\'s data');
  if (results.verified < 50) { failed++; console.log(`  FAIL  only ${results.verified} routes were proven to expose A's data to A; the probes are not meaningful`); }

  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [[A.id, B.id]]).catch(() => {}); // throwaway database
  console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
