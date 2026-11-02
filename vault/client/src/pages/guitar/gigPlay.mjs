// Gig mode rules, pure code (no browser): the chart laid out for the stage, how fast it moves, and what each key does.

export const FONT_STEPS = [1.5, 2, 2.5, 3, 4, 5];
export const DEFAULT_FONT_STEP = 2;
export const BEATS_OPTIONS = [2, 4, 8];
export const MIN_BPM = 30;
export const MAX_BPM = 240;
export const DEFAULT_BPM = 100;

export const clampBpm = (bpm) => {
  const n = Math.round(Number(bpm));
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_BPM, Math.max(MIN_BPM, n)) : DEFAULT_BPM;
};

/** Milliseconds the cursor stays on each chord: `beatsPerChord` beats at `bpm`. */
export const chordMs = (bpm, beatsPerChord = 4) => Math.round((60000 / clampBpm(bpm)) * beatsPerChord);

/** Group chart events into sections and lines the way the Player draws them. Each entry keeps its index in the whole song. */
export function groupChart(events) {
  const sections = [];
  let curSec = null;
  let curLine = null;
  (events || []).forEach((ev, flatIdx) => {
    const name = (ev.sectionName && !/^capo\b/i.test(ev.sectionName)) ? ev.sectionName : null;
    const lineKey = ev.lineIdx ?? flatIdx;
    if (!curSec || curSec.name !== name) { curSec = { name, lines: [] }; sections.push(curSec); curLine = null; }
    if (!curLine || curLine.key !== lineKey) { curLine = { key: lineKey, lyric: ev.lyricText ?? null, evs: [] }; curSec.lines.push(curLine); }
    if (ev.lyricText && !curLine.lyric) curLine.lyric = ev.lyricText;
    curLine.evs.push({ ev, flatIdx });
  });
  return sections;
}

/**
 * What a key press means in gig mode. Foot pedals and Bluetooth page turners send arrow or page keys, so those are the main ones.
 * Returns an action name or null (null = leave the key alone).
 */
export function keyAction(key) {
  switch (key) {
    case ' ': case 'Spacebar': return 'toggle';
    case 'ArrowRight': case 'PageDown': case 'ArrowDown': return 'next';
    case 'ArrowLeft': case 'PageUp': case 'ArrowUp': return 'prev';
    case '+': case '=': return 'bigger';
    case '-': case '_': return 'smaller';
    case 'n': case 'N': return 'nextSong';
    case 'p': case 'P': return 'prevSong';
    case ']': return 'faster';
    case '[': return 'slower';
    default: return null;
  }
}

export const clampIndex = (i, length) => Math.max(0, Math.min(Math.max(0, length - 1), i));
