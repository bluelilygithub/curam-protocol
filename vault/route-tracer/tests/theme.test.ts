// @vitest-environment jsdom
import { themes, fontOptions } from '@vault-client/themes';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, luminance, onColour, readLook } from '../src/theme';

const saved = (state: object) => JSON.stringify({ state, version: 0 });

describe('readLook (what Vault saved in Settings)', () => {
  it('uses the saved theme and font', () => {
    expect(readLook(saved({ theme: 'dark-slate', font: 'Lato' }))).toEqual({ theme: 'dark-slate', font: 'Lato' });
    expect(readLook(saved({ theme: 'forest', font: 'JetBrains Mono' }))).toEqual({ theme: 'forest', font: 'JetBrains Mono' });
  });
  it('falls back to Vault\'s defaults when nothing usable is saved', () => {
    const d = { theme: 'warm-sand', font: 'DM Sans' };
    expect(readLook(null)).toEqual(d);
    expect(readLook('')).toEqual(d);
    expect(readLook('not json')).toEqual(d);
    expect(readLook('null')).toEqual(d);
    expect(readLook(saved({}))).toEqual(d);
    expect(readLook(saved({ theme: 7, font: ['x'] }))).toEqual(d);
  });
  it('ignores a theme or font Vault does not offer (nothing from storage goes into the page unchecked)', () => {
    expect(readLook(saved({ theme: 'hot-pink', font: 'Comic Sans' }))).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
    expect(readLook(saved({ theme: '__proto__', font: "x'}; body{display:none" }))).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
    expect(readLook(saved({ theme: 'toString' }))).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
  });
  it('knows every theme and font Vault has today', () => {
    for (const t of Object.keys(themes)) expect(readLook(saved({ theme: t })).theme).toBe(t);
    for (const f of fontOptions) expect(readLook(saved({ font: f.value })).font).toBe(f.value);
  });
});

describe('text on the theme colour', () => {
  it('luminance of black and white', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
  it('white where white reads (as in the rest of Vault), near-black only where it would not, and always at least 3:1', () => {
    const contrast = (a: string, b: string): number => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const expected: Record<string, string> = { 'warm-sand': '#ffffff', 'dark-slate': '#ffffff', forest: '#ffffff', 'midnight-blue': '#1a1a1a', 'paper-white': '#ffffff' };
    for (const [name, t] of Object.entries(themes)) {
      expect(onColour(t.primary), name).toBe(expected[name] ?? onColour(t.primary));
      expect(contrast(t.primary, onColour(t.primary)), `${name} contrast`).toBeGreaterThanOrEqual(3);
    }
    expect(onColour('#ffe082')).toBe('#1a1a1a'); // a pale yellow
    expect(onColour('#ffffff')).toBe('#1a1a1a');
    expect(onColour('#000000')).toBe('#ffffff');
  });
});

describe('applyTheme', () => {
  beforeEach(() => { document.head.innerHTML = ''; document.documentElement.removeAttribute('style'); delete document.documentElement.dataset.theme; });

  it('writes the theme\'s colours as the same --color-* variables Vault uses', () => {
    applyTheme(saved({ theme: 'dark-slate', font: 'Lato' }));
    const css = document.getElementById('route-tracer-theme')!.textContent!;
    const t = themes['dark-slate'];
    for (const v of [`--color-bg: ${t.bg}`, `--color-surface: ${t.surface}`, `--color-border: ${t.border}`, `--color-primary: ${t.primary}`, `--color-text: ${t.text}`, `--color-muted: ${t.muted}`]) expect(css).toContain(v);
    expect(css).toContain('color-scheme: dark');
    expect(document.documentElement.dataset.theme).toBe('dark-slate');
  });
  it('a light theme says so, and re-applying replaces rather than piles up', () => {
    applyTheme(saved({ theme: 'warm-sand' }));
    applyTheme(saved({ theme: 'forest' }));
    expect(document.querySelectorAll('#route-tracer-theme')).toHaveLength(1);
    const css = document.getElementById('route-tracer-theme')!.textContent!;
    expect(css).toContain(themes.forest.primary);
    expect(css).not.toContain(themes['warm-sand'].primary);
    expect(css).toContain('color-scheme: light');
  });
  it('sets the font and loads it once from Google Fonts, like Vault does', () => {
    applyTheme(saved({ font: 'Merriweather' }));
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe("'Merriweather', serif");
    applyTheme(saved({ font: 'Merriweather' }));
    const links = [...document.head.querySelectorAll('link[rel=stylesheet]')] as HTMLLinkElement[];
    expect(links.filter((l) => l.href.includes('family=Merriweather'))).toHaveLength(1);
    expect(links[0].href.startsWith('https://fonts.googleapis.com/css2?family=Merriweather')).toBe(true);
  });
  it('the default font needs no download (Vault loads it up front too)', () => {
    applyTheme(null);
    expect(document.head.querySelectorAll('link[rel=stylesheet]')).toHaveLength(0);
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe("'DM Sans', sans-serif");
  });
});
