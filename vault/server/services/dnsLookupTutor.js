'use strict';

// The DNS Lookup guide (the round button on Vault's /dns-lookup page): a person says what they want to know ("is my email set up",
// "has my change spread yet", "where does this site point") and the guide points at the real controls, in order, or says plainly that
// DNS Lookup does not do it. It only knows what is written here and it never sees any name typed or any answer. Built on guideCore.js;
// the ids are the page's own, listed in client/src/pages/dnsLookup/dnsLookupTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/dns-lookup.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'name', label: 'Name box', group: 'Look up records',
    does: 'The box at the top of Look up records. Type a domain name (example.com), a web address (https://www.example.com/page) or an email address, and the page uses just the domain part. Type an IP address instead to find the name it belongs to (a reverse lookup).',
    notes: 'It asks about the name you type, exactly. www.example.com and example.com can have different records.' },
  { id: 'types', label: 'Record types', group: 'Look up records',
    does: 'The row of choices under the box picks which kinds of record to ask for: A and AAAA (the address a name points to), CNAME (an alias to another name), MX (where email goes), NS (who runs the name\'s DNS), TXT (notes such as SPF and site verification), SOA (the zone\'s admin details) and CAA (who may issue security certificates). All are ticked by default.',
    notes: 'Untick the ones you do not need to keep the answer short.' },
  { id: 'resolver', label: 'Ask which resolver', group: 'Look up records',
    does: 'The Ask choice picks who is asked: Cloudflare (1.1.1.1) or Google (8.8.8.8). Both are public resolvers that answer the same way the wider internet sees the name.',
    notes: 'A resolver may keep an old answer until its time to live (TTL) runs out, so after a change the two can briefly differ.' },
  { id: 'lookup', label: 'Look up', group: 'Look up records',
    does: 'The Look up button asks and shows each record type as its own block with its values, priority (for MX) and time to live (TTL). A type with nothing says so. Each value has a Copy button.',
    notes: 'It only reads DNS. It does not open the website or send any email.' },
  { id: 'compare', label: 'Compare both', group: 'Look up records',
    does: 'Compare both asks Cloudflare and Google the same question and says, for each record type, whether they gave the same answer or different ones. Use it after changing a record to see whether the change has spread.',
    notes: 'Different answers usually mean the change is still spreading and it will settle by itself. Some records take hours.' },
  { id: 'email-check', label: 'Check email setup', group: 'Check email',
    does: 'The Check email setup box takes a domain and reads its MX, SPF and DMARC records. It lists what it found in plain words, each marked good, worth a look or a problem: no mail servers, no SPF, two SPF records, SPF with more than ten lookups, no DMARC or a monitor-only DMARC. It also recognises Cloudflare Email Routing.',
    notes: 'It reads the records only. It cannot tell whether an email will actually arrive. It does not check DKIM, because that needs the sender\'s selector name.' },
];

const RULES = [
  'Type the domain in the box, choose what to ask for, then press Look up. The answer appears below the box.',
  'DNS answers can be out of date for a while after a change; Compare both shows whether two big resolvers agree yet.',
  'Look up records and Check email setup are separate boxes on the same page; the email check ignores the record type choices.',
  'It reads public DNS only. It never opens the website, never sends mail and never changes a record.',
  'No names or answers are saved, and nothing is sent anywhere except the question to the chosen resolver.',
  'The Open buttons in this chat only switch to a tool (they scroll to its box); they never look anything up by themselves.',
];

const NOT_POSSIBLE = [
  'Changing, adding or deleting DNS records: it only reads them (records are changed where the domain is managed, such as Cloudflare).',
  'Checking whether a website is up or fast (use Lighthouse), or whether a domain name is free to buy (use Domain).',
  'Showing who owns a domain (WHOIS) or when it expires.',
  'Checking DKIM, or whether an email will actually be delivered.',
  'Looking up a name on a private network or one that only exists inside a company.',
  'Watching a name over time or sending an alert when it changes.',
];

const SYSTEM = `You are the guide to DNS Lookup in Vault for one person who looks up what a domain name points to and checks that its email records are sensible. They say, in everyday words, what they want to know. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say DNS Lookup cannot do.
- You cannot see any name they typed or any answer. Never state or guess what a name's records are.
- Be plain and short, as to a friend who is not technical. Explain any DNS word (MX, TXT, TTL) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask why a change has not shown up, say records are cached for their TTL, to use Compare both, and to wait.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'DNS Lookup guide', feature: 'dns_lookup_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DNS LOOKUP TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to find out about the domain, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDnsLookupTutor: guide.ask,
};
