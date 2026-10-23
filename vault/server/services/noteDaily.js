'use strict';

// The daily note: one note per calendar day, made on demand. Pure helpers (no database) so they are unit-tested:
// node server/services/noteDaily.test.js

const MAX_CARRIED = 50;

/** 'YYYY-MM-DD' only when it is a real calendar day, else null. */
function validDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : null;
}

const OPEN_TODO = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(\S.*)$/;

/**
 * The to-dos still open in a note's text: every "- [ ] something" line (nested ones too), written back as plain "- [ ] something",
 * repeats dropped, empty boxes ("- [ ] " with nothing after) ignored, at most 50.
 */
function extractOpenTodos(body) {
  const out = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = OPEN_TODO.exec(line);
    if (!m) continue;
    const text = `- [ ] ${m[1].trim()}`;
    if (!out.includes(text)) out.push(text);
    if (out.length >= MAX_CARRIED) break;
  }
  return out;
}

/** The new day's text: the template, then the unfinished to-dos from the last daily note under a "Carried over" heading. */
function composeDailyBody(templateBody, carried, previousDay) {
  const base = String(templateBody ?? '').replace(/\s+$/, '');
  if (!carried || !carried.length) return base;
  const heading = previousDay ? `Carried over from ${previousDay}:` : 'Carried over:';
  return `${base}${base ? '\n\n' : ''}${heading}\n${carried.join('\n')}\n`;
}

module.exports = { MAX_CARRIED, validDay, extractOpenTodos, composeDailyBody };
