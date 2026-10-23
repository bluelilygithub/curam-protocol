#!/usr/bin/env node
/**
 * Chats use the shared recycle bin: a deleted chat (session, messages, bookmarks, attached files, linked study decks) is kept 30 days and
 * comes back whole, under its project and with its own ids; private; a chat too big for the bin falls back to the old Deleted list.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/chatRecycleBin.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP chatRecycleBin.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let A; let B;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? B : A, isAdmin: false }; next(); });
app.use('/api/chat', require('./chat'));
app.use('/api/recycle-bin', require('./recycleBin'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const run = Date.now();
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const project = async (name, user) => (await one('INSERT INTO projects (name, "userId", model, "projectType") VALUES ($1,$2,\'m\',\'writing\') RETURNING id', [name, user])).id;
const chat = async (user, projectId, title, texts) => {
  const sid = crypto.randomUUID();
  await pool.query('INSERT INTO sessions ("sessionId","userId","projectId",title) VALUES ($1,$2,$3,$4)', [sid, user, projectId, title]);
  const ids = [];
  for (let i = 0; i < texts.length; i++) {
    ids.push((await one('INSERT INTO messages ("sessionId","projectId",role,content,"createdAt") VALUES ($1,$2,$3,$4, NOW() + ($5 || \' seconds\')::interval) RETURNING id',
      [sid, projectId, i % 2 ? 'assistant' : 'user', texts[i], String(i)])).id);
  }
  return { sid, ids };
};
const inBin = async (binId, as) => (await call('GET', '/api/recycle-bin', undefined, as)).json.items.some((i) => i.id === binId);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a deleted chat goes to the bin whole and Undo brings back the session, messages (same ids and order), bookmarks, files and study deck', async () => {
  const proj = await project('Kitchen job', A);
  const { sid, ids } = await chat(A, proj, 'Quote for the Hendersons', ['What do we charge for oak?', 'About $120 a metre.', 'And the install?']);
  await pool.query('UPDATE sessions SET starred=1, summary=$2, "isSummarized"=1 WHERE "sessionId"=$1', [sid, 'Pricing talk']);
  await pool.query('INSERT INTO bookmarks ("messageId","sessionId") VALUES ($1,$2)', [ids[1], sid]);
  const file = (await one('INSERT INTO files ("projectId", name, path) VALUES ($1,\'plan.pdf\',\'x/plan.pdf\') RETURNING id', [proj])).id;
  await pool.query('INSERT INTO session_files ("sessionId","fileId") VALUES ($1,$2)', [sid, file]);
  const deck = (await one('INSERT INTO study_decks ("userId", title, "sessionId") VALUES ($1,\'Oak\',$2) RETURNING id', [A, sid])).id;

  const del = await call('DELETE', `/api/chat/sessions/${sid}`);
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.ok(del.json.binId && del.json.retentionDays === 30);
  assert.strictEqual((await q('SELECT 1 FROM sessions WHERE "sessionId"=$1', [sid])).length, 0, 'the chat is gone from Chat');
  assert.strictEqual((await q('SELECT 1 FROM messages WHERE "sessionId"=$1', [sid])).length, 0, 'and so are its messages');
  assert.strictEqual((await q('SELECT 1 FROM bookmarks WHERE "sessionId"=$1', [sid])).length, 0);
  assert.strictEqual((await one('SELECT "sessionId" FROM study_decks WHERE id=$1', [deck])).sessionId, null);
  const item = (await call('GET', '/api/recycle-bin')).json.items.find((i) => i.id === del.json.binId);
  assert.deepStrictEqual({ type: item.entityType, label: item.label, title: item.title, detail: item.detail },
    { type: 'chat', label: 'Chat', title: 'Quote for the Hendersons', detail: '3 messages · Kitchen job' });

  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.strictEqual(back.json.entityId, sid);
  const s = await one('SELECT "userId","projectId",title,starred,summary,"deletedAt" FROM sessions WHERE "sessionId"=$1', [sid]);
  assert.deepStrictEqual({ ...s }, { userId: A, projectId: proj, title: 'Quote for the Hendersons', starred: 1, summary: 'Pricing talk', deletedAt: null });
  const msgs = await q('SELECT id, role, content, "projectId" FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt", id', [sid]);
  assert.deepStrictEqual(msgs.map((m) => [m.id, m.role, m.content, m.projectId]),
    [[ids[0], 'user', 'What do we charge for oak?', proj], [ids[1], 'assistant', 'About $120 a metre.', proj], [ids[2], 'user', 'And the install?', proj]]);
  assert.strictEqual((await one('SELECT "messageId" FROM bookmarks WHERE "sessionId"=$1', [sid])).messageId, ids[1], 'the bookmark is on the same message');
  assert.strictEqual((await one('SELECT "fileId" FROM session_files WHERE "sessionId"=$1', [sid])).fileId, file);
  assert.strictEqual((await one('SELECT "sessionId" FROM study_decks WHERE id=$1', [deck])).sessionId, sid);
  assert.strictEqual(await inBin(del.json.binId), false, 'and it leaves the bin');
  await pool.query('DELETE FROM study_decks WHERE id=$1', [deck]);
  await pool.query('DELETE FROM projects WHERE id=$1', [proj]);
});

test('a chat cannot be deleted or restored by someone else, and deleting twice is a 404', async () => {
  const { sid } = await chat(A, null, 'Private', ['secret']);
  assert.strictEqual((await call('DELETE', `/api/chat/sessions/${sid}`, undefined, 'B')).status, 404);
  assert.strictEqual((await q('SELECT 1 FROM sessions WHERE "sessionId"=$1', [sid])).length, 1, 'untouched');
  const del = await call('DELETE', `/api/chat/sessions/${sid}`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await call('DELETE', `/api/chat/sessions/${sid}`)).status, 404, 'already gone');
  assert.strictEqual(await inBin(del.json.binId, 'B'), false, 'invisible to others');
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`, undefined, 'B')).status, 404);
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`)).status, 200);
  await pool.query('DELETE FROM sessions WHERE "sessionId"=$1', [sid]);
});

test("a project owner can delete a chat in their project; it comes back still belonging to the member who had it", async () => {
  const proj = await project('Shared job', A);
  const { sid } = await chat(B, proj, "B's chat in A's project", ['hello']);
  assert.strictEqual((await call('DELETE', `/api/chat/sessions/${sid}`, undefined, 'B')).status, 200, 'its own owner can');
  const again = await chat(B, proj, "another of B's", ['hi']);
  const del = await call('DELETE', `/api/chat/sessions/${again.sid}`);
  assert.strictEqual(del.status, 200, 'the project owner can');
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`)).status, 200);
  assert.strictEqual((await one('SELECT "userId" FROM sessions WHERE "sessionId"=$1', [again.sid])).userId, B);
  await pool.query('DELETE FROM projects WHERE id=$1', [proj]); // chats and messages go with it
});

test('restoring after the project or a file was deleted still works: an ordinary chat, without the file', async () => {
  const proj = await project('Short-lived', A);
  const { sid } = await chat(A, proj, 'Orphan', ['one', 'two']);
  const file = (await one('INSERT INTO files ("projectId", name, path) VALUES ($1,\'gone.pdf\',\'x/gone.pdf\') RETURNING id', [proj])).id;
  await pool.query('INSERT INTO session_files ("sessionId","fileId") VALUES ($1,$2)', [sid, file]);
  const del = await call('DELETE', `/api/chat/sessions/${sid}`);
  await pool.query('DELETE FROM projects WHERE id=$1', [proj]);
  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.strictEqual((await one('SELECT "projectId" FROM sessions WHERE "sessionId"=$1', [sid])).projectId, null, 'no project any more');
  assert.deepStrictEqual((await q('SELECT "projectId", content FROM messages WHERE "sessionId"=$1 ORDER BY id', [sid])).map((m) => [m.projectId, m.content]), [[null, 'one'], [null, 'two']]);
  assert.strictEqual((await q('SELECT 1 FROM session_files WHERE "sessionId"=$1', [sid])).length, 0);
  await pool.query('DELETE FROM sessions WHERE "sessionId"=$1', [sid]);
});

test('a chat that cannot be restored leaves the bin item alone (the id is already in use)', async () => {
  const { sid } = await chat(A, null, 'Twice', ['x']);
  const del = await call('DELETE', `/api/chat/sessions/${sid}`);
  await pool.query('INSERT INTO sessions ("sessionId","userId",title) VALUES ($1,$2,\'imposter\')', [sid, A]);
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`)).status, 409);
  assert.strictEqual(await inBin(del.json.binId), true, 'still in the bin');
  await pool.query('DELETE FROM sessions WHERE "sessionId"=$1', [sid]);
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`)).status, 200, 'and fine once the id is free');
  await pool.query('DELETE FROM sessions WHERE "sessionId"=$1', [sid]);
});

test('a chat too big for the bin is not refused: it goes to the old Deleted list and restores from there', async () => {
  const big = 'x'.repeat(26 * 1024 * 1024);
  const { sid } = await chat(A, null, 'Huge', [big]);
  const del = await call('DELETE', `/api/chat/sessions/${sid}`);
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.deepStrictEqual({ binId: del.json.binId, legacy: del.json.legacy }, { binId: null, legacy: true });
  const s = await one('SELECT "deletedAt" FROM sessions WHERE "sessionId"=$1', [sid]);
  assert.ok(s.deletedAt, 'marked deleted, as before');
  assert.strictEqual((await q('SELECT 1 FROM messages WHERE "sessionId"=$1', [sid])).length, 1, 'its messages are kept');
  assert.ok((await call('GET', '/api/chat/deleted-history')).json.some((x) => x.sessionId === sid), 'listed under Deleted in Chat History');
  assert.strictEqual((await call('POST', `/api/chat/sessions/${sid}/restore`)).status, 200);
  await pool.query('DELETE FROM messages WHERE "sessionId"=$1', [sid]);
  await pool.query('DELETE FROM sessions WHERE "sessionId"=$1', [sid]);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`cb-${tag}-${run}@example.test`])).rows[0].id;
  A = await mk('a'); B = await mk('b');
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const x of tests) {
      try { await x.fn(); console.log(`  ok   ${x.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${x.name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
    }
  } finally {
    server.close();
    await pool.query(`DELETE FROM messages WHERE "sessionId" IN (SELECT "sessionId" FROM sessions WHERE "userId" = ANY($1::int[]))`, [[A, B]]);
    await pool.query(`DELETE FROM sessions WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM projects WHERE "userId" = ANY($1::int[])`, [[A, B]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B]]); // the bin rows cascade from users
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
