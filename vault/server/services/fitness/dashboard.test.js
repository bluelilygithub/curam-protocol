'use strict';

// Stage 4 dashboard maths. No database. Run: node server/services/fitness/dashboard.test.js
const assert = require('assert');
const D = require('./dashboard');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { console.error(`FAIL: ${name}\n  ${err.message}`); process.exitCode = 1; }
}

const TODAY = '2026-10-14'; // a Wednesday; this week starts 2026-10-12
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekAgo = (n) => addDays('2026-10-12', -7 * n);
const cardio = (minutes) => [{ domain: 'cardio', minutes }];
const sess = (day, status, domain = 'cardio', minutes = 30) => ({ day, status, components: [{ domain, minutes }], effort: 4 });
// a finished, well-logged week with `done` cardio minutes
const week = (n, doneMin, extra = {}) => ({
  weekStart: weekAgo(n), isDeload: false,
  targets: { aerobicMinutes: 90, strengthDays: 2, balanceDays: 2, mobilityDays: 2 },
  restDays: [],
  sessions: [sess(0, 'done', 'cardio', doneMin), sess(2, 'done', 'strength', 40), sess(4, 'done', 'balance', 20)],
  extras: [],
  ...extra,
});
const S = (w) => D.summariseWeek(w, TODAY);

// ── one week ──
test('done minutes and sessions, partly done is half, rest is left out of the planned count', () => {
  const s = S({ ...week(1, 60), sessions: [sess(0, 'done', 'cardio', 40), sess(2, 'partial', 'cardio', 20), sess(4, 'rest'), sess(5, 'skipped', 'cardio', 30)] });
  assert.strictEqual(s.done.aerobicMinutes, 50, '40 + half of 20');
  assert.strictEqual(s.sessionsPlanned, 3, 'rest is not a planned session');
  assert.strictEqual(s.sessionsDone, 1.5);
  assert.ok(Math.abs(s.coverage - 1) < 1e-9, 'all three live sessions are logged');
});
test('a swapped session counts, and an extra adds its minutes', () => {
  const s = S({ ...week(1, 0), sessions: [sess(0, 'swapped', 'cardio', 30)], extras: [{ domain: 'cardio', minutes: 45, date: weekAgo(1), effort: 3 }] });
  assert.strictEqual(s.done.aerobicMinutes, 75);
});
test('the current week is "so far", finished weeks are finished, and neither deload nor thin weeks are usable', () => {
  assert.strictEqual(S(week(0, 30)).current, true);
  assert.strictEqual(S(week(0, 30)).usable, false, 'the current week never feeds trends');
  assert.strictEqual(S(week(1, 30)).usable, true);
  assert.strictEqual(S({ ...week(1, 30), isDeload: true }).usable, false);
  const thin = S({ ...week(1, 30), sessions: [sess(0, 'done'), sess(2, 'planned'), sess(4, 'planned')] });
  assert.strictEqual(thin.usable, false, 'one logged session of three is less than half');
  assert.strictEqual(S({ ...week(1, 30), sessions: [sess(0, 'done'), sess(2, 'done'), sess(4, 'planned'), sess(5, 'planned')] }).usable, true, 'exactly half counts');
});
test('a week of only rest has nothing planned and is never usable', () => {
  const s = S({ ...week(1, 0), sessions: [sess(0, 'rest'), sess(1, 'rest')] });
  assert.strictEqual(s.sessionsPlanned, 0);
  assert.strictEqual(s.usable, false);
});
test('each day carries its colour state, and days after today are marked future', () => {
  const s = S({ ...week(0, 30), sessions: [sess(0, 'done'), sess(2, 'planned')], restDays: [{ day: 1, kind: 'planned' }] });
  assert.deepStrictEqual(s.days.map((d) => d.state).slice(0, 3), ['done', 'rest', 'planned']);
  assert.strictEqual(s.days[1].future, false);
  assert.strictEqual(s.days[6].future, true);
});

// ── window ──
test('the window is the last 4, last 12 or all weeks up to today; a week made ahead is left out', () => {
  const weeks = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => S(week(n, 30)));
  assert.strictEqual(D.windowWeeks(weeks, '4', TODAY).length, 4);
  assert.strictEqual(D.windowWeeks(weeks, '12', TODAY).length, 12);
  assert.strictEqual(D.windowWeeks(weeks, 'all', TODAY).length, 14, 'week -1 is next week and is not shown');
  assert.strictEqual(D.windowWeeks(weeks, '4', TODAY).at(-1).weekStart, weekAgo(0), 'ends with the current week');
});

