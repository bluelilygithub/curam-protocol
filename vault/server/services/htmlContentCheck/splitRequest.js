'use strict';

// Splits a pasted change request into request lines (R1, R2...). Plain code, no model: the person reviews the result. Each line is
//   { lineText, kind: 'request_line' | 'held_over' | 'keep', section: 'The Artist' | 'Plates and Passages › Portrait of …' | null }
//
// Lines
//   - A bullet or number ("-", "*", "•", "1.", "2)", "a)", "(iv)") starts a line; with bullets, a plain line straight after one continues it.
//   - Without bullets every line is its own request line, except a line starting with a small letter, which continues the one before
//     (wrapped email text). A blank line always ends a line.
//   - Nothing is dropped: an intro such as "Hi, please make these changes:" becomes a line the person can delete.
// Labels, not lines
//   - "Under The Artist." (Under + up to 8 words, no comma or quote) labels the lines beneath it until the next "Under …". The page uses
//     the label to put a line on the job's page of that name.
//   - Inside an "Under …" section, a short line starting fresh (after the heading or a blank line; 6 words or fewer, no quotes, no full stop or colon at the end, not an
//     instruction) straight before an instruction ("Keep:",
//     "Insert:", "Remove …", "Change to …") is a sub-label ("Portrait of Dorothy Stoner"), until the next blank line.
// Kinds
//   - "Keep: …" is a Keep line (the text must stay as it is; the "Keep:" is taken off).
//   - A line that says "hold over" / "held over" is Held over (shown, never checked).
// findDuplicates() flags lines that look like repeats of an earlier one (to merge on review).

const BULLET = /^\s*(?:[-*•·‣▪◦–—]|\(?(?:\d{1,3}|[a-z]|[ivx]{1,5})[.)])\s+/i;
const UNDER = /^\s*under\s+(.+?)\s*[.:]?\s*$/i;
const KEEP = /^\s*keep\s*:\s*/i;
const HELD = /\bh(?:o|e)ld[\s-]*over\b/i;
const LABELLED = /^\s*(keep|insert|add|remove|delete|change(\s+to)?|replace|update)\s*:/i; // "Keep: …", "Insert: …": always a line of its own
const ACTION = /^\s*(keep|insert|add|remove|delete|change|replace|update|fix|move|swap|rename|put|use|show)\b/i;
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const words = (s) => (s.match(/\S+/g) || []).length;

function underLabel(line) {
  const m = UNDER.exec(line);
  if (!m || words(m[1]) > 8 || /[,"“”]/.test(m[1])) return null;
  return clean(m[1]);
}
function isSubLabel(line, next) {
  const t = clean(line);
  return Boolean(next) && words(t) <= 6 && !/[.:;!?]$/.test(t) && !/["“”']/.test(t) && !ACTION.test(t) && !underLabel(t) && ACTION.test(next.replace(BULLET, ''));
}

function splitRequest(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const hasBullets = lines.some((l) => BULLET.test(l) && !underLabel(l));
  const nextNonBlank = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j]; return null; };
  const out = [];
  let open = false; // is the last line still taking continuation lines?
  let section = null;
  let sub = null;
  const where = () => (sub ? (section ? `${section} › ${sub}` : sub) : section);
  lines.forEach((line, i) => {
    if (!line.trim()) { open = false; sub = null; return; }
    const label = underLabel(line);
    if (label) { section = label; sub = null; open = false; return; }
    if (section && !open && !BULLET.test(line) && isSubLabel(line, nextNonBlank(i))) { sub = clean(line); open = false; return; }
    if (BULLET.test(line) || LABELLED.test(line)) { out.push({ text: clean(line.replace(BULLET, '')), section: where() }); open = true; return; }
    const wrapped = !hasBullets && /^\s*[a-z]/.test(line);
    if (open && (hasBullets || wrapped)) { out[out.length - 1].text = clean(`${out[out.length - 1].text} ${line}`); return; }
    out.push({ text: clean(line), section: where() });
    open = true;
  });
  return out.filter((l) => l.text).map(({ text, section: s }) => {
    if (KEEP.test(text)) return { lineText: text.replace(KEEP, '').trim() || text, kind: 'keep', section: s };
    return { lineText: text, kind: HELD.test(text) ? 'held_over' : 'request_line', section: s };
  });
}

/** Lines that look like a repeat of an earlier line: most of the shorter one's words are in the other. Returns { index: earlierIndex }. */
function findDuplicates(texts) {
  const sets = texts.map((t) => new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)));
  const out = {};
  for (let j = 1; j < sets.length; j++) {
    for (let i = 0; i < j; i++) {
      const [a, b] = [sets[i], sets[j]];
      const small = Math.min(a.size, b.size);
      if (small < 4) continue;
      let common = 0;
      for (const w of b) if (a.has(w)) common++;
      if (common / small >= 0.8) { out[j] = i; break; }
    }
  }
  return out;
}

module.exports = { splitRequest, findDuplicates };
