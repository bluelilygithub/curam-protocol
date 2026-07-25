'use strict';

/**
 * Milestone 3 smoke tests — apply DOCX, metadata scrub, internal/ export guard.
 * Run: node server/services/documentRedaction/milestone3.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { parseDocxBuffer, findOccurrences } = require('./docxParse');
const { applyReplacementsToDocx, applyReplacementsToText } = require('./applyDocx');
const { assertReadyToApply } = require('./applyGate');
const { heuristicFallback } = require('./syntheticReplacements');
const {
  createJobShell,
  saveOriginalDocx,
  saveRedactedDocx,
  saveEntityMap,
  appendAudit,
  resolveExportArtifactPath,
  isExportForbiddenRelativePath,
  EXPORTABLE_ARTIFACTS,
  jobDir,
  internalDir,
} = require('./jobStore');

async function buildFixtureDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Patient Jane Smith contacted us.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Invoice $12,400 for Jane Smith.</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>`);
  zip.folder('word').file('comments.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="0"><w:p><w:r><w:t>Secret note about Jane</w:t></w:r></w:p></w:comment>
</w:comments>`);
  zip.folder('docProps').file('core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Dr Real Author</dc:creator>
  <cp:lastModifiedBy>Nurse Leak</cp:lastModifiedBy>
  <cp:revision>7</cp:revision>
</cp:coreProperties>`);
  zip.folder('docProps').file('app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Company>Secret Hospital Pty Ltd</Company>
  <Manager>CEO Name</Manager>
</Properties>`);
  zip.folder('docProps').file('custom.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ClientId"><vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">REAL-CLIENT</vt:lpwstr></property>
</Properties>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

function testGate() {
  try {
    assertReadyToApply([{ decision: 'approved', score: 0.9 }], { confirmApply: false });
    assert.fail('expected confirm required');
  } catch (err) {
    assert.strictEqual(err.code, 'CONFIRM_REQUIRED');
  }

  try {
    assertReadyToApply([{ decision: 'pending', score: 0.9 }], { confirmApply: true });
    assert.fail('expected no approved');
  } catch (err) {
    assert.strictEqual(err.code, 'NO_APPROVED');
  }

  try {
    assertReadyToApply([
      { decision: 'approved', score: 0.9, id: 'a' },
      { decision: 'pending', score: 0.8, id: 'b', entityText: 'x' },
    ], { confirmApply: true });
    assert.fail('expected pending blocking');
  } catch (err) {
    assert.strictEqual(err.code, 'PENDING_BLOCKING');
    assert.strictEqual(err.blocking.length, 1);
  }

  const ok = assertReadyToApply([
    { decision: 'approved', score: 0.9 },
    { decision: 'pending', score: 0.2 },
    { decision: 'rejected', score: 0.9 },
  ], { confirmApply: true });
  assert.strictEqual(ok.approved.length, 1);
  assert.strictEqual(ok.pendingLow.length, 1);
}

function testExportGuard() {
  assert.strictEqual(isExportForbiddenRelativePath('redacted.docx'), false);
  assert.strictEqual(isExportForbiddenRelativePath('sanitized.pdf'), false);
  assert.strictEqual(isExportForbiddenRelativePath('internal/entity-map.json'), true);
  assert.strictEqual(isExportForbiddenRelativePath('internal/audit.jsonl'), true);
  assert.strictEqual(isExportForbiddenRelativePath('../internal/entity-map.json'), true);
  assert.strictEqual(isExportForbiddenRelativePath('entity-map.json'), true);
  assert.strictEqual(isExportForbiddenRelativePath('job.json'), true);
  assert.ok(EXPORTABLE_ARTIFACTS.includes('redacted.docx'));

  const routeSrc = fs.readFileSync(
    path.join(__dirname, '../../routes/documentRedaction.js'),
    'utf8',
  );
  assert.ok(/createDownloadHandler/.test(routeSrc), 'download route must use createDownloadHandler');
  assert.ok(!/sendFile\(\s*path\.join\(\s*jobDir/.test(routeSrc));
}

/**
 * HTTP-level: hit the real download handler with .../internal/entity-map.json → 403.
 * Does not load applyService / DB.
 */
