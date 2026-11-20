'use strict';

// node server/services/docCompareTutor.test.js   (the DocCompare guide). No model is called. No npm script, to keep package.json unchanged.

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
  exampleToolId: 'doc-compare',
  exampleStepId: 'files',
  facts: [
    ['doc-compare', 'notes', /nothing is uploaded, nothing is sent to an AI model/, 'files stay in the browser'],
    ['files', 'notes', /same type/, 'both files must be the same type'],
    ['file-check', 'notes', /no way past this check/, 'the type check cannot be skipped'],
    ['same-document', 'notes', /recorded in the report/, 'compare anyway is recorded'],
    ['metadata', 'notes', /never flagged/, 'missing details are not flagged'],
    ['page-viewer', 'notes', /PDF files only/, 'the viewer is for PDFs'],
    ['report', 'notes', /filters currently set/, 'the report follows the filters'],
  ],
  gaps: [/different file types/, /\.doc files/, /Scanned PDFs/, /Spreadsheets/, /Editing or fixing/, /which version is correct/, /cannot see the files/],
  rules: [/same type/, /never uploaded/, /High severity/, /trivial/, /PDFs only/],
  system: [/Never state or guess what their documents say/, /never say a file is uploaded/],
}).then((tools) => {
  // the app opens exactly these ids; the bridge message types are shared with the host page
  const assert = require('assert');
  assert.strictEqual(tools.OPEN_TYPE, 'doc-compare:open');
  assert.strictEqual(tools.CONTEXT_TYPE, 'doc-compare:context');
}).catch((e) => { console.error(e); process.exit(1); });
