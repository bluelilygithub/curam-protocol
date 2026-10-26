'use strict';

// node server/services/sharesTutor.test.js   (npm run test:shares-tutor). No model is called.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { checkBasics } = require('./guideBasicsKit');
const service = require('./sharesTutor');

// ---- the guide knows exactly the tabs the Shares page shows (fails if one is added or removed without updating the guide) ----
const page = fs.readFileSync(path.join(__dirname, '../../client/src/pages/SharesPage.jsx'), 'utf8');
const tabsBlock = page.match(/const TABS = \[([\s\S]*?)\n\];/);
assert.ok(tabsBlock, 'found the TABS list on the Shares page');
const pageTabs = [...tabsBlock[1].matchAll(/\{ id: '([^']+)', label: '([^']+)' \}/g)].map((m) => ({ id: m[1], label: m[2] }));
assert.ok(pageTabs.length >= 10, 'found the tabs');
assert.deepStrictEqual(service.CATALOG.map((t) => t.id).sort(), pageTabs.map((t) => t.id).sort(), 'guide catalogue matches the Shares tabs');
for (const t of service.CATALOG) assert.strictEqual(t.label, pageTabs.find((p) => p.id === t.id).label, `${t.id} uses the page's own tab name`);
assert.ok(page.includes('<SharesTutorChat'), 'the Shares page shows the guide');

// ---- safety: no advice, no figures ----
const gaps = service.NOT_POSSIBLE.join(' ');
for (const re of [/buy, sell or hold/, /Tax advice/, /Placing trades/, /only dividend lines/, /cannot see/]) assert.match(gaps, re);
const rules = service.RULES.join(' ');
for (const re of [/average cost/, /trade date/, /net cash received/, /never add, change or delete/]) assert.match(rules, re);
assert.match(service.CATALOG.find((t) => t.id === 'cgt').notes, /not tax advice/);

checkBasics({
  name: 'sharesTutor', service, askName: 'askSharesTutor', feature: 'shares_guide', toolWord: 'tab',
  exampleToolId: 'cgt', exampleStepId: 'trades',
  system: [/Never recommend buying, selling or holding/, /not a tax adviser/, /cannot see this person's holdings/],
}).catch((e) => { console.error(e); process.exit(1); });
