// Finger patterns between two chords, pure code (no browser, no network).
//
// shapeFor(name) gives a standard fingering for a chord (open shape if there is one, otherwise a movable barre shape at the lowest fret).
// describeChange(from, to) compares two shapes and says, in plain words, which notes can stay where they are, which fingers move and
// where to, and which lift or land. fingering.test.mjs checks every shape against the real notes of its chord, so a wrong fret cannot
// slip in and send a learner to the wrong place.
//
// Strings are numbered 0 to 5 from the thickest (low E) to the thinnest (high E), the same order as `fretPositions`
// (-1 = not played, 0 = open, n = fret). `fingerPositions`: 0 = no finger, 1 index, 2 middle, 3 ring, 4 little.

import { rootSemi, chordName } from './theory.mjs';

export const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E'];
export const FINGER_NAMES = ['', 'index', 'middle', 'ring', 'little'];
const ORDINAL = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

const open = (frets, fingers) => ({ fretPositions: frets, fingerPositions: fingers, baseFret: 1, kind: 'open' });

// Standard open fingerings, as taught
const OPEN = {
  C: open([-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]),
  D: open([-1, -1, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]),
  E: open([0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0]),
  G: open([3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3]),
  A: open([-1, 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0]),
  Am: open([-1, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]),
  Dm: open([-1, -1, 0, 2, 3, 1], [0, 0, 0, 2, 3, 1]),
  Em: open([0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0]),
  A7: open([-1, 0, 2, 0, 2, 0], [0, 0, 2, 0, 3, 0]),
  B7: open([-1, 2, 1, 2, 0, 2], [0, 2, 1, 3, 0, 4]),
  C7: open([-1, 3, 2, 3, 1, 0], [0, 3, 2, 4, 1, 0]),
  D7: open([-1, -1, 0, 2, 1, 2], [0, 0, 0, 2, 1, 3]),
  E7: open([0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 0, 0]),
  G7: open([3, 2, 0, 0, 0, 1], [3, 2, 0, 0, 0, 1]),
  Cmaj7: open([-1, 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0]),
  Dmaj7: open([-1, -1, 0, 2, 2, 2], [0, 0, 0, 1, 1, 1]),
  Fmaj7: open([-1, -1, 3, 2, 1, 0], [0, 0, 3, 2, 1, 0]),
  Gmaj7: open([3, 2, 0, 0, 0, 2], [3, 2, 0, 0, 0, 1]),
  Amaj7: open([-1, 0, 2, 1, 2, 0], [0, 0, 2, 1, 3, 0]),
  Am7: open([-1, 0, 2, 0, 1, 0], [0, 0, 2, 0, 1, 0]),
  Dm7: open([-1, -1, 0, 2, 1, 1], [0, 0, 0, 2, 1, 1]),
  Em7: open([0, 2, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0]),
  Bm7: open([-1, 2, 0, 2, 0, 2], [0, 1, 0, 2, 0, 3]),
  Asus2: open([-1, 0, 2, 2, 0, 0], [0, 0, 1, 2, 0, 0]),
  Asus4: open([-1, 0, 2, 2, 3, 0], [0, 0, 1, 2, 4, 0]),
  Dsus2: open([-1, -1, 0, 2, 3, 0], [0, 0, 0, 1, 2, 0]),
  Dsus4: open([-1, -1, 0, 2, 3, 3], [0, 0, 0, 1, 2, 3]),
  Esus4: open([0, 2, 2, 2, 0, 0], [0, 2, 3, 4, 0, 0]),
};

// Movable barre shapes. n is the fret of the barre. `root` is the string holding the chord's root.
const E_SHAPES = {
  '': (n) => [[n, n + 2, n + 2, n + 1, n, n], [1, 3, 4, 2, 1, 1]],
  m: (n) => [[n, n + 2, n + 2, n, n, n], [1, 3, 4, 1, 1, 1]],
  '7': (n) => [[n, n + 2, n, n + 1, n, n], [1, 3, 1, 2, 1, 1]],
  m7: (n) => [[n, n + 2, n, n, n, n], [1, 3, 1, 1, 1, 1]],
};
const A_SHAPES = {
  '': (n) => [[-1, n, n + 2, n + 2, n + 2, n], [0, 1, 2, 3, 4, 1]],
  m: (n) => [[-1, n, n + 2, n + 2, n + 1, n], [0, 1, 3, 4, 2, 1]],
  '7': (n) => [[-1, n, n + 2, n, n + 2, n], [0, 1, 3, 1, 4, 1]],
  m7: (n) => [[-1, n, n + 2, n, n + 1, n], [0, 1, 3, 1, 2, 1]],
};

