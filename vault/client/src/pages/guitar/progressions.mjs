// Suggested progressions between two chords, pure code (no browser, no network).
//
// Given two chords, find the keys they both belong to, then list well-known progressions in those keys that contain both. Each one is a
// way to get from one chord to the other through other chords, so the person also learns the chords in between. A progression is a loop:
// the last chord goes back to the first.

import { NAMES, rootSemi, chordName, analyseChord } from './theory.mjs';

// [semitones above the key chord, quality]. Names are the ones guitarists use; numerals are shown with each suggestion.
const MAJOR = [
  { name: 'The three-chord song', numerals: 'I IV V', steps: [[0, ''], [5, ''], [7, '']] },
  { name: 'The pop progression', numerals: 'I V vi IV', steps: [[0, ''], [7, ''], [9, 'm'], [5, '']] },
  { name: 'The fifties progression', numerals: 'I vi IV V', steps: [[0, ''], [9, 'm'], [5, ''], [7, '']] },
  { name: 'Start on the minor', numerals: 'vi IV I V', steps: [[9, 'm'], [5, ''], [0, ''], [7, '']] },
  { name: 'Folk and country', numerals: 'I IV I V', steps: [[0, ''], [5, ''], [0, ''], [7, '']] },
  { name: 'Rock: one, five, four', numerals: 'I V IV', steps: [[0, ''], [7, ''], [5, '']] },
  { name: 'Two, five, one', numerals: 'ii V I', steps: [[2, 'm'], [7, ''], [0, '']] },
];
const MINOR = [
  { name: 'The minor three-chord song', numerals: 'i iv V', steps: [[0, 'm'], [5, 'm'], [7, '']] },
  { name: 'The epic minor progression', numerals: 'i VI III VII', steps: [[0, 'm'], [8, ''], [3, ''], [10, '']] },
  { name: 'Rock minor', numerals: 'i VII VI', steps: [[0, 'm'], [10, ''], [8, '']] },
  { name: 'Slow and sad', numerals: 'i VI VII', steps: [[0, 'm'], [8, ''], [10, '']] },
];

const parts = (name) => { const m = /^([A-G][#b]?)(.*)$/.exec(String(name || '')); return m ? { root: m[1], quality: m[2] } : null; };
export const canon = (name) => { const p = parts(name); const r = p && rootSemi(p.root); return r === null || r === undefined ? null : chordName(r, p.quality); };

// How central a chord is in a key: the home chord counts most, then the chords a fifth and a fourth away
const weight = (interval) => (interval === 0 ? 3 : interval === 5 || interval === 7 ? 2 : 1);

function keysFor(a, b) {
  const pa = parts(a), pb = parts(b);
  const found = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor']) {
      const key = { tonic, mode };
      const ra = analyseChord(key, pa.root, pa.quality);
      const rb = analyseChord(key, pb.root, pb.quality);
      if (!ra || !rb || ra.kind !== 'diatonic' || rb.kind !== 'diatonic') continue;
      const ia = (rootSemi(pa.root) - tonic + 12) % 12;
      const ib = (rootSemi(pb.root) - tonic + 12) % 12;
      found.push({ key, label: `${NAMES[tonic]} ${mode}`, score: weight(ia) + weight(ib) });
    }
  }
  return found.sort((x, y) => y.score - x.score || x.label.localeCompare(y.label));
}

/**
 * Progressions that go between chords `a` and `b`. `known` is a Set of chord names the person can already play, used to say which chords
 * in a suggestion are new; suggestions with fewer new chords come first. Returns { keys: [label], items: [...], reason? }.
 * Each item: { id, name, key, numerals, chords: [name] (a loop starting on a), newChords: [name], inBetween: [name] }.
 */
export function suggestProgressions(a, b, known = new Set(), { limit = 8 } = {}) {
  const ca = canon(a), cb = canon(b);
  if (!ca || !cb || ca === cb) return { keys: [], items: [], reason: 'Two different chords are needed.' };
  const knownSet = new Set([...known].map(canon).filter(Boolean));
  const keys = keysFor(ca, cb);
  if (!keys.length) {
    return { keys: [], items: [], reason: `${ca} and ${cb} do not belong to one key, so there is no ready-made progression between them. Practise the two chords on their own.` };
  }
  const best = keys[0].score;
  const usedKeys = keys.filter(k => k.score >= best - 1).slice(0, 3);
  const items = [];
  const seen = new Set();
  for (const { key, label } of usedKeys) {
    for (const p of key.mode === 'major' ? MAJOR : MINOR) {
      const chords = p.steps.map(([semi, q]) => chordName(key.tonic + semi, q));
      const distinct = [...new Set(chords)];
      if (!distinct.includes(ca) || !distinct.includes(cb)) continue;
      // Start the loop on the first chord of the pair, so "A, D, E" and "A, E, F#m, D" both begin on A
      const start = chords.indexOf(ca);
      const loop = [...chords.slice(start), ...chords.slice(0, start)];
      const sig = loop.join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      items.push({
        id: `${label}:${p.numerals}`.replace(/\s+/g, '-'), name: p.name, key: label, numerals: p.numerals, chords: loop,
        newChords: distinct.filter(c => !knownSet.has(c)),
        inBetween: distinct.filter(c => c !== ca && c !== cb),
      });
    }
  }
  items.sort((x, y) => x.newChords.length - y.newChords.length || x.chords.length - y.chords.length);
  return { keys: usedKeys.map(k => k.label), items: items.slice(0, limit) };
}

/** One line saying how the pair sits in a key, for the top of the suggestions: "In A major, A is I and E is V." */
export function explainPair(a, b) {
  const ca = canon(a), cb = canon(b);
  if (!ca || !cb) return '';
  const keys = keysFor(ca, cb);
  if (!keys.length) return '';
  const k = keys[0];
  const pa = parts(ca), pb = parts(cb);
  return `In ${k.label}, ${ca} is ${analyseChord(k.key, pa.root, pa.quality).numeral} and ${cb} is ${analyseChord(k.key, pb.root, pb.quality).numeral}.`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ago = (iso, now) => {
  if (!iso) return 'never';
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? 'today' : `${days}d ago`;
};

/**
 * The line under a pair on the Drills list, in plain words: how often the person's songs switch between the two chords (not a score),
 * and how the one-minute drills are going. r: { count, songCount, lastRate, bestRate, lastPlayedAt } from the server.
 */
export function pairSummary(r, now = Date.now()) {
  const inSongs = `Your songs switch between these two ${r.count === 1 ? 'once' : `${r.count} times`}${r.songCount === 1 ? ', all in one song' : `, across ${r.songCount} songs`}.`;
  const score = r.lastRate != null
    ? `Last one-minute drill: ${plural(r.lastRate, 'clean change', 'clean changes')} (best ${r.bestRate}), ${ago(r.lastPlayedAt, now)}.`
    : 'No one-minute score saved yet.';
  return `${inSongs} ${score}`;
}
