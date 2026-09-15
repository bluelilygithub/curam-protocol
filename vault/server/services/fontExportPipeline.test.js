#!/usr/bin/env node
/**
 * End-to-end test for the Node <-> Python font export bridge:
 * fontBuffer -> runFontExport() -> Python subprocess (Phase 1-4 pipeline,
 * unmodified) -> returned .ttf/.woff2/.otf + report, plus a failure path
 * (unchanged OFL family name) surfacing as a clear error, not a hang or
 * a generic crash.
 *
 * Requires a Python env with server/services/fonts/requirements.txt
 * installed (set FONTS_PYTHON_BIN to point at a venv's python.exe if the
 * system default doesn't have fontTools). Needs network the first time it
 * downloads the fixture font (cached to a temp file for reruns).
 *
 * Run: node server/services/fontExportPipeline.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const { runFontExport } = require('./fontExportPipeline');

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

const FIXTURE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/ptserif/PT_Serif-Web-Regular.ttf';
const FIXTURE_PATH = path.join(os.tmpdir(), 'vault_fonts_test_ptserif.ttf');

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

const RECIPE = {
  transforms: { stemThickness: 20, proportionalWidth: 110, extendAscDesc: 10, counterWidth: -5 },
  kerning: { enabledGroupIds: ['diagonal-caps'], balance: -30, advancedPairs: { AV: -20 } },
};

async function main() {
  const fontBuffer = await downloadFixture();

  await test('full pipeline: fontBuffer -> transform -> export returns ttf/woff2/otf + report', async () => {
    const { outputs, report } = await runFontExport({
      fontBuffer,
      recipe: RECIPE,
      rename: { familyName: 'Node Bridge Test Serif' },
      rangeIds: ['basic-latin', 'latin-1-supplement'],
      formats: ['ttf', 'woff2', 'otf'],
    });

    assert.deepStrictEqual(Object.keys(outputs).sort(), ['otf', 'ttf', 'woff2']);
    for (const [fmt, buf] of Object.entries(outputs)) {
      assert.ok(Buffer.isBuffer(buf) && buf.length > 0, `${fmt} output should be non-empty bytes`);
    }
    assert.strictEqual(report.renamed.new_family, 'Node Bridge Test Serif');
    assert.strictEqual(report.renamed.original_family, 'PT Serif');
    assert.ok(report.subset.glyphs_after < report.subset.glyphs_before, 'subsetting should reduce glyph count');
    assert.strictEqual(report.incomplete, false);
    assert.ok(report.structural_transforms_applied.composite_glyphs_reassembled.length > 0, 'composite glyphs should be reassembled, not skipped');
  });

  await test('failure path: unchanged OFL family name surfaces a clear, typed error (not a hang/crash)', async () => {
    await assert.rejects(
      runFontExport({
        fontBuffer,
        recipe: { transforms: {} },
        rename: { familyName: 'PT Serif' }, // matches the original — must be blocked
      }),
      (err) => {
        assert.strictEqual(err.code, 'FONT_EXPORT_USER_ERROR');
        assert.strictEqual(err.pythonErrorType, 'OFLComplianceError');
        assert.ok(/matches the original/i.test(err.message));
        return true;
      },
    );
  });

  await test('validation: rejects when neither family nor fontBuffer is given', async () => {
    await assert.rejects(
      runFontExport({ recipe: {}, rename: { familyName: 'X' } }),
      /Either a Google Fonts family name or an uploaded font file/,
    );
  });

  await test('validation: rejects when family name is missing from rename', async () => {
    await assert.rejects(
      runFontExport({ fontBuffer, recipe: {}, rename: {} }),
      /new family name is required/,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error running tests:', err);
  process.exit(1);
});
