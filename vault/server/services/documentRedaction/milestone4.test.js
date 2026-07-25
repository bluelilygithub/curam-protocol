'use strict';

/**
 * Milestone 4 smoke — compare highlights, leftover scan (masked), frontier gate.
 * Run: node server/services/documentRedaction/milestone4.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const {
  findHighlights,
  scanLeftovers,
  categoryColor,
  approveForFrontier,
  getComparePayload,
  fixLeftovers,
} = require('./compareService');
const {
  createJobShell,
  saveOriginalDocx,
  saveRedactedDocx,
  saveEntityMap,
  saveSanitizedPdf,
  appendAudit,
  jobDir,
  internalDir,
} = require('./jobStore');

async function miniDocx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  </Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  </Relationships>`);
  const body = paragraphs.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('');
  zip.folder('word').file('document.xml', `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

function testHighlights() {
  const hits = findHighlights('Hello Alex Morgan and Alex Morgan again', 'Alex Morgan', 'person_name');
  assert.strictEqual(hits.length, 2);
  assert.ok(hits[0].color.bg);
  assert.strictEqual(hits[0].categoryLabel, 'person_name');
}

function testLeftoverMask() {
  const leftovers = scanLeftovers('Still has Jane Smith in it', {
    entries: [{ realValue: 'Jane Smith', categoryLabel: 'person_name', syntheticValue: 'Alex Morgan' }],
  });
  assert.strictEqual(leftovers.length, 1);
  assert.ok(!JSON.stringify(leftovers).includes('Jane Smith'));
  assert.strictEqual(leftovers[0].categoryLabel, 'person_name');
  assert.ok(leftovers[0].context.includes('‹person_name›'));
  assert.strictEqual(leftovers[0].expectedSynthetic, 'Alex Morgan');
  assert.strictEqual(leftovers[0].paragraphIndex, 0);
}

function testCategoryColorStable() {
  assert.deepStrictEqual(categoryColor('person_name'), categoryColor('person_name'));
}

async function testCompareAndGate() {
  const prev = process.env.UPLOAD_DIR;
  const tmpRoot = path.join(__dirname, '../../../uploads/_m4_test_' + Date.now());
  process.env.UPLOAD_DIR = tmpRoot;
  try {
    const job = createJobShell(7, { originalFilename: 'c.docx', status: 'docx_ready_pdf_pending', pdfStatus: 'pending' });
    const orig = await miniDocx(['Patient Jane Smith paid $12,400.']);
    const red = await miniDocx(['Patient Alex Morgan paid $10,788.']);
    saveOriginalDocx(job.id, orig, 'c.docx');
    saveRedactedDocx(job.id, red);
    saveEntityMap(job.id, {
      kind: 'entity_map_v1',
      entries: [
        { realValue: 'Jane Smith', syntheticValue: 'Alex Morgan', categoryLabel: 'person_name', occurrenceCount: 1 },
        { realValue: '$12,400', syntheticValue: '$10,788', categoryLabel: 'financial_figure', occurrenceCount: 1 },
      ],
    });

    const payload = await getComparePayload(job.id, 7);
    assert.strictEqual(payload.pdfReady, false);
    assert.strictEqual(payload.canApproveForFrontier, false);
    assert.ok(payload.approveBlockedReason);
    assert.ok(payload.rows.length >= 1);
    assert.ok(payload.rows[0].redacted.highlights.length >= 1);
    assert.ok(payload.legend.length >= 1);
    // Leftover / map payloads must not include realValue keys
    assert.ok(!/"realValue"/.test(JSON.stringify(payload)));
    assert.ok(payload.rows[0].original.text.includes('Jane Smith')); // left pane is original — expected

    let blocked = false;
    try {
      await approveForFrontier(job.id, 7, { confirm: true });
    } catch (err) {
      blocked = true;
      assert.strictEqual(err.code, 'PDF_REQUIRED');
    }
    assert.ok(blocked, 'frontier approve must require PDF');

    saveSanitizedPdf(job.id, Buffer.from('%PDF-1.4 fake'));
    // Clean redacted has no leftovers — approve ok
    const ok = await approveForFrontier(job.id, 7, { confirm: true });
    assert.ok(ok.approvedAt);
    assert.strictEqual(ok.job.status, 'ready_for_frontier');

    const auditPath = path.join(internalDir(job.id), 'audit.jsonl');
    assert.ok(fs.existsSync(auditPath));
    const audit = fs.readFileSync(auditPath, 'utf8');
    assert.ok(audit.includes('approve_for_frontier'));
  } finally {
    if (prev === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prev;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function testLeftoverBlocksAndFix() {
  const prev = process.env.UPLOAD_DIR;
  const tmpRoot = path.join(__dirname, '../../../uploads/_m4_left_' + Date.now());
  process.env.UPLOAD_DIR = tmpRoot;
  try {
    const job = createJobShell(8, { originalFilename: 'leak.docx', status: 'pdf_ready', pdfStatus: 'ready' });
    const orig = await miniDocx(['Patient Jane Smith paid $12,400.']);
    // "Apply missed Jane Smith" — redacted still has real name
    const red = await miniDocx(['Patient Jane Smith paid $10,788.']);
    saveOriginalDocx(job.id, orig, 'leak.docx');
    saveRedactedDocx(job.id, red);
    saveSanitizedPdf(job.id, Buffer.from('%PDF-1.4 fake'));
    saveEntityMap(job.id, {
      kind: 'entity_map_v1',
      entries: [
        { realValue: 'Jane Smith', syntheticValue: 'Alex Morgan', categoryLabel: 'person_name', occurrenceCount: 1 },
        { realValue: '$12,400', syntheticValue: '$10,788', categoryLabel: 'financial_figure', occurrenceCount: 1 },
      ],
    });

    const payload = await getComparePayload(job.id, 8);
    assert.strictEqual(payload.pdfReady, true);
    assert.strictEqual(payload.leftoversOutstanding, true);
    assert.strictEqual(payload.canApproveForFrontier, false);
    assert.ok(/leftover/i.test(payload.approveBlockedReason));

    let blocked = false;
    try {
      await approveForFrontier(job.id, 8, { confirm: true });
    } catch (err) {
      blocked = true;
      assert.strictEqual(err.code, 'UNRESOLVED_LEFTOVERS');
      assert.ok(err.leftoverCount >= 1);
    }
    assert.ok(blocked, 'leftovers must block frontier even when PDF exists');

    const fixed = await fixLeftovers(job.id, 8);
    assert.ok(fixed.fixed >= 1);
    assert.strictEqual(fixed.remaining, 0);
    assert.strictEqual(fixed.pdfStatus, 'pending'); // PDF invalidated
    assert.strictEqual(fixed.compare.leftoversOutstanding, false);

    // Still need PDF before approve
    let pdfBlock = false;
    try {
      await approveForFrontier(job.id, 8, { confirm: true });
    } catch (err) {
      pdfBlock = true;
      assert.strictEqual(err.code, 'PDF_REQUIRED');
    }
    assert.ok(pdfBlock);

    saveSanitizedPdf(job.id, Buffer.from('%PDF-1.4 fake2'));
    // job pdfStatus still pending in json — hasSanitizedPdf checks file presence
    // Update job status for pdfReady helper in getCompare — approve only checks hasSanitizedPdf + leftovers
    const ok = await approveForFrontier(job.id, 8, { confirm: true });
    assert.ok(ok.approvedAt);
  } finally {
    if (prev === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prev;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function run() {
  testHighlights();
  testLeftoverMask();
  testCategoryColorStable();
  await testCompareAndGate();
  await testLeftoverBlocksAndFix();
  console.log('OK milestone4 tests');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
