'use strict';

// node server/services/htmlContentCheckTutor.test.js   (the HTML Content Check guide). No model is called. No npm script, to keep package.json unchanged.

const assert = require('assert');
const { checkGuide } = require('./guideTestKit');
const service = require('./htmlContentCheckTutor');

checkGuide({
  name: 'htmlContentCheckTutor',
  service,
  askName: 'askHtmlContentCheckTutor',
  feature: 'html_content_check_guide',
  toolsFile: 'htmlContentCheck/htmlContentCheckTools.mjs',
  menuExport: 'HCC_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'changes',
  exampleStepId: 'new',
  facts: [
    ['changes', 'notes', /never says an edit is right or done/, 'changes are never judged'],
    ['match', 'notes', /Suggestions only/, 'matching only suggests'],
    ['saved-copy', 'notes', /behind a login/, 'a saved copy is the way in for staging and logins'],
    ['self-changing', 'notes', /never thrown away/, 'self-changing changes are kept'],
    ['details', 'notes', /cannot change once the page has been read/, 'the address is fixed after round 0'],
    ['approve', 'notes', /never the AI/, "approval is the person's own"],
  ],
  gaps: [/Making the edits on the website/, /report the client filled in and sent back/, /cannot see them/],
  rules: [/never says an edit is right|says an edit is right, complete or done/, /only AI step/, /need a job open first/, /saved copy/],
  system: [/Never say an edit is correct or done/, /Never state or guess what a page says/],
}).then((tools) => {
  // the start screen's jobs: every step is a real tool with a note
  const toolIds = tools.HCC_TOOLS.map((t) => t.id);
  for (const g of tools.HCC_GOALS) {
    assert.ok(g.id && g.title && g.blurb && g.icon && g.steps.length >= 1, `${g.id} is described`);
    for (const s of g.steps) assert.ok(toolIds.includes(s.tool) && s.note, `${g.id}: ${s.tool} is a real tool with a note`);
  }
  for (const id of tools.JOB_TOOL_IDS) assert.ok(toolIds.includes(id), `${id} is a tool`);
  console.log('htmlContentCheck jobs tests passed');
}).catch((e) => { console.error(e); process.exit(1); });
