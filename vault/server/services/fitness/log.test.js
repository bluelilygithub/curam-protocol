'use strict';

// Stage 3 tests: the pure logging rules. No database. Run: node server/services/fitness/log.test.js
const assert = require('assert');
const LG = require('./logging');
const { dayState, weekDone } = require('./dayStatus');

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
const throwsLog = (fn, re) => assert.throws(fn, (e) => e instanceof LG.LogError && e.status === 400 && (!re || re.test(e.message)));

test('rest and skipped are separate statuses', () => {
  assert.deepStrictEqual(LG.STATUSES, ['done', 'partial', 'swapped', 'skipped', 'rest']);
  assert.notStrictEqual(LG.STATUSES.indexOf('rest'), LG.STATUSES.indexOf('skipped'));
});

test('a normal log is accepted and normalised', () => {
  const v = LG.validateSessionLog({ status: 'done', actualMinutes: '45', effort: '5', note: '  knees felt good ', exercises: [{ position: 2, sets: '3', reps: 8, weightKg: '6.5' }] });
  assert.strictEqual(v.status, 'done');
  assert.strictEqual(v.actualMinutes, 45);
  assert.strictEqual(v.effort, 5);
  assert.strictEqual(v.note, 'knees felt good');
  assert.deepStrictEqual(v.exercises[0], { position: 2, sets: 3, reps: 8, weightKg: 6.5, distanceKm: null, seconds: null });
});

test('unknown status, bad effort and silly minutes are refused with a plain message', () => {
  throwsLog(() => LG.validateSessionLog({ status: 'failed' }), /how it went/);
  throwsLog(() => LG.validateSessionLog({ status: 'done', effort: 11 }), /Effort/);
  throwsLog(() => LG.validateSessionLog({ status: 'done', effort: 0 }), /Effort/);
  throwsLog(() => LG.validateSessionLog({ status: 'done', actualMinutes: -5 }), /Minutes/);
  throwsLog(() => LG.validateSessionLog({ status: 'done', actualMinutes: 5000 }), /Minutes/);
});

test('minutes and effort are optional', () => {
  const v = LG.validateSessionLog({ status: 'done' });
  assert.strictEqual(v.actualMinutes, null);
  assert.strictEqual(v.effort, null);
  assert.deepStrictEqual(v.exercises, []);
});

test('rest keeps no minutes, effort or exercise rows: nothing was done, and that is fine', () => {
  const v = LG.validateSessionLog({ status: 'rest', actualMinutes: 30, effort: 9, exercises: [{ position: 0, sets: 3 }], note: 'tired' });
  assert.strictEqual(v.actualMinutes, null);
  assert.strictEqual(v.effort, null);
  assert.deepStrictEqual(v.exercises, []);
  assert.strictEqual(v.note, 'tired');
});

test('"didn\'t do it" keeps no effort or exercise rows either', () => {
  const v = LG.validateSessionLog({ status: 'skipped', effort: 7, exercises: [{ position: 0 }] });
  assert.strictEqual(v.effort, null);
  assert.deepStrictEqual(v.exercises, []);
});

test('what you did instead is kept only for swapped sessions; "none" style notes are empty', () => {
  assert.strictEqual(LG.validateSessionLog({ status: 'swapped', activity: 'swam instead' }).activity, 'swam instead');
  assert.strictEqual(LG.validateSessionLog({ status: 'done', activity: 'swam instead' }).activity, null);
  assert.strictEqual(LG.validateSessionLog({ status: 'done', note: 'none' }).note, null);
  assert.strictEqual(LG.validateSessionLog({ status: 'done', note: 'n/a' }).note, null);
});

test('exercise rows: positions must be unique and values sensible', () => {
  throwsLog(() => LG.validateSessionLog({ status: 'done', exercises: [{ position: 1 }, { position: 1 }] }), /repeated/);
  throwsLog(() => LG.validateSessionLog({ status: 'done', exercises: [{ position: 1, weightKg: 900 }] }), /Weight/);
  throwsLog(() => LG.validateSessionLog({ status: 'done', exercises: [{ position: 1, reps: -1 }] }), /Reps/);
  throwsLog(() => LG.validateSessionLog({ status: 'done', exercises: 'nope' }), /not valid/);
  const ok = LG.validateSessionLog({ status: 'done', exercises: [{ position: 3, distanceKm: '5.25', seconds: 1800 }] });
  assert.strictEqual(ok.exercises[0].distanceKm, 5.25);
  assert.strictEqual(ok.exercises[0].seconds, 1800);
});

