// Names someone already has, spotted in what they wrote ("the book called The Suitcase", "artist named Dorothy Stoner") so they can be
// offered as "Names I already have" with one click. Pure code: it suggests, it never adds anything by itself.
//
// It looks for: text in quotes, a title after "called", "titled" or "entitled", a name after "named" (which must be capitalised, so
// "named artist" is not a name), and runs of two or more capitalised words ("Dorothy Stoner").

const STOP = new Set(['and', 'which', 'that', 'who', 'whose', 'is', 'are', 'was', 'to', 'for', 'about', 'by', 'with', 'in', 'on', 'at', 'as', 'also', 'or', 'but', 'so', 'because', 'when', 'where', 'while', 'will', 'would', 'can', 'it', 'its', 'this', 'these', 'those']);
const COMMON_FIRST = new Set(['I', 'We', 'My', 'Our', 'The', 'A', 'An', 'This', 'That', 'It', 'In', 'On', 'At', 'For']);

const title = (s) => s.split(/\s+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Words up to the first stop word or punctuation. */
function phrase(raw) {
  const out = [];
  for (const w of raw.split(/\s+/)) {
    const bare = w.replace(/[.,;:!?()"“”]+$/g, '');
    const lower = bare.toLowerCase();
    if (!bare || (out.length && STOP.has(lower))) break;
    out.push(bare);
    if (/[.,;:!?)]$/.test(w)) break;
  }
  return out;
}

/**
 * @param {string} text what the person wrote about the project
 * @param {string} existing the "Names I already have" box, one per line (names already there are not suggested again)
 * @returns {string[]} up to four names, in the order they appear
 */
export function noticeOwnNames(text, existing = '') {
  const t = String(text || '');
  const have = new Set(String(existing || '').split(/[\n;,]+/).map(norm).filter(Boolean));
  const found = [];
  const add = (raw) => {
    const name = title(String(raw).replace(/\s+/g, ' ').trim());
    const n = norm(name);
    // a name inside one already found ("Staircase Suitcase" inside "The Staircase Suitcase") is the same name
    if (name.length < 3 || name.length > 60 || have.has(n) || found.some((f) => norm(f).includes(n))) return;
    found.push(name);
  };

  const hits = [];
  // text in double quotes
  for (const m of t.matchAll(/["“”]([^"“”\n]{3,60})["“”]/g)) hits.push([m.index, m[1]]);
  // a title after called / titled / entitled
  for (const m of t.matchAll(/\b(?:called|titled|entitled)\s+((?:[A-Za-z][\w'’-]*[,.;:]?\s*){1,6})/gi)) {
    const words = phrase(m[1]);
    if (words.length) hits.push([m.index, words.join(' ')]);
  }
  // a name after "named": it must be capitalised, so "named artist" is skipped
  for (const m of t.matchAll(/\bnamed\s+((?:[A-Za-z][\w'’-]*[,.;:]?\s*){1,5})/g)) {
    const words = phrase(m[1]);
    if (words.length && words.every((w) => /^[A-Z]/.test(w))) hits.push([m.index, words.join(' ')]);
  }
  // runs of two or more capitalised words
  for (const m of t.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    const words = m[1].split(/\s+/);
    const trimmed = COMMON_FIRST.has(words[0]) ? words.slice(1) : words;
    if (trimmed.length >= 2) hits.push([m.index, trimmed.join(' ')]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  for (const [, raw] of hits) add(raw);
  return found.slice(0, 4);
}
