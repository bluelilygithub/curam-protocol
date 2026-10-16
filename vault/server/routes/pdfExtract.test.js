#!/usr/bin/env node
/**
 * PDF text extraction on upload. pdfjs-dist 6.x has no legacy/build/pdf.js, so the old require() failed
 * for every PDF: project file uploads were stored with empty text (silently) and the debate /extract
 * route returned a 500. This test builds a real PDF and sends it through both real routes, plus a
 * corrupt one (must not crash the upload). No model is called.
 * Integration test: needs a real Postgres. Uses a throwaway user/project and a throwaway upload folder.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/pdfExtract.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP pdfExtract.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}
// No outside calls: a successful extraction would otherwise try to summarise with a real model.
process.env.ANTHROPIC_API_KEY = ''; process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-extract-test-'));
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { pool } = require('../db');
const { extractPdfTextFromBuffer } = require('../utils/pdfText');

const app = express();
app.use(express.json());
let USER; let PROJECT;
app.use((req, _res, next) => { req.user = { id: USER, isAdmin: false }; next(); });
app.use('/api/files', require('./files'));
app.use('/api/debate', require('./debate'));

const MARKER = `Quarterly marker ${Date.now()}`;
async function makePdf(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((text, i) => { doc.addPage().drawText(text, { x: 50, y: 700, size: 14, font }); });
  return Buffer.from(await doc.save());
}
let base;
const form = (buf, name) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'application/pdf' }), name); return fd; };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('helper: text of every page, in order', async () => {
  const pages = await extractPdfTextFromBuffer(await makePdf([MARKER, 'second page text']));
  assert.strictEqual(pages.length, 2);
  assert.ok(pages[0].includes(MARKER)); assert.ok(pages[1].includes('second page text'));
});

test('project upload: a PDF is stored with its extracted text (not empty)', async () => {
  const res = await fetch(`${base}/api/files/upload/${PROJECT}`, { method: 'POST', body: form(await makePdf([MARKER]), 'report.pdf') });
  assert.ok(res.status === 200 || res.status === 201, `status ${res.status}: ${await res.text()}`);
  const row = (await pool.query(`SELECT "extractedText", path, mimetype FROM files WHERE "projectId"=$1 AND name='report.pdf'`, [PROJECT])).rows[0];
  assert.ok(row, 'file row stored');
  assert.ok((row.extractedText || '').includes(MARKER), `extracted text missing, got: ${JSON.stringify(row.extractedText)}`);
  assert.strictEqual(row.path, null, 'PDF binary discarded, only text kept (unchanged)');
});

test('project upload: a corrupt PDF still uploads (empty text, no crash)', async () => {
  const res = await fetch(`${base}/api/files/upload/${PROJECT}`, { method: 'POST', body: form(Buffer.from('not a pdf at all'), 'broken.pdf') });
  assert.ok(res.status === 200 || res.status === 201, `status ${res.status}: ${await res.text()}`);
  const row = (await pool.query(`SELECT "extractedText" FROM files WHERE "projectId"=$1 AND name='broken.pdf'`, [PROJECT])).rows[0];
  assert.ok(row && !row.extractedText);
});

test('debate extract: a PDF returns its text', async () => {
  const res = await fetch(`${base}/api/debate/extract`, { method: 'POST', body: form(await makePdf([MARKER, 'page two']), 'brief.pdf') });
  const json = await res.json();
  assert.strictEqual(res.status, 200, JSON.stringify(json));
  assert.ok(json.extractedText.includes(MARKER) && json.extractedText.includes('page two'));
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const run = Date.now();
  USER = (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`pdf-${run}@example.test`])).rows[0].id;
  PROJECT = (await pool.query(`INSERT INTO projects (name,"userId",model) VALUES ('pdf test',$1,'m') RETURNING id`, [USER])).rows[0].id;
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const t of tests) {
      try { await t.fn(); console.log(`  ok   ${t.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
    }
  } finally {
    server.close();
    await pool.query(`DELETE FROM users WHERE id=$1`, [USER]); // projects and files cascade
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
