// End-to-end test for the print-handoff SVG export, against a real font
// (fetched via the same raw.githubusercontent.com approach used by the
// Python test suite, cached locally for reruns).
//
// Run: node client/src/pages/fonts/svgExport.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import * as opentype from 'opentype.js';
import { buildOutlinedSvg } from './svgExport.js';
import { findUncoveredChars } from './coverageCheck.js';

const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.message}`);
  }
}

const FIXTURE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/ptserif/PT_Serif-Web-Regular.ttf';
const FIXTURE_PATH = path.join(os.tmpdir(), 'vault_fonts_svg_test_ptserif.ttf');

function downloadFixture() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(FIXTURE_PATH) && fs.statSync(FIXTURE_PATH).size > 0) {
      resolve(fs.readFileSync(FIXTURE_PATH));
      return;
    }
    https.get(FIXTURE_URL, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(FIXTURE_PATH, buf);
        resolve(buf);
      });
      resp.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const buf = await downloadFixture();
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  test('flattened output has no <text> elements', () => {
    const svg = buildOutlinedSvg(font, 'Hg', 100, { mode: 'solid', solidColor: '#111' }, []);
    assert.ok(!/<text/i.test(svg), 'SVG must not contain a <text> element');
    assert.ok(/<path/i.test(svg), 'SVG must contain flattened <path> elements');
  });

  test('solid fill applies fill color directly to the glyph path', () => {
    const svg = buildOutlinedSvg(font, 'A', 100, { mode: 'solid', solidColor: '#ff0000' }, []);
    assert.ok(svg.includes('fill="#ff0000"'));
  });

  test('gradient fill bakes a <linearGradient> with the configured stops', () => {
    const fill = {
      mode: 'gradient',
      gradientAngle: 45,
      gradientStops: [{ color: '#ff0000', position: 0 }, { color: '#0000ff', position: 100 }],
    };
    const svg = buildOutlinedSvg(font, 'A', 100, fill, []);
    assert.ok(/<linearGradient/.test(svg));
    assert.ok(svg.includes('stop-color="#ff0000"'));
    assert.ok(svg.includes('stop-color="#0000ff"'));
    assert.ok(/fill="url\(#font-export-fill\)"/.test(svg));
  });

  test('image fill bakes a <pattern> with the source image', () => {
    const fill = { mode: 'image', imageDataUrl: 'data:image/png;base64,AAAA' };
    const svg = buildOutlinedSvg(font, 'A', 100, fill, []);
    assert.ok(/<pattern/.test(svg));
    assert.ok(svg.includes('data:image/png;base64,AAAA'));
  });

  test('shadow layers bake as blurred, offset duplicate paths behind the main glyph', () => {
    const shadows = [{ offsetX: 3, offsetY: 4, blur: 6, color: 'rgba(0,0,0,0.4)' }];
    const svg = buildOutlinedSvg(font, 'A', 100, { mode: 'solid', solidColor: '#111' }, shadows);
    assert.ok(/<feGaussianBlur/.test(svg));
    assert.ok(/translate\(3,4\)/.test(svg));
    assert.ok(svg.includes('rgba(0,0,0,0.4)'));
    // Shadow path must come before the main fill path in document order (renders behind it).
    const shadowIdx = svg.indexOf('feGaussianBlur');
    const mainFillIdx = svg.lastIndexOf('fill="#111"');
    assert.ok(shadowIdx < mainFillIdx, 'shadow must be defined/drawn before the main glyph path');
  });

  test('multiple shadow layers each get their own filter', () => {
    const shadows = [
      { offsetX: 1, offsetY: 1, blur: 2, color: '#000' },
      { offsetX: -2, offsetY: -2, blur: 5, color: '#fff' },
    ];
    const svg = buildOutlinedSvg(font, 'A', 100, { mode: 'solid', solidColor: '#111' }, shadows);
    assert.strictEqual((svg.match(/<filter/g) || []).length, 2);
  });

  test('viewBox tightly bounds the actual glyph outlines with padding', () => {
    const svg = buildOutlinedSvg(font, 'l', 100, { mode: 'solid', solidColor: '#111' }, []);
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    assert.ok(viewBoxMatch);
    const [, , w, h] = viewBoxMatch[1].split(' ').map(Number);
    assert.ok(w > 0 && w < 200, `unexpectedly large/zero viewBox width: ${w}`);
    assert.ok(h > 0 && h < 300, `unexpectedly large/zero viewBox height: ${h}`);
  });

  test('coverage report flags a skipped glyph BEFORE SVG generation is attempted (requirement 3)', () => {
    // Simulate a Phase 4 export where 'A' was reported as skipped —
    // findUncoveredChars must surface it; the UI's Export button gates on
    // this list being non-empty (FontEffectsPanel.jsx generateSvg/disabled),
    // so it's never silently exported as a glyph gap.
    const aGlyphName = font.charToGlyph('A').name;
    const coverageReport = {
      structural_transforms_applied: {
        glyphs_skipped: [[aGlyphName, 'decompose_failed: missing component']],
      },
    };
    const issues = findUncoveredChars(font, coverageReport, 'CAT');
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].char, 'A');
    assert.strictEqual(issues[0].reason, 'skipped_at_export');
    assert.ok(issues[0].detail.includes('decompose_failed'));
  });

  test('text with no coverage issues generates a valid SVG (control case for the above)', () => {
    const issues = findUncoveredChars(font, { structural_transforms_applied: { glyphs_skipped: [] } }, 'CAT');
    assert.strictEqual(issues.length, 0);
    const svg = buildOutlinedSvg(font, 'CAT', 100, { mode: 'solid', solidColor: '#111' }, []);
    assert.ok(/<path/.test(svg));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
