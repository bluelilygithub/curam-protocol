'use strict';

// Ear training bookkeeping, pure code (no database): what a round may record, and the summary shown on the Ear tab.

const MODES = ['chords', 'numerals'];
const CHORD_RE = /^[A-G][#b]?(m|7|maj7|m7|dim|aug|sus2|sus4|dim7|m7b5)?$/;
// A numeral as the theory module writes it: optional flat or sharp, Roman letters, then a quality mark
const NUMERAL_RE = /^[b#]?(?:[ivIV]{1,3})(?:°7?|ø|\+|maj7|sus[24]|7)?(?:\/[b#]?[ivIV]{1,3})?$/;

/** The misses a round sends, cleaned: only chord names or numerals, small whole counts, at most 30 entries. */
function cleanMisses(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, n] of Object.entries(raw).slice(0, 30)) {
    const count = Number(n);
    if (!(CHORD_RE.test(name) || NUMERAL_RE.test(name))) continue;
    if (!Number.isInteger(count) || count < 1 || count > 100) continue;
    out[name] = count;
  }
  return out;
}

/** Check a round before it is saved. Returns { ok, error?, value? }. */
function checkRound({ mode, correct, total, misses }) {
  if (!MODES.includes(mode)) return { ok: false, error: 'Mode must be chords or numerals' };
  const t = Number(total);
  const c = Number(correct);
  if (!(Number.isInteger(t) && t >= 1 && t <= 100)) return { ok: false, error: 'Total must be a whole number from 1 to 100' };
  if (!(Number.isInteger(c) && c >= 0 && c <= t)) return { ok: false, error: 'Correct must be between 0 and the total' };
  return { ok: true, value: { mode, correct: c, total: t, misses: cleanMisses(misses) } };
}

/**
 * sessions: [{ mode, correct, total, misses, playedAt }] newest first.
 * Returns the last rounds, the accuracy per mode over the recent rounds, the chords missed most, and whether accuracy is improving.
 */
function summarise(sessions, now = new Date()) {
  const recent = (sessions || []).filter(s => now.getTime() - new Date(s.playedAt).getTime() < 60 * 86400000);
  const byMode = {};
  for (const m of MODES) {
    const list = recent.filter(s => s.mode === m);
    const total = list.reduce((a, s) => a + s.total, 0);
    const correct = list.reduce((a, s) => a + s.correct, 0);
    const half = Math.floor(list.length / 2);
    const acc = (l) => { const t = l.reduce((a, s) => a + s.total, 0); return t ? l.reduce((a, s) => a + s.correct, 0) / t : null; };
    // list is newest first: the newer half against the older half
    const newer = acc(list.slice(0, half || list.length));
    const older = half ? acc(list.slice(half)) : null;
    byMode[m] = {
      rounds: list.length, total, correct,
      accuracy: total ? Math.round((correct / total) * 100) : null,
      trend: newer != null && older != null ? (newer - older > 0.05 ? 'up' : newer - older < -0.05 ? 'down' : 'steady') : null,
    };
  }
  const missTotals = new Map();
  for (const s of recent) {
    for (const [name, n] of Object.entries(s.misses || {})) missTotals.set(name, (missTotals.get(name) || 0) + Number(n || 0));
  }
  const topMisses = [...missTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, count]) => ({ name, count }));
  return { byMode, topMisses, last: (sessions || []).slice(0, 5) };
}

module.exports = { MODES, cleanMisses, checkRound, summarise };
