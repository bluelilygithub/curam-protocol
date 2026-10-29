import { describe, expect, it } from 'vitest';
import { fontOptions, themes } from '@vault-client/themes';
import { DEFAULT_FONT, DEFAULT_THEME, FONT_LIST, THEME_LIST, applyLook, isDark, lookCss, lookFromSearch, luminance, onColour, resolveLook, rgbTriplet } from '../src/lib/theme';

describe('the shelf uses Vault\'s own themes and fonts', () => {
  it('offers exactly the themes and fonts in client/src/themes.js, in the same order', () => {
    expect(THEME_LIST.map((t) => t.id)).toEqual(Object.keys(themes));
    expect(FONT_LIST).toBe(fontOptions);
    expect(THEME_LIST.length).toBe(5);
  });
  it('defaults to Warm Sand and DM Sans, like a new Vault', () => {
    expect(DEFAULT_THEME).toBe('warm-sand'); expect(DEFAULT_FONT).toBe('DM Sans');
    expect(resolveLook()).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
  });
  it('every theme writes all six Vault tokens with Vault\'s exact colours, and a matching -rgb twin', () => {
    for (const [id, t] of Object.entries(themes)) {
      const css = lookCss({ theme: id, font: 'DM Sans' });
      for (const [token, hex] of [['bg', t.bg], ['surface', t.surface], ['border', t.border], ['primary', t.primary], ['text', t.text], ['muted', t.muted]] as const) {
        expect(css, `${id} ${token}`).toContain(`--color-${token}: ${hex};`);
        expect(css, `${id} ${token} rgb`).toContain(`--color-${token}-rgb: ${rgbTriplet(hex)};`);
      }
      expect(css).toContain('--color-on-primary:');
    }
  });
  it('Warm Sand is Vault\'s documented default palette', () => {
    const css = lookCss({ theme: 'warm-sand', font: 'DM Sans' });
    for (const hex of ['#F5F5F0', '#EEEEE8', '#D8D8D0', '#CC785C', '#1A1A1A', '#888888']) expect(css).toContain(hex);
  });
  it('unknown names fall back to the defaults instead of breaking', () => {
    expect(resolveLook('neon-pink', 'Comic Sans')).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
    expect(resolveLook(42, null)).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
    expect(resolveLook('dark-slate', 'Inter')).toEqual({ theme: 'dark-slate', font: 'Inter' });
    expect(resolveLook('__proto__', 'constructor')).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
  });
  it('reads the look the shell puts in the page address', () => {
    expect(lookFromSearch('?theme=midnight-blue&font=JetBrains%20Mono')).toEqual({ theme: 'midnight-blue', font: 'JetBrains Mono' });
    expect(lookFromSearch('')).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
    expect(lookFromSearch('?theme=<script>')).toEqual({ theme: 'warm-sand', font: 'DM Sans' });
  });
  it('light and dark come from the theme, never the operating system', () => {
    expect(isDark({ theme: 'warm-sand', font: 'DM Sans' })).toBe(false);
    expect(isDark({ theme: 'dark-slate', font: 'DM Sans' })).toBe(true);
    expect(isDark({ theme: 'midnight-blue', font: 'DM Sans' })).toBe(true);
    expect(isDark({ theme: 'paper-white', font: 'DM Sans' })).toBe(false);
    expect(lookCss({ theme: 'dark-slate', font: 'DM Sans' })).toContain('color-scheme: dark');
  });
  it('text on the primary colour stays readable in every theme', () => {
    for (const t of Object.values(themes)) {
      const on = onColour(t.primary);
      const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
      expect(ratio(on, t.primary), t.label).toBeGreaterThanOrEqual(3);
    }
    expect(onColour('#CC785C')).toBe('#ffffff');     // Vault's own buttons: white on terracotta
    expect(onColour('#F0F0F0')).toBe('#1a1a1a');     // white on a pale colour would not read
  });
  it('writes the variables, the font and the scheme onto the page, and replaces them when the theme changes', () => {
    applyLook({ theme: 'forest', font: 'Lato' });
    expect(document.getElementById('shelf-theme-vars')!.textContent).toContain('#3D7A5E');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('Lato');
    expect(document.documentElement.dataset.scheme).toBe('light');
    applyLook({ theme: 'dark-slate', font: 'Merriweather' });
    expect(document.querySelectorAll('#shelf-theme-vars').length).toBe(1);
    expect(document.getElementById('shelf-theme-vars')!.textContent).toContain('#7C8CF8');
    expect(document.getElementById('shelf-theme-vars')!.textContent).not.toContain('#3D7A5E');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('Merriweather');
    expect(document.documentElement.dataset.scheme).toBe('dark');
  });
});
