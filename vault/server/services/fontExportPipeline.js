'use strict';

/**
 * Node <-> Python bridge for the Font Customizer's Phase 1-4 pipeline
 * (server/services/fonts/), following the same subprocess/temp-dir/
 * cleanup pattern as officeConvert.js (LibreOffice) and videoFfmpeg.js
 * (ffmpeg): try a list of candidate binaries, write input to a per-request
 * temp dir, run, read output files back, always clean up in `finally`.
 *
 * The Python side (fonts/cli_export.py) is invoked as a module
 * (`-m fonts.cli_export`) with cwd = server/services, since that package
 * uses relative imports throughout (same reason its own tests/ do).
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PYTHON_BINS = [
  process.env.FONTS_PYTHON_BIN,
  'python3',
  'python',
].filter(Boolean);

const SERVICES_DIR = path.join(__dirname); // server/services — cwd for `-m fonts.cli_export`
const CLI_TIMEOUT_MS = Number(process.env.FONTS_EXPORT_TIMEOUT_MS || 120_000);

// Error types the Python side reports that are the CALLER's fault (bad
// input / license), not a server problem — mapped to 400 by the route.
const USER_ERROR_TYPES = new Set(['OFLComplianceError', 'LicenseNotAllowedError', 'FontNotFoundError', 'ValueError']);

/**
 * @param {object} opts
 * @param {string} [opts.family] - Google Fonts family name (Phase 1 fetch) — exactly one of family/fontBuffer required
 * @param {Buffer} [opts.fontBuffer] - raw font bytes to use directly, skipping Phase 1 fetch
 * @param {string} [opts.fontExt] - extension for fontBuffer (default '.ttf')
 * @param {object} opts.recipe - { transforms, kerning } — Phase 3 structural.apply_transform_recipe shape
 * @param {object} opts.rename - { familyName, copyright?, trademark? } — Phase 4 OFL rename
 * @param {string[]} [opts.rangeIds] - subsetting unicode range ids (default ['basic-latin'])
 * @param {string[]} [opts.formats] - which outputs to produce (default ['ttf','woff2','otf'])
 * @returns {Promise<{ outputs: Record<string, Buffer>, report: object }>}
 */
async function runFontExport({ family, fontBuffer, fontExt = '.ttf', recipe, rename, rangeIds, formats }) {
  if (!family && !fontBuffer) throw new Error('Either a Google Fonts family name or an uploaded font file is required.');
  if (family && fontBuffer) throw new Error('Provide either a Google Fonts family name or an uploaded font file, not both.');
  if (!rename || !rename.familyName) throw new Error('A new family name is required for the OFL-compliant export.');

  const id = crypto.randomUUID();
  const tmpDir = path.join(os.tmpdir(), `vault_fonts_export_${id}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  try {
    const params = {
      family: family || null,
      font_file: null,
      recipe: recipe || {},
      rename: {
        familyName: rename.familyName,
        copyright: rename.copyright || null,
        trademark: rename.trademark || null,
      },
      subset: { rangeIds: rangeIds && rangeIds.length ? rangeIds : ['basic-latin'] },
      formats: formats && formats.length ? formats : ['ttf', 'woff2', 'otf'],
    };

    if (fontBuffer) {
      const inputPath = path.join(tmpDir, `input${fontExt}`);
      await fsp.writeFile(inputPath, fontBuffer);
      params.font_file = inputPath.replace(/\\/g, '/'); // Python on Windows is happier with forward slashes in JSON-carried paths
    }

    const paramsPath = path.join(tmpDir, 'params.json');
    await fsp.writeFile(paramsPath, JSON.stringify(params));

    const outputDir = path.join(tmpDir, 'out');
    await fsp.mkdir(outputDir, { recursive: true });

    const { result, triedErrors } = await runPythonModuleWithFallback(
      ['-m', 'fonts.cli_export', '--params-file', paramsPath, '--output-dir', outputDir],
    );

    if (!result) {
      const err = new Error(triedErrors.join(' | ') || 'Python font export pipeline is not available on this server.');
      err.code = 'ENOENT';
      throw err;
    }

    if (!result.ok) {
      const err = new Error(result.error || 'Font export failed.');
      err.pythonErrorType = result.error_type;
      err.code = USER_ERROR_TYPES.has(result.error_type) ? 'FONT_EXPORT_USER_ERROR' : 'FONT_EXPORT_FAILED';
      if (result.traceback) err.pythonTraceback = result.traceback;
      throw err;
    }

    const outputs = {};
    for (const fmt of result.formats) {
      outputs[fmt] = await fsp.readFile(path.join(outputDir, `export.${fmt}`));
    }
    const report = JSON.parse(await fsp.readFile(path.join(outputDir, 'report.json'), 'utf8'));

    return { outputs, report };
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Tries each candidate Python binary in turn (ENOENT = "not installed",
 * try the next one) running `<bin> <args>` with cwd = server/services.
 * Shared by fontExportPipeline.js and fontGoogleCatalog.js so both talk
 * to the fonts/ package the same way.
 */
async function runPythonModuleWithFallback(args, { timeout = CLI_TIMEOUT_MS } = {}) {
  const triedErrors = [];
  for (const bin of PYTHON_BINS) {
    try {
      const { stdout } = await execFileAsync(
        bin,
        args,
        { cwd: SERVICES_DIR, timeout, maxBuffer: 10 * 1024 * 1024 },
      );
      const result = parseLastJsonLine(stdout);
      if (!result) {
        triedErrors.push(`${bin}: no JSON status line in output`);
        continue;
      }
      return { result, triedErrors };
    } catch (err) {
      // execFile rejects on non-zero exit (which cli_export.py uses for its
      // own reported failures too) — recover the JSON status from stdout
      // before treating this as "binary not usable".
      if (err.stdout) {
        const result = parseLastJsonLine(err.stdout);
        if (result) return { result, triedErrors };
      }
      const code = err.code ? ` (${err.code})` : '';
      triedErrors.push(`${bin}${code}: ${err.message || err}`);
      if (err.code === 'ENOENT') continue; // this binary doesn't exist — try the next candidate
      // A real crash (non-JSON stderr, e.g. missing fonttools import) — still try remaining bins.
    }
  }
  return { result: null, triedErrors };
}

function parseLastJsonLine(stdout) {
  const lines = String(stdout || '').trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

module.exports = { runFontExport, runPythonModuleWithFallback, parseLastJsonLine, SERVICES_DIR };
