'use strict';

// node server/services/skillScanTutor.test.js — no model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./skillScanTutor');

checkGuide({
  name: 'skillScanTutor',
  service,
  askName: 'askSkillScanTutor',
  feature: 'skill_scan_guide',
  toolsFile: 'skillScan/skillScanTools.mjs',
  menuExport: 'SKILL_SCAN_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'scan',
  exampleStepId: 'report',
  facts: [
    ['scan', 'does', /github\.com link/, 'the input is named'],
    ['scan', 'notes', /never runs them/, 'static scans do not run code'],
    ['deep', 'notes', /sent to Anthropic/, 'a deep scan sends the files out'],
    ['report', 'notes', /51 and over Do not install/, 'the bands are stated'],
    ['history', 'does', /recycle bin/, 'delete goes to the bin'],
  ],
  gaps: [/own computer/, /private repositories/, /Guaranteeing a skill is safe/],
  rules: [/SkillSpector/, /never runs the skill/, /admins only/],
  system: [/cannot see any link/, /everyday words/],
});
