// Making HTML and CSS readable for the "HTML source" tool: pages come minified on one line, so they are laid out with indentation, numbered
// by line, and can be filtered to the lines that mention something. Pure functions, tested in server/services/restyle/restyleSource.test.js.
// Nothing here changes what the page is: it is only how the text is shown.

export const MAX_FORMAT_CHARS = 3_000_000; // past this the text is shown as it is: laying it out would freeze the page
export const MAX_SHOWN_LINES = 10000;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = /^<(script|style|pre|textarea)\b/i;
const PIECE = /<!--[\s\S]*?-->|<(script|style|pre|textarea)\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/\1\s*>|<(?:"[^"]*"|'[^']*'|[^>"'])*>|[^<]+|</gi;

/** CSS laid out one declaration per line, indented by block. Strings, url(...) and comments are left alone. */
export function formatCss(css) {
  const text = String(css || '');
  if (!text.trim() || text.length > MAX_FORMAT_CHARS) return text;
  const out = [];
  let line = '';
  let depth = 0;
  let paren = 0;
  let quote = '';
  const pad = () => '  '.repeat(Math.max(0, depth));
  const flush = () => { const t = line.trim(); if (t) out.push(`${pad()}${t}`); line = ''; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      line += c;
      if (c === '\\') { line += text[i + 1] || ''; i += 1; } else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      flush();
      out.push(`${pad()}${text.slice(i, stop).trim()}`);
      i = stop - 1;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; line += c; continue; }
    if (c === '(') paren += 1;
    if (c === ')') paren = Math.max(0, paren - 1);
    if (paren === 0 && c === '{') { line = `${line.trim()} {`; flush(); depth += 1; continue; }
    if (paren === 0 && c === '}') { flush(); depth = Math.max(0, depth - 1); out.push(`${pad()}}`); continue; }
    if (paren === 0 && c === ';') { line += ';'; flush(); continue; }
    line += c;
  }
  flush();
  return out.join('\n');
}

/** HTML laid out one tag per line, indented by nesting. Scripts, styles, <pre> and <textarea> keep their contents (style is laid out as CSS). */
export function formatHtml(html) {
  const text = String(html || '');
  if (!text.trim() || text.length > MAX_FORMAT_CHARS) return text;
  const out = [];
  let depth = 0;
  const pad = () => '  '.repeat(Math.max(0, depth));
  for (const m of text.matchAll(PIECE)) {
    const piece = m[0];
    if (piece.startsWith('<!--')) { out.push(`${pad()}${piece}`); continue; }
    const raw = RAW.exec(piece);
    if (raw && /<\/(script|style|pre|textarea)\s*>$/i.test(piece)) {
      const open = /^<[^>]*>/.exec(piece)[0];
      const close = /<\/[a-z]+\s*>$/i.exec(piece)[0];
      const inner = piece.slice(open.length, piece.length - close.length);
      if (raw[1].toLowerCase() === 'style' && inner.trim()) {
        out.push(`${pad()}${open}`);
        depth += 1;
        formatCss(inner).split('\n').forEach((l) => out.push(`${pad()}${l}`));
        depth -= 1;
        out.push(`${pad()}${close}`);
      } else if (raw[1].toLowerCase() === 'pre' || raw[1].toLowerCase() === 'textarea' || !inner.trim()) {
        out.push(`${pad()}${piece}`);
      } else {
        out.push(`${pad()}${open}`);
        inner.trim().split('\n').forEach((l) => out.push(`${pad()}  ${l.trim()}`));
        out.push(`${pad()}${close}`);
      }
      continue;
    }
    if (piece.startsWith('</')) { depth = Math.max(0, depth - 1); out.push(`${pad()}${piece}`); continue; }
    if (piece.startsWith('<') && piece.length > 1) {
      out.push(`${pad()}${piece}`);
      const name = (/^<([a-z][\w:-]*)/i.exec(piece) || [])[1];
      if (name && !VOID.has(name.toLowerCase()) && !piece.endsWith('/>') && !piece.startsWith('<!') && !piece.startsWith('<?')) depth += 1;
      continue;
    }
    const words = piece.replace(/\s+/g, ' ').trim();
    if (words) out.push(`${pad()}${words}`);
  }
  return out.join('\n');
}

/** Pictures copied into a page as data: addresses are thousands of characters long; for reading they are shortened to a note. */
export function shortenDataUris(html) {
  return String(html || '').replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]{200,}/gi, (m) => `${m.slice(0, m.indexOf(',') + 1)}…(${Math.max(1, Math.round(m.length / 1024))} KB left out)`);
}

/** The text as numbered lines. `query` keeps only the lines containing it (still numbered as in the whole text). */
export function sourceLines(text, { query = '', max = MAX_SHOWN_LINES } = {}) {
  const all = String(text || '').split('\n');
  const q = String(query || '').trim().toLowerCase();
  const rows = [];
  let matches = 0;
  for (let i = 0; i < all.length; i += 1) {
    if (q && !all[i].toLowerCase().includes(q)) continue;
    matches += 1;
    if (rows.length < max) rows.push({ number: i + 1, text: all[i] });
  }
  return { rows, total: all.length, matches, truncated: matches > rows.length };
}
