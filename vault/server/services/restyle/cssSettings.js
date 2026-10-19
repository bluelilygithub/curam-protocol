'use strict';

// What a page's CSS settles: the colours, fonts, sizes, corners, shadows, spacing, variables, screen-size breakpoints, font files and
// animations it uses, with how often each appears. Used by "Download a page's CSS" in the CSS tool. Reads the CSS with PostCSS (never
// regex over the whole text) and never throws: a file that cannot be parsed is counted and skipped. Test:
// node server/services/restyle/restyleScrape.test.js

const postcss = require('postcss');

const TOP = 40;
const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?)\(\s*[^)]*\)/gi;
const LENGTH_RE = /-?\d*\.?\d+(?:px|rem|em|%|vw|vh|ch|pt)\b/g;
const BREAKPOINT_RE = /\(\s*(min|max)-width\s*:\s*(-?\d*\.?\d+)(px|em|rem)\s*\)/gi;

/** A counter that keeps the first spelling it saw of each value. */
class Counter {
  constructor() { this.map = new Map(); }
  add(raw, key = raw) {
    const k = String(key);
    if (!k) return;
    const hit = this.map.get(k);
    if (hit) hit.count += 1; else this.map.set(k, { value: String(raw), count: 1 });
  }
  list(limit = TOP, sort) {
    const items = [...this.map.values()];
    items.sort(sort || ((a, b) => b.count - a.count || a.value.localeCompare(b.value)));
    return items.slice(0, limit);
  }
}

const normaliseColour = (c) => c.trim().toLowerCase().replace(/\s+/g, '');
const lengthNumber = (v) => parseFloat(v);

/**
 * @param {string[]} cssTexts  one string per style file
 * @returns {object} the settings, see the keys below
 */
function summariseCss(cssTexts) {
  const colors = new Counter();
  const fontFamilies = new Counter();
  const fontSizes = new Counter();
  const fontWeights = new Counter();
  const lineHeights = new Counter();
  const radii = new Counter();
  const shadows = new Counter();
  const spacing = new Counter();
  const breakpoints = new Counter();
  const keyframes = new Counter();
  const variables = new Map(); // name -> { name, value, uses }
  const fontFaces = [];
  const imports = [];
  let rules = 0;
  let declarations = 0;
  let unreadable = 0;
  let bytes = 0;
  let allText = '';

  (cssTexts || []).forEach((text) => {
    const css = String(text || '');
    bytes += css.length;
    allText += `${css}\n`;
    let root;
    try { root = postcss.parse(css); } catch { unreadable += 1; return; }

    root.walkAtRules((rule) => {
      const name = rule.name.toLowerCase();
      if (name === 'media') {
        for (const m of rule.params.matchAll(BREAKPOINT_RE)) breakpoints.add(`${m[1].toLowerCase()}-width: ${m[2]}${m[3].toLowerCase()}`);
      } else if (name === 'keyframes' || name === '-webkit-keyframes') {
        keyframes.add(rule.params.trim());
      } else if (name === 'import') {
        const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"]/.exec(rule.params);
        if (url) imports.push(url[1] || url[2]);
      } else if (name === 'font-face') {
        const face = { family: '', weight: '', style: '', sources: [] };
        rule.walkDecls((d) => {
          const prop = d.prop.toLowerCase();
          if (prop === 'font-family') face.family = d.value.replace(/['"]/g, '').trim();
          else if (prop === 'font-weight') face.weight = d.value.trim();
          else if (prop === 'font-style') face.style = d.value.trim();
          else if (prop === 'src') for (const m of d.value.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (!m[1].startsWith('data:')) face.sources.push(m[1]);
        });
        if (face.family) fontFaces.push(face);
      }
    });

    root.walkRules(() => { rules += 1; });
    root.walkDecls((decl) => {
      declarations += 1;
      const prop = decl.prop.toLowerCase();
      const value = decl.value || '';
      if (prop.startsWith('--')) {
        if (!variables.has(prop)) variables.set(prop, { name: prop, value: value.trim(), uses: 0 });
        return;
      }
      for (const m of value.matchAll(COLOR_RE)) colors.add(normaliseColour(m[0]));
      if (prop === 'font-family') fontFamilies.add(value.replace(/\s*!important\s*$/i, '').trim());
      else if (prop === 'font-size') fontSizes.add(value.trim());
      else if (prop === 'font-weight') fontWeights.add(value.trim());
      else if (prop === 'line-height') lineHeights.add(value.trim());
      else if (prop === 'border-radius') radii.add(value.trim());
      else if (prop === 'box-shadow') shadows.add(value.trim());
      else if (/^(margin|padding)(-top|-right|-bottom|-left)?$|^gap$|^row-gap$|^column-gap$/.test(prop)) {
        for (const m of value.matchAll(LENGTH_RE)) if (lengthNumber(m[0]) !== 0) spacing.add(m[0]);
      }
    });
  });

  // how often each variable is used: var(--name) anywhere in the CSS
  for (const m of allText.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const v = variables.get(m[1]);
    if (v) v.uses += 1;
  }

  const byNumber = (a, b) => lengthNumber(a.value) - lengthNumber(b.value);
  return {
    colors: colors.list(),
    fontFamilies: fontFamilies.list(),
    fontSizes: fontSizes.list(TOP, byNumber),
    fontWeights: fontWeights.list(),
    lineHeights: lineHeights.list(),
    radii: radii.list(),
    shadows: shadows.list(),
    spacing: spacing.list(TOP, byNumber),
    variables: [...variables.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)).slice(0, 80),
    breakpoints: breakpoints.list(TOP, (a, b) => (parseFloat(a.value.split(': ')[1]) - parseFloat(b.value.split(': ')[1])) || a.value.localeCompare(b.value)),
    fontFaces: fontFaces.slice(0, 60),
    keyframes: keyframes.list(),
    imports,
    stats: { files: (cssTexts || []).length, bytes, rules, declarations, unreadable },
  };
}

module.exports = { summariseCss };
