'use strict';

// Stage 3 step 3 tests: adapting the plan, and load suggestions. No database. Run: node server/services/fitness/adapt.test.js
const assert = require('assert');
const A = require('./adaptation');
const LD = require('./loads');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

// week helper: list of [status, effort] pairs
const wk = (pairs, extra = {}) => ({ weekStart: '2026-10-05', isDeload: false, decision: null, sessions: pairs.map(([status, effort = null]) => ({ status, effort })), ...extra });
const easy = () => wk([['done', 3], ['done', 4], ['done', 4], ['done', 4]]);
const hard = () => wk([['done', 8], ['done', 9], ['done', 8], ['done', 8]]);
const busy = () => wk([['done', 5], ['skipped'], ['skipped'], ['skipped']]); // one of four done

// ── what counts ──
test('rest is never counted, unlogged sessions are left out of the done share, partly done is half, swapped is done', () => {
  const s = A.summariseWeek(wk([['done', 5], ['partial', 6], ['swapped', 5], ['skipped'], ['rest'], ['planned']]));
  assert.strictEqual(s.considered, 5, 'rest is not a session that could have been missed');
  assert.strictEqual(s.logged, 4);
  assert.ok(Math.abs(s.coverage - 4 / 5) < 1e-9);
  assert.ok(Math.abs(s.doneShare - (1 + 0.5 + 1 + 0) / 4) < 1e-9);
  assert.ok(Math.abs(s.averageEffort - (5 + 6 + 5) / 3) < 1e-9, 'effort only from sessions that were done in some way');
});
test('a week of only rest has nothing to count and is never "not done"', () => {
  const s = A.summariseWeek(wk([['rest'], ['rest']]));
  assert.strictEqual(s.considered, 0);
  assert.strictEqual(s.sufficient, false);
  assert.strictEqual(s.doneShare, null);
});
test('less than half logged is not enough to go on', () => {
  assert.strictEqual(A.summariseWeek(wk([['done', 4], ['planned'], ['planned'], ['planned']])).sufficient, false);
  assert.strictEqual(A.summariseWeek(wk([['done', 4], ['done', 4], ['planned'], ['planned']])).sufficient, true); // exactly half
});

// ── nudging up ──
test('three comfortable building weeks nudge up', () => {
  const d = A.decide({ weeks: [easy(), easy(), easy()] });
  assert.strictEqual(d.decision, 'nudge');
  assert.strictEqual(d.reason, 'easy_streak');
  assert.strictEqual(d.volumeFactor, 1.1);
  assert.strictEqual(d.levelDelta, 1);
});
test('the nudge thresholds are exact: 80% done and effort 4', () => {
  const edge = wk([['done', 4], ['done', 4], ['done', 4], ['done', 4], ['partial', 4]]); // 4.5 of 5 = 0.9, effort 4
  const exactly = wk([['done', 4], ['done', 4], ['done', 4], ['done', 4], ['skipped']]); // 4 of 5 = 0.8 exactly
  assert.strictEqual(A.decide({ weeks: [exactly, exactly, exactly] }).decision, 'nudge');
  assert.strictEqual(A.decide({ weeks: [edge, edge, edge] }).decision, 'nudge');
  const justUnder = wk([['done', 4], ['done', 4], ['done', 4], ['partial', 4], ['skipped']]); // 3.5 of 5 = 0.7
  assert.strictEqual(A.decide({ weeks: [exactly, exactly, justUnder] }).decision, 'hold');
  const effort41 = wk([['done', 5], ['done', 4], ['done', 4], ['done', 4], ['done', 4], ['done', 4], ['done', 4], ['done', 4], ['done', 4], ['done', 4]]); // avg 4.1
  assert.ok(A.summariseWeek(effort41).averageEffort > 4);
  assert.strictEqual(A.decide({ weeks: [easy(), easy(), effort41] }).decision, 'hold');
});
test('no effort recorded means no nudge: no information is not "easy"', () => {
  const noEffort = wk([['done'], ['done'], ['done'], ['done']]);
  assert.strictEqual(A.decide({ weeks: [noEffort, noEffort, noEffort] }).decision, 'hold');
  const half = wk([['done', 3], ['done', 3], ['done'], ['done']]); // effort on exactly half
  assert.strictEqual(A.decide({ weeks: [half, half, half] }).decision, 'nudge');
  const under = wk([['done', 3], ['done'], ['done'], ['done']]); // a quarter
  assert.strictEqual(A.decide({ weeks: [under, under, under] }).decision, 'hold');
});
test('two comfortable weeks are not enough, and a week with too little logged breaks the run', () => {
  assert.strictEqual(A.decide({ weeks: [easy(), easy()] }).decision, 'hold');
  const thin = wk([['done', 3], ['planned'], ['planned'], ['planned']]);
  assert.strictEqual(A.decide({ weeks: [easy(), thin, easy()] }).decision, 'hold');
});
test('deload weeks are skipped when counting, and a deload week itself is never adapted', () => {
  const deload = { ...easy(), isDeload: true };
  assert.strictEqual(A.decide({ weeks: [easy(), easy(), deload, easy()] }).decision, 'nudge', 'the last three BUILD weeks');
  assert.strictEqual(A.decide({ weeks: [easy(), easy(), easy()], isDeload: true }).decision, 'hold');
  assert.strictEqual(A.decide({ weeks: [hard(), hard()], isDeload: true }).decision, 'hold');
});

