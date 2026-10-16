#!/usr/bin/env node
/**
 * GET /api/files/:projectId lists a project's files only for the project's owner.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/files.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP files.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let userA; let userB; let projectA; let projectB;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? userB : userA, isAdmin: false }; next(); });
app.use('/api/files', require('./files'));

let base;
async function get(url, as) {
  const res = await fetch(base + url, { headers: as === 'B' ? { 'x-user': 'B' } : {} });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the owner sees their project files, newest first', async () => {
  const r = await get(`/api/files/${projectA}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.map((f) => f.name), ['second.pdf', 'first.pdf']);
});

test("another user gets 404 for someone else's project, and the same 404 as for a missing project", async () => {
  const other = await get(`/api/files/${projectA}`, 'B');
  assert.strictEqual(other.status, 404);
  const missing = await get('/api/files/999999999');
  assert.strictEqual(missing.status, 404);
  assert.deepStrictEqual(other.json, missing.json, 'no hint that the project exists');
});

test("each user still sees their own project's files and nobody else's", async () => {
  const b = await get(`/api/files/${projectB}`, 'B');
  assert.strictEqual(b.status, 200);
  assert.deepStrictEqual(b.json.map((f) => f.name), ['b-only.pdf']);
  assert.strictEqual((await get(`/api/files/${projectB}`)).status, 404, 'user A cannot read user B');
});

test('a project with no files returns an empty list for its owner; a non-numeric id is still a 400', async () => {
  const empty = (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ('empty',$1,'m') RETURNING id`, [userA])).rows[0].id;
  const r = await get(`/api/files/${empty}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, []);
  assert.strictEqual((await get('/api/files/abc')).status, 400);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1,'x') RETURNING id`, [`files-test-${tag}-${Date.now()}@example.test`])).rows[0].id;
  userA = await mk('a'); userB = await mk('b');
  const mkProject = async (u, name) => (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ($1,$2,'m') RETURNING id`, [name, u])).rows[0].id;
  projectA = await mkProject(userA, 'A project'); projectB = await mkProject(userB, 'B project');
  const mkFile = (proj, name, at) => pool.query(`INSERT INTO files ("projectId",name,size,mimetype,path,"uploadedAt") VALUES ($1,$2,10,'application/pdf','/nowhere/x',$3)`, [proj, name, at]);
  await mkFile(projectA, 'first.pdf', '2026-01-01'); await mkFile(projectA, 'second.pdf', '2026-02-01'); await mkFile(projectB, 'b-only.pdf', '2026-01-15');
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
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[userA, userB]]); // projects and files cascade from users
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
