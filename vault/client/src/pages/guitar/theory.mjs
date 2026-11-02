// Guitar theory helpers, pure code (no browser, no network): key, Roman numerals, and the capo optimiser.
// Chord qualities match the chart: '' (major), m, 7, maj7, m7, dim, aug, sus2, sus4, dim7, m7b5.

export const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SEMI = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

export function rootSemi(root) {
  const s = SEMI[String(root || '').trim()];
  return s === undefined ? null : s;
}

const mod12 = (n) => ((n % 12) + 12) % 12;
export const chordName = (semi, quality = '') => NAMES[mod12(semi)] + (quality || '');

/** "C major" / "A minor" (what the audio detector writes) -> { tonic: 0-11, mode }. Null if it cannot be read. */
export function parseKey(text) {
  const m = /^\s*([A-G][#b]?)\s*(major|minor|maj|min|m)?\s*$/i.exec(String(text || ''));
  if (!m) return null;
  const tonic = rootSemi(m[1][0].toUpperCase() + m[1].slice(1));
  if (tonic === null) return null;
  const word = (m[2] || 'major').toLowerCase();
  return { tonic, mode: word === 'major' || word === 'maj' ? 'major' : 'minor' };
}

export const keyLabel = (key) => `${NAMES[key.tonic]} ${key.mode}`;

// Chord qualities that belong on each scale step, by semitones above the tonic.
const DIATONIC = {
  major: {
    0: ['', 'maj7', 'sus2', 'sus4'], 2: ['m', 'm7', 'sus2', 'sus4'], 4: ['m', 'm7', 'sus4'], 5: ['', 'maj7', 'sus2'],
    7: ['', '7', 'sus2', 'sus4'], 9: ['m', 'm7', 'sus2', 'sus4'], 11: ['dim', 'm7b5'],
  },
  // natural minor, plus the major V and V7 and the leading-tone chord of harmonic minor, which every minor song uses
  minor: {
    0: ['m', 'm7', 'sus2', 'sus4'], 2: ['dim', 'm7b5'], 3: ['', 'maj7', 'sus2'], 5: ['m', 'm7', 'sus4'],
    7: ['m', 'm7', 'sus4', '', '7'], 8: ['', 'maj7'], 10: ['', '7', 'sus2'], 11: ['dim', 'dim7'],
  },
};

// Numeral for each distance from the tonic. In a minor key the natural-minor steps (III, VI, VII) carry no flat.
const STEP = {
  major: ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'],
  minor: ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', '#VII'],
};

const MINOR_LIKE = new Set(['m', 'm7', 'dim', 'dim7', 'm7b5']);
const SUFFIX = { '': '', m: '', '7': '7', maj7: 'maj7', m7: '7', dim: '°', aug: '+', sus2: 'sus2', sus4: 'sus4', dim7: '°7', m7b5: 'ø' };

function numeralFor(interval, quality, mode) {
  const base = STEP[mode][interval];
  const m = /^([b#]?)([IV]+)$/.exec(base);
  const roman = MINOR_LIKE.has(quality) ? m[2].toLowerCase() : m[2];
  return `${m[1]}${roman}${SUFFIX[quality] ?? quality}`;
}

const isDiatonic = (table, interval, quality) => !!table[interval] && table[interval].includes(quality);

/**
 * Where does this chord sit in the key?
 * kind: 'diatonic' | 'borrowed' (from the parallel major/minor) | 'secondary' (a dominant of another chord) | 'chromatic'
 */
export function analyseChord(key, root, quality = '') {
  const r = rootSemi(root);
  if (r === null || !key) return null;
  const interval = mod12(r - key.tonic);
  const name = chordName(r, quality);
  const numeral = numeralFor(interval, quality, key.mode);

  if (isDiatonic(DIATONIC[key.mode], interval, quality)) return { numeral, kind: 'diatonic', note: null };

  const other = key.mode === 'major' ? 'minor' : 'major';
  if (isDiatonic(DIATONIC[other], interval, quality)) {
    return { numeral, kind: 'borrowed', note: `${name} is borrowed from the parallel ${other} (${NAMES[key.tonic]} ${other})` };
  }

  // A major chord or dominant 7th whose root is a fifth above a chord that belongs to the key
  if (quality === '' || quality === '7') {
    const targetInterval = mod12(interval + 5);
    const targetQualities = DIATONIC[key.mode][targetInterval];
    if (targetQualities && targetInterval !== 0) {
      const targetQuality = targetQualities[0];
      const target = numeralFor(targetInterval, targetQuality, key.mode);
      const targetName = chordName(key.tonic + targetInterval, targetQuality);
      return {
        numeral: `V${quality === '7' ? '7' : ''}/${target}`,
        kind: 'secondary',
        note: `${name} is the V of ${target}: it leads to ${targetName}`,
      };
    }
  }
  return { numeral, kind: 'chromatic', note: `${name} is outside ${keyLabel(key)}` };
}

/** Best-fitting key for a list of chords { root, quality }. Used when the audio detector gave no key. */
export function estimateKey(chords) {
  const usable = (chords || []).filter(c => rootSemi(c.root) !== null);
  if (!usable.length) return null;
  const weight = new Map();
  for (const c of usable) {
    const k = `${rootSemi(c.root)}|${c.quality || ''}`;
    weight.set(k, (weight.get(k) || 0) + 1);
  }
  const first = rootSemi(usable[0].root);
  const last = rootSemi(usable[usable.length - 1].root);
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor']) {
      let score = 0;
      for (const [k, w] of weight) {
        const [r, q] = k.split('|');
        if (isDiatonic(DIATONIC[mode], mod12(Number(r) - tonic), q)) score += w;
      }
      if (tonic === first) score += 0.5; // songs tend to start and end on the tonic
      if (tonic === last) score += 0.5;
      if (!best || score > best.score) best = { tonic, mode, score };
    }
  }
  return { tonic: best.tonic, mode: best.mode };
}

// ── Capo optimiser ───────────────────────────────────────────────────────────

// Open-position chords and how awkward they are (0 = easy). Anything not listed needs a barre.
const OPEN_COST = {
  C: 0, D: 0, E: 0, G: 0, A: 0, Am: 0, Dm: 0, Em: 0,
  A7: 0, B7: 1, C7: 1, D7: 0, E7: 0, G7: 0,
  Cmaj7: 0, Dmaj7: 0, Emaj7: 1, Fmaj7: 1, Gmaj7: 0, Amaj7: 0,
  Am7: 0, Dm7: 0, Em7: 0, Bm7: 1,
  Asus2: 0, Asus4: 0, Dsus2: 0, Dsus4: 0, Esus4: 0, Csus2: 0, Gsus4: 0,
};
const BARRE_COST = 3;

export function shapeCost(name) {
  return Object.prototype.hasOwnProperty.call(OPEN_COST, name) ? OPEN_COST[name] : BARRE_COST;
}

/**
 * Which capo position makes the song easiest? `chords` are { root, quality } as played (already transposed).
 * Each candidate capo drops every chord by that many semitones; chords that become open shapes are cheap,
 * the rest need a barre. Ties go to the lower capo. Returns the best choice and the other options, best first.
 */
export function optimiseCapo(chords, { maxCapo = 7 } = {}) {
  const counts = new Map();
  for (const c of chords || []) {
    const r = rootSemi(c.root);
    if (r === null) continue;
    const k = `${r}|${c.quality || ''}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (!counts.size) return null;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const options = [];
  for (let capo = 0; capo <= maxCapo; capo++) {
    let cost = 0;
    let barres = 0;
    const shapes = [];
    for (const [k, count] of counts) {
      const [r, q] = k.split('|');
      const shape = chordName(Number(r) - capo, q);
      const c = shapeCost(shape);
      cost += c * count;
      if (c >= BARRE_COST) barres += 1;
      shapes.push({ concert: chordName(Number(r), q), shape, count, barre: c >= BARRE_COST });
    }
    // A small nudge toward the lower capo: a capo high on the neck cramps the hand
    cost += capo * 0.01 * total;
    shapes.sort((a, b) => b.count - a.count);
    options.push({ capo, cost, barres, shapes });
  }
  options.sort((a, b) => a.cost - b.cost || a.capo - b.capo);
  const baseline = options.find(o => o.capo === 0);
  return { best: options[0], baseline, options: options.slice(0, 4) };
}

/** "Capo 3, play G shapes" for a key, or null when there is no key. */
export function capoAdvice(best, key) {
  if (!best) return null;
  if (best.capo === 0) return 'No capo needed';
  if (!key) return `Capo ${best.capo}`;
  const shapeKey = chordName(key.tonic - best.capo, key.mode === 'minor' ? 'm' : '');
  return `Capo ${best.capo}, play ${shapeKey} shapes`;
}

/**
 * Everything the Player needs about one song's theory.
 * chords: chart events { id, chordRoot, chordQuality }. transpose: semitones the chart is shifted by.
 * keyOverride: { tonic, mode } when the person picks the key; otherwise the detected key, otherwise one worked out from the chords.
 */
export function analyseSong({ keyDetected, chords, transpose = 0, keyOverride = null }) {
  const list = (chords || []).filter(c => rootSemi(c.chordRoot) !== null);
  if (!list.length) return null;
  const plain = list.map(c => ({ root: c.chordRoot, quality: c.chordQuality || '' }));

  let key = keyOverride || null;
  let keySource = key ? 'chosen' : null;
  if (!key) { key = parseKey(keyDetected); keySource = key ? 'detected' : null; }
  if (!key) { key = estimateKey(plain); keySource = key ? 'estimated' : null; }
  if (!key) return null;

  const byId = new Map();
  const flaggedMap = new Map();
  for (const c of list) {
    const res = analyseChord(key, c.chordRoot, c.chordQuality || '');
    if (!res) continue;
    byId.set(c.id, res);
    if (res.kind !== 'diatonic') {
      const label = chordName(rootSemi(c.chordRoot), c.chordQuality || '');
      const prev = flaggedMap.get(label);
      if (prev) prev.count += 1;
      else flaggedMap.set(label, { label, numeral: res.numeral, kind: res.kind, note: res.note, count: 1 });
    }
  }

  const playedKey = { tonic: mod12(key.tonic + transpose), mode: key.mode };
  const played = plain.map(c => ({ root: chordName(rootSemi(c.root) + transpose), quality: c.quality }));
  const capo = optimiseCapo(played);
  return {
    key, keySource, playedKey, byId,
    flagged: [...flaggedMap.values()].sort((a, b) => b.count - a.count),
    capo, advice: capo ? capoAdvice(capo.best, playedKey) : null,
  };
}

/** The shape name to finger for a chord at a capo fret, e.g. concert Bb at capo 3 is a G shape. */
export function shapeAtCapo(root, quality, transpose, capo) {
  const r = rootSemi(root);
  if (r === null) return null;
  return chordName(r + transpose - capo, quality || '');
}
