#!/usr/bin/env node
/**
 * PDF Tools → Fill & Sign hidden signing stamp. Signing writes VaultSigningId/SignedBy/SignedAt into the PDF's Info
 * dictionary and saves a pdf_signatures row with hashes of the original and signed files. The lookup only shows the
 * signer's own records.
 * Integration test: needs a real Postgres. Uses two throwaway users.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/pdfSign.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP pdfSign.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-sign-test-'));
const { PDFDocument, PDFName } = require('pdf-lib');
const { pool } = require('../db');

const app = express();
app.use(express.json({ limit: '10mb' }));
let USER = {}; let OTHER = {}; let actAs;
app.use((req, _res, next) => { req.user = { id: actAs.id, email: actAs.email, isAdmin: false }; next(); });
app.use('/api/pdf', require('./pdf'));
app.use('/api/attachments', require('./attachments'));

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SIG_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let base;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'sign-test' }, body: JSON.stringify(body) });

let signed; let original;
test('sign: stamps the hidden ID and stores a matching record', async () => {
  const doc = await PDFDocument.create(); doc.addPage();
  original = Buffer.from(await doc.save());
  actAs = USER;
  const res = await post('/api/pdf/sign', {
    dataUrl: `data:application/pdf;base64,${original.toString('base64')}`, fileName: 'agreement.pdf',
    signatures: [{ page: 1, x: 50, y: 50, width: 100, height: 40, type: 'image', dataUrl: SIG_PNG }],
  });
  const json = await res.json();
  assert.strictEqual(res.status, 200, JSON.stringify(json));
  signed = Buffer.from(json.dataUrl.split(',')[1], 'base64');

  const info = (await PDFDocument.load(signed)).getInfoDict();
  assert.strictEqual(info.lookup(PDFName.of('VaultSigningId')).decodeText(), json.signingId);
  assert.strictEqual(info.lookup(PDFName.of('VaultSignedBy')).decodeText(), USER.email);

  const row = (await pool.query(`SELECT * FROM pdf_signatures WHERE "signingId"=$1`, [json.signingId])).rows[0];
  assert.ok(row, 'record stored');
  assert.strictEqual(row.userId, USER.id);
  assert.strictEqual(row.originalSha256, sha(original));
  assert.strictEqual(row.signedSha256, sha(signed), 'stored hash is the hash of the file handed back');
  assert.strictEqual(row.fileName, 'agreement.pdf');
  assert.strictEqual(row.userAgent, 'sign-test');
  assert.strictEqual(info.lookup(PDFName.of('VaultSignedAt')).decodeText(), row.signedAt.toISOString());
  signed.id = json.signingId;
  signed.copyKept = json.copyKept;
});

test('lookup: the signer sees the record', async () => {
  actAs = USER;
  const res = await fetch(`${base}/api/pdf/signatures/${signed.id}`);
  const json = await res.json();
  assert.strictEqual(res.status, 200, JSON.stringify(json));
  assert.strictEqual(json.signedSha256, sha(signed));
  assert.strictEqual(json.signerEmail, USER.email);
});

test('lookup: another user gets 404, and a malformed ID gets 404', async () => {
  actAs = OTHER;
  assert.strictEqual((await fetch(`${base}/api/pdf/signatures/${signed.id}`)).status, 404);
  actAs = USER;
  assert.strictEqual((await fetch(`${base}/api/pdf/signatures/not-a-uuid`)).status, 404);
});

test('signed PDFs: a copy of the signed file is kept, listed and downloadable by the signer only', async () => {
  actAs = USER;
  assert.strictEqual(signed.copyKept, true);
  const list = await (await fetch(`${base}/api/pdf/signatures`)).json();
  const row = list.signatures.find((s) => s.signingId === signed.id);
  assert.ok(row && row.attachmentId, 'listed with its copy');
  assert.strictEqual(row.fileName, 'agreement.pdf');
  const dl = await fetch(`${base}/api/attachments/${row.attachmentId}/download`);
  assert.strictEqual(dl.status, 200);
  assert.strictEqual(sha(Buffer.from(await dl.arrayBuffer())), sha(signed), 'the kept copy is byte-for-byte the signed file');

  actAs = OTHER;
  assert.strictEqual((await fetch(`${base}/api/attachments/${row.attachmentId}/download`)).status, 404);
  assert.strictEqual((await (await fetch(`${base}/api/pdf/signatures`)).json()).signatures.length, 0, 'another user lists nothing');
});

test('sign: nothing placed means no record and an error', async () => {
  actAs = USER;
  const before = (await pool.query(`SELECT COUNT(*)::int n FROM pdf_signatures WHERE "userId"=$1`, [USER.id])).rows[0].n;
  const res = await post('/api/pdf/sign', { dataUrl: `data:application/pdf;base64,${original.toString('base64')}`, signatures: [{ page: 1, type: 'type', text: '' }] });
  assert.strictEqual(res.status, 400);
  const after = (await pool.query(`SELECT COUNT(*)::int n FROM pdf_signatures WHERE "userId"=$1`, [USER.id])).rows[0].n;
  assert.strictEqual(after, before);
});

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const run = Date.now();
  for (const [u, tag] of [[USER, 'a'], [OTHER, 'b']]) {
    u.email = `sign-${tag}-${run}@example.test`;
    u.id = (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [u.email])).rows[0].id;
  }
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
    await pool.query(`DELETE FROM attachments WHERE "userId" = ANY($1)`, [[USER.id, OTHER.id]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER.id, OTHER.id]]); // pdf_signatures cascade
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
