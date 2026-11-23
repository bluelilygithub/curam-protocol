'use strict';

// The Business Profiler guide (the round button on /bip and /bip/:id). It knows the page's controls and what BIP can and cannot read.
// It never sees a domain, a profile or any result. Built on guideCore.js; ids match client/src/pages/bip/bipTools.mjs.
// See docs/guide-chat.md and docs/bip.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'search', label: 'Profile a domain', group: 'Profile',
    does: 'The box at the top of /bip. Type a domain such as example.com and press Profile. BIP first reads the domain registration (RDAP, with a WHOIS fallback), the DNS records and the public pages of the website, then looks up the business in the sources that are switched on for this server.',
    notes: 'A full profile runs in the background and appears when it finishes. If that domain was profiled in the last 30 days, the saved report is shown instead.' },
  { id: 'profiles', label: 'Saved profiles', group: 'Profile',
    does: 'The list below the search box. It shows every profile you have saved, newest first, with the business name, domain, date profiled and a link to the full report.',
    notes: 'Profiles stay until you delete them. Deleting one puts it in the recycle bin for 30 days.' },
  { id: 'profile', label: 'Profile cards', group: 'Profile',
    does: 'The full report at /bip/:id. It has seven cards: Entity Overview, People, Locations, Products & Services, Digital Footprint, Online Presence & Reputation, and Financial Indicators.',
    notes: 'Financial Indicators are estimates from public sources. Figures BIP cannot find are left blank rather than invented.' },
  { id: 'conflicts', label: 'Confidence & conflicts', group: 'Review',
    does: 'Shows every value found for a field with the source it came from. ✅ means two or more sources agree, ⚠️ means one source, and ❌ means sources disagree. You can record your own decision on a conflict; BIP never chooses a winner for you.',
    notes: 'A decision is saved on the profile. It does not delete or overwrite any of the original values.' },
  { id: 'refresh', label: 'Re-scan & refresh', group: 'Review',
    does: 'Re-scan runs every module again. The refresh icon on a card re-runs only that module, keeps the rest of the report, and writes a new timestamped copy of its response.',
    notes: 'A re-scan ignores the 30-day cache. A single-module refresh is quicker and leaves the other sources untouched.' },
  { id: 'export', label: 'Download PDF', group: 'Review',
    does: 'Downloads the saved profile as a PDF using Vault’s usual export button. It contains the cards, the source list and the confidence labels.',
    notes: 'The PDF is made from the saved report; it does not do any new lookups.' },
  { id: 'save', label: 'Save to Note & Client', group: 'Review',
    does: 'The Notes & client box on a saved profile (also the Save to Note / Client button at the top). Save as a new note makes a note in Notes with the key facts and a link back to the profile; you can file it under a project. The box lists every note that links to the profile. Create client from profile makes a CRM client (status Prospect, with the name, ABN, address, phone and website in its notes) and links the two; or pick an existing client and press Link.',
    notes: 'A linked client\'s page lists the profile under Business profiles, and notes saved afterwards are filed under that client too. Unlink stops the link without changing the client or any note.' },
];

const RULES = [
  'Type a domain in the search box, press Profile, wait for the background job, then open the saved profile.',
  'The first stage reads domain registration, DNS and the website. The second stage uses that seed for ABN Lookup, ASIC, Google Places, Google search, social links, ProductReview.com.au, Trustpilot and tech stack detection.',
  'ASIC has no free public feed here. When it is blocked the source is marked unavailable and the profile links to the ASIC register for a manual check.',
  'A source with no key is skipped, not failed. The rest of the profile still finishes.',
  'The 30-day cache means the saved report is shown within 30 days. Use Re-scan for fresh data or a card’s refresh icon for one source only.',
  'Values are never silently merged: all of them are shown with their source and a ✅ / ⚠️ / ❌ confidence label, and the person decides what to do about a conflict.',
  'The Open buttons in this chat only switch to a tool (they scroll to its box or section); they never run a lookup or change a profile by themselves.',
];

const NOT_POSSIBLE = [
  'Verifying that a business is legitimate, or giving legal, accounting or investment advice.',
  'Reading private company data, ASIC filings behind a login, credit reports, bank records or tax returns.',
  'Guessing revenue, funding or employee numbers when no public source states them.',
  'Resolving a disagreement between sources automatically: BIP shows all values and lets the person decide.',
  'Watching a domain over time, sending alerts, or scanning a whole list of domains at once.',
  'Changing DNS, registering a domain or contacting a business.',
];

const SYSTEM = `You are the guide to Business Profiler in Vault for one person who wants a rounded public-source profile of a business from its domain. They say what they want in everyday words. You point them to the right control, in order, and explain how it works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Business Profiler cannot do.
- You cannot see any domain they type, any profile, or any result. Never state or guess what a profile says.
- Be plain and short, as to a friend who is not technical. Explain words such as RDAP, DNS and JSONB in a few everyday words the first time you use them.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask about a conflict, say that all values are shown with their sources, that BIP does not pick a winner, and that they can record their own decision.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Business Profiler guide', feature: 'bip_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'BUSINESS PROFILER TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to find out about a business, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askBipTutor: guide.ask,
};
