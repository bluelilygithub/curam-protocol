// Strumming patterns and the pattern ladder, pure code (no browser, no network).
//
// A bar of 4/4 is eight slots, one per eighth note, counted "1 & 2 & 3 & 4 &". The strumming arm never stops: it goes DOWN on every beat
// (slots 0, 2, 4, 6) and UP between them (slots 1, 3, 5, 7). A pattern is only which of those swings actually hit the strings; the others
// are "air" swings (the arm moves, the pick misses). That is how teachers explain strumming, and it is what the arrows show.

export const SLOTS = 8;
export const COUNT_LABELS = ['1', '&', '2', '&', '3', '&', '4', '&'];
export const isDownSlot = (i) => i % 2 === 0;

// 'D' = a down strum that hits, 'U' = an up strum that hits, '-' = an air swing. The character must match the slot: D on 0,2,4,6 and U on 1,3,5,7 (or '-').
export const PATTERNS = [
  { id: 'downs', name: 'Down on every beat', pattern: 'D-D-D-D-', tip: 'The first one to learn: a down strum on each beat of the bar.' },
  { id: 'eighths', name: 'Down up, down up', pattern: 'DUDUDUDU', tip: 'Steady down-up on every count. Common in fast folk and punk.' },
  { id: 'old-faithful', name: 'The old faithful', pattern: 'D-DU-UDU', tip: 'Down, down up, up down up. Fits a huge number of songs.' },
  { id: 'pop', name: 'Pop strum', pattern: 'D-DUDUDU', tip: 'Down, then down up all the way. A bright, driving strum.' },
  { id: 'ballad', name: 'Gentle ballad', pattern: 'D---DUDU', tip: 'One long down strum, then a lift. Slow and open.' },
];

/** Check a pattern string: eight characters, D only on beats, U only between them. */
export function validPattern(p) {
  if (typeof p !== 'string' || p.length !== SLOTS) return false;
  for (let i = 0; i < SLOTS; i++) {
    const c = p[i];
    if (c === '-') continue;
    if (c === 'D' && isDownSlot(i)) continue;
    if (c === 'U' && !isDownSlot(i)) continue;
    return false;
  }
  return true;
}

/** The eight swings of a pattern: { slot, dir: 'down'|'up', hit: boolean, label } */
export function swings(pattern) {
  return Array.from({ length: SLOTS }, (_, i) => ({
    slot: i, dir: isDownSlot(i) ? 'down' : 'up', hit: pattern[i] !== '-', label: COUNT_LABELS[i],
  }));
}

const BEATS_ONLY = 'D-D-D-D-';

/**
 * The ladder from "down on every beat" to the target pattern. The arm keeps swinging the whole time; each step lets one more up strum hit,
 * and the last step also lets go of any beat the pattern misses. Returns [{ pattern, text }] with at least one step.
 */
export function ladder(target) {
  if (!validPattern(target)) return [{ pattern: BEATS_ONLY, text: 'Down on every beat.' }];
  const steps = [{ pattern: BEATS_ONLY, text: 'Down on every beat. Keep your arm swinging up between the beats, but miss the strings on the way up.' }];
  let current = BEATS_ONLY.split('');
  for (let i = 1; i < SLOTS; i += 2) {
    if (target[i] === 'U') {
      current[i] = 'U';
      steps.push({ pattern: current.join(''), text: `Add the up strum on the "${COUNT_LABELS[i]}" after ${COUNT_LABELS[i - 1]}.` });
    }
  }
  if (current.join('') !== target) {
    const missed = [];
    for (let i = 0; i < SLOTS; i += 2) if (target[i] === '-') missed.push(COUNT_LABELS[i]);
    steps.push({ pattern: target, text: `Now miss the strings on beat ${missed.join(' and ')}: the arm still swings, nothing sounds.` });
  }
  return steps;
}

/** Milliseconds between swings (eighth notes) at a tempo in beats a minute. */
export const slotMs = (bpm) => Math.round(30000 / Math.min(240, Math.max(30, Number(bpm) || 70)));

/** The time of each upcoming swing, from `start` (seconds), so a clock can schedule clicks ahead. */
export function slotTimes(start, bpm, count, firstSlot = 0) {
  const step = slotMs(bpm) / 1000;
  return Array.from({ length: count }, (_, k) => ({ time: start + k * step, slot: (firstSlot + k) % SLOTS }));
}

/** Which slot is sounding at `now`, given the time slot 0 of bar 0 started. Also the bar number counted from 0. */
export function slotAt(now, startTime, bpm) {
  const step = slotMs(bpm) / 1000;
  const n = Math.floor((now - startTime) / step);
  if (n < 0) return { slot: -1, bar: -1 };
  return { slot: n % SLOTS, bar: Math.floor(n / SLOTS) };
}

/** Plain words for a pattern: "Down, down up, up down up". */
export function describe(pattern) {
  if (!validPattern(pattern)) return '';
  const words = [];
  for (let i = 0; i < SLOTS; i += 2) {
    const down = pattern[i] === 'D';
    const up = pattern[i + 1] === 'U';
    if (down && up) words.push('down up');
    else if (down) words.push('down');
    else if (up) words.push('up');
    else words.push('miss');
  }
  return words.join(', ');
}
