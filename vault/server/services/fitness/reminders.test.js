'use strict';

// Stage 5: reminder timing, wording and the plan-to-Tasks rules. No database, no email. Run: node server/services/fitness/reminders.test.js
const assert = require('assert');
const R = require('./reminders');
const { buildEmail } = require('./reminderEmails');
const T = require('./fitnessTasks');
const { BANNED } = require('./coaching');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { console.error(`FAIL: ${name}\n  ${err.message}`); process.exitCode = 1; }
}

const TZ = 'Australia/Brisbane'; // UTC+10, no daylight saving
const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00+10:00`); // a local Brisbane moment
const DAY = '2026-10-14';
const ON = (extra = {}) => R.cleanSettings({ morning: { on: true, time: '07:00' }, catchup: { on: true, time: '18:00' }, rerate: { on: true }, ...extra });
const planned = (n = 1) => Array.from({ length: n }, (_, i) => ({ status: 'planned', title: `S${i}` }));
const due = (over) => R.dueReminders({ now: at(DAY, '07:05'), timeZone: TZ, settings: ON(), state: {}, sessionsToday: planned(), ratingDue: { due: false }, lastLoggedOn: '2026-10-13', ...over }).map((x) => x.kind);

// ── time zones and windows ──
test('the local clock follows the time zone, not the server', () => {
  const now = new Date('2026-10-13T21:05:00Z'); // 07:05 on the 14th in Brisbane, 21:05 on the 13th in UTC
  assert.deepStrictEqual(R.localClock(now, TZ), { date: '2026-10-14', minutes: 7 * 60 + 5 });
  assert.strictEqual(R.localClock(now, 'UTC').date, '2026-10-13');
});
test('morning goes out at the chosen time and for three hours after, never before', () => {
  assert.deepStrictEqual(due({ now: at(DAY, '06:55') }), []);
  assert.deepStrictEqual(due({ now: at(DAY, '07:00') }), ['morning']);
  assert.deepStrictEqual(due({ now: at(DAY, '09:59') }), ['morning']);
  assert.deepStrictEqual(due({ now: at(DAY, '10:00') }), [], 'a late job still sends, but not all day');
});
test('a different chosen time is honoured', () => {
  const s = ON({ morning: { on: true, time: '06:30' } });
  assert.deepStrictEqual(due({ now: at(DAY, '06:35'), settings: s }), ['morning']);
  assert.deepStrictEqual(due({ now: at(DAY, '07:05'), settings: s }), ['morning'], 'still inside the grace window');
});
test('catch-up goes out in the evening only when nothing planned for today is logged', () => {
  assert.deepStrictEqual(due({ now: at(DAY, '18:05') }), ['catchup']);
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), sessionsToday: [{ status: 'done' }] }), []);
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), sessionsToday: [{ status: 'done' }, { status: 'planned' }] }), [], 'something was logged: no nudge');
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), sessionsToday: [{ status: 'skipped' }] }), [], "a logged \"didn't do it\" is not nagged about");
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), sessionsToday: [{ status: 'moved' }, { status: 'planned' }] }), ['catchup']);
});
test('a session moved to another day does not count as today', () => {
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), sessionsToday: [] }), []);
});

// ── never on rest days, off by default, pause, once a day ──
test('nothing goes out on a rest day or a day with only rest sessions', () => {
  assert.deepStrictEqual(due({ restDayToday: true }), []);
  assert.deepStrictEqual(due({ sessionsToday: [{ status: 'rest' }] }), []);
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), restDayToday: true }), []);
});
test('everything is off until switched on', () => {
  assert.deepStrictEqual(due({ settings: R.cleanSettings({}) }), []);
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), settings: R.cleanSettings({}) }), []);
  const d = R.cleanSettings({});
  assert.strictEqual(d.morning.on, false);
  assert.strictEqual(d.catchup.on, false);
  assert.strictEqual(d.rerate.on, false);
  assert.strictEqual(d.showInTasks, true);
});
test('each email goes once a day', () => {
  assert.deepStrictEqual(due({ state: { lastSent: { morning: DAY } } }), []);
  assert.deepStrictEqual(due({ state: { lastSent: { morning: '2026-10-13' } } }), ['morning'], 'yesterday does not count');
  assert.deepStrictEqual(due({ now: at(DAY, '18:05'), state: { lastSent: { catchup: DAY } } }), []);
  const after = R.markSent({}, { kind: 'morning' }, DAY);
  assert.deepStrictEqual(due({ state: after }), []);
});
test('a pause silences everything until the day after it ends', () => {
  assert.deepStrictEqual(due({ settings: ON({ pausedUntil: DAY }) }), []);
  assert.deepStrictEqual(due({ settings: ON({ pausedUntil: '2026-10-13' }) }), ['morning']);
});
test('three weeks with nothing logged quietly stops reminders, and logging again brings them back', () => {
  assert.deepStrictEqual(due({ lastLoggedOn: '2026-09-22' }), []);
  assert.deepStrictEqual(due({ lastLoggedOn: '2026-09-24' }), ['morning']);
  assert.deepStrictEqual(due({ lastLoggedOn: null }), ['morning'], 'a new person who has not logged yet is still welcome');
});

// ── re-rate ──
test('the re-rate note goes out once per level per rating, on an otherwise quiet day', () => {
  const rd = { due: true, level: 'soft', weeks: 4, key: '2026-09-16' };
  assert.deepStrictEqual(due({ ratingDue: rd, sessionsToday: [] }), ['rerate']);
  const sent = R.markSent({}, { kind: 'rerate', rerateLevel: 'soft' }, DAY, rd.key);
  assert.deepStrictEqual(due({ ratingDue: rd, sessionsToday: [], state: sent, now: at('2026-10-15', '07:05') }), [], 'soft is not repeated');
  assert.deepStrictEqual(due({ ratingDue: { ...rd, level: 'firm', weeks: 6 }, sessionsToday: [], state: sent, now: at('2026-10-30', '07:05') }), ['rerate'], 'the firmer one follows');
  assert.deepStrictEqual(due({ ratingDue: { due: false } , sessionsToday: [] }), []);
});
test('a re-rate never lands on top of another email the same day', () => {
  const rd = { due: true, level: 'soft', weeks: 4, key: 'k' };
  assert.deepStrictEqual(due({ ratingDue: rd }), ['morning'], 'the plan comes first');
  assert.deepStrictEqual(due({ ratingDue: rd, sessionsToday: [], state: { lastSent: { catchup: DAY } } }), []);
});
test('markSent keeps only the current rating cycle', () => {
  let s = R.markSent({}, { kind: 'rerate', rerateLevel: 'soft' }, '2026-06-01', 'old');
  s = R.markSent(s, { kind: 'rerate', rerateLevel: 'soft' }, DAY, 'new');
  assert.deepStrictEqual(Object.keys(s.lastSent), ['rerate:new:soft']);
});

// ── settings are cleaned ──
test('settings accept only valid times, dates and booleans', () => {
  const s = R.cleanSettings({ morning: { on: 'yes', time: '7am' }, catchup: { on: true, time: '25:00' }, rerate: 1, pausedUntil: 'tomorrow', showInTasks: false, junk: 1 });
  assert.deepStrictEqual(s.morning, { on: false, time: '07:00' });
  assert.deepStrictEqual(s.catchup, { on: true, time: '18:00' });
  assert.strictEqual(s.rerate.on, false);
  assert.strictEqual(s.pausedUntil, null);
  assert.strictEqual(s.showInTasks, false);
  assert.ok(!('junk' in s));
  assert.strictEqual(R.cleanSettings({ morning: { on: true, time: '21:30' } }).morning.time, '21:30');
  assert.deepStrictEqual(R.cleanSettings(null), R.cleanSettings({}));
});

// ── the emails ──
const urls = { app: 'https://x.test/fitness', unsub: 'https://x.test/u?k=morning', all: 'https://x.test/u?k=all' };
const SESSIONS = [{ title: 'Strength & balance', slot: 'morning', totalMinutes: 45 }, { title: 'Easy <walk>', slot: 'evening', totalMinutes: 30 }];
const EMAILS = ['morning', 'catchup', 'rerate'].flatMap((k) => ['soft', 'firm'].map((level) => [k, buildEmail(k, { sessions: SESSIONS, weekNote: 'A steady week.', weeks: 5, level, urls })]));
test('every email has a subject, the open button and both stop links', () => {
  for (const [k, e] of EMAILS) {
    assert.ok(e.subject && e.subject.length < 80, k);
    assert.ok(e.html.includes(urls.app), `${k} opens the app`);
    assert.ok(e.html.includes(urls.unsub) && e.html.includes(urls.all), `${k} has both stop links`);
  }
});
test('no email is ever a telling-off: no guilt words, nothing about missing or skipping', () => {
  for (const [k, e] of EMAILS) {
    const text = `${e.subject} ${e.html.replace(/<[^>]+>/g, ' ')}`;
    assert.ok(!BANNED.test(text), `${k}: ${text.match(BANNED)}`);
    assert.ok(!/missed|skip|behind|failed|lazy|should have|overdue|streak/i.test(text), `${k}: ${text.match(/missed|skip|behind|failed|lazy|should have|overdue|streak/i)}`);
  }
});
test('session titles are escaped in the html', () => {
  const html = buildEmail('morning', { sessions: SESSIONS, urls }).html;
  assert.ok(html.includes('Strength &amp; balance'));
  assert.ok(html.includes('Easy &lt;walk&gt;'));
  assert.ok(!html.includes('<walk>'));
});
test('the morning subject names a single session, or counts several', () => {
  assert.strictEqual(buildEmail('morning', { sessions: [SESSIONS[0]], urls }).subject, 'Today: Strength & balance');
  assert.strictEqual(buildEmail('morning', { sessions: SESSIONS, urls }).subject, "Today's plan: 2 sessions");
});
test('the re-rate email is softer at four weeks and firmer later, and says earlier ratings are kept', () => {
  const soft = buildEmail('rerate', { weeks: 4, level: 'soft', urls });
  const firm = buildEmail('rerate', { weeks: 6, level: 'firm', urls });
  assert.ok(/Time for a quick re-rate\?/.test(soft.subject));
  assert.ok(/keeps your plan honest/.test(firm.subject));
  assert.ok(/earlier ratings are kept/.test(soft.html));
});

// ── plan to Tasks ──
test('only today and later become tasks; a past, unlogged session quietly loses its task', () => {
  assert.deepStrictEqual(T.planTask({ status: 'planned', date: '2026-10-14' }, '2026-10-14'), { action: 'keep', taskStatus: 'todo' });
  assert.deepStrictEqual(T.planTask({ status: 'moved', date: '2026-10-16' }, '2026-10-14'), { action: 'keep', taskStatus: 'todo' });
  assert.deepStrictEqual(T.planTask({ status: 'planned', date: '2026-10-13' }, '2026-10-14'), { action: 'delete' }, 'no overdue task');
});
test('done, partly done and swapped sessions complete their task, whatever day they were', () => {
  for (const status of ['done', 'partial', 'swapped']) {
    assert.deepStrictEqual(T.planTask({ status, date: '2026-10-10' }, '2026-10-14'), { action: 'keep', taskStatus: 'done' }, status);
  }
});
test('rest and "didn\'t do it" have no task', () => {
  assert.deepStrictEqual(T.planTask({ status: 'rest', date: '2026-10-15' }, '2026-10-14'), { action: 'delete' });
  assert.deepStrictEqual(T.planTask({ status: 'skipped', date: '2026-10-15' }, '2026-10-14'), { action: 'delete' });
});
test('the task text points back to Fitness and carries the session, time of day and length', () => {
  const t = T.taskText({ title: 'Strength and balance', slot: 'evening', totalMinutes: 50 });
  assert.strictEqual(t.title, 'Fitness: Strength and balance');
  assert.ok(/Evening · 50 min/.test(t.notes) && /\/fitness/.test(t.notes));
  assert.ok(!BANNED.test(t.notes) && !/overdue|missed/i.test(t.notes));
});

// ── open or closed in both places ──
const MON = '2026-10-12';
const sess = (status, date, weekStart = MON) => ({ status, date, weekStart });
test('completing a task logs its session done; a session already done is left alone', () => {
  assert.strictEqual(T.sessionAction(true, sess('planned', '2026-10-14'), '2026-10-14', MON), 'log');
  assert.strictEqual(T.sessionAction(true, sess('moved', '2026-10-13'), '2026-10-14', MON), 'log', 'a day that has passed can still be logged');
  for (const s of ['done', 'partial', 'swapped']) assert.strictEqual(T.sessionAction(true, sess(s, '2026-10-14'), '2026-10-14', MON), 'none', s);
});
test('completing a task early this week moves the session to today and logs it; next week cannot be done yet', () => {
  assert.strictEqual(T.sessionAction(true, sess('planned', '2026-10-17'), '2026-10-14', MON), 'moveToday');
  assert.strictEqual(T.sessionAction(true, sess('planned', '2026-10-20', '2026-10-19'), '2026-10-14', MON), 'revert');
});
test('reopening a task un-logs a session that was done, and does nothing to a session that was not', () => {
  for (const s of ['done', 'partial', 'swapped']) assert.strictEqual(T.sessionAction(false, sess(s, '2026-10-13'), '2026-10-14', MON), 'unlog', s);
  assert.strictEqual(T.sessionAction(false, sess('planned', '2026-10-15'), '2026-10-14', MON), 'none');
  assert.strictEqual(T.sessionAction(true, sess('rest', '2026-10-15'), '2026-10-14', MON), 'none');
});
test('the task follows the session: done closes it, an undone session reopens it, in progress is left as set', () => {
  assert.strictEqual(T.nextTaskStatus('done', 'todo'), 'done');
  assert.strictEqual(T.nextTaskStatus('done', 'in-progress'), 'done');
  assert.strictEqual(T.nextTaskStatus('todo', 'done'), 'todo');
  assert.strictEqual(T.nextTaskStatus('todo', 'in-progress'), 'in-progress');
  assert.strictEqual(T.nextTaskStatus('todo', 'todo'), 'todo');
});

console.log(`fitness reminders: ${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
