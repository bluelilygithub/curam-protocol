'use strict';

// node server/services/codeMapTutor.test.js   (the Code Map guide). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./codeMapTutor');
const { RULES: CHECKS } = require('./codeMap/rules');
const assert = require('assert');

checkGuide({
  name: 'codeMapTutor',
  service,
  askName: 'askCodeMapTutor',
  feature: 'code_map_guide',
  toolsFile: 'codeMap/codeMapTools.mjs',
  menuExport: 'CODE_MAP_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'overview',
  exampleStepId: 'run-analysis',
  facts: [
    ['run-analysis', 'notes', /last 30 runs/, 'the last 30 runs are kept'],
    ['run-analysis', 'notes', /Sunday at 3:17 am/, 'the weekly run'],
    ['explain-fix', 'notes', /200 lines/, 'explain reads at most 200 lines around each line'],
    ['explain-fix', 'notes', /I could not tell/, 'explain does not guess'],
    ['explain-fix', 'notes', /does not change any code/, 'explain changes nothing'],
    ['structure', 'notes', /git history/, 'no hotspots without git'],
    ['changes', 'notes', /two finished runs/, 'changes needs two runs'],
    ['tool-panel', 'notes', /three or more tools/, 'shared files are not owned'],
  ],
  gaps: [/only reports/, /cannot see any of them/, /git history/, /not checked against the rules/, /rules\.js/, /last 30 runs/, /standard model/],
  rules: [/amber is worth a look/, /pattern matches/, /three or more tools/, /14 rules/, /Suggestions inbox/],
  system: [/cannot see any code, run, finding, score/, /pattern matches and can be wrong/],
}).then(() => {
  // the guide explains every rule the analyzer really has, by its label
  const text = service.RULES.join(' ');
  for (const r of CHECKS) assert.ok(text.includes(r.label), `the guide explains the "${r.label}" rule (rules.js and codeMapTutor.js RULES)`);
  assert.strictEqual(CHECKS.length, 14, 'the guide says there are 14 rules');
  console.log('codeMapTutor: every rule is explained');
}).catch((e) => { console.error(e); process.exit(1); });
