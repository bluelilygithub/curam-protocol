'use strict';

// Stage 3 tests: the pure logging rules. No database. Run: node server/services/fitness/log.test.js
const assert = require('assert');
const LG = require('./logging');
const { dayState, weekDone } = require('./dayStatus');
const CO = require('./coaching');
const Ph = require('./phases');
const DS = require('./demoScript');
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


// ── tips after a session ──
const ex = (slug, extra = {}) => ({ slug, block: 'main', ...extra });
test('no tips for rest or "didn\'t do it": nothing to say about a session that was not done', () => {
  assert.deepStrictEqual(CO.ruleTips({ status: 'rest', effort: null, exercises: [ex('goblet-squat')] }), []);
  assert.deepStrictEqual(CO.ruleTips({ status: 'skipped', effort: null, exercises: [ex('goblet-squat')] }), []);
});
test('effort 9 or 10 suggests the easier version, by name, and a sensible target', () => {
  const t = CO.ruleTips({ status: 'done', effort: 9, exercises: [ex('push-up'), ex('goblet-squat')] });
  assert.ok(/9 out of 10/.test(t[0]) && /easier version of Push-up \(Incline push-up\)/.test(t[0]) && /6 to 8/.test(t[0]), t[0]);
});
test('a manageable weight gets a small step up; a hard one is left alone', () => {
  const easy = CO.ruleTips({ status: 'done', effort: 4, exercises: [ex('goblet-squat', { weightKg: 6 })] });
  assert.ok(easy.some((x) => /6 kg felt manageable/.test(x) && /try the next weight up\.$/.test(x)), easy.join(' | '));
  const owned = CO.ruleTips({ status: 'done', effort: 4, exercises: [ex('goblet-squat', { weightKg: 6 })], steps: [2, 4, 6, 8, 10] });
  assert.ok(owned.some((x) => /try the next weight up \(8 kg\)\./.test(x)), 'names the weight only when the person listed the weights they own');
  const hard = CO.ruleTips({ status: 'done', effort: 8, exercises: [ex('goblet-squat', { weightKg: 8 })] });
  assert.ok(hard.some((x) => /stay at 8 kg/.test(x)), hard.join(' | '));
  const middle = CO.ruleTips({ status: 'done', effort: 6, exercises: [ex('goblet-squat', { weightKg: 8 })] });
  assert.ok(!middle.some((x) => /kg/.test(x)), 'effort 6 or 7 is right: no weight advice');
});
test('an easy session says the plan steps up by itself; a partly done one says part still counts', () => {
  assert.ok(CO.ruleTips({ status: 'done', effort: 3, exercises: [] }).some((x) => /plan steps up a little by itself/.test(x)));
  assert.ok(CO.ruleTips({ status: 'partial', effort: 5, exercises: [] }).some((x) => /Part of a session still counts/.test(x)));
});
test('the form cue puts the fix first and reads as a sentence, not a quotation', () => {
  const t = CO.ruleTips({ status: 'done', effort: 6, exercises: [ex('incline-push-up')] }, 0);
  assert.ok(/^A form cue for Incline push-up: Use something fixed/.test(t[0]), t[0]);
  assert.ok(/\(A common slip: the surface slides or tilts\.\)$/.test(t[0]), t[0]);
  assert.ok(!/"/.test(t[0]), 'no clumsy quote marks');
});
test('a form cue comes from the library and varies with the seed; never more than two tips', () => {
  const exs = [ex('goblet-squat'), ex('push-up'), ex('dead-bug'), ex('supported-dumbbell-row')];
  const cues = new Set();
  for (let seed = 0; seed < 8; seed += 1) {
    const t = CO.ruleTips({ status: 'done', effort: 6, exercises: exs }, seed);
    assert.ok(t.length >= 1 && t.length <= 2);
    assert.ok(/^A form cue for /.test(t[0]));
    cues.add(t[0]);
  }
  assert.ok(cues.size >= 3, 'the cue rotates between exercises');
  assert.ok(CO.ruleTips({ status: 'done', effort: 9, exercises: exs }).length <= 2);
});
test('no rule-based tip or reflection ever uses guilt words', () => {
  for (const status of ['done', 'partial', 'swapped']) for (const effort of [1, 3, 5, 7, 9, 10, null]) {
    for (const tip of CO.ruleTips({ status, effort, exercises: [ex('goblet-squat', { weightKg: 6 }), ex('push-up')] }, 3)) assert.ok(!CO.BANNED.test(tip), tip);
  }
  const f = { sessionsLogged: 3, extras: 1, minutesLogged: 140, aerobicDone: 60, aerobicPlanned: 90, averageEffort: 9, done: 2, partly: 1, didSomethingElse: 0, rested: 1 };
  assert.ok(!CO.BANNED.test(CO.reflectionFallback(f)));
  assert.ok(!CO.BANNED.test(CO.reflectionFallback({ ...f, averageEffort: 2 })));
});
test('model tips are accepted only if short, on tone, and in the right shape', () => {
  assert.strictEqual(CO.validateTips({ tips: ['Keep the weight where it is.'] }).ok, true);
  assert.strictEqual(CO.validateTips({ tips: ['One.', 'Two.', 'Three.'] }).value.tips.length, 2);
  assert.strictEqual(CO.validateTips({ tips: [] }).ok, false);
  assert.strictEqual(CO.validateTips({ tips: 'nope' }).ok, false);
  assert.strictEqual(CO.validateTips(null).ok, false);
  assert.strictEqual(CO.validateTips({ tips: ['You should have done more.'] }).ok, false);
  assert.strictEqual(CO.validateTips({ tips: ['Do not get behind.'] }).ok, false);
  assert.strictEqual(CO.validateTips({ tips: ['x'.repeat(500)] }).value.tips[0].length, 220);
});

// ── the weekly reflection ──
test('reflection facts count only what was logged; unlogged sessions are simply absent', () => {
  const week = {
    sessions: [
      { status: 'done', log: { status: 'done', actualMinutes: 40, effort: 5 } },
      { status: 'partial', log: { status: 'partial', actualMinutes: 20, effort: 7 } },
      { status: 'planned', log: null },
      { status: 'rest', log: null },
    ],
    extras: [{ minutes: 30 }],
    done: { aerobicMinutes: 60, strengthDays: 1 },
    week: { targets: { aerobicMinutes: 90, strengthDays: 2 } }, // the real GET /week shape
  };
  const f = CO.reflectionFacts(week);
  assert.strictEqual(f.sessionsLogged, 2);
  assert.strictEqual(f.minutesLogged, 90);
  assert.strictEqual(f.averageEffort, 6);
  assert.strictEqual(f.rested, 1);
  assert.strictEqual(f.extras, 1);
  assert.strictEqual(f.aerobicPlanned, 90);
  assert.strictEqual(f.strengthDaysPlanned, 2);
  assert.ok(!('skipped' in f) && !('notLogged' in f));
});
test('a week with nothing logged has no reflection; one with something does, in plain words', () => {
  assert.strictEqual(CO.reflectionFallback({ sessionsLogged: 0, extras: 0 }), null);
  const text = CO.reflectionFallback({ sessionsLogged: 2, extras: 0, minutesLogged: 80, aerobicDone: 40, aerobicPlanned: 60, averageEffort: 5 });
  assert.ok(/80 minutes across 2 activities/.test(text) && /40 aerobic minutes against the 60/.test(text) && /Rest and quiet weeks are part of it/.test(text));
});
test('model reflections are checked for shape and tone', () => {
  assert.strictEqual(CO.validateReflection({ reflection: 'A steady week. Keep going at your own pace.' }).ok, true);
  assert.strictEqual(CO.validateReflection({ reflection: '' }).ok, false);
  assert.strictEqual(CO.validateReflection({}).ok, false);
  assert.strictEqual(CO.validateReflection({ reflection: 'You skipped two sessions.' }).ok, false);
});

// ── keeping one week gentle ──
test('a confirmed gentler week eases exactly that week and no other', () => {
  const goal = {
    startsOn: '2026-10-12', summary: { startMinutes: 60 },
    milestones: [1, 2, 3, 4, 5].map((y) => ({ year: y, by: `${2026 + y}-10-12`, phase: { id: 'build', label: 'Build', focus: '' }, weekly: { aerobicModerateMin: 120, strengthDays: 2, balanceDays: 1, mobilityDays: 2 } })),
  };
  const base = { goal, prevBuildMinutes: 70, currentMinutes: 60 };
  const plain = Ph.targetsForWeek({ ...base, weekStart: '2026-11-02' });
  const gentle = Ph.targetsForWeek({ ...base, weekStart: '2026-11-02', easeWeek: '2026-11-02' });
  const other = Ph.targetsForWeek({ ...base, weekStart: '2026-10-26', easeWeek: '2026-11-02' });
  assert.strictEqual(plain.eased, false);
  assert.strictEqual(gentle.eased, true);
  assert.strictEqual(gentle.easier, true);
  assert.ok(gentle.targets.aerobicMinutes < plain.targets.aerobicMinutes, 'the gentle week asks for less');
  assert.strictEqual(other.eased, false);
});


// ── the demo history ──
const mk = (...kinds) => kinds.map((k, i) => ({ id: i + 1, totalMinutes: 50, components: [{ domain: k, minutes: 30 }], exercises: [] }));
const FOUR = mk('strength', 'cardio', 'strength', 'flexibility');
const THREE = mk('strength', 'cardio', 'strength');
const FIVE = mk('strength', 'cardio', 'strength', 'cardio', 'balance');
test('the demo history mixes every kind of outcome across the twelve weeks, however many sessions a week has', () => {
  for (const sessions of [THREE, FOUR, FIVE]) {
    const seen = new Set();
    for (let w = 0; w < DS.WEEKS; w += 1) for (const x of DS.assignWeek(sessions, w)) seen.add(x.status);
    for (const status of ['done', 'partial', 'swapped', 'rest', 'skipped']) assert.ok(seen.has(status), `${status} with ${sessions.length} sessions`);
  }
  assert.ok(DS.EXTRAS.length >= 1 && DS.WEIGHTS.length >= Math.max(...Object.values(DS.WEEKS_BY_SCENARIO)));
  assert.ok(DS.EXTRAS.every(([w, d]) => w >= 0 && w < DS.WEEKS && d >= 0 && d <= 6));
});
test('the first week is all done; the third of the four full-mix weeks has the knee note on a done STRENGTH session, a swim swap for a cardio session, and a miss', () => {
  assert.ok(DS.assignWeek(FOUR, 0).every((x) => x.status === 'done'));
  for (const sessions of [THREE, FOUR, FIVE]) {
    const w2 = DS.assignWeek(sessions, DS.LEAD_IN + 2);
    const i = w2.findIndex((x) => /knee/i.test(x.note || ''));
    assert.ok(i >= 0, 'the knee note is always placed');
    assert.strictEqual(w2[i].status, 'done');
    assert.ok(sessions[i].components.some((c) => c.domain === 'strength'), 'on a strength session');
    const swap = w2.findIndex((x) => x.status === 'swapped');
    assert.ok(sessions[swap].components.some((c) => c.domain === 'cardio'), 'the swim replaces a cardio session');
    assert.strictEqual(w2.filter((x) => x.status === 'skipped').length, 1);
  }
});
test('every session gets exactly one outcome, and the last week is complete', () => {
  for (const sessions of [THREE, FOUR, FIVE]) for (let w = 0; w < DS.WEEKS; w += 1) {
    const a = DS.assignWeek(sessions, w);
    assert.strictEqual(a.length, sessions.length);
    assert.ok(a.every((x) => x && ['done', 'partial', 'swapped', 'rest', 'skipped'].includes(x.status)));
  }
  assert.ok(DS.assignWeek(FOUR, DS.WEEKS - 1).every((x) => x.status === 'done'), 'last week: all done, a little harder');
});
test('exactly one demo note mentions knee pain, it triggers the pain notice (not the GP-first one), and no note is guilt-toned', () => {
  const notes = [];
  for (let w = 0; w < DS.WEEKS; w += 1) for (const x of DS.assignWeek(FOUR, w)) if (x.note) notes.push(x.note);
  const knee = notes.filter((n) => /knee/i.test(n));
  assert.strictEqual(knee.length, 1);
  const c = checkNotes(knee[0]);
  assert.deepStrictEqual(c.flags, ['pain']);
  assert.ok(c.offerEase && !c.suggestGp);
  for (const n of notes) assert.ok(!CO.BANNED.test(n), n);
  for (const n of notes.filter((x) => !/knee/i.test(x))) assert.strictEqual(checkNotes(n).flags.length, 0, n);
});
test('every scripted outcome becomes a log the real validator accepts, with weights only on loaded exercises', () => {
  const session = {
    totalMinutes: 55,
    components: [{ domain: 'strength', minutes: 30 }],
    exercises: [
      { block: 'warmup', position: 0, slug: 'cat-cow', prefill: { kind: 'reps', sets: 1, reps: null, seconds: null } },
      { block: 'main', position: 2, slug: 'goblet-squat', prefill: { kind: 'reps', sets: 3, reps: 8, seconds: null } },
      { block: 'main', position: 3, slug: 'dead-bug', prefill: { kind: 'reps', sets: 2, reps: 5, seconds: null } },
      { block: 'main', position: 4, slug: 'forearm-plank', prefill: { kind: 'hold', sets: 3, reps: null, seconds: 20 } },
    ],
  };
  for (let w = 0; w < DS.WEEKS; w += 1) {
    for (const script of DS.assignWeek([session, session, session, session], w)) {
      const v = LG.validateSessionLog(DS.bodyFor(script, session, w));
      assert.strictEqual(v.status, script.status);
      if (v.status === 'done') {
        assert.strictEqual(v.exercises.length, 3, 'only the main work is detailed');
        assert.strictEqual(v.exercises.find((e) => e.position === 2).weightKg, DS.weightFor(w), 'loaded exercises get a weight');
        assert.strictEqual(v.exercises.find((e) => e.position === 3).weightKg, null, 'bodyweight work has none');
      }
      if (v.status === 'rest' || v.status === 'skipped') assert.deepStrictEqual(v.exercises, []);
    }
  }
  assert.ok(DS.weightFor(DS.WEEKS - 1) > DS.weightFor(0), 'weights rise over the weeks');
});

console.log(`fitness logging: ${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