// ── balance ──
test('balance sums the last four finished, logged weeks against their targets', () => {
  const weeks = [1, 2, 3, 4, 5].map((n) => S(week(n, 60)));
  const b = D.domainBalance(weeks);
  assert.strictEqual(b.status, 'ok');
  assert.strictEqual(b.weeks, 4);
  const cardioRow = b.domains.find((d) => d.id === 'cardio');
  assert.strictEqual(cardioRow.done, 240);
  assert.strictEqual(cardioRow.target, 360);
  assert.ok(Math.abs(cardioRow.share - 240 / 360) < 1e-9);
  assert.strictEqual(b.domains.find((d) => d.id === 'strength').done, 4, 'one strength day in each of four weeks');
});
test('balance leaves out unlogged weeks and the current week; nothing usable says too little', () => {
  const unlogged = S({ ...week(2, 0), sessions: [sess(0, 'planned'), sess(2, 'planned'), sess(4, 'planned')] });
  const b = D.domainBalance([S(week(0, 60)), S(week(1, 60)), unlogged]);
  assert.strictEqual(b.weeks, 1);
  assert.strictEqual(D.domainBalance([S(week(0, 60)), unlogged]).status, 'too_little');
});
test('a domain with no target is not shown', () => {
  const w = S({ ...week(1, 60), targets: { aerobicMinutes: 90, strengthDays: 0, balanceDays: 2, mobilityDays: 0 } });
  assert.deepStrictEqual(D.domainBalance([w]).domains.map((d) => d.id), ['cardio', 'balance']);
});

// ── projection ──
const MILESTONES = [1, 2, 3, 4, 5].map((y) => ({ year: y, by: addDays(TODAY, 365 * y), weekly: { aerobicModerateMin: 195 + (y - 1) * 20 } }));
const rising = (from, step, n = 6) => Array.from({ length: n }, (_, i) => S(week(n - i, from + step * i)));