async function testDownloadRouteHttp() {
  const express = require('express');
  const http = require('http');
  const { createDownloadHandler } = require('./exportDownload');

  const prev = process.env.UPLOAD_DIR;
  const tmpRoot = path.join(__dirname, '../../../uploads/_m3_dl_' + Date.now());
  process.env.UPLOAD_DIR = tmpRoot;

  let server;
  try {
    const job = createJobShell(42, { originalFilename: 'secret.docx' });
    saveEntityMap(job.id, {
      kind: 'entity_map_v1',
      entries: [{ realValue: 'LEAK-ME', syntheticValue: 'SAFE', categoryLabel: 'x', occurrenceCount: 1 }],
    });
    saveRedactedDocx(job.id, Buffer.from('ok-docx'));

    const app = express();
    app.use((req, _res, next) => { req.user = { id: 42 }; next(); });
    const handler = createDownloadHandler();
    app.get('/api/document-redaction/jobs/:id/download/:artifact', handler);
    app.get('/api/document-redaction/jobs/:id/download/*', (req, res) => {
      req.params.artifact = req.params[0];
      return handler(req, res);
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    async function get(artifact) {
      const url = `http://127.0.0.1:${port}/api/document-redaction/jobs/${job.id}/download/${artifact}`;
      const res = await fetch(url);
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, body };
    }

    const forbidden = await get('internal/entity-map.json');
    assert.strictEqual(forbidden.status, 403, `expected 403 for internal path, got ${forbidden.status}`);
    assert.ok(forbidden.body?.code === 'EXPORT_FORBIDDEN' || /not exportable|blocked/i.test(forbidden.body?.error || ''));

    const traversal = await get(encodeURIComponent('../internal/entity-map.json'));
    assert.ok(traversal.status === 403 || traversal.status === 404, `traversal status ${traversal.status}`);

    const ok = await get('redacted.docx');
    assert.strictEqual(ok.status, 200, `expected 200 for redacted.docx, got ${ok.status}`);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prev === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prev;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function testTrackedChangesFailClosed() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  </Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  </Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello </w:t></w:r>
      <w:ins w:author="Leak"><w:r><w:t>SECRET</w:t></w:r></w:ins>
      <w:del w:author="Leak"><w:r><w:delText>OLD</w:delText></w:r></w:del>
    </w:p>
  </w:body>
</w:document>`);
  const buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));

  let blocked = false;
  try {
    await applyReplacementsToDocx(buf, []);
  } catch (err) {
    blocked = true;
    assert.strictEqual(err.code, 'TRACKED_CHANGES');
    assert.strictEqual(err.status, 409);
  }
  assert.ok(blocked, 'apply without acceptTrackedChanges must fail-closed');

  const { buffer, metadataReport } = await applyReplacementsToDocx(buf, [], { acceptTrackedChanges: true });
  assert.ok(metadataReport.trackedChangesAccepted);
  const ir = await parseDocxBuffer(buffer);
  assert.ok(ir.fullText.includes('SECRET'), 'accepted insert kept');
  assert.ok(!ir.fullText.includes('OLD'), 'deleted text dropped');
}

async function testApplyDocxAndScrub() {
  const buf = await buildFixtureDocx();
  const ir = await parseDocxBuffer(buf);
  const janeLocs = findOccurrences(ir, 'Jane Smith');
  assert.ok(janeLocs.length >= 2, 'expected Jane Smith locs');

  const ops = janeLocs.map((loc) => ({
    ...loc,
    synthetic: 'Alex Morgan',
  }));
  // also replace dollar figure
  const moneyLocs = findOccurrences(ir, '$12,400');
  for (const loc of moneyLocs) {
    ops.push({ ...loc, synthetic: '$10,788' });
  }

  const { buffer, metadataReport, paragraphsTouched } = await applyReplacementsToDocx(buf, ops);
  assert.ok(paragraphsTouched >= 1);
  assert.ok(metadataReport.stripped.length >= 1, 'expected metadata scrub');
  assert.ok(
    metadataReport.stripped.some((s) => /creator|Company|custom|comments/i.test(s)),
    `unexpected scrub list: ${metadataReport.stripped.join(',')}`,
  );

  const ir2 = await parseDocxBuffer(buffer);
  assert.ok(!ir2.fullText.includes('Jane Smith'), 'real name should be gone');
  assert.ok(ir2.fullText.includes('Alex Morgan'), 'synthetic name present');
  assert.ok(!ir2.fullText.includes('$12,400'), 'real amount gone');
  assert.ok(ir2.fullText.includes('$10,788'), 'synthetic amount present');

  const zip2 = await JSZip.loadAsync(buffer);
  assert.ok(!zip2.file('word/comments.xml'), 'comments removed');
  assert.ok(!zip2.file('docProps/custom.xml'), 'custom props removed');
  const core = await zip2.file('docProps/core.xml').async('string');
  assert.ok(!/Dr Real Author/.test(core), 'creator scrubbed');
  assert.ok(!/Nurse Leak/.test(core), 'lastModifiedBy scrubbed');
}

function testJobInternalIsolation() {
  const prev = process.env.UPLOAD_DIR;
  const tmpRoot = path.join(__dirname, '../../../uploads/_m3_test_' + Date.now());
  process.env.UPLOAD_DIR = tmpRoot;
  try {
    const job = createJobShell(1, { originalFilename: 't.docx' });
    const id = job.id;
    assert.ok(fs.existsSync(internalDir(id)));

    saveOriginalDocx(id, Buffer.from('PK'), 't.docx');
    saveEntityMap(id, {
      kind: 'entity_map_v1',
      entries: [{ realValue: 'SECRET', syntheticValue: 'SAFE', categoryLabel: 'person_name', occurrenceCount: 1 }],
    });
    appendAudit(id, { type: 'test', note: 'SECRET should stay internal' });
    saveRedactedDocx(id, Buffer.from('redacted-bytes'));

    // Exportable resolves
    const redacted = resolveExportArtifactPath(id, 'redacted.docx');
    assert.ok(redacted.endsWith('redacted.docx'));

    // Internal must throw
    let blocked = false;
    try {
      resolveExportArtifactPath(id, 'internal/entity-map.json');
    } catch (err) {
      blocked = true;
      assert.ok(err.status === 404 || err.status === 400 || err.status === 403);
    }
    assert.ok(blocked, 'internal entity-map must not resolve for download');

    // Confirm map file exists on disk but not via export helper
    const mapPath = path.join(jobDir(id), 'internal', 'entity-map.json');
    assert.ok(fs.existsSync(mapPath));
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    assert.strictEqual(map.entries[0].realValue, 'SECRET');
  } finally {
    if (prev === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prev;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function testHeuristics() {
  assert.ok(heuristicFallback('$12,400', 'financial_figure').startsWith('$'));
  assert.notStrictEqual(heuristicFallback('Jane Smith', 'person_name'), 'Jane Smith');
  assert.ok(heuristicFallback('a@b.com', 'email').includes('@'));
}

function testTextReplace() {
  const out = applyReplacementsToText('Hello Jane Smith today', [
    { startOffset: 6, endOffset: 16, synthetic: 'Alex Morgan', quote: 'Jane Smith' },
  ]);
  assert.strictEqual(out, 'Hello Alex Morgan today');
}

async function run() {
  testGate();
  testExportGuard();
  testHeuristics();
  testTextReplace();
  await testApplyDocxAndScrub();
  testJobInternalIsolation();
  await testTrackedChangesFailClosed();
  await testDownloadRouteHttp();
  console.log('OK milestone3 tests');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
