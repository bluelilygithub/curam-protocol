'use strict';
// node server/services/htmlContentCheck/report.test.js [out.pdf]
// The client report's content (buildReportModel) and that the PDF renders with live fields, including characters Helvetica cannot draw.
// Pass a path to keep the sample PDF to look at.
const assert = require('node:assert/strict');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { buildReportModel, renderReportPdf } = require('./report');

const pages = [{ id: 11, label: 'The Artist', url: 'https://dorothy.example/the-artist' }, { id: 12, label: 'Events', url: 'https://dorothy.example/events' }];
const items = [
  { ref: 'R1', kind: 'request_line', pageId: null, lineText: 'Change the footer phone number' },
  { ref: 'R2', kind: 'request_line', pageId: 11, lineText: 'Change to: Moon Over Backyard. Oil on canvas 60 × 90 cm' },
  { ref: 'R3', kind: 'keep', pageId: 11, lineText: 'George established himself early in his career' },
  { ref: 'R4', kind: 'request_line', pageId: 12, lineText: 'Add the 2027 Hobart launch — Fuller’s Book Shop 😀' },
  { ref: 'R5', kind: 'held_over', pageId: 12, lineText: 'Read a Chapter: I will have to think about this (hold over)' },
  { ref: 'R6', kind: 'request_line', pageId: 12, lineText: 'Remove the 2026 opening' },
];
const changes = {
  11: [
    { id: 'c1', type: 'changed', before: { text: 'Phone 03 1111', section: ['Footer'] }, after: { text: 'Phone 03 2222', section: ['Footer'] }, words: [{ op: '=', text: 'Phone ' }, { op: '-', text: '03 1111' }, { op: '+', text: '03 2222' }] },
    { id: 'c2', type: 'added', after: { text: 'Moon Over Backyard. Oil on canvas 60 × 90 cm', section: ['Plates'] } },
    { id: 'c3', type: 'removed', before: { text: 'A cookie notice', section: [] }, volatile: 'cookie' },
    { id: 'c4', type: 'changed', before: { text: 'Exhibitions', section: [] }, after: { text: 'Past exhibitions', section: [] }, words: [{ op: '+', text: 'Past ' }, { op: '=', text: 'exhibitions' }] },
  ],
  12: [{ id: 'c1', type: 'added', after: { text: '2027 - Thursday 4 February, Fuller’s Book Shop launch, Hobart', section: ['Events'] } }],
};
const view = {
  number: 2, fetchedAt: '2026-11-27T02:00:00Z',
  pages: pages.map((p) => ({ pageId: p.id, status: 'ready', fetchedAt: '2026-11-27T02:00:00Z', results: { diff: { vsBaseline: { changes: changes[p.id] } } } })),
  lines: [
    { ref: 'R1', status: 'linked', links: [{ pageId: 11, changeId: 'c1' }] },
    { ref: 'R2', status: 'linked', links: [{ pageId: 11, changeId: 'c2' }] },
    { ref: 'R3', status: 'keepChanged', pageIds: [11] },
    { ref: 'R4', status: 'linked', links: [{ pageId: 12, changeId: 'c1' }] },
    { ref: 'R5', status: 'held' },
    { ref: 'R6', status: 'noChange' },
  ],
};
const approvals = { R1: { status: 'approved' }, R2: { status: 'approved' }, R4: { status: 'approved' }, R6: { status: 'needs_work' } };
const job = { id: 7, name: 'Dorothy Stoner website' };

(async () => {
  const m = buildReportModel({ job, pages, items, view, approvals });
  assert.deepEqual(m.sections.map((s) => s.label), ['The Artist', 'Events'], 'grouped by page, in page order');
  assert.deepEqual(m.sections[0].rows.map((r) => r.ref), ['R1', 'R2'], 'a line with no page goes with the page its change is on');
  assert.deepEqual(m.sections[1].rows.map((r) => r.ref), ['R4']);
  assert.deepEqual(m.sections[0].keeps.map((k) => [k.ref, k.status]), [['R3', 'keepChanged']]);
  assert.deepEqual(m.sections[1].held.map((h) => h.ref), ['R5']);
  assert.equal(m.needsWork, 1); assert.equal(m.notYet, 0); assert.equal(m.approvedCount, 3);
  assert.deepEqual(m.sections[0].unasked, [], 'left out by default');
  const all = buildReportModel({ job, pages, items, view, approvals, includeUnasked: true });
  assert.deepEqual(all.sections[0].unasked.map((c) => c.id), ['c4'], 'unasked: not linked, and not "may have changed by itself"');

  const bytes = await renderReportPdf(all);
  const doc = await PDFDocument.load(bytes);
  const names = doc.getForm().getFields().map((f) => f.getName());
  for (const n of ['hcc_7_r2_R1_ok', 'hcc_7_r2_R4_note', 'hcc_7_r2_p11_c4_change', 'hcc_7_r2_change8_text', 'hcc_7_r2_approved', 'hcc_job']) assert.ok(names.includes(n), n);
  assert.equal(doc.getForm().getTextField('hcc_round').getText(), '2');
  if (process.argv[2]) fs.writeFileSync(process.argv[2], bytes);
  console.log('report.test.js: passed');
})().catch((err) => { console.error(err); process.exit(1); });
