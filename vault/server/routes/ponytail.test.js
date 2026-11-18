#!/usr/bin/env node
/**
 * Ponytail report routes against the REAL app (every middleware and router) on a throwaway Postgres on THIS machine, with the outside
 * network blocked (server/testing/crossUserHarness.js). No model is called anywhere in these routes.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_ponytail_test node server/routes/ponytail.test.js
 *      (without DATABASE_URL it says SKIP and exits). Pure checks: node server/services/ponytailTasks.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const assert = require('assert');
const harness = require('../testing/crossUserHarness'); // must come first: it sets the environment and exits when there is no local DB
const { CSV_HEADER } = require('../services/ponytailTasks');

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failed += 1; console.log(`  FAIL ${name}: ${e.message}`); }
}

const snapshot = (over = {}) => ({
  key: 'abcd1234-1763500000000', started: '2026-11-19 09:30', project: 'curam-protocol', name: 'First name', session: 'abcd1234-ffff',
  level: 'full', model: 'claude-opus-5-5', cost: 1.5, lastTurn: 0.2, turns: 3, agentMs: 60000,
  tokens: { input: 100, output: 200, cacheRead: 3000, cacheWrite: 400 }, reuse: 50, reused: 2, created: 2, callersOpen: 0, tests: '4 passed', ...over,
});

(async () => {
  const h = await harness.start();
  const { pool, base } = h;
  // The harness waits for the first tables only; ours are made later in the same boot.
  for (let i = 0; i < 120; i += 1) {
    try { await pool.query('SELECT 1 FROM ponytail_tasks LIMIT 1'); await pool.query('SELECT 1 FROM ponytail_tokens LIMIT 1'); await pool.query('SELECT 1 FROM changelog_entries LIMIT 1'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  const api = (method, p, opts) => harness.call(base, method, p, opts);
  const j = (r) => { try { return JSON.parse(r.text); } catch { return {}; } };
  const raw = async (p, token, body, type = 'application/json') => {
    const res = await fetch(base + p, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body });
    return { status: res.status, text: await res.text() };
  };
  const upload = async (token, text, name = 'curam-protocol.csv') => {
    const fd = new FormData();
    fd.append('file', new Blob([text], { type: 'text/csv' }), name);
    const res = await fetch(`${base}/api/ponytail/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const admin = await h.makeUser('ptadmin', true);
  const member = await h.makeUser('ptmember', false);
  const rows = async (key) => (await pool.query('SELECT * FROM ponytail_tasks WHERE "userId"=$1 AND key=$2', [admin.id, key])).rows;

  let key;
  await t('an admin makes a key; it is shown once and only its hash is stored', async () => {
    const r = await api('POST', '/api/ponytail/tokens', { token: admin.token, body: { label: 'Laptop' } });
    assert.strictEqual(r.status, 201, r.text);
    key = j(r).token;
    assert.match(key, /^pty_[0-9a-f]{64}$/);
    const stored = (await pool.query('SELECT "tokenHash" FROM ponytail_tokens WHERE "userId"=$1', [admin.id])).rows;
    assert.strictEqual(stored.length, 1);
    assert.notStrictEqual(stored[0].tokenHash, key);
    const list = j(await api('GET', '/api/ponytail/tokens', { token: admin.token }));
    assert.ok(!JSON.stringify(list).includes(key), 'the list never carries the key');
  });

  await t('good key: 204 and one row; the same key again updates it, not a second row', async () => {
    assert.strictEqual((await raw('/api/ponytail/ingest', key, JSON.stringify(snapshot()))).status, 204);
    assert.strictEqual((await raw('/api/ponytail/ingest', key, JSON.stringify(snapshot({ cost: 2.25, turns: 4, name: 'Renamed' })))).status, 204);
    const r = await rows('abcd1234-1763500000000');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(Number(r[0].cost), 2.25);
    assert.strictEqual(r[0].name, 'Renamed');
    assert.strictEqual(r[0].updatesReceived, 2);
    assert.strictEqual(Number(r[0].tokensCacheRead), 3000);
  });

  await t('"started" is read as Brisbane time (UTC+10, no daylight saving)', async () => {
    const r = await rows('abcd1234-1763500000000');
    assert.strictEqual(r[0].started.toISOString(), '2026-11-18T23:30:00.000Z');
  });

  await t('an empty name is accepted (Ponytail sends "" when task names are switched off)', async () => {
    assert.strictEqual((await raw('/api/ponytail/ingest', key, JSON.stringify(snapshot({ key: 'noname-1', name: '' })))).status, 204);
    assert.strictEqual((await rows('noname-1'))[0].name, '');
  });

  await t('wrong, missing and revoked keys get 401', async () => {
    assert.strictEqual((await raw('/api/ponytail/ingest', `pty_${'0'.repeat(64)}`, JSON.stringify(snapshot()))).status, 401);
    assert.strictEqual((await api('POST', '/api/ponytail/ingest', { body: snapshot() })).status, 401);
    assert.strictEqual((await raw('/api/ponytail/ingest', admin.token, JSON.stringify(snapshot()))).status, 401, 'a login token is not a Ponytail key');
    const made = j(await api('POST', '/api/ponytail/tokens', { token: admin.token, body: { label: 'Old' } }));
    assert.strictEqual((await api('DELETE', `/api/ponytail/tokens/${made.key.id}`, { token: admin.token })).status, 200);
    assert.strictEqual((await raw('/api/ponytail/ingest', made.token, JSON.stringify(snapshot()))).status, 401);
  });

  await t('oversized, malformed and invalid bodies get 400 with a short reason', async () => {
    const big = await raw('/api/ponytail/ingest', key, JSON.stringify(snapshot({ pad: 'x'.repeat(17 * 1024) })));
    assert.strictEqual(big.status, 400);
    assert.match(j(big).error, /16 KB/);
    const bad = await raw('/api/ponytail/ingest', key, '{"key": ');
    assert.strictEqual(bad.status, 400);
    assert.ok(!bad.text.includes('"key"'), 'the body is not echoed back');
    assert.strictEqual((await raw('/api/ponytail/ingest', key, JSON.stringify(snapshot({ cost: -1 })))).status, 400);
    assert.strictEqual((await raw('/api/ponytail/ingest', key, JSON.stringify(snapshot({ name: 'x'.repeat(301) })))).status, 400);
    assert.strictEqual((await raw('/api/ponytail/ingest', key, JSON.stringify(snapshot({ started: 'yesterday' })))).status, 400);
  });

  const csv = `${CSV_HEADER}\n`
    + 'csv00001-1,2026-11-17 08:00,curam-protocol,"Backfill, one",0.80,5,2.5,12000,1000,40,2,3,0,3 passed,full,claude-opus-5-5\n'
    + 'csv00001-2,2026-11-18 14:15,curam-protocol,Backfill two,0.20,1,0.5,2000,100,,0,0,0,not run,lite,claude-sonnet-5-5\n'
    + 'abcd1234-1763500000000,2026-11-19 09:30,curam-protocol,From CSV,0.10,1,0.1,10,1,,0,0,0,not run,full,claude-opus-5-5\n'
    + 'broken,not a date,curam-protocol,x,1,1,1,1,1,,0,0,0,x,full,m\n';

  await t('CSV import: rows added, a bad row reported and skipped, the webhook row left alone', async () => {
    const r = await upload(admin.token, csv);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.added, r.body.updated, r.body.kept, r.body.skipped], [2, 0, 1, 1]);
    assert.strictEqual(r.body.problems[0].line, 5);
    const hooked = (await rows('abcd1234-1763500000000'))[0];
    assert.strictEqual(hooked.name, 'Renamed', 'the CSV did not overwrite what the webhook sent');
    const one = (await rows('csv00001-1'))[0];
    assert.strictEqual(one.source, 'csv');
    assert.strictEqual(Number(one.tokensInput), 11000);
    assert.strictEqual(Number(one.agentMs), 150000);
  });

  await t('re-importing the same file does not duplicate', async () => {
    const r = await upload(admin.token, csv);
    assert.deepStrictEqual([r.body.added, r.body.updated, r.body.kept], [0, 2, 1]);
    const count = (await pool.query('SELECT COUNT(*) FROM ponytail_tasks WHERE "userId"=$1', [admin.id])).rows[0].count;
    assert.strictEqual(Number(count), 4);
  });

  await t('a file that is not a Ponytail ledger is refused', async () => {
    const r = await upload(admin.token, 'a,b,c\n1,2,3\n');
    assert.strictEqual(r.status, 400);
  });

  await t('summary, tasks (filtered, sorted) and code written answer for the admin', async () => {
    const s = j(await api('GET', '/api/ponytail/summary?from=2026-11-17&to=2026-11-19', { token: admin.token }));
    assert.strictEqual(s.totals.tasks, 4);
    assert.ok(Math.abs(s.totals.cost - 4.75) < 1e-9, `cost ${s.totals.cost}`); // 2.25 + 1.5 (no-name task) + 0.80 + 0.20
    assert.deepStrictEqual(s.days.map((d) => d.day), ['2026-11-17', '2026-11-18', '2026-11-19']);
    assert.strictEqual(s.totals.testsRun, 3, 'two webhook rows "4 passed" and one CSV row "3 passed"; "not run" is not counted');
    assert.strictEqual(s.totals.testsPassed, 3);
    const onlyLite = j(await api('GET', '/api/ponytail/tasks?model=claude-sonnet-5-5', { token: admin.token }));
    assert.strictEqual(onlyLite.total, 1);
    const byCost = j(await api('GET', '/api/ponytail/tasks?sort=cost&dir=desc', { token: admin.token }));
    assert.strictEqual(byCost.tasks[0].cost, 2.25);
    const day = j(await api('GET', '/api/ponytail/tasks?from=2026-11-19&to=2026-11-19', { token: admin.token }));
    assert.strictEqual(day.total, 2, 'Brisbane day 19 Nov holds the 09:30 task and the no-name task');
    const cw = await api('GET', '/api/ponytail/code-written?from=2026-11-17&to=2026-11-19', { token: admin.token });
    assert.strictEqual(cw.status, 200, cw.text);
    assert.ok(j(cw).days.some((d) => d.day === '2026-11-19' && d.tasks === 2));
  });

  await t('a member gets 403 on every admin route', async () => {
    for (const [m, p] of [['GET', '/api/ponytail/tokens'], ['POST', '/api/ponytail/tokens'], ['DELETE', '/api/ponytail/tokens/1'], ['GET', '/api/ponytail/tasks'],
      ['GET', '/api/ponytail/tasks/1'], ['DELETE', '/api/ponytail/tasks/1'], ['GET', '/api/ponytail/summary'], ['GET', '/api/ponytail/code-written'], ['POST', '/api/ponytail/import']]) {
      const r = await api(m, p, { token: member.token, body: m === 'GET' ? undefined : {} });
      assert.strictEqual(r.status, 403, `${m} ${p} gave ${r.status}`);
    }
  });

  await t('delete moves the task to the recycle bin; restore puts it back', async () => {
    const id = (await rows('csv00001-2'))[0].id;
    const r = await api('DELETE', `/api/ponytail/tasks/${id}`, { token: admin.token });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual((await rows('csv00001-2')).length, 0);
    const binned = (await pool.query(`SELECT id FROM recycle_bin WHERE "userId"=$1 AND "entityType"='ponytail-task'`, [admin.id])).rows;
    assert.strictEqual(binned.length, 1);
    await require('../services/recycleBin').restoreItem(admin.id, binned[0].id);
    assert.strictEqual((await rows('csv00001-2')).length, 1);
  });

  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[admin.id, member.id]]).catch(() => {});
  if (h.blocked.length) { console.log('  FAIL outside network was attempted:', h.blocked); failed += 1; }
  console.log(failed ? `ponytail route tests: ${failed} failed` : 'ponytail route tests passed');
  h.server.close();
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
