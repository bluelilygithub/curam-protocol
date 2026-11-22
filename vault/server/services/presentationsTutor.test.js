'use strict';

// node server/services/presentationsTutor.test.js   (the Presentations guide). No model is called. No npm script, to keep package.json unchanged.
// Keeps the guide's catalogue, the page's tool list (client/src/pages/presentations/presentationsTools.mjs) and the start-screen jobs
// (presentationGoals.mjs) in step.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { checkGuide } = require('./guideTestKit');
const service = require('./presentationsTutor');

checkGuide({
  name: 'presentationsTutor',
  service,
  askName: 'askPresentationsTutor',
  feature: 'presentations_tutor',
  toolsFile: 'presentations/presentationsTools.mjs',
  menuExport: 'PRESENTATIONS_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'slides',
  exampleStepId: 'create',
  facts: [
    ['import', 'does', /nothing here sends a file to a model/, 'import does not send files to a model'],
    ['slides', 'does', /no free-form drag-and-drop/, 'there is no drawing canvas'],
    ['templates', 'does', /colours and fonts/, 'a PowerPoint theme gives colours and fonts only'],
    ['decks', 'does', /recycle bin/, 'deleted decks go to the recycle bin'],
  ],
  gaps: [/AI-generated pictures/, /PowerPoint masters/, /export video/],
  rules: [/6 to 20 slides/, /recycle bin/, /Make or open a deck first/, /No model id is hard-coded/],
  system: [/cannot see or open the person's decks/],
}).then(async (tools) => {
  // the start screen's jobs: every step is a real tool with a note
  const goalsUrl = pathToFileURL(path.join(__dirname, '../../client/src/pages/presentations/presentationGoals.mjs')).href;
  const { PRESENTATION_GOALS } = await import(goalsUrl);
  const toolIds = tools.PRESENTATIONS_TOOLS.map((t) => t.id);
  assert.ok(PRESENTATION_GOALS.length >= 4, 'the start screen has jobs');
  for (const g of PRESENTATION_GOALS) {
    for (const s of g.steps) assert.ok(toolIds.includes(s.tool) && s.note, `${g.id}: ${s.tool} is a real tool with a note`);
  }
  for (const id of toolIds) {
    assert.ok(tools.TOOL_HELP[id] && tools.TOOL_HELP[id].what && tools.TOOL_HELP[id].features.length, `${id} has a (?) help box`);
  }
  console.log('presentations jobs and help tests passed');
}).catch((e) => { console.error(e); process.exit(1); });
