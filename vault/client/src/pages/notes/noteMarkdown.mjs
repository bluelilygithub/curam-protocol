// Pure helpers for markdown in notes. Unit-tested: node client/src/pages/notes/noteMarkdown.test.mjs
// A note is still stored as plain text; markdown is only how it is shown (Preview) and how a to-do tick is written back.

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

/**
 * Tick or untick the "- [ ]" / "- [x]" on one line (1-based, as react-markdown reports it) and return the new text.
 * Returns the text unchanged when that line is not a to-do, so a stale click can never damage a note.
 */
export function toggleTaskLine(body, line) {
  const text = String(body ?? '');
  const lines = text.split('\n');
  const i = Number(line) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= lines.length) return text;
  const m = TASK_LINE.exec(lines[i]);
  if (!m) return text;
  lines[i] = lines[i].replace(TASK_LINE, `${m[1]}[${m[2] === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

/** How many to-dos a note has: { total, done }. */
export function taskCounts(body) {
  let total = 0;
  let done = 0;
  for (const l of String(body ?? '').split('\n')) {
    const m = TASK_LINE.exec(l);
    if (m) { total++; if (m[2] !== ' ') done++; }
  }
  return { total, done };
}

/**
 * Markdown symbols removed so a list row reads as words ("# Plan" -> "Plan", "**Call** Sam" -> "Call Sam"). Display only.
 * snake_case and a lone * are left alone.
 */
export function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])([*_])(\S(?:[^*_\n]*?\S)?)\2(?=[^\w]|$)/g, '$1$3')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1');
}
