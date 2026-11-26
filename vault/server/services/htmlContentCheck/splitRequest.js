'use strict';

// Splits a pasted change request into request lines (R1, R2...). Plain code, no model: the person edits the result.
//   - A bullet or number ("-", "*", "•", "1.", "2)", "a)", "(iv)") starts a new line; a plain line straight after it continues it.
//   - A blank line ends a line, so paragraphs separated by blank lines are one line each (wrapped email text stays together).
//   - With no bullets and no blank lines, every line is its own request line.
// Nothing is dropped: an intro such as "Hi, please make these changes:" becomes a line the person can delete.

const BULLET = /^\s*(?:[-*•·‣▪◦–—]|\(?(?:\d{1,3}|[a-z]|[ivx]{1,5})[.)])\s+/i;
const clean = (s) => s.replace(/\s+/g, ' ').trim();

function splitRequest(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const hasBullets = lines.some((l) => BULLET.test(l));
  const hasBlank = lines.some((l, i) => !l.trim() && i > 0 && i < lines.length - 1);
  if (!hasBullets && !hasBlank) return lines.map(clean).filter(Boolean);

  const out = [];
  let open = false; // is the last line in `out` still taking continuation lines?
  for (const line of lines) {
    if (!line.trim()) { open = false; continue; }
    if (BULLET.test(line)) { out.push(clean(line.replace(BULLET, ''))); open = true; continue; }
    if (open) out[out.length - 1] = clean(`${out[out.length - 1]} ${line}`);
    else { out.push(clean(line)); open = true; }
  }
  return out.filter(Boolean);
}

module.exports = { splitRequest };
