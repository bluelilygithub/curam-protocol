#!/usr/bin/env node
/**
 * Every route in files.js checks that the project or file belongs to the caller; another user gets the
 * same 404 as for something that does not exist, and nothing is read, changed, deleted or written.
 * Integration test: needs a real Postgres. Uses two throwaway users and a throwaway upload folder.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/files.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP files.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
// No outside calls from this test: an upload would otherwise try to summarise the text with a real model.
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
// Uploads in this test go to a throwaway folder (read by files.js when a file is stored).
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'files-own-test-'));
const { pool } = require('../db');

let userA; let userB; let projectA; let projectB; let fileA; let fileB; let diskA; let diskB;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? userB : userA, isAdmin: false }; next(); });
app.use('/api/files', require('./files'));

let base;
async function send(method, url, as, body) {
  const res = await fetch(base + url, { method, headers: as === 'B' ? { 'x-user': 'B' } : {}, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const get = (url, as) => send('GET', url, as);
const upload = (projectId, name, content, as) => {
  const fd = new FormData();
  fd.append('file', new Blob([content], { type: 'text/plain' }), name);
  return send('POST', `/api/files/upload/${projectId}`, as, fd);
};
const dbFiles = async (projectId) => (await pool.query('SELECT name FROM files WHERE "projectId"=$1 ORDER BY id', [projectId])).rows.map((r) => r.name);
const MISSING = { error: 'Not found' };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('list: the owner sees their project files, newest first', async () => {
  const r = await get(`/api/files/${projectA}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.map((f) => f.name).slice(0, 2), ['shared-name.txt', 'second.pdf']);
  assert.ok(r.json.map((f) => f.name).includes('first.pdf'));
});

test("list: another user gets 404 for someone else's project, and the same 404 as for a missing project", async () => {
  const other = await get(`/api/files/${projectA}`, 'B');
  assert.strictEqual(other.status, 404);
  const missing = await get('/api/files/999999999');
  assert.strictEqual(missing.status, 404);
  assert.deepStrictEqual(other.json, missing.json, 'no hint that the project exists');
});

test("list: each user sees their own project's files and nobody else's", async () => {
  const b = await get(`/api/files/${projectB}`, 'B');
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(b.json.map((f) => f.name).sort(), ['b-only.pdf', 'shared-name.txt']);
  assert.strictEqual((await get(`/api/files/${projectB}`)).status, 404, 'user A cannot read user B');
});

test('list: a project with no files returns an empty list for its owner; a non-numeric id is still a 400', async () => {
  const empty = (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ('empty',$1,'m') RETURNING id`, [userA])).rows[0].id;
  const r = await get(`/api/files/${empty}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, []);
  assert.strictEqual((await get('/api/files/abc')).status, 400);
});

test('raw download: the owner gets the file; another user gets the same 404 as a missing file and none of the content', async () => {
  const own = await get(`/api/files/${fileA}/raw`);
  assert.strictEqual(own.status, 200);
  assert.strictEqual(own.text, 'secret contents of A');
  const other = await get(`/api/files/${fileA}/raw`, 'B');
  assert.strictEqual(other.status, 404);
  assert.deepStrictEqual(other.json, MISSING);
  assert.ok(!other.text.includes('secret'));
  const missing = await get('/api/files/999999999/raw');
  assert.strictEqual(missing.status, 404);
  assert.deepStrictEqual(missing.json, other.json);
  assert.strictEqual((await get('/api/files/abc/raw')).status, 400);
});

test('pin: only the owner can toggle it; another user changes nothing and gets the missing-file 404', async () => {
  const pinned = async (id) => (await pool.query('SELECT pinned FROM files WHERE id=$1', [id])).rows[0].pinned;
  const other = await send('PATCH', `/api/files/${fileA}/pin`, 'B');
  assert.strictEqual(other.status, 404);
  assert.deepStrictEqual(other.json, MISSING);
  assert.strictEqual(await pinned(fileA), 0, 'still not pinned');
  assert.deepStrictEqual((await send('PATCH', `/api/files/${fileA}/pin`)).json, { pinned: true });
  assert.strictEqual(await pinned(fileA), 1);
  assert.deepStrictEqual((await send('PATCH', `/api/files/${fileA}/pin`, 'B')).json, MISSING);
  assert.strictEqual(await pinned(fileA), 1, 'another user cannot unpin it');
  assert.strictEqual((await send('PATCH', '/api/files/999999999/pin')).status, 404);
  assert.strictEqual((await send('PATCH', '/api/files/abc/pin')).status, 400);
  await send('PATCH', `/api/files/${fileA}/pin`); // back to unpinned
});

test("delete: another user's request deletes nothing, not from the database and not from disk", async () => {
  const searchRows = async () => (await pool.query(`SELECT "projectId" FROM search_index WHERE type='file' AND title='shared-name.txt' ORDER BY "projectId"`)).rows.map((r) => r.projectId);
  const other = await send('DELETE', `/api/files/${fileA}`, 'B');
  assert.strictEqual(other.status, 404);
  assert.deepStrictEqual(other.json, MISSING);
  assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM files WHERE id=$1', [fileA])).rows[0].n, 1, 'database row is still there');
  assert.ok(fs.existsSync(diskA), 'file is still on disk');
  assert.strictEqual(fs.readFileSync(diskA, 'utf8'), 'secret contents of A');
  assert.deepStrictEqual(await searchRows(), [String(projectA), String(projectB)].sort(), 'search entries untouched');
  assert.deepStrictEqual((await send('DELETE', '/api/files/999999999')).json, other.json, 'same answer as a missing file');
  assert.strictEqual((await send('DELETE', '/api/files/abc')).status, 400);

  // the owner can delete their own file; the other user's same-named file and search entry survive
  const own = await send('DELETE', `/api/files/${fileA}`);
  assert.strictEqual(own.status, 200);
  assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM files WHERE id=$1', [fileA])).rows[0].n, 0);
  assert.ok(!fs.existsSync(diskA), 'owner delete removes the file from disk');
  assert.deepStrictEqual(await searchRows(), [String(projectB)], "only this project's search entry is removed");
  assert.strictEqual((await pool.query('SELECT COUNT(*)::int n FROM files WHERE id=$1', [fileB])).rows[0].n, 1);
  assert.ok(fs.existsSync(diskB));
});

test('upload: the owner can upload; another user cannot, and nothing is stored or written to disk', async () => {
  const ok = await upload(projectA, 'notes.txt', 'hello from A');
  assert.strictEqual(ok.status, 201, ok.text);
  assert.ok((await dbFiles(projectA)).includes('notes.txt'));
  const folder = path.join(process.env.UPLOAD_DIR, String(projectA));
  assert.ok(fs.readdirSync(folder).some((f) => f.endsWith('notes.txt')));

  const before = await dbFiles(projectA);
  const dirBefore = fs.readdirSync(folder).sort();
  const intruder = await upload(projectA, 'planted.txt', 'planted by B', 'B');
  assert.strictEqual(intruder.status, 404);
  assert.deepStrictEqual(intruder.json, MISSING);
  assert.deepStrictEqual(await dbFiles(projectA), before, 'no row added to the other project');
  assert.deepStrictEqual(fs.readdirSync(folder).sort(), dirBefore, 'no file written to the other project folder');

  const ghost = await upload(999999999, 'ghost.txt', 'x');
  assert.strictEqual(ghost.status, 404);
  assert.deepStrictEqual(ghost.json, intruder.json, 'same answer as a missing project');
  assert.ok(!fs.existsSync(path.join(process.env.UPLOAD_DIR, '999999999')), 'no folder created for a missing project');
  assert.strictEqual((await upload('abc', 'x.txt', 'x')).status, 400);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1,'x') RETURNING id`, [`files-test-${tag}-${Date.now()}@example.test`])).rows[0].id;
  userA = await mk('a'); userB = await mk('b');
  const mkProject = async (u, name) => (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [name, u])).rows[0].id;
  projectA = await mkProject(userA, 'A project'); projectB = await mkProject(userB, 'B project');
  const mkFile = (proj, name, at) => pool.query(`INSERT INTO files ("projectId",name,size,mimetype,path,"uploadedAt") VALUES ($1,$2,10,'application/pdf','/nowhere/x',$3)`, [proj, name, at]);
  await mkFile(projectA, 'first.pdf', '2026-01-01'); await mkFile(projectA, 'second.pdf', '2026-02-01'); await mkFile(projectB, 'b-only.pdf', '2026-01-15');
  // two real files on disk with the same display name, one per user, each with a search entry
  diskA = path.join(process.env.UPLOAD_DIR, 'a-secret.txt'); fs.writeFileSync(diskA, 'secret contents of A');
  diskB = path.join(process.env.UPLOAD_DIR, 'b-own.txt'); fs.writeFileSync(diskB, 'contents of B');
  const mkReal = async (proj, disk, at) => (await pool.query(`INSERT INTO files ("projectId",name,size,mimetype,path,"uploadedAt") VALUES ($1,'shared-name.txt',10,'text/plain',$2,$3) RETURNING id`, [proj, disk, at])).rows[0].id;
  fileA = await mkReal(projectA, diskA, '2026-03-01'); fileB = await mkReal(projectB, diskB, '2026-03-01');
  for (const proj of [projectA, projectB]) await pool.query(`INSERT INTO search_index(type,"projectId",title,body) VALUES ('file',$1,'shared-name.txt','x')`, [String(proj)]);
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
    await pool.query(`DELETE FROM search_index WHERE type='file' AND "projectId" = ANY($1::text[])`, [[String(projectA), String(projectB)]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[userA, userB]]); // projects and files cascade from users
    try { fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
