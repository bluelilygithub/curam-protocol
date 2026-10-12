'use strict';

// Pure-logic tests for the Fitness Planner (no database, no AI). Run: node server/services/fitness/fitness.test.js
const assert = require('assert');
const Module = require('module');

// ai.js pulls in the database pool at require time; stub those modules so this stays a pure test.
const realLoad = Module._load;
Module._load = function load(request, parent, ...rest) {
  if (/(^|\/)db$/.test(request) || /modelResolver$/.test(request) || /callModel$/.test(request) || /logUsage$/.test(request)) return {};
  return realLoad.call(this, request, parent, ...rest);
};
const { extractJsonObject } = require('./ai');
const baseline = require('./baseline');
const goal = require('./goal');
Module._load = realLoad;

const C = require('./config');
const T = require('./targets');
const { checkNotes } = require('./safety');

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

// ── age and bands ──
test('ageOn handles birthdays', () => {
  assert.strictEqual(T.ageOn('1966-10-13', '2026-10-12'), 59);
  assert.strictEqual(T.ageOn('1966-10-12', '2026-10-12'), 60);
  assert.strictEqual(T.ageOn('2000-02-29', '2026-02-28'), 25);
});
test('bandForAge boundaries and under-18', () => {
  assert.strictEqual(T.bandForAge(17), null);
  assert.strictEqual(T.bandForAge(18).id, '18-34');
  assert.strictEqual(T.bandForAge(34).id, '18-34');
  assert.strictEqual(T.bandForAge(35).id, '35-49');
  assert.strictEqual(T.bandForAge(60).id, '50-64');
  assert.strictEqual(T.bandForAge(65).id, '65-74');
  assert.strictEqual(T.bandForAge(75).id, '75+');
  assert.strictEqual(T.bandForAge(101).id, '75+');
});
test('todayInZone differs across the date line', () => {
  const t = new Date('2026-10-12T20:00:00Z');
  assert.strictEqual(T.todayInZone('Australia/Brisbane', t), '2026-10-13');
  assert.strictEqual(T.todayInZone('America/Los_Angeles', t), '2026-10-12');
});
test('addYears keeps 29 Feb valid', () => {
  assert.strictEqual(T.addYears('2024-02-29', 1), '2025-02-28');
  assert.strictEqual(T.addYears('2026-10-12', 5), '2031-10-12');
});

// ── WHO-based targets ──
test('WHO aerobic range respected at every ambition and band', () => {
  for (const band of C.AGE_BANDS) {
    for (let a = 1; a <= 5; a += 1) {
      const t = T.weeklyTargets(band.id, a);
      assert.ok(t.aerobicModerateMin >= 150 && t.aerobicModerateMin <= 300, `${band.id}/${a} aerobic ${t.aerobicModerateMin}`);
      assert.ok(t.strengthDays >= 2, `${band.id}/${a} strength days`);
    }
  }
});
test('65+ get 3+ balance/strength days at every ambition', () => {
  for (const id of ['65-74', '75+']) {
    for (let a = 1; a <= 5; a += 1) {
      const t = T.weeklyTargets(id, a);
      assert.ok(t.balanceDays >= 3 && t.strengthDays >= 3 && t.multicomponent, `${id}/${a}`);
    }
  }
});
test('aerobic target never exceeds the band safety cap and rises with ambition', () => {
  for (const band of C.AGE_BANDS) {
    let prev = 0;
    for (let a = 1; a <= 5; a += 1) {
      const m = T.weeklyTargets(band.id, a).aerobicModerateMin;
      assert.ok(m <= C.DEFAULTS.bandTargets[band.id].aerobicCapModerate);
      assert.ok(m >= prev);
      prev = m;
    }
  }
});

// ── baseline comparison and goal path ──
const WORKED = { cardio: 3, strength: 3, flexibility: 2, balance: 3 };
const WORKED_PREV = { cardio: 5, strength: 4, flexibility: 3, balance: 4 };

