// Auto-simplify, pure code (no browser, no network). Makes a song easier to play in two honest ways:
//   'exact'   the same sound: only the capo moves, to the fret that leaves the fewest barre chords;
//   'easier'  the capo, plus easier chords in place of hard ones. The sound changes a little (an F becomes an Fmaj7) and says so.
// Chords are given as { root, quality } as they SOUND (already transposed), and each gets the shape to finger.

import { NAMES, rootSemi, chordName, shapeCost } from './theory.mjs';

const BARRE = 3;           // shapeCost of a chord that needs a barre
const MIN_BEATS = 2;       // a chord shorter than this many beats is too quick to land for a beginner

// Chords with no easy twin on their own: fewer notes make them easier. Applied only when the result really is easier.
const TRIAD = { maj7: '', m7: 'm', '7': '', sus2: '', sus4: '', dim: 'm', dim7: 'm', m7b5: 'm', aug: '' };

// Hard chords that have an easy open-position cousin with the same job. Each says what changes, in words.
const SUBSTITUTES = {
  F: ['Fmaj7', 'Fmaj7 is easy to play and fits where F does, but sounds softer.'],
  Bm: ['Bm7', 'Bm7 uses open strings and sounds close to Bm.'],
  B: ['B7', 'B7 is easier than a full B barre; it adds a bluesy seventh.'],
};

const parts = (name) => { const m = /^([A-G][#b]?)(.*)$/.exec(name); return m ? { root: m[1], quality: m[2] } : null; };

/**
 * The easiest chord to finger in place of `shape` (a chord name as fingered, with any capo already taken off).
 * level 'exact' never substitutes. kind: 'same' (already easy), 'triad' (fewer notes), 'substitute' (a different easy chord), 'barre' (still a barre).
 */
export function easyShape(shape, level = 'easier') {
  const cost = shapeCost(shape);
  if (cost < BARRE) return { play: shape, kind: 'same', note: null, cost };
  if (level === 'exact') return { play: shape, kind: 'barre', note: null, cost };
  const p = parts(shape);
  if (p && Object.prototype.hasOwnProperty.call(TRIAD, p.quality)) {
    const plain = p.root + TRIAD[p.quality];
    if (shapeCost(plain) < cost) {
      return { play: plain, kind: 'triad', note: `${plain} has fewer notes than ${shape}, so the sound is plainer.`, cost: shapeCost(plain) };
    }
  }
  const sub = SUBSTITUTES[shape];
  if (sub && shapeCost(sub[0]) < cost) return { play: sub[0], kind: 'substitute', note: sub[1], cost: shapeCost(sub[0]) };
  return { play: shape, kind: 'barre', note: null, cost };
}

/**
 * Pick the capo (0 to maxCapo) that leaves the song easiest, with each chord's finger shape.
 * chords: [{ root, quality }] one per chord event, in song order (repeats count: a chord played often matters more).
 * Returns null for no usable chords.
 */
export function simplifySong(chords, { level = 'easier', maxCapo = 7 } = {}) {
  const counts = new Map();
  for (const c of chords || []) {
    const r = rootSemi(c.root);
    if (r === null) continue;
    const k = `${r}|${c.quality || ''}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (!counts.size) return null;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const build = (capo) => {
    const rows = [];
    let cost = 0;
    for (const [k, count] of counts) {
      const [r, q] = k.split('|');
      const concert = chordName(Number(r), q);
      const shape = chordName(Number(r) - capo, q);
      const e = easyShape(shape, level);
      cost += e.cost * count;
      rows.push({ concert, shape, play: e.play, kind: e.kind, note: e.note, count });
    }
    return { capo, cost: cost + capo * 0.01 * total, rows };
  };

  const options = [];
  for (let capo = 0; capo <= maxCapo; capo++) options.push(build(capo));
  options.sort((a, b) => a.cost - b.cost || a.capo - b.capo);
  const best = options[0];
  const baseline = options.find(o => o.capo === 0);
  const barres = (rows) => rows.filter(r => r.kind === 'barre').length;
  // "Before" is the song as written: no capo, nothing changed
  const asWritten = [...counts.keys()].filter((k) => { const [r, q] = k.split('|'); return shapeCost(chordName(Number(r), q)) >= BARRE; }).length;
  return {
    level, capo: best.capo, chords: best.rows.sort((a, b) => b.count - a.count),
    barresBefore: asWritten, barresAfter: barres(best.rows),
    changed: best.rows.filter(r => r.play !== r.shape).length,
    baselineBarres: barres(baseline.rows),
  };
}

/** A line such as "Capo 3, play G shapes" is built in the panel; this one says what changed in a few words. */
export function summarise(plan) {
  if (!plan) return '';
  const bits = [];
  bits.push(plan.capo === 0 ? 'No capo' : `Capo ${plan.capo}`);
  bits.push(plan.barresAfter === 0 ? 'no barre chords' : `${plan.barresAfter} barre ${plan.barresAfter === 1 ? 'chord' : 'chords'} left`);
  if (plan.barresBefore !== plan.barresAfter) bits.push(`down from ${plan.barresBefore}`);
  return bits.join(', ');
}

/**
 * Chord changes too quick for a beginner. Walks the chart in order and marks a chord to skip when it lasts less than `minBeats` beats;
 * the chord before it carries on instead. Only meaningful when the chart's times are real (a song detected from audio), so the caller decides.
 * events: [{ id, timestampSec }]  Returns a Set of the ids to skip. The first chord is never skipped.
 */
export function thinChanges(events, bpm, minBeats = MIN_BEATS) {
  const skip = new Set();
  const b = Number(bpm);
  if (!(b > 0) || !Array.isArray(events) || events.length < 3) return skip;
  const minSec = (60 / b) * minBeats;
  const list = events.slice().sort((a, c) => Number(a.timestampSec) - Number(c.timestampSec));
  let keptAt = Number(list[0].timestampSec);
  for (let i = 1; i < list.length; i++) {
    const t = Number(list[i].timestampSec);
    const next = i + 1 < list.length ? Number(list[i + 1].timestampSec) : Infinity;
    if (next - t < minSec || t - keptAt < minSec * 0.5) {
      // too short a stay: skip it unless it is the last chord of the song
      if (i + 1 < list.length) { skip.add(list[i].id); continue; }
    }
    keptAt = t;
  }
  return skip;
}

export { NAMES };