test('fewer than four usable weeks gives no projection and says how many it has', () => {
  const p = D.projection(rising(60, 5, 3), MILESTONES, TODAY);
  assert.strictEqual(p.status, 'too_little');
  assert.strictEqual(p.usableWeeks, 3);
  assert.ok(/at least 4 logged weeks, and you have 3/.test(p.sentence));
  assert.deepStrictEqual(p.points, []);
});
test('a steady climb projects forward, held to the 10%-a-week rule and never beyond the plan', () => {
  const p = D.projection(rising(60, 5), MILESTONES, TODAY);
  assert.strictEqual(p.status, 'ok');
  assert.strictEqual(p.holding, false);
  assert.ok(Math.abs(p.level - 85) <= 1, `level ${p.level}`); // 60..85 fitted
  assert.ok(p.perWeek > 0 && p.perWeek <= Math.max(5, p.level * 0.1) + 1e-9);
  assert.strictEqual(p.points.length, 5);
  assert.ok(p.points.every((x) => x.minutes <= Math.max(x.planned, p.level)), 'never beats the plan');
  assert.ok(p.points[0].minutes >= p.level, 'a rising line is never below where you are now');
  assert.ok(p.points[4].atPlan, 'five years at that pace comfortably reaches the plan');
});
test('a flat or falling run is projected as holding steady, not as decline', () => {
  const flat = D.projection(rising(80, 0), MILESTONES, TODAY);
  assert.strictEqual(flat.holding, true);
  assert.ok(flat.points.every((x) => x.minutes === flat.level));
  const falling = D.projection(rising(100, -8), MILESTONES, TODAY);
  assert.strictEqual(falling.holding, true);
  assert.ok(falling.points.every((x) => x.minutes === falling.level), 'never projects below where recent weeks sit');
  assert.ok(/stay around \d+ min a week/.test(falling.sentence));
});
test('deload weeks and thin weeks are left out of the fit', () => {
  const weeks = rising(60, 5, 5);
  const deload = S({ ...week(0.0001, 5), weekStart: weekAgo(6), isDeload: true });
  const thin = S({ ...week(7, 0), sessions: [sess(0, 'done', 'cardio', 5), sess(2, 'planned'), sess(4, 'planned')] });
  const p = D.projection([...weeks, deload, thin], MILESTONES, TODAY);
  assert.strictEqual(p.usableWeeks, 5);
  assert.ok(p.level >= 60, 'the 5-minute deload week did not drag the fit down');
});
test('only the latest eight usable weeks are used', () => {
  const weeks = [...rising(10, 0, 4).map((w, i) => ({ ...w, weekStart: weekAgo(20 - i) })), ...rising(100, 0, 8)];
  const p = D.projection(weeks, MILESTONES, TODAY);
  assert.strictEqual(p.usableWeeks, 8);
  assert.strictEqual(p.level, 100);
});
test('the sentence compares with the plan, names Year 1 and the last year, and is a rough guide', () => {
  const slow = D.projection(rising(60, 0.5), MILESTONES, TODAY);
  assert.strictEqual(slow.holding, false);
  assert.ok(/^At your recent pace you'd reach about \d+ min a week by Year 1, against a plan of 195\./.test(slow.sentence), slow.sentence);
  assert.ok(/By Year 5: about \d+, against 275\./.test(slow.sentence), slow.sentence);
  assert.ok(slow.points[0].minutes < 195, 'a slow climb falls short of the plan');
  const fast = D.projection(rising(60, 5), MILESTONES, TODAY);
  assert.ok(/^At your recent pace you'd reach your plan of 195 min a week by Year 1\. By Year 5 you'd be at your plan of 275\./.test(fast.sentence), fast.sentence);
  assert.ok(/rough guide, not a promise/.test(fast.sentence));
});
test('the projection wording never blames or compares people with others', () => {
  const BAD = /skip|miss|fail|behind|lazy|should have|only/i;
  for (const p of [D.projection(rising(60, 5), MILESTONES, TODAY), D.projection(rising(100, -8), MILESTONES, TODAY), D.projection(rising(60, 5, 2), MILESTONES, TODAY)]) {
    assert.ok(!BAD.test(p.sentence), p.sentence);
  }
});
test('no goal milestones means no sentence to write, not a crash', () => {
  const p = D.projection(rising(60, 5), [], TODAY);
  assert.strictEqual(p.status, 'ok');
  assert.ok(!/Year 1/.test(p.sentence));
});

// ── fit ──
test('the fitted line is exact for a straight series', () => {
  const { slope, intercept } = D.fitLine([10, 20, 30, 40]);
  assert.ok(Math.abs(slope - 10) < 1e-9 && Math.abs(intercept - 10) < 1e-9);
  assert.deepStrictEqual(D.fitLine([5, 5, 5]).slope, 0);
});

// ── whole payload ──
test('buildDashboard returns the window, this week so far, a calendar, the balance and the projection', () => {
  const weeks = [0, 1, 2, 3, 4, 5, 6].map((n) => week(n, 60 + n));
  const d = D.buildDashboard({ weeks, milestones: MILESTONES, today: TODAY, range: '4' });
  assert.strictEqual(d.weeks.length, 4);
  assert.strictEqual(d.thisWeek.weekStart, weekAgo(0));
  assert.strictEqual(d.calendar.length, 4);
  assert.strictEqual(d.calendar[0].days.length, 7);
  assert.strictEqual(d.balance.status, 'ok');
  assert.strictEqual(d.projection.status, 'ok');
  assert.ok(!('days' in d.weeks[0]), 'the chart list stays small: day states live in the calendar');
});
test('all-weeks range keeps every week for the charts but the calendar stays to a readable length', () => {
  const weeks = Array.from({ length: 60 }, (_, n) => week(n, 60));
  const d = D.buildDashboard({ weeks, milestones: MILESTONES, today: TODAY, range: 'all' });
  assert.strictEqual(d.weeks.length, 60);
  assert.ok(d.calendar.length <= 26);
});
test('a person with no weeks yet gets an empty but valid dashboard', () => {
  const d = D.buildDashboard({ weeks: [], milestones: MILESTONES, today: TODAY, range: '12' });
  assert.strictEqual(d.weeks.length, 0);
  assert.strictEqual(d.thisWeek, null);
  assert.strictEqual(d.balance.status, 'too_little');
  assert.strictEqual(d.projection.status, 'too_little');
});

console.log(`fitness dashboard: ${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
