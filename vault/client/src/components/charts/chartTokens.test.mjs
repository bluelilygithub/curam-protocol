// node client/src/components/charts/chartTokens.test.mjs — every theme's chart tokens exist and meet the contrast rules in DESIGN.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// themes.js is an ES module in a CommonJS package, so load its text as a module.
const src = readFileSync(new URL('../../themes.js', import.meta.url), 'utf8');
const { themes } = await import(`data:text/javascript,${encodeURIComponent(src)}`);

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const TOKENS = ['c1', 'c2', 'c3', 'c4', 'gain', 'loss', 'warn', 'neutral', 'grid', 'ink'];
const SERIES = ['c1', 'c2', 'c3', 'c4'];
// Series must differ in lightness, not just hue, so lines stay apart for colour-blind readers and in greyscale. 1.35:1 is a clearly
// visible step, and on a light surface it still leaves room for four colours that each reach 3:1 (a light theme only has lightness
// 0 to about 0.25 to work with).
const SERIES_APART = 1.35;

assert.ok(Object.keys(themes).length >= 5, 'found the themes');
const darkHexes = new Set();
const lightHexes = new Set();
for (const [name, t] of Object.entries(themes)) {
  const c = t.chart;
  assert.ok(c, `${name} has chart tokens`);
  for (const k of TOKENS) assert.match(c[k] || '', /^#[0-9A-Fa-f]{6}$/, `${name} defines chart ${k}`);
  for (const k of ['gain', 'loss', 'warn']) {
    assert.ok(ratio(c[k], t.surface) >= 4.5, `${name} ${k} on surface ${ratio(c[k], t.surface).toFixed(2)}`);
    assert.ok(ratio(c[k], t.bg) >= 4.5, `${name} ${k} on bg ${ratio(c[k], t.bg).toFixed(2)}`);
  }
  for (const k of SERIES) assert.ok(ratio(c[k], t.surface) >= 3, `${name} ${k} on surface ${ratio(c[k], t.surface).toFixed(2)}`);
  for (let i = 0; i < SERIES.length; i++) {
    for (let j = i + 1; j < SERIES.length; j++) {
      const r = ratio(c[SERIES[i]], c[SERIES[j]]);
      assert.ok(r >= SERIES_APART, `${name} ${SERIES[i]} vs ${SERIES[j]} only ${r.toFixed(2)}:1 apart`);
    }
  }
  for (const k of ['gain', 'loss', 'warn', ...SERIES]) (lum(t.bg) < 0.2 ? darkHexes : lightHexes).add(c[k].toUpperCase());
}
// Dark themes get their own lighter values, never a light theme's.
for (const h of darkHexes) assert.ok(!lightHexes.has(h), `dark theme reuses light value ${h}`);

console.log('chartTokens tests passed');