const TODAY = '2026-10-21';
test('extra activity: a walk today is fine; defaults to cardio', () => {
  const v = LG.validateExtra({ title: 'Long walk', actualMinutes: 50, effort: 4 }, TODAY);
  assert.strictEqual(v.loggedOn, TODAY);
  assert.strictEqual(v.domain, 'cardio');
  assert.strictEqual(v.actualMinutes, 50);
});
test('extra activity: needs a name and minutes, no future dates, back-fill limited to 28 days', () => {
  throwsLog(() => LG.validateExtra({ actualMinutes: 30 }, TODAY), /what you did/);
  throwsLog(() => LG.validateExtra({ title: 'Walk' }, TODAY), /Minutes/);
  throwsLog(() => LG.validateExtra({ title: 'Walk', actualMinutes: 30, date: '2026-10-22' }, TODAY), /not what is coming/);
  throwsLog(() => LG.validateExtra({ title: 'Walk', actualMinutes: 30, date: '2026-09-01' }, TODAY), /28 days/);
  assert.strictEqual(LG.validateExtra({ title: 'Walk', actualMinutes: 30, date: '2026-09-23' }, TODAY).loggedOn, '2026-09-23');
  throwsLog(() => LG.validateExtra({ title: 'Walk', actualMinutes: 30, domain: 'bodybuilding' }, TODAY), /kind of activity/);
  throwsLog(() => LG.validateExtra({ title: 'Walk', actualMinutes: 30, date: 'yesterday' }, TODAY), /date/);
});

test('a planned session can be logged on its day or later, not before, and not beyond the back-fill window', () => {
  LG.checkLoggable('2026-10-21', TODAY);
  LG.checkLoggable('2026-10-14', TODAY);
  throwsLog(() => LG.checkLoggable('2026-10-22', TODAY), /Come back on the day/);
  throwsLog(() => LG.checkLoggable('2026-09-01', TODAY), /28 days/);
});

test('catch-up lists only planned or moved sessions up to today, inside the window, newest first; never anything already logged', () => {
  const s = (id, date, status) => ({ id, date, status });
  const list = LG.catchUpList([
    s(1, '2026-10-20', 'planned'), s(2, '2026-10-21', 'moved'), s(3, '2026-10-22', 'planned'), // tomorrow: not yet
    s(4, '2026-10-19', 'done'), s(5, '2026-10-18', 'rest'), s(6, '2026-10-17', 'skipped'), s(7, '2026-10-16', 'swapped'),
    s(8, '2026-09-01', 'planned'), s(9, '2026-10-20', 'planned'),
  ], TODAY);
  assert.deepStrictEqual(list.map((x) => x.id), [2, 9, 1]);
});

test('prescription text becomes starting values: sets and the low end of reps, low end of a hold, minutes for cardio', () => {
  assert.deepStrictEqual(LG.parsePrescription('3 sets of 8-12 reps'), { kind: 'reps', sets: 3, reps: 8, seconds: null, minutes: null });
  assert.deepStrictEqual(LG.parsePrescription('2 sets of 6-8 reps each side, using support'), { kind: 'reps', sets: 2, reps: 6, seconds: null, minutes: null });
  assert.deepStrictEqual(LG.parsePrescription('3 sets of 10-12 slow reps'), { kind: 'reps', sets: 3, reps: 10, seconds: null, minutes: null });
  assert.deepStrictEqual(LG.parsePrescription('3 holds of 20-30 seconds each side'), { kind: 'hold', sets: 3, reps: null, seconds: 20, minutes: null });
  assert.deepStrictEqual(LG.parsePrescription('2 holds of 15-20 seconds each side. Stand beside a wall or bench for support.'), { kind: 'hold', sets: 2, reps: null, seconds: 15, minutes: null });
  assert.deepStrictEqual(LG.parsePrescription('45 minutes'), { kind: 'cardio', sets: null, reps: null, seconds: null, minutes: 45 });
  assert.strictEqual(LG.parsePrescription('').kind, 'rounds');
  assert.strictEqual(LG.parsePrescription(null).sets, null);
});


