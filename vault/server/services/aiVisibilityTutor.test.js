'use strict';

// node server/services/aiVisibilityTutor.test.js   (the AI Visibility guide). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./aiVisibilityTutor');

checkGuide({
  name: 'aiVisibilityTutor',
  service,
  askName: 'askAiVisibilityTutor',
  feature: 'ai_visibility_guide',
  toolsFile: 'aiVisibility/aiVisibilityTools.mjs',
  menuExport: 'AI_VISIBILITY_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'scores',
  exampleStepId: 'suggestions',
  facts: [
    ['new-audit', 'notes', /public/, 'only public pages can be audited'],
    ['saved-audits', 'does', /Search audits filters/, 'the saved list is searchable'],
    ['run-audit', 'does', /one live search for each buyer question/, 'each question gets a search and the assistants'],
    ['assistants', 'does', /searches the web itself/, 'the assistants search for themselves'],
    ['model', 'notes', /technical checks still run/, 'the audit still runs without a model'],
    ['model', 'does', /does not choose the assistants/, 'the model is not the assistant'],
    ['buyer-questions', 'does', /generates four/, 'blank questions are generated'],
    ['facts-input', 'notes', /Include the units/, 'facts need units'],
    ['scores', 'notes', /left out rather than scored zero/, 'unmeasured areas are not zero'],
    ['suggestions', 'notes', /work down the list from the top/, 'suggestions are worked top down'],
    ['technical', 'notes', /not Google Search/, 'Google-Extended is not Google Search'],
    ['robots', 'notes', /treated as allowed/, 'a missing robots.txt allows crawlers'],
    ['readability', 'does', /percentage readable without JavaScript/, 'the no-JS percentage is explained'],
    ['schema', 'does', /JSON-LD blocks/, 'JSON-LD is named'],
    ['questions', 'does', /at what position/, 'the search position is shown'],
    ['citation', 'notes', /deliberately separate/, 'found, named and linked are separate'],
    ['facts', 'notes', /heuristic, not proof/, 'fact matching is a heuristic'],
    ['copy', 'does', /Markdown/, 'copy produces Markdown'],
    ['pdf', 'notes', /attach the PDF/, 'the PDF is attached by hand'],
  ],
  gaps: [/Changing the website/, /behind a login/, /whole site/, /schedule/, /Emailing the PDF/, /Keyword search volumes/, /Proving that a fact is true/],
  rules: [/one public page at a time/, /never run an audit or change anything/],
  system: [/Never state or guess a score/, /snapshot/, /cannot control/],
}).catch((e) => { console.error(e); process.exit(1); });
