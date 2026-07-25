'use strict';

/**
 * Milestone 1 smoke tests — DOCX IR, pattern backstop, merge/dedupe (no LLM).
 * Run: node server/services/documentRedaction/milestone1.test.js
 */

const assert = require('assert');
const JSZip = require('jszip');
const { parseDocxBuffer, findOccurrences } = require('./docxParse');
const { extractPatternCandidates } = require('./patternCandidates');
const { mergeAndDeduplicateCandidates, expandOccurrencesWithIr } = require('./mergeCandidates');

async function buildFixtureDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Patient Jane Smith contacted us at jane.smith@hospital.org.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Please call Jane Smith on (07) 3123 4567 regarding invoice $12,400.</w:t></w:r></w:p>
    <w:p><w:r><w:t>DOB: 14/03/1988. Address: 42 Harbour Road Brisbane.</w:t></w:r></w:p>
    <w:p><w:r><w:t>TFN reference 123-456-789 for Jane Smith payroll.</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

async function run() {
  const buf = await buildFixtureDocx();
  const ir = await parseDocxBuffer(buf);
  assert.ok(ir.paragraphCount >= 4, 'expected paragraphs');
  assert.ok(ir.paragraphs[0].runs.length >= 1, 'expected runs');
  assert.ok(ir.paragraphs[0].paragraphId.startsWith('body-p-'), 'paragraph ids');

  const janeLocs = findOccurrences(ir, 'Jane Smith');
  assert.strictEqual(janeLocs.length, 3, `Jane Smith should appear 3 times, got ${janeLocs.length}`);
  assert.ok(janeLocs[0].paragraphId, 'location has paragraphId');
  assert.ok(typeof janeLocs[0].startOffset === 'number', 'location has offsets');

  const patterns = extractPatternCandidates(ir, 'job-test');
  assert.ok(patterns.some((c) => c.categoryLabel === 'Email'), 'email pattern');
  assert.ok(patterns.some((c) => c.source === 'deterministic' && c.sourceLabel === 'pattern-match'));

  // Simulate LLM stubs for Jane Smith (one location) + merge should expand
  const llmStub = [{
    id: 'llm-1',
    jobId: 'job-test',
    source: 'local_llm',
    sourceLabel: 'llm',
    categoryLabel: 'person_name',
    surfaceForms: ['Jane Smith'],
    locations: [janeLocs[0]],
    confidence: 0.9,
    suggestedReplacement: 'Alex Taylor',
    decision: 'pending',
    rationale: 'Client name in brief',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }];

  let merged = mergeAndDeduplicateCandidates([...patterns, ...llmStub], 'job-test');
  merged = expandOccurrencesWithIr(merged, ir, findOccurrences);
  const jane = merged.find((c) => c.entityText === 'Jane Smith' || c.surfaceForms?.includes('Jane Smith'));
  assert.ok(jane, 'grouped Jane Smith candidate');
  assert.ok(jane.occurrenceCount >= 3, `expected >=3 occurrences, got ${jane.occurrenceCount}`);
  assert.ok(jane.entityKey, 'entityKey set');

  console.log('OK milestone1 tests');
  console.log(JSON.stringify({
    paragraphs: ir.paragraphCount,
    patternCount: patterns.length,
    mergedCount: merged.length,
    jane: {
      entityText: jane.entityText,
      source: jane.source,
      sourceLabel: jane.sourceLabel,
      occurrenceCount: jane.occurrenceCount,
      score: jane.score,
      replacement: jane.suggestedReplacement,
      locations: jane.locations.map((l) => ({
        paragraphId: l.paragraphId,
        runId: l.runId,
        startOffset: l.startOffset,
        endOffset: l.endOffset,
      })),
    },
    samplePatterns: merged.filter((c) => c.sourceLabel === 'pattern-match').slice(0, 5).map((c) => ({
      entityText: c.entityText,
      categoryLabel: c.categoryLabel,
      occurrenceCount: c.occurrenceCount,
      replacement: c.suggestedReplacement,
    })),
  }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