test('compareToRange uses neutral statuses', () => {
  const rows = T.compareToRange('50-64', WORKED, WORKED_PREV);
  assert.strictEqual(rows.find((r) => r.domain === 'flexibility').status, 'building');
  assert.strictEqual(rows.find((r) => r.domain === 'cardio').status, 'in_range');
  assert.ok(rows.every((r) => ['building', 'in_range', 'above'].includes(r.status)));
});
test('targets never fall below current rating and respect band ceiling', () => {
  for (let a = 1; a <= 5; a += 1) {
    const t = T.targetRatings('50-64', WORKED, a);
    for (const d of C.DOMAINS) {
      assert.ok(t[d] >= WORKED[d], `${d} ${a}`);
      assert.ok(t[d] <= C.DEFAULTS.healthyRange['50-64'].ceiling[d]);
    }
  }
  const top = T.targetRatings('75+', { cardio: 5, strength: 5, flexibility: 5, balance: 5 }, 1);
  assert.deepStrictEqual(top, { cardio: 5, strength: 5, flexibility: 5, balance: 5 }); // never reduced
});
test('milestones: five years, monotonic, year 5 reaches end state', () => {
  const plan = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: WORKED_PREV, ambition: 3, startsOn: '2026-10-12' });
  assert.strictEqual(plan.milestones.length, 5);
  assert.strictEqual(plan.milestones[0].by, '2027-10-12');
  assert.strictEqual(plan.milestones[4].by, '2031-10-12');
  assert.strictEqual(plan.regaining, true);
  for (let i = 1; i < 5; i += 1) {
    assert.ok(plan.milestones[i].weekly.aerobicModerateMin >= plan.milestones[i - 1].weekly.aerobicModerateMin);
    for (const d of C.DOMAINS) assert.ok(plan.milestones[i].ratings[d] >= plan.milestones[i - 1].ratings[d]);
  }
  assert.deepStrictEqual(plan.milestones[4].ratings, plan.endRatings);
  assert.strictEqual(plan.milestones[4].weekly.aerobicModerateMin, plan.endWeekly.aerobicModerateMin);
});
test('first-year step is gentle (no jump straight to the end state)', () => {
  const plan = T.buildMilestones({ bandId: '50-64', scores: { cardio: 2, strength: 2, flexibility: 2, balance: 2 }, previous: null, ambition: 5, startsOn: '2026-10-12' });
  assert.ok(plan.milestones[0].weekly.aerobicModerateMin < plan.endWeekly.aerobicModerateMin);
  assert.ok(plan.milestones[0].weekly.strengthDays <= 2);
});
test('dialing ambition up never lowers anything', () => {
  const lo = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: null, ambition: 2, startsOn: '2026-10-12' });
  const hi = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: null, ambition: 4, startsOn: '2026-10-12' });
  const d = T.diffPlans(lo, hi);
  assert.ok(d.aerobicMinutesPerWeek >= 0 && d.strengthDays >= 0 && d.balanceDays >= 0 && d.mobilityDays >= 0);
  for (const k of C.DOMAINS) assert.ok(d.ratingChanges[k] >= 0);
});
test('invalid scores rejected', () => {
  assert.throws(() => T.buildMilestones({ bandId: '50-64', scores: { cardio: 9 }, ambition: 3, startsOn: '2026-10-12' }));
  assert.strictEqual(T.validRatings({ cardio: 3, strength: 3, flexibility: 3, balance: 0 }), false);
});

// ── re-rating cadence ──
test('ratingDue: soft at 4 weeks, firm at 6, none before', () => {
  assert.strictEqual(T.ratingDue('2026-10-01', '2026-10-12').due, false);
  assert.deepStrictEqual(T.ratingDue('2026-09-14', '2026-10-12'), { due: true, level: 'soft', weeks: 4 });
  assert.strictEqual(T.ratingDue('2026-08-31', '2026-10-12').level, 'firm');
});

// ── safety keywords ──
test('safety: chest symptoms suggest GP and offer easing', () => {
  const r = checkNotes('felt chest tightness on the stairs');
  assert.deepStrictEqual(r.flags, ['chest']);
  assert.ok(r.suggestGp && r.offerEase);
});
test('safety: dizziness suggests GP', () => {
  const r = checkNotes('got dizzy after the bike');
  assert.ok(r.flags.includes('dizzy') && r.suggestGp);
});
test('safety: pain offers easing but not a GP first', () => {
  const r = checkNotes('left knee hurts going downstairs');
  assert.deepStrictEqual(r.flags, ['pain']);
  assert.ok(r.offerEase && !r.suggestGp);
});
test('safety: negations and ordinary notes do not trigger', () => {
  assert.strictEqual(checkNotes('no pain at all, felt great').flags.length, 0);
  assert.strictEqual(checkNotes('pain-free and happy').flags.length, 0);
  assert.strictEqual(checkNotes('knees felt good', 'swam instead of running').flags.length, 0);
  assert.strictEqual(checkNotes(null, '', undefined).flags.length, 0);
});

// ── config override merge ──
test('deepMerge overrides nested config without losing siblings', () => {
  const merged = C.deepMerge(C.DEFAULTS, { rerate: { softWeeks: 5 }, bandTargets: { '50-64': { aerobicCapModerate: 250 } } });
  assert.strictEqual(merged.rerate.softWeeks, 5);
  assert.strictEqual(merged.rerate.firmWeeks, 6);
  assert.strictEqual(merged.bandTargets['50-64'].aerobicCapModerate, 250);
  assert.strictEqual(merged.bandTargets['50-64'].strengthDays, 2);
});

