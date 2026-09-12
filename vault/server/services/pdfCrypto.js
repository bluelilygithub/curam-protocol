'use strict';

/**
 * Password protect / remove password for a PDF via qpdf (native binary).
 * pdf-lib cannot write encrypted PDFs, so this shells out to qpdf the same
 * way officeConvert.js shells out to LibreOffice: write a temp input file,
 * run the binary, read the temp output file back, clean up either way.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const QPDF_BINS = [
  process.env.QPDF_BIN,
  'qpdf',
  '/usr/bin/qpdf',
].filter(Boolean);

async function withTempDir(fn) {
  const id = crypto.randomUUID();
  const tmpDir = path.join(os.tmpdir(), `vault_qpdf_${id}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  try {
    return await fn(tmpDir);
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runQpdf(args) {
  const errors = [];
  for (const bin of QPDF_BINS) {
    try {
      return await execFileAsync(bin, args, { timeout: 60_000 });
    } catch (err) {
      const code = err.code ? ` (${err.code})` : '';
      errors.push(`${bin}${code}: ${err.stderr || err.message}`);
      if (err.code === 'ENOENT') continue; // try next candidate binary
      // qpdf ran but exited non-zero (bad password, corrupt file, etc) —
      // surface that immediately rather than retrying other bin candidates.
      const e = new Error((err.stderr || err.message || 'qpdf failed').trim());
      e.stderr = err.stderr;
      e.qpdfExit = err.code;
      throw e;
    }
  }
  const isEnoent = errors.some((e) => /ENOENT/.test(e));
  const err = new Error(
    isEnoent
      ? 'qpdf is not available on this server. Use PDF Tools after the next deploy, or install qpdf.'
      : (errors.join(' | ') || 'qpdf did not produce output'),
  );
  err.code = isEnoent ? 'ENOENT' : 'QPDF_FAILED';
  throw err;
}

/**
 * @param {Buffer} buf source PDF bytes
 * @param {{ userPassword: string, ownerPassword?: string, permissions?: { printing?: boolean, copying?: boolean, modify?: boolean } }} opts
 * @returns {Promise<Buffer>} encrypted PDF bytes
 */
async function protectPdf(buf, { userPassword, ownerPassword, permissions = {} } = {}) {
  if (!userPassword) throw new Error('A password is required');
  return withTempDir(async (tmpDir) => {
    const inFile = path.join(tmpDir, 'in.pdf');
    const outFile = path.join(tmpDir, 'out.pdf');
    await fsp.writeFile(inFile, buf);
    const owner = ownerPassword || userPassword;
    const args = [
      '--encrypt', userPassword, owner, '256',
      permissions.printing === false ? '--print=none' : '--print=full',
      permissions.copying === false ? '--extract=n' : '--extract=y',
      permissions.modify === false ? '--modify=none' : '--modify=all',
      '--',
      inFile, outFile,
    ];
    await runQpdf(args);
    return fsp.readFile(outFile);
  });
}

/**
 * @param {Buffer} buf encrypted PDF bytes
 * @param {string} password
 * @returns {Promise<Buffer>} decrypted PDF bytes
 */
async function unprotectPdf(buf, password) {
  return withTempDir(async (tmpDir) => {
    const inFile = path.join(tmpDir, 'in.pdf');
    const outFile = path.join(tmpDir, 'out.pdf');
    await fsp.writeFile(inFile, buf);
    try {
      await runQpdf(['--decrypt', `--password=${password || ''}`, inFile, outFile]);
    } catch (err) {
      if (err.code !== 'ENOENT' && /password|decrypt/i.test(err.stderr || err.message || '')) {
        const e = new Error('Incorrect password.');
        e.wrongPassword = true;
        throw e;
      }
      throw err;
    }
    return fsp.readFile(outFile);
  });
}

module.exports = {
  protectPdf,
  unprotectPdf,
  QPDF_BINS,
};
