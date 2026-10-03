#!/usr/bin/env node
/**
 * Room Planner project library routes: ownership, validation, the optimistic-save 409, limits and error handling.
 * Runs against an in-memory stand-in for the pool (the queries are matched by their shape and given the SQL's semantics),
 * so it needs no database. The SQL itself is exercised on staging.
 *
 * Run: node server/routes/roomProjects.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createRouter, validateData, cleanName, MAX_PROJECTS_PER_USER, MAX_NAME } = require('./roomProjectsRouter');

// ---------------------------------------------------------------- fake pool
function fakePool() {
  const rows = [];
  let seq = 0;
  let clock = Date.UTC(2026, 9, 3, 12, 0, 0);
  const tick = () => new Date((clock += 1000));
  const pool = {
    rows,
    failNext: false,
    async query(sql, params) {
      if (pool.failNext) { pool.failNext = false; throw new Error('connection refused: secret-host:5432'); }
      const s = sql.replace(/\s+/g, ' ');
      if (/SELECT COUNT/.test(s)) return { rows: [{ n: String(rows.filter((r) => r.userId === params[0]).length) }] };
      if (/ORDER BY "updatedAt" DESC/.test(s)) {
        return { rows: rows.filter((r) => r.userId === params[0]).sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id).map(({ data, ...rest }) => rest) };
      }
      if (/, data FROM room_projects WHERE id = \$1/.test(s)) {
        const r = rows.find((x) => String(x.id) === String(params[0]) && x.userId === params[1]);
        return { rows: r ? [r] : [] };
      }
      if (/INSERT INTO room_projects/.test(s)) {
        const r = { id: ++seq, userId: params[0], name: params[1], data: JSON.parse(params[2]), roomCount: params[3], createdAt: tick(), updatedAt: tick() };
        rows.push(r);
        return { rows: [r] };
      }
      if (/UPDATE room_projects/.test(s)) {
        const [name, dataJson, count, id, userId, expected] = params;
        const r = rows.find((x) => String(x.id) === String(id) && x.userId === userId && (expected === null || x.updatedAt.toISOString() === expected));
        if (!r) return { rows: [] };
        if (name !== null) r.name = name;
        if (dataJson !== null) r.data = JSON.parse(dataJson);
        if (count !== null) r.roomCount = count;
        r.updatedAt = tick();
        return { rows: [r] };
      }
      if (/SELECT id, name, "roomCount", "updatedAt" FROM room_projects WHERE id = \$1 AND "userId" = \$2/.test(s)) {
        const r = rows.find((x) => String(x.id) === String(params[0]) && x.userId === params[1]);
        return { rows: r ? [r] : [] };
      }
      if (/DELETE FROM room_projects/.test(s)) {
        const i = rows.findIndex((x) => String(x.id) === String(params[0]) && x.userId === params[1]);
        if (i >= 0) rows.splice(i, 1);
        return { rowCount: i >= 0 ? 1 : 0 };
      }
      throw new Error(`unexpected query: ${s}`);
    },
  };
  return pool;
}

const project = (rooms = 1, extra = {}) => ({
  schemaVersion: 1, id: 'p', units: 'metric', rooms: Array.from({ length: rooms }, (_, i) => ({ id: `r${i}`, name: `Room ${i + 1}` })),
  furnitureDefinitions: [], materials: [], ...extra,
});

// ---------------------------------------------------------------- harness
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function withServer(fn) {
  const pool = fakePool();
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.user = { id: Number(req.get('x-test-user') || 1) }; next(); });
  app.use('/api/room-projects', createRouter(pool));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/room-projects`;
  const call = async (method, path, body, user = 1) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  };
  try { await fn({ call, pool }); } finally { await new Promise((r) => server.close(r)); }
}

// ---------------------------------------------------------------- tests
test('create, list (no data), get (with data)', () => withServer(async ({ call }) => {
  const empty = await call('GET', '');
  assert.deepStrictEqual(empty.body, { projects: [] });
  const created = await call('POST', '', { name: 'Flat 4', data: project(2) });
  assert.strictEqual(created.status, 200);
  assert.deepStrictEqual(Object.keys(created.body.project).sort(), ['id', 'name', 'roomCount', 'updatedAt']);
  assert.strictEqual(created.body.project.roomCount, 2);
  const list = await call('GET', '');
  assert.strictEqual(list.body.projects.length, 1);
  assert.strictEqual(list.body.projects[0].data, undefined);
  const one = await call('GET', `/${created.body.project.id}`);
  assert.strictEqual(one.body.project.data.rooms.length, 2);
  assert.strictEqual(one.body.project.name, 'Flat 4');
}));

test('list is newest first', () => withServer(async ({ call }) => {
  const a = await call('POST', '', { name: 'A', data: project() });
  const b = await call('POST', '', { name: 'B', data: project() });
  assert.deepStrictEqual((await call('GET', '')).body.projects.map((p) => p.name), ['B', 'A']);
  await call('PUT', `/${a.body.project.id}`, { name: 'A2' });
  assert.deepStrictEqual((await call('GET', '')).body.projects.map((p) => p.name), ['A2', 'B']);
  assert.ok(b);
}));

test('a user never sees, opens, saves or deletes another user\'s project (404, never 409)', () => withServer(async ({ call }) => {
  const mine = await call('POST', '', { name: 'Mine', data: project() }, 1);
  const id = mine.body.project.id;
  assert.deepStrictEqual((await call('GET', '', undefined, 2)).body, { projects: [] });
  assert.strictEqual((await call('GET', `/${id}`, undefined, 2)).status, 404);
  assert.strictEqual((await call('PUT', `/${id}`, { name: 'Stolen' }, 2)).status, 404);
  assert.strictEqual((await call('PUT', `/${id}`, { name: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }, 2)).status, 404);
  assert.strictEqual((await call('DELETE', `/${id}`, undefined, 2)).status, 404);
  assert.strictEqual((await call('GET', `/${id}`, undefined, 1)).body.project.name, 'Mine');
}));

test('names: trimmed, spaces collapsed, clipped; blank or missing is rejected', () => withServer(async ({ call }) => {
  const ok = await call('POST', '', { name: '  Beach    house  ', data: project() });
  assert.strictEqual(ok.body.project.name, 'Beach house');
  const long = await call('POST', '', { name: 'x'.repeat(500), data: project() });
  assert.strictEqual(long.body.project.name.length, MAX_NAME);
  for (const name of ['', '   ', undefined, 5, null]) {
    const r = await call('POST', '', { name, data: project() });
    assert.strictEqual(r.status, 400, `name ${JSON.stringify(name)}`);
    assert.match(r.body.error, /name is required/);
  }
  assert.strictEqual((await call('PUT', `/${ok.body.project.id}`, { name: '   ' })).status, 400);
}));

test('data must be a planner project (schemaVersion 1 with rooms, definitions, materials)', () => withServer(async ({ call }) => {
  for (const data of [undefined, null, [], 'x', project(1, { schemaVersion: 2 }), { ...project(), rooms: 'no' }, { ...project(), id: 5 }, { ...project(), materials: undefined }]) {
    const r = await call('POST', '', { name: 'x', data });
    assert.strictEqual(r.status, 400, JSON.stringify(data)?.slice(0, 60));
    assert.ok(r.body.error);
  }
  const ok = await call('POST', '', { name: 'ok', data: project() });
  assert.strictEqual((await call('PUT', `/${ok.body.project.id}`, { data: { nope: true } })).status, 400);
}));

test('a project over 5 MB is refused with a plain message', () => withServer(async ({ call }) => {
  const big = project(1, { padding: 'x'.repeat(5 * 1024 * 1024 + 10) });
  const r = await call('POST', '', { name: 'big', data: big });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /too large/);
}));

test('save name only keeps the data; save data updates the room count and the time', () => withServer(async ({ call }) => {
  const c = await call('POST', '', { name: 'P', data: project(1) });
  const id = c.body.project.id;
  const renamed = await call('PUT', `/${id}`, { name: 'Q' });
  assert.strictEqual(renamed.body.project.name, 'Q');
  assert.strictEqual(renamed.body.project.roomCount, 1);
  assert.strictEqual((await call('GET', `/${id}`)).body.project.data.rooms.length, 1);
  const saved = await call('PUT', `/${id}`, { data: project(3) });
  assert.strictEqual(saved.body.project.roomCount, 3);
  assert.strictEqual(saved.body.project.name, 'Q');
  assert.ok(saved.body.project.updatedAt > renamed.body.project.updatedAt);
}));

test('optimistic save: the right time succeeds, a stale one is 409 with the current entry, a bad time is 400', () => withServer(async ({ call }) => {
  const c = await call('POST', '', { name: 'P', data: project() });
  const id = c.body.project.id;
  const first = await call('PUT', `/${id}`, { data: project(2), expectedUpdatedAt: c.body.project.updatedAt });
  assert.strictEqual(first.status, 200);
  const stale = await call('PUT', `/${id}`, { data: project(3), expectedUpdatedAt: c.body.project.updatedAt });
  assert.strictEqual(stale.status, 409);
  assert.match(stale.body.error, /another window/);
  assert.strictEqual(stale.body.current.id, id);
  assert.strictEqual(stale.body.current.updatedAt, first.body.project.updatedAt);
  assert.strictEqual(stale.body.current.roomCount, 2);
  assert.strictEqual((await call('GET', `/${id}`)).body.project.data.rooms.length, 2); // the stale save changed nothing
  const bad = await call('PUT', `/${id}`, { data: project(), expectedUpdatedAt: 'not a time' });
  assert.strictEqual(bad.status, 400);
  const without = await call('PUT', `/${id}`, { data: project(4) }); // no expectation: last write wins
  assert.strictEqual(without.status, 200);
}));

test('delete removes it once; ids that are not numbers are 404', () => withServer(async ({ call }) => {
  const c = await call('POST', '', { name: 'P', data: project() });
  assert.deepStrictEqual((await call('DELETE', `/${c.body.project.id}`)).body, { ok: true });
  assert.strictEqual((await call('DELETE', `/${c.body.project.id}`)).status, 404);
  assert.strictEqual((await call('GET', `/${c.body.project.id}`)).status, 404);
  for (const bad of ['abc', '1;DROP TABLE x', '99999999999999', '-1']) {
    assert.strictEqual((await call('GET', `/${encodeURIComponent(bad)}`)).status, 404, bad);
    assert.strictEqual((await call('PUT', `/${encodeURIComponent(bad)}`, { name: 'x' })).status, 404, bad);
    assert.strictEqual((await call('DELETE', `/${encodeURIComponent(bad)}`)).status, 404, bad);
  }
}));

test('a user cannot hold more than the project limit', () => withServer(async ({ call, pool }) => {
  for (let i = 0; i < MAX_PROJECTS_PER_USER; i++) pool.rows.push({ id: 1000 + i, userId: 1, name: `P${i}`, data: project(), roomCount: 1, createdAt: new Date(), updatedAt: new Date() });
  const r = await call('POST', '', { name: 'one too many', data: project() });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /limit of 200/);
  assert.strictEqual((await call('POST', '', { name: 'other user is fine', data: project() }, 2)).status, 200);
}));

test('database failures are 500 with a plain message and never leak the error', () => withServer(async ({ call, pool }) => {
  const c = await call('POST', '', { name: 'P', data: project() });
  const id = c.body.project.id;
  for (const [method, path, body] of [['GET', '', undefined], ['GET', `/${id}`, undefined], ['POST', '', { name: 'x', data: project() }], ['PUT', `/${id}`, { name: 'y' }], ['DELETE', `/${id}`, undefined]]) {
    pool.failNext = true;
    const r = await call(method, path, body);
    assert.strictEqual(r.status, 500, `${method} ${path}`);
    assert.ok(!/secret-host|ECONN|refused/.test(JSON.stringify(r.body)), 'leaked the error');
    assert.ok(typeof r.body.error === 'string' && r.body.error.length > 5);
  }
}));

test('helpers: cleanName and validateData', () => {
  assert.strictEqual(cleanName('  a   b '), 'a b');
  assert.strictEqual(cleanName('   '), null);
  assert.strictEqual(cleanName(5), null);
  assert.strictEqual(validateData(project()), null);
  assert.ok(validateData(null));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed += 1; console.log(`PASS  ${name}`); }
    catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
