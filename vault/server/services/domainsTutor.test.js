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
  exampleToolId: 'brief',
  exampleStepId: 'filters',
  facts: [
    ['brief', 'does', /Generate names/, 'the brief ends with Generate names'],
    ['names', 'does', /filters/, 'the names step has filters'],
    ['names', 'notes', /not a trade mark or business name check/, 'free is not a trade mark check'],
    ['own-names', 'does', /thestaircasesuitcase/, 'the example is joined into one word'],
    ['own-names', 'does', /never filtered out/, 'own names are never filtered out'],
    ['requirements', 'does', /\.org/, 'the endings include .org'],
    ['requirements', 'notes', /Not confirmed never counts as free/, 'unknown is never free'],
    ['generate', 'does', /about 40/, 'the cost is stated'],
    ['microphone', 'does', /"dot".*"dash"/s, 'the microphone explains dot and dash'],
    ['filters', 'does', /cost nothing/, 'filters are free'],
    ['talk', 'does', /changes nothing/, 'asking changes nothing'],
    ['talk', 'notes', /cannot say a name is safe/, 'the AI cannot clear a name'],
    ['notes', 'does', /optional/, 'the notes box is optional'],
    ['own-names', 'notes', /one click/, 'names in the description are offered'],
    ['steering', 'does', /never repeats names/, 'a new round does not repeat names'],
    ['variations', 'notes', /24/, 'variations are capped'],
    ['save-set', 'notes', /your account only/, 'sets are private'],
    ['sets', 'does', /Recycle bin for 30 days/, 'a deleted set can be recovered'],
  ],
  gaps: [/Buying or registering a domain/, /trade marks/, /DNS records/, /Watching a name/, /social media handles/],
  rules: [/microphone/, /Nothing is bought, registered or held/, /free name is not a safe name/, /Never call a name free or safe from memory/],
  system: [/Never say a name is safe/, /cannot see any description/],
}).catch((e) => { console.error(e); process.exit(1); });
