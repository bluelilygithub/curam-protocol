'use strict';

/**
 * Milestone 6 smoke — frontier apply gate, three-way payload, final approve + audit export.
 * Run: node server/services/documentRedaction/milestone6.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const {
  assertReadyToApply,
  candidatesForPass,
} = require('./applyGate');
const {
  getComparePayload,
  findHighlightsForPass,
  PASS_COLORS,
} = require('./compareService');
const { approveFinal } = require('./finalApproval');
const {
  createJobShell,
  saveOriginalDocx,
  saveRedactedDocx,
  saveLocalPassDocx,
  saveEntityMap,
  saveSanitizedPdf,
  saveCandidates,
  loadJob,
  jobDir,
  isExportForbiddenRelativePath,
  EXPORTABLE_ARTIFACTS,
} = require('./jobStore');
const { resolveJobDownload } = require('./exportDownload');

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

function testFrontierGateScopesCandidates() {
  const list = [
    { id: '1', source: 'local_llm', decision: 'pending', score: 0.9, entityText: 'A' },
    { id: '2', source: 'frontier_suggested', decision: 'approved', score: 0.8, entityText: 'B' },
    { id: '3', source: 'frontier_suggested', decision: 'pending', score: 0.7, entityText: 'C' },
  ];
  assert.strictEqual(candidatesForPass(list, 'frontier').length, 2);
  assert.strictEqual(candidatesForPass(list, 'local').length, 1);

  // Frontier apply: pending frontier ≥ 0.5 blocks
  let blocked = false;
  try {
    assertReadyToApply(list, { confirmApply: true, applyPass: 'frontier' });
  } catch (err) {
    blocked = true;
    assert.strictEqual(err.code, 'PENDING_BLOCKING');
  }
  assert.ok(blocked);

  // Local apply ignores pending frontier
  const localGate = assertReadyToApply(
    [
      { id: '1', source: 'local_llm', decision: 'approved', score: 0.9, entityText: 'A' },
      { id: '3', source: 'frontier_suggested', decision: 'pending', score: 0.9, entityText: 'C' },
    ],
    { confirmApply: true, applyPass: 'local' },
  );
  assert.strictEqual(localGate.approved.length, 1);
  assert.strictEqual(localGate.applyPass, 'local');
}

function testMergeEntityMap() {
  // Mirrors applyService.mergeEntityMapEntries — keep in sync (avoid loading applyService → DB)
  function mergeEntityMapEntries(existingEntries, incoming) {
    const byKey = new Map();
    for (const e of existingEntries || []) {
      if (e?.entityKey) byKey.set(e.entityKey, e);
    }
    for (const e of incoming || []) {
      const prev = byKey.get(e.entityKey);
      if (prev) {
        byKey.set(e.entityKey, {
          ...prev,
          ...e,
          candidateIds: [...new Set([...(prev.candidateIds || []), ...(e.candidateIds || [])])],
          id: prev.id || e.id,
        });
      } else {
        byKey.set(e.entityKey, e);
      }
    }
    return [...byKey.values()];
  }
  const merged = mergeEntityMapEntries(
    [{ entityKey: 'a', realValue: 'Jane', syntheticValue: 'Alex', appliedPass: 'local' }],
    [{ entityKey: 'b', realValue: 'Alex', syntheticValue: 'Sam', appliedPass: 'frontier', candidateIds: ['f1'] }],
  );
  assert.strictEqual(merged.length, 2);
  assert.ok(merged.find((e) => e.entityKey === 'b').appliedPass === 'frontier');
}

function testPassHighlights() {
  const hits = findHighlightsForPass('Hello Sam and more', [
    { syntheticValue: 'Sam', categoryLabel: 'person', appliedPass: 'frontier' },
  ], 'frontier');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].pass, 'frontier');
  assert.strictEqual(hits[0].color.bg, PASS_COLORS.frontier.bg);
}

async function testThreeWayAndFinal() {
  const prev = process.env.UPLOAD_DIR;
  const tmpRoot = path.join(__dirname, '../../../uploads/_m6_test_' + Date.now());
  process.env.UPLOAD_DIR = tmpRoot;
  try {
    const job = createJobShell(9, {
      originalFilename: 'm6.docx',
      status: 'ready_for_final',
      pdfStatus: 'ready',
      lastApplyPass: 'frontier',
    });
    const orig = await miniDocx(['Patient Jane Smith paid $12,400.']);
    const local = await miniDocx(['Patient Alex Morgan paid $10,788.']);
    const final = await miniDocx(['Patient Sam Rivers paid $10,788.']);
    saveOriginalDocx(job.id, orig, 'm6.docx');
    saveLocalPassDocx(job.id, local);
    saveRedactedDocx(job.id, final);
    saveSanitizedPdf(job.id, Buffer.from('%PDF-1.4 m6'));
    saveEntityMap(job.id, {
      kind: 'entity_map_v1',
      entries: [
        {
          entityKey: 'jane',
          realValue: 'Jane Smith',
          syntheticValue: 'Alex Morgan',
          categoryLabel: 'person_name',
          appliedPass: 'local',
        },
        {
          entityKey: 'alex',
          realValue: 'Alex Morgan',
          syntheticValue: 'Sam Rivers',
          categoryLabel: 'person_name',
          appliedPass: 'frontier',
        },
        {
          entityKey: 'amt',
          realValue: '$12,400',
          syntheticValue: '$10,788',
          categoryLabel: 'financial_figure',
          appliedPass: 'local',
        },
      ],
    });
    saveCandidates(job.id, [
      {
        id: 'c1',
        source: 'local_llm',
        entityText: 'Jane Smith',
        decision: 'approved',
        categoryLabel: 'person_name',
        score: 0.9,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'c2',
        source: 'frontier_suggested',
        entityText: 'Alex Morgan',
        decision: 'approved',
        categoryLabel: 'person_name',
        score: 0.7,
        suggestedReplacement: 'Sam Rivers',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const payload = await getComparePayload(job.id, 9);
    assert.strictEqual(payload.threeWayAvailable, true);
    assert.ok(payload.threeWay?.rows?.length >= 1);
    assert.strictEqual(payload.canApproveFinal, true);
    assert.ok(!/"realValue"/.test(JSON.stringify(payload.threeWay)));
    const finalRow = payload.threeWay.rows[0];
    assert.ok(finalRow.final.text.includes('Sam Rivers'));
    assert.ok(finalRow.local.text.includes('Alex Morgan'));
    assert.ok(finalRow.final.highlights.some((h) => h.pass === 'frontier'));

    // Audit trail download blocked before final approve
    let blocked = false;
    try {
      resolveJobDownload(job.id, 9, 'INTERNAL-ONLY-audit-trail.json');
    } catch (err) {
      blocked = true;
      assert.strictEqual(err.code, 'FINAL_APPROVAL_REQUIRED');
    }
    assert.ok(blocked);

    const approved = await approveFinal(job.id, 9, { confirm: true });
    assert.ok(approved.ok);
    assert.strictEqual(approved.job.status, 'completed');
    const trailPath = path.join(jobDir(job.id), 'INTERNAL-ONLY-audit-trail.json');
    assert.ok(fs.existsSync(trailPath));
    const trail = JSON.parse(fs.readFileSync(trailPath, 'utf8'));
    assert.strictEqual(trail.label, 'INTERNAL-ONLY');
    assert.ok(trail.warning.toLowerCase().includes('original'));
    assert.ok(trail.candidates.some((c) => c.entityText === 'Jane Smith'));
    assert.ok(trail.entityMap.entries.some((e) => e.realValue === 'Jane Smith'));

    const dl = resolveJobDownload(job.id, 9, 'INTERNAL-ONLY-audit-trail.json');
    assert.ok(dl.downloadName.includes('INTERNAL-ONLY'));

    const reloaded = loadJob(job.id, 9);
    assert.ok(reloaded.finalApprovedAt);

    assert.ok(EXPORTABLE_ARTIFACTS.includes('INTERNAL-ONLY-audit-trail.json'));
    assert.ok(isExportForbiddenRelativePath('internal/entity-map.json'));
  } finally {
    process.env.UPLOAD_DIR = prev;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

async function run() {
  testFrontierGateScopesCandidates();
  testMergeEntityMap();
  testPassHighlights();
  await testThreeWayAndFinal();
  console.log('OK milestone6 tests');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
