'use strict';

// The thinking part of "Brand from a website", with no browser and no network so it can be tested on its own: turn what the page
// painted (weighted colour maps, fonts, radii from pageScript.js) into named roles (background, text, primary, accent ...), a font choice
// per role, and a corner-radius label. Colour maths reuses the Web Extractor's palette helpers (same delta E as everywhere else).

const { deltaE, rgbToHsl, isNeutral } = require('../webExtractorPalette');

const SIMILAR = 4; // delta E under which two colours look the same

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function luminance([r, g, b]) {
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two [r,g,b] colours. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** { '#hex': weight } -> [{ hex, rgb, w }] heaviest first, colours that look the same joined into the heavier one. */
function mergeMap(map, threshold = SIMILAR) {
  const items = Object.entries(map || {}).map(([hex, w]) => ({ hex, rgb: hexToRgb(hex), w })).sort((a, b) => b.w - a.w);
  const out = [];
  for (const c of items) {
    const home = out.find((o) => deltaE(o.rgb, c.rgb) < threshold);
    if (home) home.w += c.w; else out.push({ ...c });
  }
  return out.sort((a, b) => b.w - a.w);
}

/** Add `src` (a weight map) into `dst`, each weight times `scale`. */
function addScaled(dst, src, scale) {
  for (const [k, v] of Object.entries(src || {})) dst[k] = (dst[k] || 0) + v * scale;
  return dst;
}

const isChromatic = (rgb) => !isNeutral(rgbToHsl(rgb[0], rgb[1], rgb[2]));

/** Several page loads (desktop counts fully, phone half) -> one set of maps. */
function combineRuns(runs) {
  const sum = { bg: {}, fg: {}, btnBg: {}, btnFg: {}, linkFg: {}, border: {}, fonts: {}, radii: [], canvas: null, themeColor: null };
  for (const { data, scale } of runs) {
    if (!data) continue;
    for (const k of ['bg', 'fg', 'btnBg', 'btnFg', 'linkFg', 'border', 'fonts']) addScaled(sum[k], data[k], scale);
    if (scale >= 1) sum.radii.push(...(data.radii || []));
    sum.canvas = sum.canvas || data.canvas;
    sum.themeColor = sum.themeColor || data.themeColor;
  }
  return sum;
}

/** Colour roles from combined maps. Any role can be null (a site with one colour has no accent). */
function pickColourRoles(d) {
  const bgList = mergeMap(d.bg);
  const fgList = mergeMap(d.fg);
  const background = d.canvas || (bgList[0] && bgList[0].hex) || '#ffffff';
  const bgRgb = hexToRgb(background);

  // a card or panel is often only a shade off the page colour, so this list is merged much more finely than the others
  const surface = mergeMap(d.bg, 1.5).find((c) => {
    const gap = deltaE(c.rgb, bgRgb);
    return gap > 2 && gap < 25 && c.w >= 0.05; // close to the page colour: a card, panel or band, not a brand-coloured block
  });

  const readable = fgList.find((c) => contrast(c.rgb, bgRgb) >= 4.5) || fgList[0];
  const text = readable ? readable.hex : (luminance(bgRgb) < 0.4 ? '#ffffff' : '#111111');
  const textRgb = hexToRgb(text);
  const textContrast = contrast(textRgb, bgRgb);
  const muted = fgList.find((c) => deltaE(c.rgb, textRgb) > 8 && contrast(c.rgb, bgRgb) >= 3 && contrast(c.rgb, bgRgb) < textContrast);

  // what the brand is: colours on buttons count most, then links and big coloured areas, then coloured text, plus the theme colour
  const score = {};
  addScaled(score, d.btnBg, 1);
  addScaled(score, d.linkFg, 0.05);
  addScaled(score, d.bg, 6);
  addScaled(score, d.fg, 0.02);
  if (d.themeColor) score[d.themeColor] = (score[d.themeColor] || 0) + 3;
  const scoreList = mergeMap(score);

  const distinct = (c) => deltaE(c.rgb, bgRgb) > 15 && deltaE(c.rgb, textRgb) > 10;
  let primary = scoreList.find((c) => isChromatic(c.rgb) && distinct(c));
  // a black-and-white brand: its buttons are the primary colour
  if (!primary) primary = mergeMap(d.btnBg).find((c) => deltaE(c.rgb, bgRgb) > 15);
  const accent = primary && scoreList.find((c) => isChromatic(c.rgb) && deltaE(c.rgb, primary.rgb) > 25
    && deltaE(c.rgb, bgRgb) > 15 && c.w >= primary.w * 0.15);
  const border = mergeMap(d.border).find((c) => deltaE(c.rgb, bgRgb) > SIMILAR);

  const onPrimary = primary ? (contrast([255, 255, 255], primary.rgb) >= contrast([17, 17, 17], primary.rgb) ? '#ffffff' : '#111111') : null;
  return {
    colours: {
      background, surface: surface ? surface.hex : null, text, mutedText: muted ? muted.hex : null,
      primary: primary ? primary.hex : null, onPrimary, accent: accent ? accent.hex : null, border: border ? border.hex : null,
    },
    palette: scoreList.slice(0, 10).map((c) => c.hex),
    contrastTextOnBackground: Math.round(textContrast * 10) / 10,
  };
}

/** The dark-mode loading, only when the site really changes its look for dark (page canvas differs clearly). */
function pickDark(lightCanvas, data) {
  if (!data) return null;
  const roles = pickColourRoles(combineRuns([{ data, scale: 1 }])).colours;
  if (!lightCanvas || deltaE(hexToRgb(roles.background), hexToRgb(lightCanvas)) < 10) return null;
  return { background: roles.background, text: roles.text, primary: roles.primary };
}

// ---- corner radius ----
const RADIUS_STEPS = [0, 2, 4, 6, 8, 12, 16, 24, 999];

function pickRadius(radii) {
  if (!radii || radii.length < 1) return { px: null, label: 'unknown' };
  const counts = new Map();
  for (const r of radii) {
    const v = r >= 999 ? 999 : r;
    const step = RADIUS_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), 0);
    counts.set(step, (counts.get(step) || 0) + 1);
  }
  const [px] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const label = px === 0 ? 'square' : px <= 4 ? 'subtle' : px <= 12 ? 'rounded' : px < 999 ? 'very rounded' : 'pill';
  return { px, label };
}

