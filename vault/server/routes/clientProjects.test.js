#!/usr/bin/env node
/**
 * Client projects: status, list + next due task, activity, notes, links, read-only finance
 * panel, convert, template apply, and per-user isolation.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards
 * (everything created cascades from users).
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15434/vault_copy node server/routes/clientProjects.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP clientProjects.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let userA; let userB;
const app = express();
app.use(express.json());
// Who is calling is chosen per request with the x-user header ('B' = the second user).
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? userB : userA, isAdmin: true }; next(); });
app.use('/api/client-projects', require('./clientProjects'));
app.use('/api/notes', require('./notes'));
app.use('/api/task-templates', require('./taskTemplates'));
app.use('/api/tasks', require('./tasks'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

let clientA; let clientB; let projectId;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a new client project needs one of your own clients', async () => {
  assert.strictEqual((await call('POST', '/api/client-projects', { name: 'X' })).status, 400);
  assert.strictEqual((await call('POST', '/api/client-projects', { name: 'X', clientId: clientB })).status, 400, "another user's client is refused");
  assert.strictEqual((await call('POST', '/api/client-projects', { name: '  ', clientId: clientA })).status, 400);
});

test('create: type client, status active, tied to the client; appears in the list', async () => {
  const r = await call('POST', '/api/client-projects', { name: 'Video recreation', clientId: clientA });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  projectId = r.json.id;
  assert.strictEqual(r.json.projectType, 'client');
  assert.strictEqual(r.json.clientStatus, 'active');
  assert.strictEqual(r.json.clientId, clientA);
  const list = await call('GET', '/api/client-projects');
  const row = list.json.find((x) => x.id === projectId);
  assert.ok(row && row.clientName === 'Client A' && row.clientStatus === 'active' && row.openTasks === 0 && row.nextTaskTitle === null);
  assert.strictEqual((await call('GET', '/api/client-projects', undefined, 'B')).json.length, 0, "the other user sees none of A's projects");
});

test('status: only active / waiting / done', async () => {
  assert.strictEqual((await call('PATCH', `/api/client-projects/${projectId}/status`, { clientStatus: 'paused' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/client-projects/${projectId}/status`, { clientStatus: 'waiting' })).status, 200);
  const o = await call('GET', `/api/client-projects/${projectId}`);
  assert.strictEqual(o.json.project.clientStatus, 'waiting');
  assert.strictEqual((await call('PATCH', `/api/client-projects/${projectId}/status`, { clientStatus: 'active' }, 'B')).status, 404);
});

test('next due task: earliest open top-level task with a date; done and subtasks ignored', async () => {
  const mk = async (title, dueDate, status = 'todo', parent = null) =>
    (await pool.query(`INSERT INTO tasks (title,status,"dueDate","projectId","parentTaskId","userId") VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [title, status, dueDate, projectId, parent, userA])).rows[0].id;
  await mk('done early', '2026-01-01', 'done');
  const later = await mk('later', '2026-12-01');
  await mk('sub early', '2026-02-01', 'todo', later);
  await mk('soonest open', '2026-06-15');
  await mk('no date', null);
  const list = await call('GET', '/api/client-projects');
  const row = list.json.find((x) => x.id === projectId);
  assert.strictEqual(row.nextTaskTitle, 'soonest open');
  assert.strictEqual(row.openTasks, 3, 'later + soonest open + no date');
  const o = await call('GET', `/api/client-projects/${projectId}`);
  assert.strictEqual(o.json.nextTask.title, 'soonest open');
});

test('activity: inherits project and client, validates, and is separate from entries with no project', async () => {
  assert.strictEqual((await call('POST', `/api/client-projects/${projectId}/activity`, { note: '' })).status, 400);
  assert.strictEqual((await call('POST', `/api/client-projects/${projectId}/activity`, { note: 'x', type: 'bogus' })).status, 400);
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.strictEqual((await call('POST', `/api/client-projects/${projectId}/activity`, { note: 'x', date: future })).status, 400);
  const r = await call('POST', `/api/client-projects/${projectId}/activity`, { note: 'Client phoned about the intro', type: 'call' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.clientId, clientA);
  assert.strictEqual(r.json.projectId, projectId);
  await pool.query(`INSERT INTO client_interactions ("clientId","userId",type,note) VALUES ($1,$2,'note','client-wide entry')`, [clientA, userA]);
  const list = await call('GET', `/api/client-projects/${projectId}/activity`);
  assert.strictEqual(list.json.length, 1);
  assert.strictEqual(list.json[0].note, 'Client phoned about the intro');
  assert.strictEqual((await call('GET', `/api/client-projects/${projectId}/activity`, undefined, 'B')).status, 404);
});

test('notes: created from the project inherit project and client; editing elsewhere keeps the client', async () => {
  const n = await call('POST', `/api/client-projects/${projectId}/notes`, { title: 'Brief call', body: 'hello' });
  assert.strictEqual(n.status, 201);
  assert.strictEqual(n.json.project_id, projectId);
  assert.strictEqual(n.json.client_id, clientA);
  // An older screen saves only title/body: client_id and project_id must survive.
  const put = await call('PUT', `/api/notes/${n.json.id}`, { title: 'Brief call 2', body: 'hello again' });
  assert.strictEqual(put.json.client_id, clientA);
  assert.strictEqual(put.json.project_id, projectId);
  const list = await call('GET', `/api/client-projects/${projectId}/notes`);
  assert.strictEqual(list.json.length, 1);
});

test('notes route: client_id must be one of your own clients (no foreign key, so checked in code)', async () => {
  assert.strictEqual((await call('POST', '/api/notes', { title: 'bad', client_id: clientB })).status, 400);
  assert.strictEqual((await call('POST', '/api/notes', { title: 'bad', client_id: 999999999 })).status, 400);
  const ok = await call('POST', '/api/notes', { title: 'direct', client_id: clientA });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.json.client_id, clientA);
  assert.strictEqual((await call('PUT', `/api/notes/${ok.json.id}`, { client_id: clientB })).status, 400);
  const cleared = await call('PUT', `/api/notes/${ok.json.id}`, { client_id: null });
  assert.strictEqual(cleared.json.client_id, null);
});

test('links: add, list, validate, delete; never visible to another user', async () => {
  assert.strictEqual((await call('POST', `/api/client-projects/${projectId}/links`, { label: 'Raw', location: '' })).status, 400);
  assert.strictEqual((await call('POST', `/api/client-projects/${projectId}/links`, { label: 'Raw', location: 'D:\\x', kind: 'bogus' })).status, 400);
  const l = await call('POST', `/api/client-projects/${projectId}/links`, { label: 'Raw footage', location: 'D:\\Clients\\A\\raw', kind: 'raw', note: '40 GB' });
  assert.strictEqual(l.status, 201);
  assert.strictEqual((await call('GET', `/api/client-projects/${projectId}/links`)).json.length, 1);
  assert.strictEqual((await call('DELETE', `/api/client-projects/${projectId}/links/${l.json.id}`, undefined, 'B')).status, 404);
  assert.strictEqual((await call('DELETE', `/api/client-projects/${projectId}/links/${l.json.id}`)).status, 200);
  assert.strictEqual((await call('GET', `/api/client-projects/${projectId}/links`)).json.length, 0);
});

test('finance panel: the client\'s own quotes and invoices, read-only, nothing from other clients or users', async () => {
  await pool.query(`INSERT INTO fin_invoices ("userId",number,status,total,"docType","clientRef") VALUES ($1,'Q-T-1','sent',1225,'quote',$2)`, [userA, clientA]);
  await pool.query(`INSERT INTO fin_invoices ("userId",number,status,total,"docType","clientRef") VALUES ($1,'INV-T-1','paid',2960,'invoice',$2)`, [userA, clientA]);
  await pool.query(`INSERT INTO fin_invoices ("userId",number,status,total,"docType","clientRef") VALUES ($1,'INV-T-OTHER','paid',99,'invoice',$2)`, [userB, clientB]);
  const before = (await pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(total),0)::float t FROM fin_invoices WHERE "userId" IN ($1,$2)`, [userA, userB])).rows[0];
  const r = await call('GET', `/api/client-projects/${projectId}/finance`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.documents.map((d) => d.number).sort(), ['INV-T-1', 'Q-T-1']);
  assert.strictEqual(r.json.scope, 'client');
  const after = (await pool.query(`SELECT COUNT(*)::int n, COALESCE(SUM(total),0)::float t FROM fin_invoices WHERE "userId" IN ($1,$2)`, [userA, userB])).rows[0];
  assert.deepStrictEqual(after, before, 'reading the panel changes nothing in Finance');
});

test('convert: an existing project becomes a client project; needs your client; others cannot convert it', async () => {
  const p = (await pool.query(`INSERT INTO projects (name, "userId", model, "projectType") VALUES ('Old chat project',$1,'m','research') RETURNING id`, [userA])).rows[0].id;
  const conv = await call('GET', '/api/client-projects/convertible');
  assert.ok(conv.json.some((x) => x.id === p) && !conv.json.some((x) => x.id === projectId));
  assert.strictEqual((await call('POST', `/api/client-projects/${p}/convert`, {})).status, 400, 'no client given and none on the project');
  assert.strictEqual((await call('POST', `/api/client-projects/${p}/convert`, { clientId: clientB })).status, 400);
  assert.strictEqual((await call('POST', `/api/client-projects/${p}/convert`, { clientId: clientA }, 'B')).status, 404);
  const ok = await call('POST', `/api/client-projects/${p}/convert`, { clientId: clientA });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.previous.projectType, 'research');
  const row = (await pool.query(`SELECT "projectType","clientId","clientStatus" FROM projects WHERE id=$1`, [p])).rows[0];
  assert.deepStrictEqual(row, { projectType: 'client', clientId: clientA, clientStatus: 'active' });
});

test('template apply: sets the project and inherits its client; refuses a project that is not yours', async () => {
  const t = (await call('POST', '/api/task-templates', { name: 'Video recreation', subtasks: ['Confirm brief', 'Extract audio'] })).json;
  const bad = await call('POST', `/api/task-templates/${t.id}/apply`, { projectId: projectId }, 'B');
  assert.strictEqual(bad.status, 404, 'template of user A is not found for B');
  const other = (await pool.query(`INSERT INTO projects (name, "userId", model) VALUES ('B project',$1,'m') RETURNING id`, [userB])).rows[0].id;
  assert.strictEqual((await call('POST', `/api/task-templates/${t.id}/apply`, { projectId: other })).status, 400);
  const ok = await call('POST', `/api/task-templates/${t.id}/apply`, { projectId });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  const task = (await pool.query(`SELECT "projectId","clientId","userId" FROM tasks WHERE id=$1`, [ok.json.taskId])).rows[0];
  assert.deepStrictEqual(task, { projectId, clientId: clientA, userId: userA });
  const subs = (await pool.query(`SELECT COUNT(*)::int n FROM tasks WHERE "parentTaskId"=$1`, [ok.json.taskId])).rows[0].n;
  assert.strictEqual(subs, 2);
  assert.strictEqual((await call('POST', `/api/task-templates/${t.id}/apply`, { clientId: clientB })).status, 400);
});

test('chats and files: only this project\'s live chats and uploaded files are listed', async () => {
  const mkSession = async (id, proj, title, deleted) => {
    await pool.query(`INSERT INTO sessions ("sessionId","projectId",title,"deletedAt") VALUES ($1,$2,$3,$4)`, [id, proj, title, deleted ? new Date() : null]);
    await pool.query(`INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,'user',$3)`, [id, proj, `first question in ${title}`]);
  };
  const other = (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ('elsewhere',$1,'m') RETURNING id`, [userA])).rows[0].id;
  await mkSession('cp-test-s1', projectId, 'Luma clips', false);
  await mkSession('cp-test-s2', projectId, 'Deleted chat', true);
  await mkSession('cp-test-s3', other, 'Different project', false);
  await pool.query(`INSERT INTO sessions ("sessionId","projectId",title) VALUES ('cp-test-empty',$1,'No messages')`, [projectId]);
  const chats = await call('GET', `/api/client-projects/${projectId}/chats`);
  assert.deepStrictEqual(chats.json.map((c) => c.title), ['Luma clips']);
  assert.ok(/first question/.test(chats.json[0].firstUserMsg));
  await pool.query(`INSERT INTO files ("projectId",name,size,mimetype,path) VALUES ($1,'brief.pdf',10,'application/pdf','/nowhere/brief.pdf')`, [projectId]);
  await pool.query(`INSERT INTO files ("projectId",name,size,mimetype,path) VALUES ($1,'other.pdf',10,'application/pdf','/nowhere/o.pdf')`, [other]);
  const files = await call('GET', `/api/client-projects/${projectId}/files`);
  assert.deepStrictEqual(files.json.map((f) => f.name), ['brief.pdf']);
  assert.ok(!('path' in files.json[0]), 'the server path is not exposed');
});

test('activity entries list their attachments', async () => {
  const act = (await call('GET', `/api/client-projects/${projectId}/activity`)).json[0];
  await pool.query(`INSERT INTO attachments ("userId","entityType","entityId",filename,"storedPath") VALUES ($1,'touchpoint',$2,'notes.txt','/nowhere/notes.txt')`, [userA, act.id]);
  const again = (await call('GET', `/api/client-projects/${projectId}/activity`)).json[0];
  assert.strictEqual(again.attachments.length, 1);
  assert.strictEqual(again.attachments[0].filename, 'notes.txt');
  assert.ok(!('storedPath' in again.attachments[0]));
});

test('other users cannot read or change a client project; a plain project is not a client project', async () => {
  for (const [m, u] of [['GET', ''], ['GET', '/activity'], ['GET', '/notes'], ['GET', '/links'], ['GET', '/finance'], ['GET', '/chats'], ['GET', '/files']]) {
    assert.strictEqual((await call(m, `/api/client-projects/${projectId}${u}`, undefined, 'B')).status, 404, u);
  }
  const plain = (await pool.query(`INSERT INTO projects (name, "userId", model, "projectType") VALUES ('Plain',$1,'m','writing') RETURNING id`, [userA])).rows[0].id;
  assert.strictEqual((await call('GET', `/api/client-projects/${plain}`)).status, 404);
});

async function cleanup(ids) {
  await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids]); // everything above cascades from users
}

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1,'x') RETURNING id`, [`cp-test-${tag}-${Date.now()}@example.test`])).rows[0].id;
  userA = await mk('a'); userB = await mk('b');
  clientA = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1,'Client A') RETURNING id`, [userA])).rows[0].id;
  clientB = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1,'Client B') RETURNING id`, [userB])).rows[0].id;
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
    await cleanup([userA, userB]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