// ── easing off ──
test('two hard weeks ease off; exactly effort 8 counts, 7.9 does not', () => {
  const d = A.decide({ weeks: [hard(), hard()] });
  assert.strictEqual(d.decision, 'ease');
  assert.strictEqual(d.reason, 'high_effort');
  assert.strictEqual(d.volumeFactor, 0.85);
  assert.strictEqual(d.levelDelta, -1);
  const eight = wk([['done', 8], ['done', 8], ['done', 8], ['done', 8]]);
  assert.strictEqual(A.decide({ weeks: [eight, eight] }).decision, 'ease');
  const just = wk([['done', 8], ['done', 8], ['done', 8], ['done', 7]]); // 7.75
  assert.strictEqual(A.decide({ weeks: [eight, just] }).decision, 'hold');
});
test('two weeks under half done ease off; exactly half does not', () => {
  const d = A.decide({ weeks: [busy(), busy()] });
  assert.strictEqual(d.decision, 'ease');
  assert.strictEqual(d.reason, 'low_done');
  const half = wk([['done', 5], ['done', 5], ['skipped'], ['skipped']]); // exactly 0.5
  assert.strictEqual(A.decide({ weeks: [half, half] }).decision, 'hold');
});
test('one hard week is not enough, and nothing happens on a hard week followed by an easy one', () => {
  assert.strictEqual(A.decide({ weeks: [easy(), hard()] }).decision, 'hold');
  assert.strictEqual(A.decide({ weeks: [hard(), easy()] }).decision, 'hold');
});
test('rest days and unlogged sessions can never cause an ease', () => {
  const restful = wk([['rest'], ['rest'], ['rest'], ['done', 4]]);
  const unlogged = wk([['done', 4], ['planned'], ['planned'], ['planned']]); // too little logged to count
  assert.strictEqual(A.decide({ weeks: [restful, restful] }).decision, 'hold');
  assert.strictEqual(A.decide({ weeks: [unlogged, unlogged] }).decision, 'hold');
  const allRest = wk([['rest'], ['rest']]);
  assert.strictEqual(A.decide({ weeks: [allRest, allRest] }).decision, 'hold');
});
test('easing wins over a nudge, and a nudge waits three weeks after an ease', () => {
  const easedBefore = { ...easy(), decision: 'ease' };
  assert.strictEqual(A.decide({ weeks: [easy(), easy(), easedBefore] }).decision, 'hold', 'an ease in the last three weeks');
  assert.strictEqual(A.decide({ weeks: [easedBefore, easy(), easy(), easy()] }).decision, 'nudge', 'three weeks later it can');
  assert.strictEqual(A.decide({ weeks: [easy(), easy(), hard(), hard()] }).decision, 'ease');
});

