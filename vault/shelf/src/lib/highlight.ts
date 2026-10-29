// Syntax colouring for code clips, using only the core of highlight.js plus the seven languages the shelf can recognise (the full library
// would add about a megabyte to a page that is created and destroyed every time the tray opens).

import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import type { CodeLanguage } from './classify';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);

export const MAX_HIGHLIGHT_CHARS = 20000;

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** HTML for the code with coloured spans. highlight.js escapes the text itself; very long clips are shown plain to keep the tray quick. */
export function highlightCode(code: string, language: CodeLanguage | undefined): string {
  if (!language || code.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(code);
  try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; } catch { return escapeHtml(code); }
}
