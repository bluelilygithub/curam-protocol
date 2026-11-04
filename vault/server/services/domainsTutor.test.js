'use strict';

// node server/services/domainsTutor.test.js   (the Domain guide). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./domainsTutor');

checkGuide({
  name: 'domainsTutor',
  service,
  askName: 'askDomainsTutor',
  feature: 'domains_guide',
  toolsFile: 'domains/domainsTools.mjs',
  menuExport: 'DOMAIN_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'suggest',
  exampleStepId: 'social',
  facts: [
    ['suggest', 'does', /16 brand names/, 'the generator gives 16 names'],
    ['suggest', 'does', /\.com\.au/, 'the endings checked include .com.au'],
    ['suggest', 'notes', /trademarks are not checked/, 'a free name is not a safe name'],
    ['availability', 'notes', /does not register it/, 'it does not register'],
    ['compare', 'notes', /at least two/, 'compare needs two names'],
    ['microphone', 'does', /"dot".*"dash"/s, 'the microphone explains dot and dash'],
    ['social', 'notes', /Unknown means/, 'unknown is explained'],
    ['pricing', 'does', /renew/, 'pricing includes renewal'],
    ['run-all', 'notes', /Domain Profile is skipped/, 'profile is skipped for a free name'],
    ['board', 'does', /at least two shortlisted/, 'compare needs two shortlisted names'],
    ['sets', 'does', /Recycle bin/, 'a deleted set can be recovered'],
    ['save-set', 'notes', /your account only/, 'sets are private'],
    ['suggestion-table', 'does', /three suggestions side by side/, 'the table is three columns'],
    ['suggestion-table', 'notes', /not a trademark check/, 'free is not a trademark check'],
    ['delete-set', 'does', /Recycle bin for 30 days/, 'a deleted set can be recovered'],
  ],
  gaps: [/Buying or registering a domain/, /trademarks/, /DNS records/, /Page speed/, /social media handles/, /Watching a name/],
  rules: [/microphone/, /Saved results are a snapshot/, /Nothing is bought, registered or held/, /free name is not a safe name/],
  system: [/Never say a name is safe/, /cannot see any description/],
}).catch((e) => { console.error(e); process.exit(1); });
