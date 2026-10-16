#!/usr/bin/env node
/**
 * The knowledge graph is the caller's own: GET /api/graph shows only their projects, files, notes, chats,
 * tasks, goals and links, never anyone else's titles or connection counts; computing semantic connections
 * clears and rebuilds only their own; insights are stored and read per user and the model only ever sees
 * the caller's own graph. The model call is replaced by a recorder, so nothing leaves the machine.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/graph.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP graph.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const http = require('http');
const express = require('express');
const prompts = [];
const callModelPath = require.resolve('../services/callModel');
require.cache[callModelPath] = { id: callModelPath, filename: callModelPath, loaded: true, exports: { callModel: async (_model, prompt) => { prompts.push(String(prompt)); return { text: '{"insights":[{"text":"a fresh insight","nodeIds":[]}]}', inputTokens: 1, outputTokens: 1 }; } } };
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/graph', require('./graph'));

let base;
async function call(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON / SSE */ }
  return { status: res.status, json, text };
}

const run = Date.now();
const ids = { A: {}, B: {} };
const edgeKeys = async () => (await pool.query(`SELECT source_id, target_id FROM graph_edges WHERE edge_type='semantic' AND (source_id = ANY($1::text[]) OR target_id = ANY($1::text[]))`, [[ids.A.file, ids.A.note, ids.B.file, ids.B.note]])).rows.map((r) => `${r.source_id}>${r.target_id}`).sort();
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("the graph shows only the caller's own projects, files, notes, chats, tasks, goals and pins", async () => {
  for (const [who, other] of [[undefined, 'B'], ['B', 'A']]) {
    const r = await call('GET', '/api/graph', who);
    assert.strictEqual(r.status, 200);
    const mine = who === 'B' ? 'B' : 'A';
    const labels = r.json.nodes.map((n) => n.label).join(' | ');
    for (const kind of ['PROJ', 'FILE', 'NOTE', 'CHAT', 'GENERAL', 'TASK', 'SUBTASK', 'GOAL', 'KR', 'PIN']) {
      assert.ok(labels.includes(`${mine}-${kind}-${run}`), `${mine} should see their ${kind}`);
      assert.ok(!labels.includes(`${other}-${kind}-${run}`), `${mine} must not see ${other}'s ${kind}`);
    }
    assert.ok(!r.text.includes(`${other}-`), 'nothing of the other user appears anywhere in the response');
  }
});

test('semantic connections: only those between the caller\'s own items are shown and counted', async () => {
  const a = await call('GET', '/api/graph');
  const sem = a.json.edges.filter((e) => e.type === 'semantic');
  assert.deepStrictEqual(sem.map((e) => `${e.source}>${e.target}`), [`${ids.A.file}>${ids.A.note}`]);
  assert.strictEqual(a.json.semanticCount, 1, 'the count is the caller\'s, not everyone\'s');
  const b = await call('GET', '/api/graph', 'B');
  assert.deepStrictEqual(b.json.edges.filter((e) => e.type === 'semantic').map((e) => `${e.source}>${e.target}`), [`${ids.B.file}>${ids.B.note}`]);
  assert.strictEqual(b.json.semanticCount, 1);
});

test('task links: a link between one person\'s task and another\'s is never drawn', async () => {
  const a = await call('GET', '/api/graph');
  const blocks = a.json.edges.filter((e) => e.type === 'blocks');
  assert.deepStrictEqual(blocks.map((e) => `${e.source}>${e.target}`), [`task_${ids.A.task}>task_${ids.A.subtask}`]);
});

test("computing semantic connections clears and rebuilds only the caller's own; other people's are untouched", async () => {
  const before = await edgeKeys();
  assert.strictEqual(before.length, 3, 'A-A, B-B and a cross-user edge are present');
  const r = await call('POST', '/api/graph/compute-semantic');
  assert.strictEqual(r.status, 200);
  assert.ok(/"stage":"complete"/.test(r.text), r.text.slice(-300));
  const after = await edgeKeys();
  assert.ok(!after.includes(`${ids.A.file}>${ids.A.note}`), "A's own edge was cleared (nothing to recompute here)");
  assert.ok(after.includes(`${ids.B.file}>${ids.B.note}`), "B's edge survived A's recompute");
  assert.ok(after.includes(`${ids.A.file}>${ids.B.note}`), 'an edge that is not entirely the caller\'s is left alone');
});

