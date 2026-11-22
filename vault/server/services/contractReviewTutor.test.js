'use strict';

// node server/services/contractReviewTutor.test.js   (the Contract Review guide). No model is called. No npm script, to keep package.json unchanged.

const assert = require('assert');
const { checkGuide } = require('./guideTestKit');
const service = require('./contractReviewTutor');

checkGuide({
  name: 'contractReviewTutor',
  service,
  askName: 'askContractReviewTutor',
  feature: 'contract_review_guide',
  toolsFile: 'contractReview/contractReviewTools.mjs',
  menuExport: 'CONTRACT_REVIEW_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'review',
  exampleStepId: 'new',
  facts: [
    ['new', 'notes', /read by an AI model/, 'the file is uploaded and read by a model'],
    ['party', 'notes', /confirmed party only/, 'risk is one-sided'],
    ['verdict', 'notes', /never says a contract is safe/, 'the verdict never says safe'],
    ['clauses', 'notes', /never applied to the document/, 'suggested changes are advisory'],
    ['perspective', 'notes', /not changed/, 'another party\'s review leaves yours alone'],
    ['contract-actions', 'notes', /legal hold cannot be deleted/, 'legal hold blocks delete'],
  ],
  gaps: [/legal advice/, /applying a suggested change/, /comparing two different contracts/, /cannot see the contracts/],
  rules: [/not legal advice/, /which party they are/, /need a contract open first/, /never call a contract safe/],
  system: [/Never give legal advice/, /Never state or guess what their contract says/],
}).then((tools) => {
  // the start screen's jobs: every step is a real tool with a note; a job starts where a contract comes from
  const toolIds = tools.CONTRACT_REVIEW_TOOLS.map((t) => t.id);
  assert.ok(tools.CONTRACT_REVIEW_GOALS.length >= 4, 'the start screen has jobs');
  for (const g of tools.CONTRACT_REVIEW_GOALS) {
    assert.ok(g.id && g.title && g.blurb && g.icon && g.steps.length >= 2, `${g.id} is described`);
    assert.ok(['new', 'contracts'].includes(g.steps[0].tool), `${g.id} starts by choosing a contract`);
    for (const s of g.steps) assert.ok(toolIds.includes(s.tool) && s.note, `${g.id}: ${s.tool} is a real tool with a note`);
  }
  for (const id of tools.CONTRACT_TOOL_IDS) assert.ok(toolIds.includes(id), `${id} is a tool`);
  console.log('contractReview jobs tests passed');
}).catch((e) => { console.error(e); process.exit(1); });