const parts = (name) => { const m = /^([A-G][#b]?)(.*)$/.exec(String(name || '')); return m ? { root: m[1], quality: m[2] } : null; };
export const canon = (name) => { const p = parts(name); const r = p && rootSemi(p.root); return r == null ? null : chordName(r, p.quality); };

/** A standard fingering for the chord, or null when there is none in the table. */
export function shapeFor(name) {
  const c = canon(name);
  if (!c) return null;
  if (OPEN[c]) return { name: c, ...OPEN[c] };
  const { root, quality } = parts(c);
  const r = rootSemi(root);
  const options = [];
  if (E_SHAPES[quality]) { const n = ((r - 4) + 12) % 12 || 12; const [f, g] = E_SHAPES[quality](n); options.push({ n, f, g, shape: 'E' }); }
  if (A_SHAPES[quality]) { const n = ((r - 9) + 12) % 12 || 12; const [f, g] = A_SHAPES[quality](n); options.push({ n, f, g, shape: 'A' }); }
  if (!options.length) return null;
  options.sort((x, y) => x.n - y.n || (x.shape === 'E' ? -1 : 1));
  const best = options[0];
  return { name: c, fretPositions: best.f, fingerPositions: best.g, baseFret: best.n, kind: 'barre', barreFret: best.n };
}

/** The fingers on a shape: [{ finger, fret, strings: [..] }]. A finger on several strings at one fret is a barre. */
export function placements(shape) {
  const by = new Map();
  shape.fretPositions.forEach((fret, s) => {
    const finger = shape.fingerPositions[s];
    if (fret > 0 && finger > 0) {
      if (!by.has(finger)) by.set(finger, { finger, fret, strings: [] });
      by.get(finger).strings.push(s);
    }
  });
  return [...by.values()];
}

const strName = (s) => `${STRING_NAMES[s]} string`;
const fingerName = (f) => `${FINGER_NAMES[f]} finger`;
const where = (p) => `the ${ORDINAL(p.fret)} fret of the ${p.strings.length > 1 ? 'strings' : STRING_NAMES[p.strings[0]] + ' string'}`;

/**
 * What changes going from `from` to `to`. Returns { from, to, shapeFrom, shapeTo, anchors, stays, moves, lifts, lands, summary, tip, hint }
 * or { ok: false, reason } when a chord has no fingering in the table. `anchors` are the strings where the same fret stays held, for the diagram.
 */
export function describeChange(from, to) {
  const a = shapeFor(from), b = shapeFor(to);
  if (!a || !b) {
    const missing = !a ? canon(from) || from : canon(to) || to;
    return { ok: false, from, to, reason: `There is no finger pattern for ${missing} yet.` };
  }
  const pa = placements(a), pb = placements(b);
  const stays = [], moves = [], lifts = [], lands = [];

  // Notes that stay put: the same string at the same fret in both chords
  const heldB = new Map();
  for (const p of pb) for (const s of p.strings) heldB.set(`${s}|${p.fret}`, p.finger);
  const anchors = [];
  const sameFinger = new Set();
  for (const p of pa) {
    for (const s of p.strings) {
      const key = `${s}|${p.fret}`;
      if (heldB.has(key)) {
        anchors.push(s);
        const next = heldB.get(key);
        stays.push({ string: s, fret: p.fret, finger: p.finger, nextFinger: next, same: next === p.finger });
        if (next === p.finger) sameFinger.add(p.finger);
      }
    }
  }

  // Fingers that move, lift or land (a finger that keeps every note it had is not moving)
  for (const p of pa) {
    const q = pb.find(x => x.finger === p.finger);
    const keepsAll = p.strings.every(s => heldB.get(`${s}|${p.fret}`) === p.finger);
    if (!q) {
      if (!p.strings.every(s => heldB.has(`${s}|${p.fret}`))) lifts.push({ finger: p.finger, from: p });
    } else if (!keepsAll) {
      const sameFret = q.fret === p.fret;
      const oneEach = p.strings.length === 1 && q.strings.length === 1;
      let how;
      if (p.strings.length > 1 || q.strings.length > 1) how = p.fret === q.fret ? 'shifts the barre shape' : `moves the barre from the ${ORDINAL(p.fret)} to the ${ORDINAL(q.fret)} fret`;
      else if (sameFret) how = `slides across to the ${strName(q.strings[0])}, staying on the ${ORDINAL(q.fret)} fret`;
      else if (p.strings[0] === q.strings[0]) how = `slides along the ${strName(p.strings[0])} to the ${ORDINAL(q.fret)} fret`;
      else how = `moves to the ${ORDINAL(q.fret)} fret of the ${strName(q.strings[0])}`;
      moves.push({ finger: p.finger, from: p, to: q, how, sameFret, oneEach });
    }
  }
  for (const q of pb) {
    if (!pa.some(x => x.finger === q.finger) && !q.strings.every(s => anchors.includes(s) && stays.find(t => t.string === s && t.fret === q.fret))) lands.push({ finger: q.finger, to: q });
  }

  // Words
  const lines = [];
  for (const s of stays) {
    lines.push(s.same
      ? `Keep your ${fingerName(s.finger)} where it is, on the ${ORDINAL(s.fret)} fret of the ${strName(s.string)}.`
      : `The ${ORDINAL(s.fret)} fret of the ${strName(s.string)} stays held, but by a different finger: your ${fingerName(s.finger)} now, your ${fingerName(s.nextFinger)} after.`);
  }
  for (const m of moves) lines.push(`Your ${fingerName(m.finger)} ${m.how}.`);
  for (const l of lifts) lines.push(`Lift your ${fingerName(l.finger)} off ${where(l.from)}.`);
  for (const l of lands) lines.push(`Put your ${fingerName(l.finger)} down on ${where(l.to)}.`);

  const held = stays.length;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const said = [];
  if (moves.length) said.push(`${count(moves.length, 'finger moves', 'fingers move')}`);
  if (lifts.length) said.push(`${count(lifts.length, 'finger lifts', 'fingers lift')}`);
  if (lands.length) said.push(`${count(lands.length, 'finger lands', 'fingers land')}`);
  const summary = `${held ? `${count(held, 'note stays held', 'notes stay held')}` : 'Nothing stays held'}${said.length ? `; ${said.join(', ')}` : ''}.`;

  let tip;
  const pivot = moves.find(m => m.oneEach && m.sameFret);
  if (sameFinger.size > 0) {
    const f = [...sameFinger][0];
    const st = stays.find(x => x.finger === f);
    tip = `Leave your ${fingerName(f)} down on the ${strName(st.string)} and move the other fingers around it. It acts as an anchor.`;
  } else if (pivot) {
    tip = `Slide your ${fingerName(pivot.finger)} across to the ${strName(pivot.to.strings[0])} without lifting it far, since it stays on the same fret.`;
  } else if (a.kind === 'barre' || b.kind === 'barre') {
    tip = 'Treat the barre as one move: lift it and land it together, then add the other fingers.';
  } else if (moves.length + lands.length >= 3) {
    tip = 'No finger can stay put, so practise landing all of them at once as one shape. Look at the next chord, not at your hand.';
  } else {
    tip = 'Move the fingers together, in one motion, and keep them close to the strings.';
  }
  const hint = sameFinger.size > 0
    ? `Keep your ${fingerName([...sameFinger][0])} down.`
    : pivot ? `Slide your ${fingerName(pivot.finger)} across.`
      : moves.length + lands.length + lifts.length ? 'No finger stays: land them all together.' : 'Same shape.';

  return { ok: true, from: a.name, to: b.name, shapeFrom: a, shapeTo: b, anchors: [...new Set(anchors)], stays, moves, lifts, lands, lines, summary, tip, hint };
}

/** One description for each change round a loop of chords, including the last back to the first. */
export function changesFor(sequence) {
  const out = [];
  for (let i = 0; i < sequence.length; i++) out.push(describeChange(sequence[i], sequence[(i + 1) % sequence.length]));
  return out;
}