test('insights: each user reads only their own; a refresh sends the model only their own graph and stores under their own account', async () => {
  const none = await call('GET', '/api/graph/insights');
  assert.deepStrictEqual(none.json, { insights: [], generatedAt: null }, "A does not see B's stored insights");
  const b = await call('GET', '/api/graph/insights', 'B');
  assert.strictEqual(b.json.insights[0].text, 'B-STORED-INSIGHT');
  const before = prompts.length;
  const r = await call('POST', '/api/graph/insights/refresh');
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(prompts.length, before + 1);
  const sent = prompts[prompts.length - 1];
  assert.ok(sent.includes(`A-PROJ-${run}`), "A's own graph was summarised");
  assert.ok(!sent.includes(`B-PROJ-${run}`) && !sent.includes(`B-TASK-${run}`) && !sent.includes(`B-NOTE-${run}`), "none of B's titles were sent to the model");
  assert.strictEqual((await call('GET', '/api/graph/insights')).json.insights[0].text, 'a fresh insight');
  assert.strictEqual((await call('GET', '/api/graph/insights', 'B')).json.insights[0].text, 'B-STORED-INSIGHT', "B's insights were not overwritten");
  const rows = (await pool.query(`SELECT "userId" FROM settings WHERE key='graph_insights' AND "userId" = ANY($1::int[]) ORDER BY "userId"`, [[A, B]])).rows.map((x) => x.userId);
  assert.deepStrictEqual(rows, [A, B].sort((x, y) => x - y));
});

async function seed(u, tag) {
  const q = async (sql, p) => (await pool.query(sql, p)).rows[0];
  const m = (kind) => `${tag}-${kind}-${run}`;
  const proj = (await q(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [m('PROJ'), u])).id;
  const file = (await q(`INSERT INTO files ("projectId",name,path) VALUES ($1,$2,'/nowhere/x') RETURNING id`, [proj, m('FILE')])).id;
  const note = (await q(`INSERT INTO notes (user_id,title) VALUES ($1,$2) RETURNING id`, [u, m('NOTE')])).id;
  const s1 = `gr-${tag}-chat-${run}`; const s2 = `gr-${tag}-general-${run}`;
  await q(`INSERT INTO sessions ("sessionId","projectId",title,"userId") VALUES ($1,$2,$3,$4) RETURNING "sessionId"`, [s1, proj, m('CHAT'), u]);
  await q(`INSERT INTO sessions ("sessionId",title,"userId") VALUES ($1,$2,$3) RETURNING "sessionId"`, [s2, m('GENERAL'), u]);
  const task = (await q(`INSERT INTO tasks (title,"userId","projectId") VALUES ($1,$2,$3) RETURNING id`, [m('TASK'), u, proj])).id;
  const subtask = (await q(`INSERT INTO tasks (title,"parentTaskId") VALUES ($1,$2) RETURNING id`, [m('SUBTASK'), task])).id; // template-made: no user id of its own
  await q(`INSERT INTO task_dependencies ("taskId","blockedByTaskId") VALUES ($1,$2) RETURNING id`, [subtask, task]);
  const obj = (await q(`INSERT INTO objectives (title,"userId") VALUES ($1,$2) RETURNING id`, [m('GOAL'), u])).id;
  await q(`INSERT INTO key_results ("objectiveId",title) VALUES ($1,$2) RETURNING id`, [obj, m('KR')]);
  await q(`INSERT INTO pinned_urls ("projectId",url,title) VALUES ($1,'https://x.example',$2) RETURNING id`, [proj, m('PIN')]);
  ids[tag] = { proj, file: `file_${file}`, note: `note_${note}`, task, subtask, obj, sessions: [s1, s2] };
}

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (t) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`gr-${t}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  await seed(A, 'A'); await seed(B, 'B');
  // a task of B that A's task is (wrongly) linked to: such a link must never be drawn
  await pool.query(`INSERT INTO task_dependencies ("taskId","blockedByTaskId") VALUES ($1,$2)`, [ids.A.task, ids.B.task]);
  for (const [s, t] of [[ids.A.file, ids.A.note], [ids.B.file, ids.B.note], [ids.A.file, ids.B.note]]) {
    await pool.query(`INSERT INTO graph_edges (source_id,target_id,edge_type,similarity) VALUES ($1,$2,'semantic',0.9)`, [s, t]);
  }
  await pool.query(`INSERT INTO settings ("userId",key,value) VALUES ($1,'graph_insights',$2)`, [B, JSON.stringify({ insights: [{ text: 'B-STORED-INSIGHT', nodeIds: [] }], generatedAt: '2026-01-01T00:00:00Z' })]);
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
    await pool.query(`DELETE FROM graph_edges WHERE source_id = ANY($1::text[]) OR target_id = ANY($1::text[])`, [[ids.A.file, ids.A.note, ids.B.file, ids.B.note]]);
    await pool.query(`DELETE FROM sessions WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM task_dependencies WHERE "taskId" = ANY($1::int[])`, [[ids.A.task, ids.A.subtask, ids.B.task, ids.B.subtask]]);
    await pool.query(`DELETE FROM tasks WHERE "userId" = ANY($1::int[]) OR "parentTaskId" = ANY($2::int[])`, [[A, B], [ids.A.task, ids.B.task]]);
    await pool.query(`DELETE FROM key_results WHERE "objectiveId" = ANY($1::int[])`, [[ids.A.obj, ids.B.obj]]);
    await pool.query(`DELETE FROM objectives WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM notes WHERE user_id = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
