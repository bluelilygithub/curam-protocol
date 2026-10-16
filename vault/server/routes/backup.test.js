#!/usr/bin/env node
/**
 * Backup routes: admin-only, a backup holds only the caller's own data and files, and restore is off.
 * Integration test: needs a real Postgres. Uses two throwaway users (A = admin, B = member) and a
 * throwaway upload folder; no Google Drive call is made.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/backup.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP backup.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { pool } = require('../db');
const backup = require('./backup');
const { exportOwnedData, listOwnedUploads, BACKUP_TABLES } = backup.helpers;

let A; let B;
const app = express();
app.use(express.json());
// A is an administrator, B is an ordinary member; the x-user header picks who is calling.
app.use((req, _res, next) => { req.user = req.headers['x-user'] === 'B' ? { id: B, isAdmin: false } : { id: A, isAdmin: true }; next(); });
app.use('/api/backup', backup);

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
}

const run = Date.now();
const EXPECTED = { // rows each user is given of every table
  folders: 1, personas: 1, projects: 1, memory: 1, task_templates: 1, objectives: 1, key_results: 1,
  sessions: 2, messages: 2, tasks: 2, task_tags: 1, task_comments: 1, task_dependencies: 1, template_subtasks: 1,
  prompts: 1, notes: 1, pinned_urls: 1, files: 1, session_files: 1, bookmarks: 1, prompt_chains: 1, debates: 1,
  comparisons: 1, search_index: 1,
};
const ids = {};

// One of everything, for one user, every text field carrying the owner's marker.
async function seed(u, tag) {
  const q = async (sql, p) => (await pool.query(sql, p)).rows[0];
  const m = `MARK-${tag}-${run}`;
  const proj = (await q(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [m, u])).id;
  await q(`INSERT INTO folders (name,"userId") VALUES ($1,$2) RETURNING id`, [m, u]);
  await q(`INSERT INTO personas (name,"systemPrompt","userId") VALUES ($1,'x',$2) RETURNING id`, [m, u]);
  await q(`INSERT INTO memory (content,"userId") VALUES ($1,$2) RETURNING id`, [m, u]);
  const tmpl = (await q(`INSERT INTO task_templates (name,"userId") VALUES ($1,$2) RETURNING id`, [m, u])).id;
  await q(`INSERT INTO template_subtasks ("templateId",title) VALUES ($1,$2) RETURNING id`, [tmpl, m]);
  const obj = (await q(`INSERT INTO objectives (title,"userId") VALUES ($1,$2) RETURNING id`, [m, u])).id;
  await q(`INSERT INTO key_results ("objectiveId",title) VALUES ($1,$2) RETURNING id`, [obj, m]);
  const s1 = `bk-${tag}-proj-${run}`; const s2 = `bk-${tag}-general-${run}`;
  await q(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,$3,$4) RETURNING "sessionId"`, [s1, proj, m, u]);
  await q(`INSERT INTO sessions ("sessionId",title,"userId") VALUES ($1,$2,$3) RETURNING "sessionId"`, [s2, m, u]); // a general chat: no project
  const msg = (await q(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user',$3) RETURNING id`, [s1, proj, m])).id;
  await q(`INSERT INTO messages ("sessionId",role,content) VALUES ($1,'user',$2) RETURNING id`, [s2, m]);
  const parent = (await q(`INSERT INTO tasks (title,"userId") VALUES ($1,$2) RETURNING id`, [m, u])).id;
  const sub = (await q(`INSERT INTO tasks (title,"parentTaskId") VALUES ($1,$2) RETURNING id`, [m + '-sub', parent])).id; // a template-made subtask: no userId of its own
  await q(`INSERT INTO task_tags ("taskId",tag) VALUES ($1,$2) RETURNING id`, [parent, m]);
  await q(`INSERT INTO task_comments ("taskId",content) VALUES ($1,$2) RETURNING id`, [parent, m]);
  await q(`INSERT INTO task_dependencies ("taskId","blockedByTaskId") VALUES ($1,$2) RETURNING id`, [sub, parent]);
  await q(`INSERT INTO prompts (title,content,"userId") VALUES ($1,'x',$2) RETURNING id`, [m, u]);
  await q(`INSERT INTO notes (user_id,title) VALUES ($1,$2) RETURNING id`, [u, m]);
  await q(`INSERT INTO pinned_urls ("projectId",url,title) VALUES ($1,'https://x.example',$2) RETURNING id`, [proj, m]);
  const file = (await q(`INSERT INTO files ("projectId",name,path) VALUES ($1,$2,'/nowhere/x') RETURNING id`, [proj, m])).id;
  await q(`INSERT INTO session_files ("sessionId","fileId") VALUES ($1,$2) RETURNING "sessionId"`, [s1, file]);
  await q(`INSERT INTO bookmarks ("messageId","sessionId") VALUES ($1,$2) RETURNING id`, [msg, s1]);
  await q(`INSERT INTO prompt_chains (name,"userId") VALUES ($1,$2) RETURNING id`, [m, u]);
  await q(`INSERT INTO debates ("debateId",topic,"modelA","modelB","projectId") VALUES ($1,$2,'a','b',$3) RETURNING id`, [`dbt-${tag}-${run}`, m, proj]);
  await q(`INSERT INTO comparisons ("projectId") VALUES ($1) RETURNING id`, [proj]);
  await q(`INSERT INTO search_index (type,"projectId",title) VALUES ('project',$1,$2) RETURNING id`, [String(proj), m]);
  ids[tag] = { proj };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('every backup route refuses a member (403), including create and restore', async () => {
  for (const [m, u] of [['GET', '/status'], ['GET', '/list'], ['GET', '/variables'], ['POST', '/create'], ['POST', '/restore']]) {
    const r = await call(m, `/api/backup${u}`, 'B', m === 'POST' ? { folderId: 'x' } : undefined);
    assert.strictEqual(r.status, 403, `${m} ${u} -> ${r.status}`);
    assert.deepStrictEqual(r.json, { error: 'Admin access required' });
  }
});

test('an administrator still reaches status and variables; create stops cleanly when no Drive is connected', async () => {
  const st = await call('GET', '/api/backup/status');
  assert.strictEqual(st.status, 200); assert.strictEqual(st.json.driveConnected, false);
  assert.strictEqual((await call('GET', '/api/backup/variables')).status, 200);
  const cr = await call('POST', '/api/backup/create');
  assert.ok(cr.type.includes('text/event-stream'));
  assert.ok(/Google account not connected/.test(cr.text), cr.text);
  const rec = await pool.query(`SELECT 1 FROM settings WHERE "userId"=$1 AND key='last_backup_at'`, [A]);
  assert.strictEqual(rec.rows.length, 0, 'no backup is recorded when nothing was backed up');
});

test('restore is switched off (410) and deletes nothing, even for an administrator', async () => {
  const count = async () => (await pool.query(`SELECT (SELECT COUNT(*) FROM projects WHERE "userId" = ANY($1::int[]))::int p, (SELECT COUNT(*) FROM tasks WHERE "userId" = ANY($1::int[]))::int t, (SELECT COUNT(*) FROM notes WHERE user_id = ANY($1::int[]))::int n, (SELECT COUNT(*) FROM messages WHERE "projectId" = ANY($2::int[]))::int m`, [[A, B], [ids.A.proj, ids.B.proj]])).rows[0];
  const before = await count();
  const r = await call('POST', '/api/backup/restore', 'A', { folderId: 'anything' });
  assert.strictEqual(r.status, 410);
  assert.ok(/switched off/.test(r.json.error));
  assert.deepStrictEqual(await count(), before, 'every row is still there');
});

test("a backup holds only the caller's rows: every table, both users, nothing crosses over", async () => {
  const a = await exportOwnedData(A); const b = await exportOwnedData(B);
  for (const [table] of BACKUP_TABLES) {
    assert.strictEqual(a[table].length, EXPECTED[table], `A ${table}: ${a[table].length}`);
    assert.strictEqual(b[table].length, EXPECTED[table], `B ${table}: ${b[table].length}`);
    const inA = new Set(a[table].map((r) => JSON.stringify(r)));
    assert.ok(b[table].every((r) => !inA.has(JSON.stringify(r))), `${table}: a row appears in both backups`);
    assert.ok(!JSON.stringify(a[table]).includes(`MARK-B-${run}`), `${table}: A's backup contains B's data`);
    assert.ok(!JSON.stringify(b[table]).includes(`MARK-A-${run}`), `${table}: B's backup contains A's data`);
  }
  assert.strictEqual(Object.keys(a).length, BACKUP_TABLES.length);
});

test("a backup of someone with no data is empty, never everyone's data", async () => {
  const none = (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`bk-empty-${run}@example.test`])).rows[0].id;
  try {
    const e = await exportOwnedData(none);
    for (const [table] of BACKUP_TABLES) assert.strictEqual(e[table].length, 0, `${table} should be empty`);
  } finally { await pool.query('DELETE FROM users WHERE id=$1', [none]); }
});

test("uploads: only the caller's project folders and own Finance documents are picked up", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-own-test-'));
  try {
    const put = (rel, text = 'x') => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put(`${ids.A.proj}/a-file.txt`); put(`${ids.A.proj}/sub/a-deep.txt`); put(`${ids.B.proj}/b-file.txt`);
    put(`finance-docs/${A}/a-doc.pdf`); put(`finance-docs/${B}/b-doc.pdf`);
    put('stray-root-file.txt'); put('999999999/unowned.txt');
    const rels = (await listOwnedUploads(A, dir)).map((f) => f.relativePath.split(path.sep).join('/')).sort();
    assert.deepStrictEqual(rels, [`${ids.A.proj}/a-file.txt`, `${ids.A.proj}/sub/a-deep.txt`, `finance-docs/${A}/a-doc.pdf`].sort());
    const relsB = (await listOwnedUploads(B, dir)).map((f) => f.relativePath.split(path.sep).join('/')).sort();
    assert.deepStrictEqual(relsB, [`${ids.B.proj}/b-file.txt`, `finance-docs/${B}/b-doc.pdf`].sort());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the "last backup" record is per user: the new statement works, the old one could never run', async () => {
  const upsert = (u, v) => pool.query(`INSERT INTO settings ("userId", key, value) VALUES ($1, 'last_backup_at', $2) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`, [u, v]);
  await upsert(A, '2026-01-01'); await upsert(A, '2026-02-02'); await upsert(B, '2026-03-03');
  const rows = (await pool.query(`SELECT "userId", value FROM settings WHERE key='last_backup_at' AND "userId" = ANY($1::int[]) ORDER BY "userId"`, [[A, B]])).rows;
  assert.deepStrictEqual(rows, [{ userId: A, value: '2026-02-02' }, { userId: B, value: '2026-03-03' }].sort((x, y) => x.userId - y.userId));
  await assert.rejects(() => pool.query(`INSERT INTO settings (key, value) VALUES ('last_backup_at', 'x') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`), /constraint|conflict/i, 'the old statement is invalid for this table, so a backup never recorded itself');
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`bk-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  await seed(A, 'A'); await seed(B, 'B');
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const t of tests) {
      try { await t.fn(); console.log(`  ok   ${t.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
    }
  } finally {
    server.close();
    const users = [A, B];
    await pool.query(`DELETE FROM search_index WHERE "projectId" = ANY($1::text[])`, [[String(ids.A.proj), String(ids.B.proj)]]);
    await pool.query(`DELETE FROM sessions WHERE "userId" = ANY($1::int[])`, [users]);
    for (const t of ['folders', 'personas', 'memory', 'task_templates', 'objectives', 'prompts', 'prompt_chains', 'tasks']) {
      await pool.query(`DELETE FROM "${t}" WHERE "userId" = ANY($1::int[])`, [users]).catch(() => {});
    }
    await pool.query(`DELETE FROM notes WHERE user_id = ANY($1::int[])`, [users]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [users]); // projects and what hangs off them cascade
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
