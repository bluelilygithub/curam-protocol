// Ear training questions, pure code (no browser, no network). Every question is made from the chords and keys of the person's own songs.
// `rng` is Math.random by default and can be a seeded function in tests.

import { analyseChord, parseKey, estimateKey, chordName, rootSemi, NAMES } from './theory.mjs';
import { PROGRESSION_LIBRARY } from './progressions.mjs';

export const ROUND_LENGTH = 10;
export const OPTIONS = 4;

// Used to fill the choices when the person's own songs do not have enough different chords yet
const COMMON = [['C', ''], ['G', ''], ['D', ''], ['A', ''], ['E', ''], ['A', 'm'], ['E', 'm'], ['D', 'm'], ['F', '']];

const MAJOR_SCALE = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const MINOR_SCALE = ['i', 'ii°', 'III', 'iv', 'v', 'V', 'VI', 'VII'];

const q = (c) => c.quality || '';
const nameOf = (c) => { const r = rootSemi(c.root); return r === null ? null : chordName(r, q(c)); };

export function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick one item; heavier weights are likelier. */
export function pickWeighted(items, weightOf, rng = Math.random) {
  const weights = items.map(i => Math.max(0, weightOf(i)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!items.length) return null;
  if (!total) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}

/** The person's chords as { name, root, quality, count }, merged by name, most used first. */
export function vocabulary(chords) {
  const byName = new Map();
  for (const c of chords || []) {
    const name = nameOf(c);
    if (!name) continue;
    const hit = byName.get(name) || { name, root: NAMES[rootSemi(c.root)], quality: q(c), count: 0 };
    hit.count += Number(c.count) || 1;
    byName.set(name, hit);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count);
}

// Chords that sound most like the answer, so the choice is a real one: the same root with another quality, the relative major or minor,
// and the chord a fifth away
function lookalikes(answer, pool) {
  const r = rootSemi(answer.root);
  const minor = answer.quality === 'm';
  const targets = new Set([
    chordName(r, minor ? '' : 'm'),
    chordName(r + (minor ? 3 : -3), minor ? '' : 'm'),
    chordName(r + 7, answer.quality),
    chordName(r + 5, answer.quality),
  ]);
  return pool.filter(c => c.name !== answer.name && targets.has(c.name));
}

/**
 * One "name this chord" question. `chords` is the material from the server ([{ root, quality, count }]); `missed` is how often each chord
 * was got wrong this session (those come up more).
 */
export function chordQuestion({ chords, missed = {}, rng = Math.random }) {
  let pool = vocabulary(chords);
  const have = new Set(pool.map(c => c.name));
  for (const [root, quality] of COMMON) {
    const name = chordName(rootSemi(root), quality);
    if (pool.length >= 8) break;
    if (!have.has(name)) { pool.push({ name, root, quality, count: 0 }); have.add(name); }
  }
  // The answer is always one of the person's own chords; the common chords added above only fill out the choices.
  const own = pool.filter(c => c.count > 0);
  const answer = pickWeighted(own.length ? own : pool, c => (Math.sqrt(c.count) + 1) * (1 + 2 * (missed[c.name] || 0)), rng);
  const chosen = new Set([answer.name]);
  const options = [answer];
  const close = lookalikes(answer, pool);
  if (close.length) { const c = close[Math.floor(rng() * close.length)]; options.push(c); chosen.add(c.name); }
  for (const c of shuffle(pool, rng)) {
    if (options.length >= OPTIONS) break;
    if (!chosen.has(c.name)) { options.push(c); chosen.add(c.name); }
  }
  return {
    mode: 'chords', answer: answer.name, options: shuffle(options.map(o => o.name), rng),
    play: [{ root: answer.root, quality: answer.quality }],
  };
}

/** The key of a song: the detected one, or the best fit for its chords. */
function keyOfSong(song) {
  return parseKey(song.keyDetected) || estimateKey((song.chords || []).map(c => ({ root: c.root, quality: q(c) })));
}

/**
 * One "which numeral is this chord" question. The key chord (I or i) is played first, then a chord from one of the person's own songs that
 * belongs to that song's key. Only plain major and minor chords are used so no choice is given away by a "7".
 * Returns null when no song has enough chords in its key.
 */
export function numeralQuestion({ songs, missed = {}, rng = Math.random }) {
  const candidates = [];
  for (const song of songs || []) {
    const key = keyOfSong(song);
    if (!key) continue;
    const chords = [];
    for (const c of song.chords || []) {
      if (q(c) !== '' && q(c) !== 'm') continue;
      const res = analyseChord(key, c.root, q(c));
      if (res && res.kind === 'diatonic') chords.push({ ...c, numeral: res.numeral });
    }
    const distinct = new Set(chords.map(c => c.numeral));
    if (distinct.size >= 2) candidates.push({ song, key, chords });
  }
  if (!candidates.length) return null;
  const { song, key, chords } = candidates[Math.floor(rng() * candidates.length)];
  const target = pickWeighted(chords, c => (Math.sqrt(c.count || 1)) * (1 + 2 * (missed[c.numeral] || 0)), rng);
  const scale = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const own = [...new Set(chords.map(c => c.numeral))].filter(n => n !== target.numeral);
  const rest = scale.filter(n => n !== target.numeral && !own.includes(n));
  const options = [target.numeral];
  for (const n of [...shuffle(own, rng), ...shuffle(rest, rng)]) { if (options.length >= OPTIONS) break; options.push(n); }
  const tonic = { root: NAMES[key.tonic], quality: key.mode === 'minor' ? 'm' : '' };
  return {
    mode: 'numerals', answer: target.numeral, options: shuffle(options, rng),
    play: [tonic, { root: NAMES[rootSemi(target.root)], quality: q(target) }],
    keyLabel: `${NAMES[key.tonic]} ${key.mode}`, songTitle: song.title,
  };
}

/**
 * One "major or minor?" question: a plain major or minor chord from the person's songs (or a common one when their songs have none of that
 * kind). The only difference between the pair is the 3rd, so `compare` is the same root as major then minor for the "hear both" button.
 * Misses are counted against the chord (`key`), so a chord that fooled you comes up again.
 */
export function qualityQuestion({ chords, missed = {}, rng = Math.random }) {
  const wantMinor = rng() < 0.5;
  const quality = wantMinor ? 'm' : '';
  const own = vocabulary(chords).filter(c => c.quality === quality);
  const fallback = COMMON.filter(([, qual]) => qual === quality).map(([root, qual]) => ({ name: chordName(rootSemi(root), qual), root, quality: qual, count: 0 }));
  const pool = own.length ? own : fallback;
  const chord = pickWeighted(pool, c => (Math.sqrt(c.count) + 1) * (1 + 2 * (missed[c.name] || 0)), rng);
  return {
    mode: 'quality', answer: wantMinor ? 'Minor' : 'Major', options: ['Major', 'Minor'], key: chord.name, chordName: chord.name,
    play: [{ root: chord.root, quality }],
    compare: [{ root: chord.root, quality: '' }, { root: chord.root, quality: 'm' }],
  };
}

/**
 * One "which note is the bass?" question: a chord from the person's songs is played and they name its root, the lowest note. `bass` is the
 * root alone for the "hear the bass note" hint. The wrong choices are the roots of the person's other chords (common chords fill the gap).
 */
export function bassQuestion({ chords, missed = {}, rng = Math.random }) {
  const pool = vocabulary(chords);
  const have = new Set(pool.map(c => c.name));
  for (const [root, quality] of COMMON) {
    const name = chordName(rootSemi(root), quality);
    if (pool.length >= 8) break;
    if (!have.has(name)) { pool.push({ name, root, quality, count: 0 }); have.add(name); }
  }
  const own = pool.filter(c => c.count > 0);
  const answer = pickWeighted(own.length ? own : pool, c => (Math.sqrt(c.count) + 1) * (1 + 2 * (missed[c.name] || 0)), rng);
  const rootOf = (c) => NAMES[rootSemi(c.root)];
  const correct = rootOf(answer);
  const roots = [...new Set(pool.map(rootOf))].filter(r => r !== correct);
  const options = [correct, ...shuffle(roots, rng).slice(0, OPTIONS - 1)];
  return {
    mode: 'bass', answer: correct, options: shuffle(options, rng), key: answer.name, chordName: answer.name,
    play: [{ root: answer.root, quality: answer.quality }], bass: { root: correct },
  };
}

/**
 * One "which progression is this?" question: the key chord, then a well-known progression in that key (a chord every second). The key is one
 * of the person's songs' keys when they have any, otherwise a friendly one. The choices are other progressions in the same mode.
 */
export function progressionQuestion({ songs, missed = {}, rng = Math.random }) {
  const keys = (songs || []).map(keyOfSong).filter(Boolean);
  const key = keys.length ? keys[Math.floor(rng() * keys.length)] : { tonic: [0, 2, 4, 7, 9][Math.floor(rng() * 5)], mode: 'major' };
  const list = PROGRESSION_LIBRARY[key.mode === 'minor' ? 'minor' : 'major'];
  const answer = pickWeighted(list, p => 1 + 2 * (missed[p.numerals] || 0), rng);
  const others = shuffle(list.filter(p => p.numerals !== answer.numerals), rng).slice(0, OPTIONS - 1);
  const chordsOf = (p) => p.steps.map(([semi, qual]) => ({ root: NAMES[(((key.tonic + semi) % 12) + 12) % 12], quality: qual }));
  const tonic = { root: NAMES[key.tonic], quality: key.mode === 'minor' ? 'm' : '' };
  return {
    mode: 'progression', answer: answer.numerals, options: shuffle([answer, ...others].map(p => p.numerals), rng), key: answer.numerals,
    play: [tonic, ...chordsOf(answer)], step: 1.0, keyLabel: `${NAMES[key.tonic]} ${key.mode}`,
    progressionName: answer.name, chordNames: chordsOf(answer).map(c => chordName(rootSemi(c.root), c.quality)),
  };
}

/** answers: [{ answer, picked, key? }] -> what is saved at the end of a round. A miss is counted against `key` when a question has one. */
export function scoreRound(answers) {
  const misses = {};
  let correct = 0;
  for (const a of answers) {
    if (a.picked === a.answer) correct += 1;
    else { const k = a.key || a.answer; misses[k] = (misses[k] || 0) + 1; }
  }
  return { correct, total: answers.length, misses };
}

/** How many times each answer was missed so far: feeds back into the next question. */
export function missedCounts(answers) {
  return scoreRound(answers).misses;
}
