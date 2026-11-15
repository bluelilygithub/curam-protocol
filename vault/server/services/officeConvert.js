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

// A PDF opens in Draw by default, and Draw has no Word/text export: LibreOffice exits 0 and writes nothing
// ("no .docx output"). For text targets, open the PDF with Writer's PDF import and name the export filter.
const PDF_TEXT_TARGETS = {
  docx: 'docx:MS Word 2007 XML',
  doc: 'doc:MS Word 97',
  odt: 'odt:writer8',
  rtf: 'rtf:Rich Text Format',
  txt: 'txt:Text (encoded):UTF8',
};

/** LibreOffice arguments for one conversion (exported for tests). */
function libreArgs(sourceExt, fmt, inFile, outDir) {
  const viaWriter = sourceExt === '.pdf' && PDF_TEXT_TARGETS[fmt];
  return [
    '--headless',
    ...(viaWriter ? ['--infilter=writer_pdf_import'] : []),
    '--convert-to', viaWriter || fmt,
    '--outdir', outDir,
    inFile,
  ];
}

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
        const { stdout, stderr } = await execFileAsync(
          bin,
          libreArgs(sourceExt, fmt, inFile, tmpDir),
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
        const said = `${stderr || ''} ${stdout || ''}`.replace(/\s+/g, ' ').trim().slice(0, 300);
        errors.push(`${bin}: no .${fmt} output${said ? ` (${said})` : ''}`);
        break; // the binary ran; the others are the same LibreOffice and would fail the same way
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
  libreArgs,
  LIBRE_BINS,
};
