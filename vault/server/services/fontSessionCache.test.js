#!/usr/bin/env node
/**
 * Session cache + fetch/freeze-once + debounced-preview tests. Verifies
 * the caching layer actually avoids re-fetching (via timing) and that
 * two different preview calls against the same cached base font produce
 * genuinely different, correctly-transformed output — checked against
 * real font data via fontTools, not just "didn't throw".
 *
 * Run: node server/services/fontSessionCache.test.js
 */
'use strict';

const assert = require('assert');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

const { runFontFetchFreeze, runFontExport } = require('./fontExportPipeline');
const sessionCache = require('./fontSessionCache');

const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.message}`);
  }
}

const PYTHON_BIN = process.env.FONTS_PYTHON_BIN
  || path.join(__dirname, 'fonts', '.venv', 'Scripts', 'python.exe');

/** Reads a glyf-format TTF buffer's OS/2 usWeightClass via a one-off fontTools call, as an independent verification path. */
async function inspectFont(buffer) {
  const tmpFile = path.join(os.tmpdir(), `vault_fonts_verify_${Date.now()}_${Math.random().toString(36).slice(2)}.ttf`);
  fs.writeFileSync(tmpFile, buffer);
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, ['-c', `
from fontTools.ttLib import TTFont
f = TTFont(r"${tmpFile}")
print(f['name'].getDebugName(1))
print(f['glyf']['H'].xMax - f['glyf']['H'].xMin)
`]);
    const [family, hWidth] = stdout.trim().split('\n').map((l) => l.trim());
    return { family, hWidth: Number(hWidth) };
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function main() {
  let sessionId;
  let fetchMs;

  await test('fetch+freeze populates a session and returns real metadata', async () => {
    const t0 = Date.now();
    const { fontBuffer, meta } = await runFontFetchFreeze('Roboto');
    fetchMs = Date.now() - t0;

    assert.strictEqual(meta.family, 'Roboto');
    assert.strictEqual(meta.license, 'OFL');
    assert.ok(Buffer.isBuffer(fontBuffer) && fontBuffer.length > 0);

    sessionId = sessionCache.createSession({ fontBuffer, meta });
    assert.ok(sessionId);
  });

  await test('preview against the cached session does not re-fetch (fast relative to the initial fetch)', async () => {
    const session = sessionCache.getSession(sessionId);
    assert.ok(session, 'session should still be present immediately after creation');

    const t0 = Date.now();
    const { outputs } = await runFontExport({
      fontBuffer: session.fontBuffer,
      recipe: { transforms: { stemThickness: 30, proportionalWidth: 100, extendAscDesc: 0, counterWidth: 0 }, kerning: {} },
      rename: { familyName: 'Cache Verify Thick' },
      rangeIds: ['basic-latin'],
      formats: ['ttf'],
    });
    const previewMs = Date.now() - t0;

    assert.ok(previewMs < fetchMs, `preview (${previewMs}ms) should be faster than the original fetch (${fetchMs}ms) — cache isn't helping if not`);
    assert.ok(previewMs < 3000, `preview took ${previewMs}ms — over the 2-3s live-preview budget`);

    global.__thickOutputs = outputs; // stashed for the next test
  });

  await test('two previews with different stemThickness produce verifiably different glyph widths (fontTools-checked)', async () => {
    const session = sessionCache.getSession(sessionId);
    const { outputs: thinOutputs } = await runFontExport({
      fontBuffer: session.fontBuffer,
      recipe: { transforms: { stemThickness: -30, proportionalWidth: 100, extendAscDesc: 0, counterWidth: 0 }, kerning: {} },
      rename: { familyName: 'Cache Verify Thin' },
      rangeIds: ['basic-latin'],
      formats: ['ttf'],
    });

    const thick = await inspectFont(global.__thickOutputs.ttf);
    const thin = await inspectFont(thinOutputs.ttf);

    assert.strictEqual(thick.family, 'Cache Verify Thick');
    assert.strictEqual(thin.family, 'Cache Verify Thin');
    assert.notStrictEqual(thick.hWidth, thin.hWidth, "stem thickness +30 vs -30 should produce a measurably different 'H' glyph width");
    assert.ok(thick.hWidth > thin.hWidth, "positive stemThickness should widen 'H' relative to negative");
  });

  await test('moderate slider values (real user report: 15/105/27/16) produce a change visible at typical preview size, not just nonzero', async () => {
    // Regression test for a real report: sliders at these exact values
    // looked visually identical to stock Roboto in the UI. The transform
    // WAS applying (confirmed non-identical bytes) but the per-percent
    // coefficients were calibrated so small that the change was
    // sub-pixel at normal preview sizes (~50-70px) — technically real,
    // functionally invisible. Assert a clearly visible px delta at a
    // representative preview size, not just "the numbers changed".
    const session = sessionCache.getSession(sessionId);
    const PREVIEW_PX = 56;

    const { outputs: zeroOut } = await runFontExport({
      fontBuffer: session.fontBuffer,
      recipe: { transforms: { stemThickness: 0, proportionalWidth: 100, extendAscDesc: 0, counterWidth: 0 }, kerning: {} },
      rename: { familyName: 'Calibration Zero' },
      rangeIds: ['basic-latin'],
      formats: ['ttf'],
    });
    const { outputs: userOut } = await runFontExport({
      fontBuffer: session.fontBuffer,
      recipe: { transforms: { stemThickness: 15, proportionalWidth: 105, extendAscDesc: 27, counterWidth: 16 }, kerning: {} },
      rename: { familyName: 'Calibration UserVals' },
      rangeIds: ['basic-latin'],
      formats: ['ttf'],
    });

    const zero = await inspectFont(zeroOut.ttf);
    const user = await inspectFont(userOut.ttf);
    const upm = 2048; // Roboto's unitsPerEm
    const mWidthDeltaPx = Math.abs(user.hWidth - zero.hWidth) / upm * PREVIEW_PX;

    assert.ok(mWidthDeltaPx >= 1.5, `'H' width changed only ${mWidthDeltaPx.toFixed(2)}px at ${PREVIEW_PX}px preview size — too subtle to notice, same failure mode as the original report`);
  });

  await test('download (final rename) matches the preview it was based on — same transform, only naming differs', async () => {
    const session = sessionCache.getSession(sessionId);
    const recipe = { transforms: { stemThickness: 15, proportionalWidth: 108, extendAscDesc: -10, counterWidth: 5 }, kerning: { enabledGroupIds: ['round-pairs'], balance: 20, advancedPairs: {} } };

    // "preview" — placeholder name, exactly what the debounced UI sends.
    const { outputs: previewOut } = await runFontExport({
      fontBuffer: session.fontBuffer,
      recipe,
      rename: { familyName: 'Roboto Draft' },
      rangeIds: ['basic-latin'],
      formats: ['ttf'],
    });

    // "download" — same session, same recipe, only the final name differs.
    const { outputs: downloadOut } = await runFontExport({
      fontBuffer: session.fontBuffer,
      recipe,
      rename: { familyName: 'My Real Custom Name' },
      rangeIds: ['basic-latin'],
      formats: ['ttf'],
    });

    const previewInfo = await inspectFont(previewOut.ttf);
    const downloadInfo = await inspectFont(downloadOut.ttf);

    assert.strictEqual(previewInfo.family, 'Roboto Draft');
    assert.strictEqual(downloadInfo.family, 'My Real Custom Name');
    // The actual structural edit (glyph width) must be identical — same recipe, same base bytes.
    assert.strictEqual(previewInfo.hWidth, downloadInfo.hWidth, 'download must apply the exact same transform as the preview it was based on');
  });

  await test('an expired/missing session id returns null, not a throw', () => {
    const result = sessionCache.getSession('00000000-0000-0000-0000-000000000000');
    assert.strictEqual(result, null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error running tests:', err);
  process.exit(1);
});
