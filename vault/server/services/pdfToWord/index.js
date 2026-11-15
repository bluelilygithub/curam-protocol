'use strict';

// PDF -> Word (.docx) via pdf2docx (pdf_to_docx.py). Used by PDF Tools (PDF -> Word) and Document Redaction's PDF intake.
// LibreOffice's PDF import is NOT used for this: it puts every line in a positioned text box and the .docx export
// stacks all pages onto page 1.

const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, 'pdf_to_docx.py');
const PYTHON_BINS = [process.env.PDF2DOCX_PYTHON_BIN, process.env.REDACT_PYTHON_BIN, 'python3', 'python'].filter(Boolean);

/**
 * @param {Buffer} pdfBuf
 * @returns {Promise<Buffer>} the .docx
 * Throws with err.code 'PDF2DOCX_MISSING' when no Python with pdf2docx is available.
 */
async function pdfToDocx(pdfBuf) {
  const dir = path.join(os.tmpdir(), `vault_pdf2docx_${crypto.randomUUID()}`);
  await fsp.mkdir(dir, { recursive: true });
  const inFile = path.join(dir, 'input.pdf');
  const outFile = path.join(dir, 'output.docx');
  await fsp.writeFile(inFile, pdfBuf);
  const errors = [];
  try {
    for (const bin of PYTHON_BINS) {
      let out;
      try {
        const r = await execFileAsync(bin, [SCRIPT, inFile, outFile], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
        out = r.stdout;
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        out = err.stdout;
        if (!out) { errors.push(`${bin}: ${err.killed ? 'timed out' : (err.message || err)}`); break; }
      }
      let res;
      try { res = JSON.parse(String(out).trim().split('\n').pop()); } catch { res = { ok: false, error: String(out).slice(0, 300) }; }
      if (res.ok) return await fsp.readFile(outFile);
      if (res.missing) { errors.push(`${bin}: ${res.error}`); continue; }
      errors.push(`${bin}: ${res.error}`);
      break;
    }
    const err = new Error(errors.join(' | ') || 'Python is not available on this server.');
    // Missing = no Python ran, or every Python that ran lacked pdf2docx. Callers fall back only in that case.
    err.code = (!errors.length || errors.every((e) => /not installed/.test(e))) ? 'PDF2DOCX_MISSING' : 'PDF2DOCX_FAILED';
    throw err;
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { pdfToDocx };
