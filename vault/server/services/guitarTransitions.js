'use strict';

// Transition drills, pure code (no database): which chord changes the library asks for most,
// and which of them to practise next. A "pair" is two chords in either order (G <-> C): the one-minute
// drill switches back and forth, so both directions count as one.

const TARGET_PER_MIN = 30;   // clean changes in a minute at which a pair stops being pushed into Today
const MIN_OCCURRENCES = 2;   // a change heard once is noise, not something to drill
const DAY_MS = 24 * 60 * 60 * 1000;

const ROOT_ALIAS = { Db: 'C#', 'D#': 'Eb', Gb: 'F#', 'G#': 'Ab', 'A#': 'Bb' };
const CHORD_RE = /^[A-G][#b]?(m|7|maj7|m7|dim|aug|sus2|sus4|dim7|m7b5)?$/;

function chordLabel(root, quality) {
  const r = String(root || '').trim();
  return (ROOT_ALIAS[r] || r) + (quality || '');
}

const isChord = (name) => CHORD_RE.test(String(name || ''));

/** Same pair whichever way round: ['G','C'] and ['C','G'] give the same two names, in alphabetical order. */
function orderPair(x, y) {
  return x <= y ? [x, y] : [y, x];
}
const pairKey = (x, y) => orderPair(x, y).join('|');

/**
 * events: chord events with songId, in song order (timestamp, then id): { songId, chordRoot, chordQuality }.
 * Returns Map(pairKey -> { a, b, count, songs: Set }). Repeats of the same chord are not a change.
 */
function countTransitions(events) {
  const pairs = new Map();
  let prev = null;
  for (const e of events || []) {
    const name = chordLabel(e.chordRoot, e.chordQuality);
    if (!isChord(name)) { prev = null; continue; }
    if (prev && prev.songId === e.songId && prev.name !== name) {
      const [a, b] = orderPair(prev.name, name);
      const key = `${a}|${b}`;
      const hit = pairs.get(key) || { a, b, count: 0, songs: new Set() };
      hit.count += 1;
      hit.songs.add(e.songId);
      pairs.set(key, hit);
    }
    prev = { songId: e.songId, name };
  }
  return pairs;
}

const ratePerMin = (s) => (s.changes * 60) / (s.seconds || 60);

/**
 * Rank the pairs by how much they need work. Frequent changes you are slow at come first; a pair you have
 * not tried counts as a rate of zero; a pair at or above the target is left out of the queue (priority 0).
 * scores: [{ chordA, chordB, changes, seconds, playedAt }]
 */
function rankTransitions(pairs, scores, now = new Date(), { limit = 15 } = {}) {
  const byPair = new Map();
  for (const s of scores || []) {
    const key = pairKey(s.chordA, s.chordB);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(s);
  }
  const rows = [];
  for (const p of pairs.values()) {
    if (p.count < MIN_OCCURRENCES) continue;
    const list = (byPair.get(`${p.a}|${p.b}`) || []).slice().sort((x, y) => new Date(x.playedAt) - new Date(y.playedAt));
    const last = list[list.length - 1] || null;
    const lastRate = last ? Math.round(ratePerMin(last)) : null;
    const bestRate = list.length ? Math.round(Math.max(...list.map(ratePerMin))) : null;
    const idleDays = last ? Math.max(0, (now.getTime() - new Date(last.playedAt).getTime()) / DAY_MS) : null;

    const shortfall = 1 - Math.min(1, (lastRate ?? 0) / TARGET_PER_MIN);
    const recency = idleDays === null ? 1 : idleDays < 1 ? 0.2 : idleDays < 3 ? 0.6 : 1;
    const priority = Math.sqrt(p.count) * shortfall * recency;
    rows.push({
      a: p.a, b: p.b, count: p.count, songCount: p.songs.size,
      lastRate, bestRate, tries: list.length, lastPlayedAt: last ? last.playedAt : null,
      priority: Math.round(priority * 1000) / 1000,
    });
  }
  rows.sort((x, y) => y.priority - x.priority || y.count - x.count || `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`));
  return rows.slice(0, limit);
}

module.exports = { TARGET_PER_MIN, MIN_OCCURRENCES, chordLabel, isChord, pairKey, orderPair, countTransitions, rankTransitions, ratePerMin };
