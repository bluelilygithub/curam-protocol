'use strict';

// node server/services/dnsLookupTutor.test.js   (npm run test:dns-lookup-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./dnsLookupTutor');

checkGuide({
  name: 'dnsLookupTutor',
  service,
  askName: 'askDnsLookupTutor',
  feature: 'dns_lookup_guide',
  toolsFile: 'dnsLookup/dnsLookupTools.mjs',
  menuExport: 'DNS_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'lookup',
  exampleStepId: 'compare',
  facts: [
    ['name', 'does', /IP address/, 'an IP address gives a reverse lookup'],
    ['types', 'does', /MX.*TXT.*CAA/s, 'the record types are named'],
    ['resolver', 'does', /Cloudflare.*Google/s, 'the two resolvers are named'],
    ['lookup', 'notes', /only reads DNS/, 'a lookup only reads'],
    ['compare', 'does', /same answer or different/, 'compare says same or different'],
    ['email-check', 'notes', /DKIM/, 'DKIM is not checked'],
  ],
  gaps: [/Changing, adding or deleting/, /Lighthouse/, /WHOIS/, /DKIM/, /private network/, /Watching a name/],
  rules: [/never opens the website/, /Compare both/, /No names or answers are saved/],
  system: [/Never state or guess what a name's records are/],
}).catch((e) => { console.error(e); process.exit(1); });
