// What the DNS Lookup page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids
// are the guide's catalogue (server/services/dnsLookupTutor.js); npm run test:dns-lookup-tutor fails if the two lists drift apart.
// The page has no tool menu, so the two "tools" below are its two boxes: `tool` on a guide entry says which box its Open button scrolls to
// (the page marks each box with data-guide="lookup" / "email-check").

export const DNS_TOOLS = [
  { id: 'lookup', label: 'Look up records', group: 'Look up records', icon: 'search' },
  { id: 'email-check', label: 'Check email setup', group: 'Check email', icon: 'mail' },
];

export const GROUPS = ['Look up records', 'Check email'];

export const GROUP_TIPS = {
  'Look up records': 'Ask a public resolver what a name points to: its address, mail servers, name servers and notes.',
  'Check email': 'Read a domain\'s mail records (MX, SPF, DMARC) and say in plain words whether they look right.',
};

export const TOOL_TIPS = {
  lookup: 'Type a domain or an IP address and see its DNS records. Compare Cloudflare and Google to see whether a change has spread.',
  'email-check': 'Type a domain and see whether its mail servers, SPF and DMARC records look right. Reads the records only.',
};

export const TOOL_BLURBS = {
  lookup: 'What a name points to, from Cloudflare or Google.',
  'email-check': 'Mail servers, SPF and DMARC in plain words.',
};

// The longer text for the (i) "How DNS Lookup works" box.
export const HOW_IT_WORKS = [
  ['What DNS is', 'DNS is the internet\'s phone book. It turns a name like example.com into the address of a computer, and says where its email goes.'],
  ['Look up records', 'Type a domain, a web address or an IP address, choose which kinds of record you want, and press Look up. An IP address gives the name it belongs to.'],
  ['Cloudflare or Google', 'Pick who to ask. Compare both asks them together and says whether they agree. After you change a record, different answers usually mean the change is still spreading. It settles by itself.'],
  ['Check email setup', 'Reads the MX (where mail goes), SPF (who may send) and DMARC (what to do with fakes) records and marks each good, worth a look or a problem. It cannot tell whether an email will really arrive.'],
  ['Read only', 'Nothing is changed and nothing is saved. Records are changed where the domain is managed, for example in Cloudflare.'],
];

// Everything the guide can point at: the two boxes plus the controls inside them. `tool` is the box the Open button scrolls to.
export const GUIDE_TOOLS = [
  { id: 'name', label: 'Name box', tool: 'lookup' },
  { id: 'types', label: 'Record types', tool: 'lookup' },
  { id: 'resolver', label: 'Ask which resolver', tool: 'lookup' },
  { id: 'lookup', label: 'Look up', tool: 'lookup' },
  { id: 'compare', label: 'Compare both', tool: 'lookup' },
  { id: 'email-check', label: 'Check email setup', tool: 'email-check' },
];
