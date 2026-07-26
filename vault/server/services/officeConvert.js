'use strict';

/**
 * Shared LibreOffice / soffice conversion — used by PDF Tools (`/api/pdf/*`)
 * and Document Redaction. Keep one implementation so both features stay aligned.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const LIBRE_BINS = [
  process.env.LIBREOFFICE_BIN,
  'libreoffice',
  'soffice',
  '/usr/bin/libreoffice',
  '/usr/bin/soffice',
  '/usr/lib/libreoffice/program/soffice',
].filter(Boolean);

/**
 * Convert an Office/PDF buffer to another format via LibreOffice headless.
 * @param {Buffer} inputBuf
 * @param {string} ext — source extension including dot (e.g. '.docx', '.pdf')
 * @param {string} targetFmt — libre target without dot (e.g. 'pdf', 'docx', 'txt')
 * @returns {Promise<Buffer>}
 */
async function libreConvert(inputBuf, ext, targetFmt) {
  const sourceExt = String(ext || '').toLowerCase().startsWith('.')
    ? String(ext).toLowerCase()
    : `.${String(ext || 'bin').toLowerCase()}`;
  const fmt = String(targetFmt || '').replace(/^\./, '').toLowerCase();
  if (!fmt) throw new Error('targetFmt required');

  const id = crypto.randomUUID();
  const tmpDir = path.join(os.tmpdir(), `vault_libre_${id}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, `input${sourceExt}`);
  await fsp.writeFile(inFile, inputBuf);

  const errors = [];
  try {
    for (const bin of LIBRE_BINS) {
      try {
        await execFileAsync(
          bin,
          ['--headless', '--convert-to', fmt, '--outdir', tmpDir, inFile],
          { timeout: 90_000 },
        );
        const outFile = path.join(tmpDir, `input.${fmt}`);
        if (fs.existsSync(outFile)) {
          return await fsp.readFile(outFile);
        }
        // LibreOffice sometimes names from original stem differently
        const files = await fsp.readdir(tmpDir);
        const match = files.find((f) => f.toLowerCase().endsWith(`.${fmt}`) && f !== path.basename(inFile));
        if (match) return await fsp.readFile(path.join(tmpDir, match));
        errors.push(`${bin}: no .${fmt} output`);
      } catch (err) {
        const code = err.code ? ` (${err.code})` : '';
        errors.push(`${bin}${code}: ${err.message || err}`);
        if (err.code === 'ENOENT') continue;
      }
    }
    const err = new Error(
      errors.some((e) => /ENOENT/.test(e))
        ? 'LibreOffice is not available on this server. Use PDF Tools after deploy, or install libreoffice.'
        : (errors.join(' | ') || `LibreOffice did not produce .${fmt}`),
    );
    err.code = errors.some((e) => /ENOENT/.test(e)) ? 'ENOENT' : 'LIBRE_CONVERT_FAILED';
    throw err;
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  libreConvert,
  LIBRE_BINS,
};
