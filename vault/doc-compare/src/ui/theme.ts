import { fontOptions, themes } from '@vault-client/themes';

/**
 * Inside Vault, DocCompare wears Vault's own look: the theme (colours) and font chosen in Vault's Settings, read from the same-origin
 * localStorage key 'vault-settings' and Vault's own theme table (client/src/themes.js), as Route Tracer does (route-tracer/src/theme.ts).
 * Only when embedded: the font is a Google Font, and loading it is a network request (it fetches the typeface only, never anything about the
 * files; Vault's page already loads the same font). Standalone, the app stays fully offline with system fonts and its own palette.
 */

const KEY = 'vault-settings';
const DEFAULT_THEME = 'warm-sand';
const DEFAULT_FONT = 'DM Sans';

type Theme = { bg: string; surface: string; border: string; primary: string; onPrimary?: string; text: string; muted: string };

export function readLook(raw: string | null): { theme: string; font: string } {
  let state: { theme?: unknown; font?: unknown } | undefined;
  try { state = (JSON.parse(raw ?? 'null') as { state?: { theme?: unknown; font?: unknown } } | null)?.state; } catch { state = undefined; }
  const theme = typeof state?.theme === 'string' && Object.prototype.hasOwnProperty.call(themes, state.theme) ? state.theme : DEFAULT_THEME;
  const font = typeof state?.font === 'string' && fontOptions.some((f) => f.value === state!.font) ? (state.font as string) : DEFAULT_FONT;
  return { theme, font };
}

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  return 0.2126 * channel(parseInt(h.slice(0, 2), 16)) + 0.7152 * channel(parseInt(h.slice(2, 4), 16)) + 0.0722 * channel(parseInt(h.slice(4, 6), 16));
}

const loadedFonts = new Set<string>();
function loadFont(font: string): void {
  if (loadedFonts.has(font)) return;
  loadedFonts.add(font);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

/** The CSS for a Vault theme: Vault's six colours plus the status colours, light or dark to suit the theme. */
export function themeCss(t: Theme, fontStyle: string): string {
  const dark = luminance(t.bg) < 0.2;
  const status = dark
    ? '--removed: #fca5a5; --removed-bg: #4a1d1d; --added: #86efac; --added-bg: #173a24; --warn: #fcd34d; --warn-bg: #3d2f0c;'
    : '--removed: #b91c1c; --removed-bg: #fde8e8; --added: #15803d; --added-bg: #e3f6e9; --warn: #92400e; --warn-bg: #fef3c7;';
  return `:root, :root:not([data-x]) { --color-bg: ${t.bg}; --color-surface: ${t.surface}; --color-border: ${t.border}; --color-primary: ${t.primary}; --color-on-primary: ${t.onPrimary || '#FFFFFF'}; --color-text: ${t.text}; --color-muted: ${t.muted}; ${status} --font-sans: ${fontStyle}; color-scheme: ${dark ? 'dark' : 'light'}; }`;
}

function safeGet(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }

export function applyVaultTheme(raw: string | null = safeGet()): void {
  const look = readLook(raw);
  const t = (themes as Record<string, Theme>)[look.theme] ?? (themes as Record<string, Theme>)[DEFAULT_THEME];
  const f = fontOptions.find((o) => o.value === look.font);
  let el = document.getElementById('vault-theme');
  if (!el) { el = document.createElement('style'); el.id = 'vault-theme'; document.head.appendChild(el); }
  el.textContent = themeCss(t, f ? f.style : `'${DEFAULT_FONT}', sans-serif`);
  loadFont(look.font);
  document.documentElement.dataset.vaultTheme = look.theme;
}

/** Apply now, and again whenever Vault's settings change (another tab, or Settings in this one). */
export function watchVaultTheme(): void {
  applyVaultTheme();
  window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) applyVaultTheme(); });
}