// ── day colours and what has been done so far ──
const sess = (status, extra = {}) => ({ status, day: 0, components: [{ domain: 'strength', minutes: 30 }], ...extra });
test('a day with everything logged as done (or done another way) is done', () => {
  assert.strictEqual(dayState({ sessions: [sess('done')] }), 'done');
  assert.strictEqual(dayState({ sessions: [sess('done'), sess('swapped')] }), 'done');
});
test('a day with nothing logged yet is planned (neutral), and a day half logged is partial', () => {
  assert.strictEqual(dayState({ sessions: [sess('planned')] }), 'planned');
  assert.strictEqual(dayState({ sessions: [sess('moved')] }), 'planned');
  assert.strictEqual(dayState({ sessions: [sess('done'), sess('planned')] }), 'partial');
});
test('partly done, or a mix of done and "didn\'t do it", is partial; all "didn\'t do it" is a neutral skipped, not a failure', () => {
  assert.strictEqual(dayState({ sessions: [sess('partial')] }), 'partial');
  assert.strictEqual(dayState({ sessions: [sess('done'), sess('skipped')] }), 'partial');
  assert.strictEqual(dayState({ sessions: [sess('skipped')] }), 'skipped');
});
test('rest days (planned, flexible, or sessions logged as rest) are rest, and rest never looks like skipped', () => {
  assert.strictEqual(dayState({ sessions: [], restInfo: { day: 3, kind: 'planned' } }), 'rest');
  assert.strictEqual(dayState({ sessions: [sess('rest')] }), 'rest');
  assert.strictEqual(dayState({ sessions: [sess('rest'), sess('planned')] }), 'planned');
  assert.notStrictEqual(dayState({ sessions: [sess('rest')] }), dayState({ sessions: [sess('skipped')] }));
});
test('nothing planned: an extra makes it an extra day, otherwise none', () => {
  assert.strictEqual(dayState({ sessions: [], extras: [{ minutes: 30 }] }), 'extra');
  assert.strictEqual(dayState({ sessions: [] }), 'none');
});

test('week progress counts what was done in the same units as the targets', () => {
  const sessions = [
    { status: 'done', day: 0, components: [{ domain: 'strength', minutes: 30 }, { domain: 'balance', minutes: 8 }] },
    { status: 'done', day: 1, components: [{ domain: 'cardio', minutes: 40 }, { domain: 'flexibility', minutes: 8 }] },
    { status: 'partial', day: 3, components: [{ domain: 'strength', minutes: 30 }] },
    { status: 'planned', day: 4, components: [{ domain: 'cardio', minutes: 50 }] },
    { status: 'skipped', day: 5, components: [{ domain: 'cardio', minutes: 50 }] },
    { status: 'rest', day: 6, components: [{ domain: 'cardio', minutes: 50 }] },
  ];
  assert.deepStrictEqual(weekDone(sessions, []), { aerobicMinutes: 40, strengthDays: 1.5, balanceDays: 1, mobilityDays: 1 });
});
test('swapped counts for what was planned; partly done is half the minutes; extras count for their kind', () => {
  const d = weekDone(
    [{ status: 'swapped', day: 0, components: [{ domain: 'cardio', minutes: 40 }] }, { status: 'partial', day: 2, components: [{ domain: 'cardio', minutes: 40 }] }],
    [{ domain: 'cardio', minutes: 30, date: '2026-10-21' }, { domain: 'balance', minutes: 15, date: '2026-10-22' }],
  );
  assert.strictEqual(d.aerobicMinutes, 40 + 20 + 30);
  assert.strictEqual(d.balanceDays, 1);
});
test('nothing logged means nothing done', () => {
  assert.deepStrictEqual(weekDone([{ status: 'planned', day: 0, components: [{ domain: 'cardio', minutes: 30 }] }], []), { aerobicMinutes: 0, strengthDays: 0, balanceDays: 0, mobilityDays: 0 });
});

console.log(`fitness logging: ${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