// ---- fonts ----
// Fonts that every computer already has: there is nothing to download for them, and they are not a brand choice.
const SYSTEM_FONT = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|segoe ui|helvetica( neue)?|arial|times( new roman)?|georgia|verdana|tahoma|trebuchet ms|courier( new)?|apple color emoji|segoe ui emoji)$/i;

/** 'h|Family|700' weight map -> { heading: {family, weight, system}, body: {...} } (the most-used family, and its most-used weight). */
function pickFontNames(fonts) {
  const result = { heading: null, body: null };
  for (const [role, tag] of [['heading', 'h'], ['body', 'b']]) {
    const byFamily = new Map();
    for (const [key, w] of Object.entries(fonts || {})) {
      const [t, family, weight] = key.split('|');
      if (t !== tag) continue;
      const e = byFamily.get(family) || { total: 0, weights: {} };
      e.total += w;
      e.weights[weight] = (e.weights[weight] || 0) + w;
      byFamily.set(family, e);
    }
    const top = [...byFamily.entries()].sort((a, b) => b[1].total - a[1].total)[0];
    if (!top) continue;
    const weight = Number(Object.entries(top[1].weights).sort((a, b) => b[1] - a[1])[0][0]);
    result[role] = { family: top[0], weight, system: SYSTEM_FONT.test(top[0]) };
  }
  // a page often sets one font for everything: then headings and body share it
  if (!result.heading && result.body) result.heading = { ...result.body };
  if (!result.body && result.heading) result.body = { ...result.heading };
  return result;
}

const familyKey = (s) => String(s || '').toLowerCase().replace(/\b(variable|vf)\b/g, '').replace(/[^a-z0-9]/g, '');
const STYLE_WORDS = /^(thin|hairline|extralight|ultralight|light|book|regular|normal|medium|semibold|demibold|bold|extrabold|ultrabold|heavy|black|italic|oblique)+$/;

/**
 * Is this font file's family name the family the page asked for? A variable font often names its default instance ("Montserrat Thin"),
 * so a family name followed only by weight or style words counts; "Montserrat Alternates" is a different family and does not.
 */
function sameFamily(fileFamily, wanted) {
  const have = familyKey(fileFamily);
  const want = familyKey(wanted);
  if (!have || !want) return false;
  return have === want || (have.startsWith(want) && STYLE_WORDS.test(have.slice(want.length)));
}

/**
 * Which downloaded font file is this family at this weight? `files` are the inspected files ({ id, family, weight, italic, variable,
 * wghtRange, hasLatin }). Needs the same family name, and letters (an icon font is never a match); nearest weight wins, upright over italic.
 * Returns the file or null.
 */
function matchFontFile(files, family, weight) {
  const want = familyKey(family);
  if (!want) return null;
  const pool = (files || []).filter((f) => !f.error && f.hasLatin && sameFamily(f.family, family));
  if (!pool.length) return null;
  const distance = (f) => {
    if (f.variable && f.wghtRange) {
      const [lo, hi] = f.wghtRange;
      return weight >= lo && weight <= hi ? 0 : Math.min(Math.abs(weight - lo), Math.abs(weight - hi));
    }
    return Math.abs(weight - f.weight);
  };
  return pool.sort((a, b) => (distance(a) - distance(b)) || (Number(a.italic) - Number(b.italic)) || (b.glyphs - a.glyphs))[0];
}

module.exports = {
  hexToRgb, luminance, contrast, mergeMap, combineRuns, pickColourRoles, pickDark, pickRadius, pickFontNames, matchFontFile, familyKey, sameFamily,
  SYSTEM_FONT, RADIUS_STEPS,
};
