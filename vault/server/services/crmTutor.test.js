'use strict';

// node server/services/crmTutor.test.js   (npm run test:crm-tutor). No model is called.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { checkBasics } = require('./guideBasicsKit');
const service = require('./crmTutor');

(async () => {
  const tools = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages/crm/crmGuideTools.mjs')).href);
  assert.deepStrictEqual(service.CATALOG.map((t) => t.id).sort(), tools.GUIDE_TOOLS.map((t) => t.id).sort(), 'the guide catalogue matches the page controls');
  for (const t of service.CATALOG) assert.strictEqual(t.label, tools.GUIDE_TOOLS.find((g) => g.id === t.id).label, `${t.id} uses the page's own name`);
  assert.ok(tools.GUIDE_TOOLS.filter((t) => t.where === 'detail').every((t) => t.section), 'every client-page control names its section');

  const gaps = service.NOT_POSSIBLE.join(' ');
  for (const re of [/Sending email/, /Mass emailing/, /Importing clients/, /invoices or quotes/, /cannot see them/]) assert.match(gaps, re);
  const rules = service.RULES.join(' ');
  for (const re of [/touchpoint is a log of something that already happened/, /confirmation/]) assert.match(rules, re);
  assert.match(service.CATALOG.find((t) => t.id === 'pipeline').does, /expected and actual close/);
  assert.match(service.CATALOG.find((t) => t.id === 'activity').does, /Follow up/);

  await checkBasics({
    name: 'crmTutor', service, askName: 'askCrmTutor', feature: 'crm_guide', toolWord: 'tool',
    exampleToolId: 'activity', exampleStepId: 'pipeline', system: [/cannot see any client/, /Warn before deleting/],
  });
})().catch((e) => { console.error(e); process.exit(1); });
