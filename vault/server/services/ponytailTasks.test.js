'use strict';

// node server/services/ponytailTasks.test.js   No database. The route test (server/routes/ponytail.test.js) covers the database side.

const assert = require('assert');
const { cleanSnapshot, parseCsv, testsState, validStarted, CSV_HEADER } = require('./ponytailTasks');

// A body exactly as the plugin's snapshot() builds it (hooks/band/metrics.ts, v5.3.3)
const good = () => ({
  key: 'a1b2c3d4-1763500000000', started: '2026-11-19 09:30', project: 'curam-protocol', name: 'Ponytail report', session: 'a1b2c3d4-0000-1111',
  level: 'full', model: 'claude-opus-5-5', cost: 1.2345, lastTurn: 0.12, turns: 7, agentMs: 420000,
  tokens: { input: 1000, output: 2000, cacheRead: 30000, cacheWrite: 4000 }, reuse: 60, reused: 3, created: 2, callersOpen: 1, tests: '12 passed',
});

{
  const { task, error } = cleanSnapshot(good());
  assert.ok(!error, error);
  assert.strictEqual(task.tokensCacheRead, 30000);
  assert.strictEqual(task.agentMs, 420000);
  assert.strictEqual(task.source, 'webhook');
}

// unknown fields ignored; empty name accepted; nulls allowed where the plugin sends them
{
  const { task } = cleanSnapshot({ ...good(), surprise: { deep: 1 }, name: '', reuse: null, lastTurn: null });
  assert.strictEqual(task.name, '');
  assert.strictEqual(task.reuse, null);
  assert.strictEqual(task.lastTurn, null);
  assert.ok(!('surprise' in task));
}

// refused: wrong types, lengths, negatives, bad started, bad key
const refused = (patch, why) => assert.ok(cleanSnapshot({ ...good(), ...patch }).error, why);
refused({ name: 'x'.repeat(301) }, 'name over 300');
refused({ project: 'x'.repeat(201) }, 'project over 200');
refused({ model: 'x'.repeat(101) }, 'model over 100');
refused({ tests: 'x'.repeat(51) }, 'tests over 50');
refused({ cost: -1 }, 'negative cost');
refused({ cost: '1.00' }, 'cost as text');
refused({ turns: 1.5 }, 'fractional turns');
refused({ reuse: 101 }, 'reuse over 100');
refused({ tokens: { input: -5 } }, 'negative tokens');
refused({ tokens: [] }, 'tokens not an object');
refused({ name: 42 }, 'name not text');
refused({ started: '2026-11-19T09:30' }, 'ISO started');
refused({ started: '2026-02-30 10:00' }, 'impossible date');
refused({ key: '' }, 'empty key');
refused({ key: 'a b' }, 'key with a space');
refused({ cost: Infinity }, 'infinite cost');
assert.ok(cleanSnapshot(null).error);
assert.ok(cleanSnapshot([]).error);
assert.ok(validStarted('2026-11-19 23:59'));
assert.ok(!validStarted('2026-11-19 24:00'));

// CSV: the header the plugin writes, quoted names, a bad row reported and skipped, BOM and CRLF tolerated
{
  const csv = `﻿${CSV_HEADER}\r\n`
    + 'a1b2c3d4-1,2026-11-19 09:30,curam,"Name, with ""quotes""",1.23,7,7.5,37000,2000,60,3,2,1,12 passed,full,claude-opus-5-5\r\n'
    + 'a1b2c3d4-2,2026-11-19 10:00,curam,,0.50,2,1.0,1000,100,,0,0,0,not run,lite,claude-sonnet-5-5\r\n'
    + 'bad,not a date,curam,x,1,1,1,1,1,,0,0,0,x,full,m\r\n'
    + 'short,row\r\n';
  const { tasks, problems } = parseCsv(csv);
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[0].name, 'Name, with "quotes"');
  assert.strictEqual(tasks[0].agentMs, 450000);
  assert.strictEqual(tasks[0].tokensInput, 35000, 'input = total - output');
  assert.strictEqual(tasks[0].tokensCacheRead, 0);
  assert.strictEqual(tasks[0].source, 'csv');
  assert.strictEqual(tasks[0].session, null);
  assert.strictEqual(tasks[1].reuse, null, 'empty reuse_pct is null');
  assert.deepStrictEqual(problems.map((p) => p.line), [4, 5]);
}
assert.strictEqual(parseCsv('key,started\n1,2').tasks.length, 0, 'a different header is refused');
assert.strictEqual(parseCsv('').problems.length, 1);

assert.strictEqual(testsState('12 passed'), 'pass');
assert.strictEqual(testsState('1 failed'), 'fail');
assert.strictEqual(testsState('passed'), 'pass');
assert.strictEqual(testsState('stale'), 'none');
assert.strictEqual(testsState('not run'), 'none');

console.log('ponytailTasks tests passed');
