#!/usr/bin/env node
/** Topic Research progress notes: order, ownership, expiry, cap, bad ids, safety. Run: node server/services/topicResearch/progress.test.js */
'use strict';

const assert = require('assert');
const { createProgressStore, NOOP, OP_ID } = require('./progress');

const STEPS = [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }, { id: 'c', label: 'Third' }];
let T = 1000;
const mk = (o = {}) => createProgressStore({ now: () => T, ...o });

// ---------------------------------------------------------------- order and states
{
  const p = mk();
  const r = p.begin(1, 'op-aaaaaaaa', STEPS);
  assert.deepStrictEqual(p.get(1, 'op-aaaaaaaa').steps.map((s) => s.status), ['pending', 'pending', 'pending']);
  r.start('a', 'asking 5 sources');
  r.detail('a', '2 of 5 answered');
  assert.deepStrictEqual([p.get(1, 'op-aaaaaaaa').steps[0].status, p.get(1, 'op-aaaaaaaa').steps[0].detail], ['active', '2 of 5 answered']);
  r.done('a');
  assert.deepStrictEqual([p.get(1, 'op-aaaaaaaa').steps[0].status, p.get(1, 'op-aaaaaaaa').steps[0].detail], ['done', '2 of 5 answered'], 'done keeps the last detail');
  r.start('b'); r.done('b', 'saved 40');
  assert.strictEqual(p.get(1, 'op-aaaaaaaa').steps[1].detail, 'saved 40');
  r.fail('c', 'could not rank');
  const g = p.get(1, 'op-aaaaaaaa');
  assert.deepStrictEqual(g.steps.map((s) => s.status), ['done', 'done', 'error']);
  assert.strictEqual(g.finished, false);
  r.finish();
  assert.deepStrictEqual([p.get(1, 'op-aaaaaaaa').finished, p.get(1, 'op-aaaaaaaa').steps[2].status], [true, 'error'], 'an error stays an error after finish');
  r.start('a', 'late'); r.detail('a', 'late');
  assert.strictEqual(p.get(1, 'op-aaaaaaaa').steps[0].detail, '2 of 5 answered', 'nothing is recorded after finish');
}
{
  const p = mk();
  const r = p.begin(1, 'op-bbbbbbbb', STEPS);
  r.start('a'); r.finish();
  assert.deepStrictEqual(p.get(1, 'op-bbbbbbbb').steps.map((s) => s.status), ['done', 'skipped', 'skipped'], 'the step that was running is done, those never reached are skipped');
}

// ---------------------------------------------------------------- ownership
{
  const p = mk();
  p.begin(1, 'op-cccccccc', STEPS);
  assert.ok(p.get(1, 'op-cccccccc'));
  assert.strictEqual(p.get(2, 'op-cccccccc'), null, "somebody else's action is invisible");
  p.begin(2, 'op-cccccccc', STEPS).start('a');
  assert.strictEqual(p.get(1, 'op-cccccccc').steps[0].status, 'pending', 'the same id from two people never mixes');
  assert.strictEqual(p.get(2, 'op-cccccccc').steps[0].status, 'active');
  assert.ok(p.get('1', 'op-cccccccc'), 'a numeric and a string user id are one person');
}

// ---------------------------------------------------------------- bad ids and arguments
{
  const p = mk();
  for (const bad of [undefined, null, '', 'short', 'has space aaaa', 'x'.repeat(65), 'bad/char/aaaa', 42, {}]) {
    assert.strictEqual(p.begin(1, bad, STEPS), NOOP, `begin refuses ${JSON.stringify(bad)}`);
    assert.strictEqual(p.get(1, bad), null);
  }
  assert.strictEqual(p.begin(1, 'op-dddddddd', []), NOOP);
  assert.strictEqual(p.begin(1, 'op-dddddddd', null), NOOP);
  assert.strictEqual(p.size(), 0);
  assert.ok(OP_ID.test('abc_DEF-123'));
  const n = p.begin(1, 'op-eeeeeeee', STEPS);
  assert.doesNotThrow(() => { n.start('nope'); n.done(undefined); n.fail(null, {}); n.detail('a', { a: 1 }); n.start('a', 'x'.repeat(500)); });
  assert.strictEqual(p.get(1, 'op-eeeeeeee').steps[0].detail.length, 200, 'a long note is cut');
  assert.doesNotThrow(() => { NOOP.start(); NOOP.done(); NOOP.detail(); NOOP.fail(); NOOP.finish(); });
}

// ---------------------------------------------------------------- expiry and cap
{
  T = 1000;
  const p = mk({ ttlMs: 5000, maxPerUser: 3 });
  p.begin(1, 'op-ffffffff', STEPS);
  T += 4000;
  assert.ok(p.get(1, 'op-ffffffff'));
  T += 2000;
  assert.strictEqual(p.get(1, 'op-ffffffff'), null, 'expired');
  const p2 = mk({ ttlMs: 5000, maxPerUser: 3 });
  for (let i = 0; i < 5; i += 1) { T += 10; p2.begin(1, `op-gggggg${i}`, STEPS); }
  assert.strictEqual(p2.get(1, 'op-gggggg0'), null, 'the oldest goes first');
  assert.strictEqual(p2.get(1, 'op-gggggg1'), null);
  assert.ok(p2.get(1, 'op-gggggg4'));
  p2.begin(2, 'op-hhhhhhhh', STEPS);
  assert.ok(p2.get(2, 'op-hhhhhhhh'), "one person's cap never evicts another's");
  // activity keeps an action alive
  T = 1000;
  const p3 = mk({ ttlMs: 5000 });
  const r = p3.begin(1, 'op-iiiiiiii', STEPS);
  T += 4000; r.start('a'); T += 4000;
  assert.ok(p3.get(1, 'op-iiiiiiii'), 'a step recorded 4s ago keeps it for 5s more');
}

// ---------------------------------------------------------------- reads are copies
{
  const p = mk();
  p.begin(1, 'op-jjjjjjjj', STEPS);
  const g = p.get(1, 'op-jjjjjjjj');
  g.steps[0].status = 'done'; g.steps.length = 0;
  assert.deepStrictEqual(p.get(1, 'op-jjjjjjjj').steps.map((s) => s.status), ['pending', 'pending', 'pending'], 'changing what you read changes nothing stored');
}

console.log('topicResearch progress: all passed');
