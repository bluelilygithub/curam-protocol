import { fontOptions, themes } from '@vault-client/themes';

/**
 * Route Tracer wears Vault's own look: the theme (colours) and font chosen in Vault's Settings. Vault keeps them in localStorage under
 * 'vault-settings' (the zustand store in client/src/store/settingsStore.js) and ThemeProvider turns them into --color-* variables and a
 * Google Font. This app is served from Vault's origin, so it reads the same setting and does the same, using the very same theme table
 * (client/src/themes.js), so a new theme or font added there shows up here with no change. Status colours (errors, success) stay fixed, as
 * in the rest of Vault.
 */

const KEY = 'vault-settings';
const DEFAULT_THEME = 'warm-sand';
const DEFAULT_FONT = 'DM Sans';

export interface VaultLook { theme: string; font: string }

/** The saved theme and font, or Vault's defaults (also when nothing is saved, the JSON is bad, or the name is not one Vault offers). */
export function readLook(raw: string | null): VaultLook {
  let state: { theme?: unknown; font?: unknown } | undefined;
  try { state = (JSON.parse(raw ?? 'null') as { state?: { theme?: unknown; font?: unknown } } | null)?.state; } catch { state = undefined; }
  const theme = typeof state?.theme === 'string' && Object.prototype.hasOwnProperty.call(themes, state.theme) ? state.theme : DEFAULT_THEME;
  const font = typeof state?.font === 'string' && fontOptions.some((f) => f.value === state!.font) ? (state.font as string) : DEFAULT_FONT;
  return { theme, font };
}

const channel = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** Relative luminance of #rrggbb (WCAG). */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return 0.2126 * channel(parseInt(h.slice(0, 2), 16)) + 0.7152 * channel(parseInt(h.slice(2, 4), 16)) + 0.0722 * channel(parseInt(h.slice(4, 6), 16));
}
/**
 * Text colour for a button painted with `bg`. Vault's own buttons use white on the theme colour, so white it is, unless white would be hard
 * to read (under 3:1, the WCAG minimum for large and bold text) and then near-black.
 */
export function onColour(bg: string): string {
  return 1.05 / (luminance(bg) + 0.05) >= 3 ? '#ffffff' : '#1a1a1a';
}

// DM Sans (Vault's default) is linked in index.html: this app runs in a frame, and a frame does not get the fonts its parent page loaded
const loadedFonts = new Set<string>([DEFAULT_FONT]);
function loadFont(font: string): void {
  if (loadedFonts.has(font)) return;
  loadedFonts.add(font);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

/** Write the chosen theme and font onto the page. */
export function applyTheme(raw: string | null = safeGet()): VaultLook {
  const look = readLook(raw);
  const t = themes[look.theme] ?? themes[DEFAULT_THEME];
  let el = document.getElementById('route-tracer-theme');
  if (!el) { el = document.createElement('style'); el.id = 'route-tracer-theme'; document.head.appendChild(el); }
  el.textContent = `:root { --color-bg: ${t.bg}; --color-surface: ${t.surface}; --color-border: ${t.border}; --color-primary: ${t.primary}; --color-text: ${t.text}; --color-muted: ${t.muted}; --color-on-primary: ${onColour(t.primary)}; color-scheme: ${luminance(t.bg) < 0.2 ? 'dark' : 'light'}; }`;
  const f = fontOptions.find((o) => o.value === look.font);
  document.documentElement.style.setProperty('--font-sans', f ? f.style : `'${DEFAULT_FONT}', sans-serif`);
  loadFont(look.font);
  document.documentElement.dataset.theme = look.theme;
  return look;
}

function safeGet(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }

/** Apply the look now, and again whenever Vault's settings change in another tab or window. */
export function watchTheme(): void {
  applyTheme();
  window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) applyTheme(); });
}
