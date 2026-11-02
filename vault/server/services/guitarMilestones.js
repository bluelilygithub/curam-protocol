'use strict';

// Milestones and "is this normal?" tips, pure code (no database). Milestones are worked out from what the person has actually done, never
// ticked by hand. Tips are reassurance shown only when it fits what their practice looks like, and each can be put away for good.
// No streaks, no guilt: nothing here counts days in a row or says anything was "broken".

const DAY_MS = 24 * 60 * 60 * 1000;

// Chords that sit in an open position and need no barre. MUST match OPEN_COST in client/src/pages/guitar/theory.mjs (a test checks it).
const OPEN_CHORDS = [
  'C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'A7', 'B7', 'C7', 'D7', 'E7', 'G7',
  'Cmaj7', 'Dmaj7', 'Emaj7', 'Fmaj7', 'Gmaj7', 'Amaj7', 'Am7', 'Dm7', 'Em7', 'Bm7',
  'Asus2', 'Asus4', 'Dsus2', 'Dsus4', 'Esus4', 'Csus2', 'Gsus4',
];
const isBarre = (name) => !OPEN_CHORDS.includes(name);

// ── Milestones ───────────────────────────────────────────────────────────────
// need: how to tell the person how close they are. have(facts) is the number, goal the target.
const MILESTONES = [
  { key: 'first-practice', group: 'Getting started', title: 'Your first practice', text: 'You logged your first practice. Everything else starts here.', have: f => f.practiceCount, goal: 1, unit: 'practice' },
  { key: 'first-hour', group: 'Getting started', title: 'One hour played', text: 'An hour of practice logged. Small sessions add up.', have: f => f.practiceMinutes, goal: 60, unit: 'minutes' },
  { key: 'ten-hours', group: 'Getting started', title: 'Ten hours played', text: 'Ten hours logged. Your hands know things they did not.', have: f => f.practiceMinutes, goal: 600, unit: 'minutes' },
  { key: 'first-chord', group: 'Chords', title: 'Your first chord', text: 'You can play a chord cleanly.', have: f => f.knownChords.length, goal: 1, unit: 'chord' },
  { key: 'five-chords', group: 'Chords', title: 'Five chords', text: 'Five chords you can play cleanly. That is a lot of songs.', have: f => f.knownChords.length, goal: 5, unit: 'chords' },
  { key: 'ten-chords', group: 'Chords', title: 'Ten chords', text: 'Ten chords you can play cleanly.', have: f => f.knownChords.length, goal: 10, unit: 'chords' },
  { key: 'first-barre', group: 'Chords', title: 'Your first barre chord', text: 'A barre chord you can play cleanly. This is the one most players find hardest.', have: f => f.knownChords.filter(isBarre).length, goal: 1, unit: 'barre chord' },
  { key: 'first-song', group: 'Songs', title: 'Your first full song', text: 'You marked a song as Ready: you can play it through.', have: f => f.readySongs, goal: 1, unit: 'song' },
  { key: 'five-songs', group: 'Songs', title: 'Five songs ready', text: 'Five songs you can play through.', have: f => f.readySongs, goal: 5, unit: 'songs' },
  { key: 'drill-first', group: 'Changes and speed', title: 'Your first chord change drill', text: 'You timed a minute of chord changes.', have: f => f.drillTries, goal: 1, unit: 'drill' },
  { key: 'drill-30', group: 'Changes and speed', title: '30 clean changes a minute', text: 'Thirty clean chord changes in a minute. That is a comfortable change for most songs.', have: f => f.bestDrillRate, goal: 30, unit: 'changes a minute' },
  { key: 'drill-60', group: 'Changes and speed', title: 'A change on every beat at 60 bpm', text: 'Sixty clean changes in a minute: a new chord on every beat at 60 beats a minute.', have: f => f.bestDrillRate, goal: 60, unit: 'changes a minute' },
  { key: 'loop-100', group: 'Changes and speed', title: 'A loop at full speed', text: 'You played a loop cleanly at the real tempo of the song.', have: f => f.bestLoopSpeed, goal: 100, unit: '% speed' },
  { key: 'ear-80', group: 'Ear', title: 'A sharp ear', text: 'You scored 80% or better in a round of ear training.', have: f => f.bestEarPct, goal: 80, unit: '%' },
];

/** Every milestone with whether it is done and how close the person is. facts: see guitarData.loadMilestoneFacts. */
function evaluateMilestones(facts) {
  return MILESTONES.map(m => {
    const have = Math.max(0, Number(m.have(facts)) || 0);
    const achieved = have >= m.goal;
    return {
      key: m.key, group: m.group, title: m.title, text: m.text, achieved,
      progress: achieved ? null : { have: Math.round(have), goal: m.goal, unit: m.unit },
    };
  });
}

