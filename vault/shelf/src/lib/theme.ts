// The shelf wears Vault's own look: the same six colour tokens, the same five themes, the same font choices (client/src/themes.js is the single table), written
// as the same CSS variables (--color-bg, --color-surface, --color-border, --color-primary, --color-text, --color-muted) and --font-sans that Vault's ThemeProvider
// writes. Status colours (error, success) stay fixed, as in Vault. Unlike Vault the shelf does NOT follow the operating system's dark mode: a theme is a choice.
//
// Vault keeps the chosen theme only in each browser's localStorage, which a separate Windows window cannot read, so the shelf has its own Appearance setting
// (saved by the shell) with Warm Sand and DM Sans as the defaults, exactly like a new Vault.

import { fontOptions, themes } from '@vault-client/themes';

export const DEFAULT_THEME = 'warm-sand';
export const DEFAULT_FONT = 'DM Sans';
export const THEME_LIST = Object.entries(themes).map(([id, t]) => ({ id, ...t }));
export const FONT_LIST = fontOptions;

export interface Look { theme: string; font: string }

/** Known names only; anything else (a typo, a theme removed from Vault) becomes the default instead of breaking the page. */
export function resolveLook(theme?: unknown, font?: unknown): Look {
  return {
    theme: typeof theme === 'string' && Object.prototype.hasOwnProperty.call(themes, theme) ? theme : DEFAULT_THEME,
    font: typeof font === 'string' && fontOptions.some((f) => f.value === font) ? font : DEFAULT_FONT,
  };
}

/** The look the shell asked for in the page address (?theme=...&font=...), so the first paint is already right. */
export function lookFromSearch(search: string): Look {
  const q = new URLSearchParams(search);
  return resolveLook(q.get('theme'), q.get('font'));
}

const channel = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const parts = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };

/** Relative luminance of #rrggbb (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = parts(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** "204 120 92": the form Tailwind needs to add opacity (bg-shelf-accent/70). */
export const rgbTriplet = (hex: string): string => parts(hex).join(' ');

/** Text colour on a button painted with `bg`: Vault's buttons use white, unless white would be hard to read (under 3:1), then near-black. */
export function onColour(bg: string): string { return 1.05 / (luminance(bg) + 0.05) >= 3 ? '#ffffff' : '#1a1a1a'; }

export const isDark = (look: Look): boolean => luminance((themes[look.theme] ?? themes[DEFAULT_THEME]!).bg) < 0.2;

/** The CSS for a look. Pure, so it can be tested without a page. */
export function lookCss(look: Look): string {
  const t = themes[look.theme] ?? themes[DEFAULT_THEME]!;
  const on = onColour(t.primary);
  const tokens: [string, string][] = [['bg', t.bg], ['surface', t.surface], ['border', t.border], ['primary', t.primary], ['text', t.text], ['muted', t.muted], ['on-primary', on]];
  const vars = tokens.map(([n, hex]) => `--color-${n}: ${hex}; --color-${n}-rgb: ${rgbTriplet(hex)};`).join(' ');
  return `:root { ${vars} color-scheme: ${isDark(look) ? 'dark' : 'light'}; }`;
}

export function applyLook(look: Look, doc: Document = document): void {
  let el = doc.getElementById('shelf-theme-vars');
  if (!el) { el = doc.createElement('style'); el.id = 'shelf-theme-vars'; doc.head.appendChild(el); }
  el.textContent = lookCss(look);
  const f = fontOptions.find((o) => o.value === look.font);
  doc.documentElement.style.setProperty('--font-sans', f ? f.style : `'${DEFAULT_FONT}', sans-serif`);
  doc.documentElement.dataset.scheme = isDark(look) ? 'dark' : 'light';
}
