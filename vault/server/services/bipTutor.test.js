'use strict';

// node server/services/bipTutor.test.js — no model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./bipTutor');

checkGuide({
  name: 'bipTutor',
  service,
  askName: 'askBipTutor',
  feature: 'bip_guide',
  toolsFile: 'bip/bipTools.mjs',
  menuExport: 'BIP_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'search',
  exampleStepId: 'profile',
  facts: [
    ['search', 'does', /RDAP.*WHOIS/s, 'the registration lookup is named'],
    ['search', 'notes', /30 days/, 'the cache is named'],
    ['profile', 'does', /seven cards/i, 'the seven cards are named'],
    ['conflicts', 'does', /never chooses a winner/i, 'conflicts are not auto-resolved'],
    ['export', 'notes', /does not do any new lookups/, 'the PDF uses saved data'],
  ],
  gaps: [/private company data/, /Guessing revenue/, /automatically/, /Watching a domain/],
  rules: [/ASIC.*manual check/s, /30-day cache/, /Open buttons in this chat only switch to a tool/],
  system: [/cannot see any domain/, /everyday words/],
});
