'use strict';

// node server/services/usageTutor.test.js   (the Usage & Cost guide). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./usageTutor');

checkGuide({
  name: 'usageTutor',
  service,
  askName: 'askUsageTutor',
  feature: 'usage_guide',
  toolsFile: 'usage/usageTools.mjs',
  menuExport: 'USAGE_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'overview',
  exampleStepId: 'advice',
  facts: [
    ['period', 'does', /Today, Week, Month, Quarter, Year, Custom or All time/, 'the periods are named'],
    ['custom-dates', 'does', /From and a To/, 'custom needs both dates'],
    ['numbers', 'notes', /generic rate/, 'an unpriced model is costed by a generic rate'],
    ['by-feature', 'does', /Show all/, 'by feature has Show all'],
    ['calls', 'notes', /no text of what was asked/, 'no call text is shown'],
    ['advice', 'notes', /not by an AI/, 'the advice is rules, not AI'],
    ['advice-save', 'notes', /Settings/, 'changing the model is done in Settings'],
    ['advice-quality', 'does', /extra cost/, 'quality advice shows extra cost'],
    ['advice-note', 'does', /no price on file/, 'unpriced models are explained'],
  ],
  gaps: [/Changing which model/, /budget, a limit or an alert/, /invoice or balance/, /Exporting/, /other people/],
  rules: [/estimate/, /not an AI/, /never changes a model/],
  system: [/Never state or guess a number/],
}).catch((e) => { console.error(e); process.exit(1); });
