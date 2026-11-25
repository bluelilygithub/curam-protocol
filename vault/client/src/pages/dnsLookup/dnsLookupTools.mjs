// What the DNS Lookup page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids
// are the guide's catalogue (server/services/dnsLookupTutor.js); npm run test:dns-lookup-tutor fails if the two lists drift apart.
// DNS_TOOLS is the left-hand menu (ToolSidebar). `tool` on a guide entry says which menu tool its Open button opens.

export const DNS_TOOLS = [
  { id: 'lookup', label: 'Look up records', group: 'Look up', icon: 'search' },
  { id: 'email-check', label: 'Check email setup', group: 'Look up', icon: 'mail' },
  { id: 'saved', label: 'Saved lookups', group: 'Saved', icon: 'history' },
];

export const GROUPS = ['Look up', 'Saved'];

export const GROUP_TIPS = {
  'Look up': 'Ask a public resolver what a name points to, who hosts it and who it is registered with, or check its email records.',
  Saved: 'Every lookup you run is kept here, so you can open it again or export it.',
};

export const TOOL_TIPS = {
  lookup: 'Type a domain or an IP address and see its DNS records, who hosts it and its registrar. Compare Cloudflare and Google to see whether a change has spread.',
  'email-check': 'Type a domain and see whether its mail servers, SPF and DMARC records look right. Reads the records only.',
  saved: 'Your past lookups, newest first. Open one to see it again or export it; delete the ones you do not need.',
};

export const TOOL_BLURBS = {
  lookup: 'What a name points to, who hosts it and its registrar.',
  'email-check': 'Mail servers, SPF and DMARC in plain words.',
  saved: 'Every lookup you ran, ready to open or export.',
};

// The longer text for the (i) "How DNS Lookup works" box.
export const HOW_IT_WORKS = [
  ['What DNS is', 'DNS is the internet\'s phone book. It turns a name like example.com into the address of a computer, and says where its email goes.'],
  ['Look up records', 'Type a domain, a web address or an IP address, choose which kinds of record you want, and press Look up. An IP address gives the name it belongs to.'],
  ['Host and registrar', 'Each lookup also says who runs the computer the name points to (the host), which country and city it is in, and which company the domain is registered through (the registrar), with its registered and expiry dates when the registry gives them. If the site sits behind Cloudflare or another proxy, the real host is hidden and the page says so.'],
  ['Cloudflare or Google', 'Pick who to ask. Compare both asks them together and says whether they agree. After you change a record, different answers usually mean the change is still spreading. It settles by itself.'],
  ['Check email setup', 'Reads the MX (where mail goes), SPF (who may send) and DMARC (what to do with fakes) records and marks each good, worth a look or a problem. It cannot tell whether an email will really arrive.'],
  ['Saved and export', 'Every answer is saved under Saved lookups. Export downloads it as a report page (opens in a browser and prints to PDF) or a spreadsheet file (CSV). Nothing is ever changed: records are changed where the domain is managed, for example in Cloudflare.'],
];

// Everything the guide can point at: the menu tools plus the controls inside them. `tool` is the menu tool the Open button opens.
export const GUIDE_TOOLS = [
  { id: 'name', label: 'Name box', tool: 'lookup' },
  { id: 'types', label: 'Record types', tool: 'lookup' },
  { id: 'resolver', label: 'Ask which resolver', tool: 'lookup' },
  { id: 'lookup', label: 'Look up records', tool: 'lookup' },
  { id: 'compare', label: 'Compare both', tool: 'lookup' },
  { id: 'about', label: 'Host and registrar', tool: 'lookup' },
  { id: 'export', label: 'Export', tool: 'lookup' },
  { id: 'email-check', label: 'Check email setup', tool: 'email-check' },
  { id: 'saved', label: 'Saved lookups', tool: 'saved' },
];