// ── model JSON extraction ──
test('extractJsonObject tolerates fences, chatter and braces in strings', () => {
  assert.strictEqual(extractJsonObject('```json\n{"a":1}\n```'), '{"a":1}');
  assert.strictEqual(extractJsonObject('Sure! {"a":"x } y"} hope that helps'), '{"a":"x } y"}');
  assert.strictEqual(extractJsonObject('no json here'), null);
});


// ── fallback wording + validators (the path used when no model is set in Settings) ──
test('baseline fallback is complete, neutral and passes its own validator', () => {
  const data = {
    age: 60, bandId: '50-64', sex: 'male', previousLabel: '10 years ago',
    comparison: T.compareToRange('50-64', WORKED, WORKED_PREV),
    who: { aerobicModerateMin: 150, aerobicModerateMax: 300, strengthDays: 2, balanceDays: 2, multicomponent: false },
    weeklyToMaintain: ['a', 'b', 'c', 'd'],
  };
  const n = baseline.fallbackNarrative(data);
  assert.ok(baseline.validateNarrative(n).ok);
  assert.ok(/flexibility/i.test(n.whereYouAre));
  assert.ok(!/fail|lazy|behind|poor|bad|should have/i.test(JSON.stringify(n)), 'no judgemental words');
});
test('baseline validator rejects empty or malformed model output', () => {
  assert.strictEqual(baseline.validateNarrative(null).ok, false);
  assert.strictEqual(baseline.validateNarrative({ headline: 'x' }).ok, false);
  assert.strictEqual(baseline.validateNarrative({ headline: 'h', whereYouAre: 'a', whereYouShouldBe: 'b', weeklyToMaintain: ['one'], encouragement: 'e' }).ok, false);
});
test('goal fallback text covers five years and explains a dial change with real numbers', () => {
  const lo = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: WORKED_PREV, ambition: 2, startsOn: '2026-10-12' });
  const hi = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: WORKED_PREV, ambition: 4, startsOn: '2026-10-12' });
  const text = goal.fallbackText(hi, T.diffPlans(lo, hi));
  assert.ok(goal.validateGoalText(text).ok);
  assert.strictEqual(text.yearNotes, undefined);
  assert.ok(/Easy-going to Ambitious/.test(text.whatChanged));
  assert.ok(/min a week/.test(text.whatChanged));
});
test('goal validator needs a summary; whatChanged is optional', () => {
  assert.strictEqual(goal.validateGoalText({ yearNotes: ['1'] }).ok, false);
  assert.strictEqual(goal.validateGoalText({ summary: 's' }).ok, true);
  assert.strictEqual(goal.validateGoalText({ summary: 's', whatChanged: 'w' }).value.whatChanged, 'w');
});

// ── goal screen: gradual ratings, "now" row, phases ──
test('ratings climb gradually: no repeated start-to-target jump, year 5 lands on the target', () => {
  const plan = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: WORKED_PREV, ambition: 3, startsOn: '2026-10-12' });
  for (const d of C.DOMAINS) {
    const col = plan.milestones.map((m) => m.ratings[d]);
    if (plan.endRatings[d] > WORKED[d]) {
      assert.ok(col[0] > WORKED[d] && col[0] < plan.endRatings[d], `${d} year 1 ${col[0]}`);
      for (let i = 1; i < 5; i += 1) assert.ok(col[i] > col[i - 1], `${d} strictly rising ${col}`);
    }
    assert.strictEqual(col[4], plan.endRatings[d]);
    assert.ok(col.every((v) => Math.round(v * 10) === v * 10 || Math.abs(v * 10 - Math.round(v * 10)) < 1e-9), 'one decimal');
  }
});
test('plan carries a now row and a phase per year', () => {
  const plan = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: WORKED_PREV, ambition: 3, startsOn: '2026-10-12' });
  assert.deepStrictEqual(plan.now.ratings, WORKED);
  assert.strictEqual(plan.now.aerobicModerateMin, 90);
  assert.deepStrictEqual(plan.milestones.map((m) => m.phase.id), ['base', 'build', 'consolidate', 'consolidate', 'maintain']);
  assert.strictEqual(plan.milestones[0].phase.label, 'Rebuild base'); // regaining
  const fresh = T.buildMilestones({ bandId: '50-64', scores: WORKED, previous: null, ambition: 5, startsOn: '2026-10-12' });
  assert.deepStrictEqual(fresh.milestones.map((m) => m.phase.id), ['base', 'build', 'build', 'consolidate', 'maintain']);
  assert.strictEqual(fresh.milestones[0].phase.label, 'Build base'); // not regaining
});

console.log(`fitness: ${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
