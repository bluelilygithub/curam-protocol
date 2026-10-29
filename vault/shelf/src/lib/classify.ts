// Works out what a copied piece of text is, so the shelf can show a colour swatch, a table grid, highlighted code or a link instead of a wall
// of text. Pure and deterministic: the shell does not classify anything, and a wrong guess only changes how a preview looks (the text is the same).

import { detectTable, type Delimiter } from './csv';

export type TextType = 'link' | 'table' | 'color' | 'code' | 'text';
export type CodeLanguage = 'javascript' | 'typescript' | 'python' | 'sql' | 'json' | 'css' | 'xml';

export interface Classified {
  type: TextType;
  language?: CodeLanguage;
  /** For 'color': #rrggbb or #rrggbbaa, lower case. */
  color?: string;
  /** For 'link': the address with a scheme. */
  url?: string;
  /** For 'table': the delimiter and the cells. */
  table?: { delimiter: Delimiter; rows: string[][] };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function normalizeHex(h: string): string {
  let s = h.slice(1).toLowerCase();
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  return `#${s}`;
}

function asUrl(t: string): string | null {
  if (/\s/.test(t) || t.length > 2000) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : /^www\.[^.\s]+\.[^\s]+$/i.test(t) ? `https://${t}` : null;
  if (!withScheme) return null;
  try { const u = new URL(withScheme); return u.hostname.includes('.') || u.hostname === 'localhost' ? u.toString() : null; } catch { return null; }
}

/** Looks at the text and guesses a programming language, or null. Needs real evidence: a plain sentence must never come back as code. */
export function guessLanguage(text: string): CodeLanguage | null {
  const t = text.trim();
  if (t.length < 8) return null;

  if (/^[{[]/.test(t)) { try { const v = JSON.parse(t); if (v !== null && typeof v === 'object') return 'json'; } catch { /* not JSON */ } }
  if (/^<(?:!doctype|\?xml|html|svg|[a-z][\w-]*[\s>/])/i.test(t) && />\s*$/.test(t)) return 'xml';
  if (/^\s*(?:select|insert\s+into|update|delete\s+from|create\s+(?:table|index|view)|alter\s+table|drop\s+table|with\s+\w+\s+as)\b/i.test(t)
    && /\b(?:from|into|set|values|table|where|join|as)\b/i.test(t)) return 'sql';
  if (/(?:^|\n)\s*[.#]?[\w-]+(?:[\s>+~,.#:[\]=\w-]*)\{[^{}]*:[^{}]*\}/.test(t) && !/\b(?:function|const|let|var|=>)\b/.test(t)) return 'css';

  const py = [
    /^\s*def\s+\w+\s*\(.*\)\s*(?:->\s*[\w[\], .]+)?:\s*$/m,
    /^\s*class\s+\w+(?:\(.*\))?:\s*$/m,
    /^\s*(?:from\s+[\w.]+\s+import\s+|import\s+[\w.]+(?:\s+as\s+\w+)?\s*$)/m,
    /^\s*(?:elif\b.*:|else:|try:|except\b.*:|with\b.*:|for\b.*\bin\b.*:|if\b.*:\s*$|while\b.*:\s*$)/m,
    /\bprint\(|\bself\.|__\w+__|^\s*@\w+/m,
  ].filter((r) => r.test(t)).length;
  const js = [
    /\b(?:const|let|var)\s+[\w${}[\],\s]+=/,
    /\bfunction\s*\w*\s*\(/,
    /=>/,
    /\b(?:import\s+.+\s+from\s+['"]|require\(['"]|module\.exports|export\s+(?:default|const|function|class|interface|type))/,
    /\bconsole\.\w+\(|\bawait\s+\w|\bdocument\.\w+|\bwindow\.\w+/,
    /;\s*$|\{\s*$/m,
  ].filter((r) => r.test(t)).length;
  const ts = /:\s*(?:string|number|boolean|unknown|void|any)\b|\binterface\s+\w+\s*\{|\btype\s+\w+\s*=|<[A-Z]\w*>|\bas\s+(?:const|string|number|unknown)\b/.test(t);

  if (py >= 2 || (py >= 1 && !js && t.includes('\n'))) return 'python';
  if (js >= 3 || (js >= 2 && t.includes('\n'))) return ts ? 'typescript' : 'javascript';
  return null;
}

export function classifyText(text: string, partial = false): Classified {
  const t = text.trim();
  if (!t) return { type: 'text' };
  if (HEX.test(t)) return { type: 'color', color: normalizeHex(t) };
  const url = asUrl(t);
  if (url) return { type: 'link', url };
  const lang = guessLanguage(t);
  if (lang === 'json' || lang === 'xml' || lang === 'sql') return { type: 'code', language: lang };
  const table = detectTable(text, partial);
  if (table) return { type: 'table', table };
  if (lang) return { type: 'code', language: lang };
  return { type: 'text' };
}
