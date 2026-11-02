'use strict';
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const m = require('./guitarMilestones');

const base = () => ({
  practiceCount: 0, practiceMinutes: 0, firstPracticeAt: null, lastPracticeAt: null, recentAvgMinutes: null, recentLowConfidence: false,
  readySongs: 0, knownChords: [], libraryChords: [], bestDrillRate: 0, drillTries: 0, bestLoopSpeed: 0, bestEarPct: 0, rustySongs: 0, stalled: 0,
});
const now = new Date('2026-11-16T00:00:00Z');
const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();

(async () => {
  // The open-chord list matches the one the Player uses (a chord is a barre when it is not in the list)
  const theory = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages/guitar/theory.mjs')).href);
  const names = ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'F', 'Bm', 'B', 'Bb', 'F#m', 'Gm', 'Fmaj7', 'Bm7', 'B7', 'C7', 'Cmaj7', 'Asus2', 'Gsus4', 'Dsus4', 'Em7', 'Dmaj7', 'Emaj7', 'Amaj7', 'Gmaj7', 'Csus2', 'Esus4', 'Dsus2', 'Asus4', 'Dm7', 'Am7', 'A7', 'D7', 'E7', 'G7', 'Cm', 'Fm', 'Dim', 'Bdim'];
  for (const n of names) assert.strictEqual(m.isBarre(n), theory.shapeCost(n) >= 3, `${n}: the server and the Player agree on whether it is a barre`);
  for (const n of m.OPEN_CHORDS) assert.ok(theory.shapeCost(n) < 3, `${n} is open in the Player too`);

  // ── Milestones ──
  const none = m.evaluateMilestones(base());
  assert.ok(none.every(x => !x.achieved));
  assert.deepStrictEqual(none.find(x => x.key === 'five-chords').progress, { have: 0, goal: 5, unit: 'chords' });
  const f = { ...base(), practiceCount: 3, practiceMinutes: 75, knownChords: ['G', 'C', 'D', 'Em', 'Am', 'F'], readySongs: 1, drillTries: 2, bestDrillRate: 34, bestLoopSpeed: 85 };
  const got = Object.fromEntries(m.evaluateMilestones(f).map(x => [x.key, x]));
  for (const k of ['first-practice', 'first-hour', 'first-chord', 'five-chords', 'first-barre', 'first-song', 'drill-first', 'drill-30']) assert.ok(got[k].achieved, `${k} is done`);
  for (const k of ['ten-hours', 'ten-chords', 'five-songs', 'drill-60', 'loop-100', 'ear-80']) assert.ok(!got[k].achieved, `${k} is not done`);
  assert.deepStrictEqual(got['loop-100'].progress, { have: 85, goal: 100, unit: '% speed' });
  assert.deepStrictEqual(got['ten-chords'].progress, { have: 6, goal: 10, unit: 'chords' });
  assert.strictEqual(got['first-barre'].progress, null);
  // a barre chord is the barre one: only open chords means no barre milestone
  assert.ok(!m.evaluateMilestones({ ...base(), knownChords: ['G', 'C', 'D', 'Em', 'Am'] }).find(x => x.key === 'first-barre').achieved);
  // keys are unique, groups are named
  assert.strictEqual(new Set(m.MILESTONES.map(x => x.key)).size, m.MILESTONES.length);
  assert.ok(m.MILESTONES.every(x => x.group && x.title && x.text));
  // junk facts do not break it
  assert.ok(m.evaluateMilestones({ ...base(), bestDrillRate: null, bestLoopSpeed: undefined }).every(x => !x.achieved));

  // ── Tips ──
  assert.deepStrictEqual(m.selectTips(base(), new Set(), now), [], 'a brand new person gets no tips');
  const newbie = { ...base(), practiceCount: 2, practiceMinutes: 20, firstPracticeAt: ago(10), lastPracticeAt: ago(1) };
  assert.deepStrictEqual(m.selectTips(newbie, new Set(), now).map(t => t.id), ['sore-fingertips']);
  // after the first weeks, or lots of hours, fingertips are no longer mentioned
  assert.ok(!m.selectTips({ ...newbie, firstPracticeAt: ago(120) }, new Set(), now).some(t => t.id === 'sore-fingertips'));
  assert.ok(!m.selectTips({ ...newbie, practiceMinutes: 900 }, new Set(), now).some(t => t.id === 'sore-fingertips'));
  // the sore-fingertips text says sharp pain is NOT normal
  assert.match(m.TIPS.find(t => t.id === 'sore-fingertips').text, /Sharp pain.*is not normal/);

  // at most two, most pressing first
  const lots = { ...newbie, recentLowConfidence: true, libraryChords: ['G', 'F'], recentAvgMinutes: 5, rustySongs: 1, stalled: 1, drillTries: 3, bestDrillRate: 8 };
  const picked = m.selectTips(lots, new Set(), now);
  assert.deepStrictEqual(picked.map(t => t.id), ['sore-fingertips', 'buzzing']);
  assert.strictEqual(m.selectTips(lots, new Set(), now, 10).length >= 6, true);
  // put-away tips stay away
  assert.deepStrictEqual(m.selectTips(lots, new Set(['sore-fingertips', 'buzzing']), now).map(t => t.id), ['g-chord', 'barre']);
  // chord-specific tips name the chord and only appear for chords not yet ticked
  const barre = m.selectTips({ ...newbie, firstPracticeAt: ago(200), practiceMinutes: 900, libraryChords: ['G', 'Bm'], knownChords: ['G'] }, new Set(), now);
  assert.deepStrictEqual(barre.map(t => t.id), ['barre']);
  assert.match(barre[0].text, /such as Bm is famous/);
  assert.ok(!/\{/.test(barre[0].text), 'no placeholder left behind');
  assert.deepStrictEqual(m.selectTips({ ...newbie, firstPracticeAt: ago(200), practiceMinutes: 900, libraryChords: ['G', 'Bm'], knownChords: ['G', 'Bm'] }, new Set(), now), []);
  // welcome back: only after a few days, and nothing about streaks or broken runs anywhere
  const away = m.selectTips({ ...newbie, firstPracticeAt: ago(300), practiceMinutes: 900, lastPracticeAt: ago(9) }, new Set(), now);
  assert.deepStrictEqual(away.map(t => t.id), ['missed-days']);
  assert.ok(!m.selectTips({ ...newbie, lastPracticeAt: ago(2) }, new Set(), now).some(t => t.id === 'missed-days'));
  const everything = JSON.stringify([m.TIPS.map(t => [t.title, t.text, t.when]), m.MILESTONES.map(x => [x.title, x.text])]);
  assert.ok(!/streak|broke|broken|lost your|failed|fall(?:ing)? behind|you are behind|should have|only \d+ days/i.test(everything), 'nothing guilt-tripping');
  // the list of every tip
  const all = m.allTips(new Set(['rusty']));
  assert.strictEqual(all.length, m.TIPS.length);
  assert.strictEqual(all.find(t => t.id === 'rusty').dismissed, true);
  assert.ok(all.every(t => !/\{/.test(t.text)));
  assert.strictEqual(new Set(m.TIPS.map(t => t.id)).size, m.TIPS.length);

  console.log('guitarMilestones tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