// ── wording and limits ──
test('every message is about fitting the plan to life: no guilt, no mention of skipping', () => {
  for (const m of Object.values(A.MESSAGES)) {
    assert.ok(!A.BANNED.test(m), m);
    assert.ok(!/skip|miss|fail|behind/i.test(m), m);
    assert.ok(/this week/i.test(m), m);
  }
  assert.strictEqual(A.decide({ weeks: [easy()] }).message, null, 'a hold says nothing');
});
test('limits always win: the 10% step, the band ceiling, a floor when easing, never increasing on an ease', () => {
  const nudge = { decision: 'nudge', volumeFactor: 1.1 };
  assert.strictEqual(A.adjustAerobic(100, nudge, { prevBuildMinutes: 100 }), 110);
  assert.strictEqual(A.adjustAerobic(100, nudge, { prevBuildMinutes: 90 }), 105, 'capped by the weekly step from last build week');
  assert.strictEqual(A.adjustAerobic(200, nudge, { prevBuildMinutes: 200, ceiling: 205 }), 205, 'capped by the age-band end state');
  const ease = { decision: 'ease', volumeFactor: 0.85, floorOfLastBuild: 0.6 };
  assert.strictEqual(A.adjustAerobic(100, ease, { prevBuildMinutes: 100 }), 85);
  assert.strictEqual(A.adjustAerobic(40, ease, { prevBuildMinutes: 100 }), 40, 'never raises minutes on an ease');
  assert.strictEqual(A.adjustAerobic(100, ease, { prevBuildMinutes: 200 }), 100, 'but the floor of 60% of the last build week holds');
  assert.strictEqual(A.adjustAerobic(100, { decision: 'hold', volumeFactor: 1 }), 100);
});

// ── load suggestions ──
test('a manageable weight suggests "the next weight up"; the number appears only if the person listed their weights', () => {
  assert.ok(/try the next weight up\.$/.test(LD.loadSuggestion([{ kg: 6, effort: 4 }])));
  assert.ok(/try the next weight up \(8 kg\)\./.test(LD.loadSuggestion([{ kg: 6, effort: 4 }], [2, 4, 6, 8, 10])));
  assert.ok(/\(10 kg\)/.test(LD.loadSuggestion([{ kg: 8, effort: 5 }], [2, 4, 6, 8, 10])));
  assert.ok(!/\d+ kg\)/.test(LD.loadSuggestion([{ kg: 10, effort: 3 }], [2, 4, 6, 8, 10])), 'nothing above the heaviest weight: no invented number');
});
test('effort 6-7 stays put, 8+ stays until easier, none just says what was used', () => {
  assert.ok(/felt about right\. Stay with it/.test(LD.loadSuggestion([{ kg: 8, effort: 6 }])));
  assert.ok(/felt about right/.test(LD.loadSuggestion([{ kg: 8, effort: 7 }])));
  assert.ok(/felt hard\. Stay at that weight until it feels easier/.test(LD.loadSuggestion([{ kg: 8, effort: 8 }])));
  assert.strictEqual(LD.loadSuggestion([{ kg: 8, effort: null }]), 'Last time: 8 kg.');
  assert.strictEqual(LD.loadSuggestion([]), null);
  assert.strictEqual(LD.loadSuggestion([{ kg: 0, effort: 4 }]), null);
});
test('two very hard sessions at the same weight suggest one step down', () => {
  assert.ok(/Try the next weight down \(6 kg\)/.test(LD.loadSuggestion([{ kg: 8, effort: 9 }, { kg: 8, effort: 10 }], [4, 6, 8, 10])));
  assert.ok(/Try the next weight down\.$/.test(LD.loadSuggestion([{ kg: 8, effort: 9 }, { kg: 8, effort: 9 }])));
  assert.ok(!/next weight down/.test(LD.loadSuggestion([{ kg: 8, effort: 9 }, { kg: 6, effort: 10 }])), 'different weights: not the same load twice');
  assert.ok(!/next weight down/.test(LD.loadSuggestion([{ kg: 8, effort: 9 }])), 'one hard session only: stay put');
});
test('the dumbbell list is cleaned: numbers, halves, unique, sorted, capped', () => {
  assert.deepStrictEqual(LD.cleanSteps('2, 4kg, 6; 8 4'), [2, 4, 6, 8]);
  assert.deepStrictEqual(LD.cleanSteps([2.5, 5, 2.5, 'x', -3, 0, 500]), [2.5, 5]);
  assert.deepStrictEqual(LD.cleanSteps(''), []);
  assert.deepStrictEqual(LD.cleanSteps(null), []);
  assert.strictEqual(LD.cleanSteps(Array.from({ length: 80 }, (_, i) => i + 1)).length, 30);
  assert.strictEqual(LD.nextUp(6, [2, 4, 6, 8]), 8);
  assert.strictEqual(LD.nextDown(6, [2, 4, 6, 8]), 4);
  assert.strictEqual(LD.nextDown(2, [2, 4]), null);
});

console.log(`fitness adaptation: ${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
