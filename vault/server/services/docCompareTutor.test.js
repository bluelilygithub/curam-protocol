'use strict';

// node server/services/docCompareTutor.test.js   (the DocCompare guide). No model is called. No npm script, to keep package.json unchanged.

const assert = require('assert');
const { checkGuide } = require('./guideTestKit');
const service = require('./docCompareTutor');

checkGuide({
  name: 'docCompareTutor',
  service,
  askName: 'askDocCompareTutor',
  feature: 'doc_compare_guide',
  toolsFile: 'docCompare/docCompareTools.mjs',
  menuExport: 'DOC_COMPARE_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'compare',
  exampleStepId: 'files',
  facts: [
    ['compare', 'notes', /nothing is uploaded, nothing is sent to an AI model/, 'files stay in the browser'],
    ['files', 'notes', /same type/, 'both files must be the same type'],
    ['file-check', 'notes', /no way past this check/, 'the type check cannot be skipped'],
    ['same-document', 'notes', /recorded in the report/, 'compare anyway is recorded'],
    ['metadata', 'notes', /never flagged/, 'missing details are not flagged'],
    ['pages', 'notes', /PDF files only/, 'page comparison is for PDFs'],
    ['report', 'notes', /filters currently set/, 'the report follows the filters'],
  ],
  gaps: [/different file types/, /\.doc files/, /Scanned PDFs/, /Spreadsheets/, /Editing or fixing/, /which version is correct/, /cannot see the files/],
  rules: [/same type/, /never uploaded/, /High severity/, /trivial/, /PDFs only/, /empty until two files have been compared/],
  system: [/Never state or guess what their documents say/, /never say a file is uploaded/],
}).then((tools) => {
  // the bridge message types are shared with the app and the host page
  assert.strictEqual(tools.OPEN_TYPE, 'doc-compare:open');
  assert.strictEqual(tools.VIEW_TYPE, 'doc-compare:view');
  assert.strictEqual(tools.CONTEXT_TYPE, 'doc-compare:context');
  // the start screen's jobs: every step is a real tool, a job starts by comparing, and a filter only names known categories/severities
  const toolIds = tools.DOC_COMPARE_TOOLS.map((t) => t.id);
  // keep in step with Category in doc-compare/src/report/model.ts
  const CATS = ['removed', 'added', 'moved', 'wording', 'typo', 'number', 'formatting', 'layout', 'metadata',
    'newClaim', 'reference', 'citation', 'quote', 'numbering', 'wordLimit', 'spelling', 'terminology', 'requiredHeading', 'versionNumber', 'drift'];
  assert.ok(tools.DOC_COMPARE_GOALS.length >= 4, 'the start screen has jobs');
  for (const g of tools.DOC_COMPARE_GOALS) {
    assert.ok(g.id && g.title && g.blurb && g.icon && g.steps.length >= 2, `${g.id} is described`);
    assert.strictEqual(g.steps[0].tool, 'compare', `${g.id} starts by comparing`);
    for (const s of g.steps) {
      assert.ok(toolIds.includes(s.tool) && s.note, `${g.id}: ${s.tool} is a real tool with a note`);
      for (const c of s.filter?.categories || []) assert.ok(CATS.includes(c), `${g.id}: category ${c}`);
      for (const v of s.filter?.severities || []) assert.ok(['high', 'medium', 'low'].includes(v), `${g.id}: severity ${v}`);
    }
  }
  console.log('docCompare jobs tests passed');
}).catch((e) => { console.error(e); process.exit(1); });
