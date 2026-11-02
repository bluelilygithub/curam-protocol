'use strict';

// "What can I play?" rules, pure code (no database): which songs need only the chords a player already knows, which chord to learn next,
// and the path to a song they want to play. Everything is worked out from the person's own songs.

const { chordLabel, isChord } = require('./guitarTransitions');

/** Unique chord names of a song's chart, in the order they first appear. Unreadable chords are left out. */
function songChordNames(events) {
  const seen = new Set();
  const out = [];
  for (const e of events || []) {
    const name = chordLabel(e.chordRoot, e.chordQuality);
    if (isChord(name) && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

/** Known chords as a clean Set of valid names. */
function cleanKnown(list) {
  return new Set((Array.isArray(list) ? list : []).map(String).filter(isChord));
}

/**
 * songs: [{ id, title, artist, chords: [name] }]; known: Set of chord names.
 * Each song gets `missing` (chords it uses that the person cannot play yet) and `playable` (nothing missing).
 */
function classifySongs(songs, known) {
  return songs.map(s => {
    const missing = s.chords.filter(c => !known.has(c));
    return { ...s, missing, playable: s.chords.length > 0 && missing.length === 0 };
  });
}

/**
 * Which chord to learn next. A chord "unlocks" a song when it is the only chord that song still needs. Chords that unlock songs come first,
 * most unlocked first; the rest follow by how many songs use them. Each entry lists up to five of the songs.
 */
function suggestChords(classified, { limit = 8 } = {}) {
  const stats = new Map();
  const touch = (c) => { if (!stats.has(c)) stats.set(c, { chord: c, unlocks: [], usedIn: 0, nearly: [] }); return stats.get(c); };
  for (const s of classified) {
    if (!s.chords.length || s.playable) continue;
    for (const c of s.missing) touch(c).usedIn += 1;
    if (s.missing.length === 1) touch(s.missing[0]).unlocks.push(s.title);
    else if (s.missing.length === 2) for (const c of s.missing) touch(c).nearly.push(s.title);
  }
  return [...stats.values()]
    .sort((a, b) => b.unlocks.length - a.unlocks.length || b.nearly.length - a.nearly.length || b.usedIn - a.usedIn || a.chord.localeCompare(b.chord))
    .slice(0, limit)
    .map(s => ({ chord: s.chord, unlockCount: s.unlocks.length, unlocks: s.unlocks.slice(0, 5), nearlyCount: s.nearly.length, usedIn: s.usedIn }));
}

/**
 * The path to a song the person wants to play: learn the chords it needs in the best order, and at each step the easier songs from the
 * library that become playable on the way, then the song itself. `ready` when nothing is missing.
 */
function roadmap(target, classified, known) {
  const need = target.missing.slice();
  if (!need.length) return { ready: true, title: target.title, steps: [] };
  const have = new Set(known);
  const others = classified.filter(s => s.id !== target.id && s.chords.length > 0);
  const playableNow = (set) => others.filter(s => s.chords.every(c => set.has(c)));
  let before = new Set(playableNow(have).map(s => s.id));
  const usage = (c) => others.filter(s => s.chords.includes(c)).length;
  const steps = [];
  const left = new Set(need);
  while (left.size) {
    let best = null;
    for (const c of left) {
      const next = new Set(have); next.add(c);
      const gained = playableNow(next).filter(s => !before.has(s.id));
      const score = gained.length * 100 + usage(c);
      if (!best || score > best.score || (score === best.score && c < best.chord)) best = { chord: c, gained, score };
    }
    left.delete(best.chord);
    have.add(best.chord);
    before = new Set(playableNow(have).map(s => s.id));
    steps.push({ chord: best.chord, unlocks: best.gained.slice(0, 3).map(s => s.title), unlockCount: best.gained.length });
  }
  return { ready: false, title: target.title, steps, chordCount: need.length };
}

module.exports = { songChordNames, cleanKnown, classifySongs, suggestChords, roadmap };