// ── "Is this normal?" tips ───────────────────────────────────────────────────
// show(facts, now) says when it fits (priority: lower comes first). `when` is the plain-words reason shown with it.
const TIPS = [
  {
    id: 'sore-fingertips', priority: 1, title: 'Sore fingertips',
    text: 'Sore fingertips are normal in the first weeks. The skin hardens into calluses over about four to six weeks of short, regular practice, and short sessions help more than one long one. Sharp pain, or an ache in your wrist, hand or forearm, is not normal: stop, rest, check how you are sitting, and ask a teacher if it comes back.',
    when: 'in your first weeks of playing',
    show: (f, now) => f.practiceCount >= 1 && f.practiceMinutes < 600 && f.firstPracticeAt && (now - new Date(f.firstPracticeAt).getTime()) < 60 * DAY_MS,
  },
  {
    id: 'buzzing', priority: 2, title: 'Buzzing strings',
    text: 'Buzzing is normal at the start. Usually a finger is touching the next string, or it is a little too far from the fret. Press close behind the fret wire with the tip of your finger, keep your fingers curved, and play the chord one string at a time to find the buzz. It gets better with practice, not with pressing harder.',
    when: 'you rated a recent practice as not very clean',
    show: f => f.recentLowConfidence,
  },
  {
    id: 'g-chord', priority: 3, title: 'The G chord feels like a stretch',
    text: 'Almost everyone finds the G chord a stretch at first. Move your elbow in a little, let your thumb rest behind the neck, and try the shape with your ring finger on the thick string (some teachers start with that one). If it still feels impossible after a few weeks, that is normal too. Learn the chords you can play first and come back to it.',
    when: 'G is in your songs and you have not ticked it yet',
    show: f => f.practiceCount >= 1 && f.libraryChords.includes('G') && !f.knownChords.includes('G'),
  },
  {
    id: 'barre', priority: 3, title: 'Barre chords feel impossible',
    text: 'A barre chord such as {chord} is famous for being the hardest early chord. Most players need months before it rings clearly, so struggling is normal. Try Easier chords in the Player to use a simpler version for now, and practise the barre for just a minute at a time.',
    when: 'a barre chord is in your songs and you have not ticked it yet',
    show: f => f.practiceCount >= 1 && f.libraryChords.some(c => isBarre(c) && !f.knownChords.includes(c)),
    fill: f => ({ chord: f.libraryChords.find(c => isBarre(c) && !f.knownChords.includes(c)) }),
  },
  {
    id: 'slow-changes', priority: 4, title: 'Changing chords slowly',
    text: 'Slow chord changes are normal. Most players start at ten to twenty clean changes a minute. Speed comes from slow, accurate changes, not from rushing. Try looking at where your fingers go next while you are still playing the current chord.',
    when: 'your chord change drills are still slow',
    show: f => f.drillTries >= 2 && f.bestDrillRate < 15,
  },
  {
    id: 'stalled', priority: 4, title: 'Stuck on the same score',
    text: 'Plateaus are normal. Progress comes in steps, with a flat patch while your hands catch up. Slow the tempo down for a few days, or practise the change away from the song for a minute a day. It almost always breaks through.',
    when: 'a chord change has stopped improving',
    show: f => f.stalled >= 1,
  },
  {
    id: 'short-sessions', priority: 5, title: 'Short sessions are fine',
    text: 'Ten to fifteen minutes most days beats an hour once a week, because your fingers and memory learn in between. You do not need to play for longer to be doing it right.',
    when: 'your recent sessions are short',
    show: f => f.recentAvgMinutes != null && f.recentAvgMinutes < 10,
  },
  {
    id: 'rusty', priority: 5, title: 'Songs go rusty',
    text: 'Songs fading when you stop playing them is normal, and they come back quickly. A single play-through is usually enough to bring one back.',
    when: 'a song has gone rusty',
    show: f => f.rustySongs >= 1,
  },
  {
    id: 'missed-days', priority: 6, title: 'Welcome back',
    text: 'A few days off is normal and your hands remember more than you think. Start with an easy song at a slow tempo and carry on from there.',
    when: 'it has been a few days since you last played',
    show: (f, now) => f.practiceCount >= 1 && f.lastPracticeAt && (now - new Date(f.lastPracticeAt).getTime()) >= 4 * DAY_MS,
  },
];

const fillText = (tip, facts) => {
  const vals = tip.fill ? tip.fill(facts) : {};
  return tip.text.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? '');
};

/**
 * The tips that fit right now, at most `limit`, skipping any the person has put away. Gentle on purpose: a missing-days note shows only when
 * nothing else needs saying.
 */
function selectTips(facts, dismissed = new Set(), now = new Date(), limit = 2) {
  const t = now.getTime();
  return TIPS
    .filter(tip => !dismissed.has(tip.id) && tip.show(facts, t))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit)
    .map(tip => ({ id: tip.id, title: tip.title, text: fillText(tip, facts), when: tip.when }));
}

/** Every tip, for the "all tips" list: put-away ones are marked so they can be brought back. */
function allTips(dismissed = new Set()) {
  return TIPS.map(tip => ({ id: tip.id, title: tip.title, text: tip.text.replace(/\{chord\}/g, 'F'), when: tip.when, dismissed: dismissed.has(tip.id) }));
}

module.exports = { OPEN_CHORDS, isBarre, MILESTONES, evaluateMilestones, TIPS, selectTips, allTips };
