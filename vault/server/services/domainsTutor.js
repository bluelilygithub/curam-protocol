'use strict';

// The Domain guide (the round button on Vault's /domains page, "Domain & Brand"): a person says what they want to find out ("I need a
// name for my business", "is this name free on Instagram", "what will it cost to keep it") and the guide points at the real tools, in
// order, or says plainly that Domain does not do it. It only knows what is written here and it never sees any description, name or
// result. Built on guideCore.js; the ids are the page's own, listed in client/src/pages/domains/domainsTools.mjs (a test keeps the two
// in step). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- Discover ----
  { id: 'suggest', label: 'Name Generator', group: 'Discover',
    does: 'Describe the business in plain English, or paste a few keywords, and press Generate Names. The AI suggests 16 brand names and each is checked for .com, .com.au, .io, .ai, .co and .app. Names with a free .com or .com.au come first; green means available and red means taken.',
    notes: 'The description you type is read by the AI model Vault is set up with, and the names are checked with a domain data service. A name being free does not mean you may use it: trademarks are not checked.' },
  { id: 'score', label: 'Name Scorer', group: 'Discover',
    does: 'Type one name and press Score Name. It gives an overall brand quality score and ratings for how memorable it is, how hard it is to spell, how easy it is to read in other languages, and its length and structure.',
    notes: 'The score is an opinion from a scoring service, a guide for choosing between names and not a verdict. The ending (.com) is ignored.' },
  { id: 'compare', label: 'Compare Names', group: 'Discover',
    does: 'Enter two to five candidate names and press Compare. It ranks them on every scoring measure and shows the ranking.',
    notes: 'It needs at least two names. Good for narrowing down a shortlist from the Name Generator.' },
  { id: 'describe-business', label: 'Describe your business', group: 'Discover',
    does: 'The big box at the top of Name Generator. Say or type what the business does and who it is for. Plain English works best; keywords are fine too.',
    notes: 'A sentence or two with the kind of customer gives better names than one word.' },
  { id: 'availability', label: 'Availability check', group: 'Discover',
    does: 'Part of Name Generator: after the names are suggested, each is checked for six endings (.com, .com.au, .io, .ai, .co, .app) and shown green if free or red if taken.',
    notes: 'It tells you whether the name is registered. It does not register it, hold it for you or check social media (use Social Handles).' },
  { id: 'add-name', label: 'Add name', group: 'Discover',
    does: 'In Compare Names, Add name gives you another box for a candidate name, up to five.',
    notes: 'Empty boxes are ignored.' },
  { id: 'microphone', label: 'Microphone', group: 'Discover',
    does: 'Every text box on the page has a microphone button. Press it, speak, and press it again (or pause, in a short box) to stop. In the big description box it keeps listening until you stop it. In a name or domain box say "dot" for a full stop and "dash" for a hyphen, so "acme wine dot com dot au" becomes acmewine.com.au.',
    notes: 'It needs a browser that supports speech recognition (Chrome or Edge work well). Check what it typed before you run the tool: names are easily misheard, so say one letter at a time if a name comes out wrong, or type it.' },
  { id: 'preferred-name', label: 'Preferred name and shortlist', group: 'Discover',
    does: 'On each name in the Name Generator results there are two buttons. Shortlist stars a name you like (up to five); the shortlisted names are the ones Compare Names ranks. Make preferred picks the one name that all the other tools run on. A new batch of names starts the choices over.',
    notes: 'Only one name can be preferred. You can also type or say the preferred name on the Current set page if you already have one.' },
  { id: 'suggestion-table', label: 'Table of three', group: 'Discover',
    does: 'On the Name Generator, the Table of three button shows three suggestions side by side, one per column. Each column lists the domain endings (.com, .com.au, .io, .ai, .co, .app) as free, taken or unknown, and the social media handles (Instagram, X, TikTok, LinkedIn, YouTube, GitHub and more) once you press Check social handles. Under each name it counts how many endings and handles are free. Every column has a list to swap in any other suggested name, and a Make preferred button.',
    notes: 'It starts with the preferred name and shortlist, then the best of the rest. Handles are one lookup per name and are saved with the set. Free means not registered or claimed right now; it is not a trademark check.' },
  // ---- Research ----
  { id: 'overview', label: 'Domain Profile', group: 'Research',
    does: 'Type a domain that already exists (example.com) and press Get Profile. It shows the registration details, when it was created, how old it is, its lifecycle stage (active, expiring and so on), reputation signals and a DNS snapshot.',
    notes: 'It reports public information. It does not tell you how to buy a domain someone else owns.' },
  // ---- Launch Readiness ----
  { id: 'social', label: 'Social Handles', group: 'Launch Readiness',
    does: 'Type the name you want and press Check Handles. It checks more than ten platforms at once, including Instagram, X, TikTok, LinkedIn, YouTube and GitHub, and marks each available, taken or unknown.',
    notes: 'Unknown means it could not tell, so check that platform yourself. It does not register any handle.' },
  { id: 'pricing', label: 'Registrar Pricing', group: 'Launch Readiness',
    does: 'Type a domain and press Compare Prices. It lists what major registrars charge to register and to renew that ending (the part after the dot), and points out the cheapest renewal.',
    notes: 'Prices change and may differ at checkout. A low first-year price can hide a high renewal, which is why renewal is shown.' },
];

const SETS_CATALOG = [
  { id: 'board', label: 'Current set', group: 'My sets',
    does: 'The business idea you are working on: its description, the preferred name and shortlist, and the result of every tool on one page, with a place to name and save it. The Run all tools button here checks the preferred name in Name Scorer, Social Handles, Registrar Pricing (.com and .com.au), Domain Profile (only when the name is already registered) and Compare Names (needs at least two shortlisted names). A failed check shows its own message and the rest still appear.',
    notes: 'Unsaved changes are flagged. New set clears the board but never deletes a saved set.' },
  { id: 'run-all', label: 'Run all tools', group: 'My sets',
    does: 'The button on Current set (and under the Name Generator results once a name is preferred). It makes every lookup for the preferred name at once, then shows the results on Current set. Pressing it again refreshes them.',
    notes: 'It uses a handful of lookups with the domain data service each time. Domain Profile is skipped when every ending is free, because there is nothing registered to profile.' },
  { id: 'save-set', label: 'Save set', group: 'My sets',
    does: 'On Current set, type a name for the set and press Save set. It keeps the description, all the suggested names, the preferred name and shortlist, and every result as shown. After the first save the button says Update set.',
    notes: 'A set is kept with your account only. Up to 200 sets.' },
  { id: 'delete-set', label: 'Delete sets', group: 'My sets',
    does: 'On Saved sets, press Delete beside a set, or tick several sets (or Select all) and press Delete selected, then confirm with Yes. On Current set, a saved set also has a Delete set button. Deleted sets go to Settings, Recycle bin for 30 days and an Undo appears straight away.',
    notes: 'Deleting a set never touches the names or results you are looking at in another set. After 30 days in the bin a set is gone for good.' },
  { id: 'sets', label: 'Saved sets', group: 'My sets',
    does: 'The list of your saved sets with the preferred name, how many names and results each holds, and when it was last updated. Open shows it on Current set exactly as saved, with no new lookups. Delete moves it to Settings, Recycle bin for 30 days, with an Undo.',
    notes: 'Availability and prices change, so run all the tools again on an old set before relying on it.' },
];

const RULES = [
  'Pick a tool on the left, type or speak into its box, then press its button. The answer appears below the box.',
  'Name Generator is the place to start when you have no name. Name Scorer and Compare Names are for names you already have. Social Handles and Registrar Pricing come last, before you commit.',
  'Every box has a microphone. In a name or domain box, say "dot" for a full stop and "dash" for a hyphen.',
  'Nothing is bought, registered or held. Domain only looks things up; the only thing it keeps is a set you save yourself.',
  'A free name is not a safe name: trademarks and business-name registers are not checked. Say so if someone asks whether they may use a name.',
  'The description in Name Generator is read by the AI model Vault is set up with, and names are checked with a domain data service. Do not put anything confidential in it.',
  'A set is one business idea kept with its names and results. Generate names, shortlist some, make one preferred, press Run all tools, then save the set from Current set. Saved sets lists them to open again.',
  'Saved results are a snapshot. Availability and prices change, so run the tools again before acting on an old set.',
  'The Open buttons in this chat only switch to a tool; they never run anything by themselves.',
];

const NOT_POSSIBLE = [
  'Buying or registering a domain, or holding a name for you (do that at a registrar; Registrar Pricing shows which is cheapest).',
  'Checking trademarks, company or business-name registers, or whether a name is legally safe to use.',
  'Changing DNS records, setting up email or pointing a domain at a website (that is DNS Lookup for reading records).',
  'Buying a domain that someone else already owns, or finding out how to contact the owner.',
  'Checking how fast a website is or how it ranks in search (Page speed and Search Console do that).',
  'Registering social media handles, or reserving them.',
  'Watching a name or reminding you about an expiry date (a set keeps a snapshot; it does not check again by itself).',
];

const SYSTEM = `You are the guide to Domain (Domain & Brand) in Vault, a private AI workspace. One person uses it to find a name for a business, check a name they already have, and check it is free and affordable before they commit. They say, in everyday words, what they want to do. You point them to the real tools, in order, or say plainly that Domain does not do it.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Domain cannot do.
- You cannot see any description, name or result they have typed or been given. Never state or guess whether a name is available, what it scores or what it costs.
- Never say a name is safe to use. A free name only means it is not registered; trademarks are not checked.
- Be plain and short, as to a friend who is not technical. Explain any unusual word (TLD, registrar, WHOIS, renewal) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask about speaking instead of typing, point at the microphone and explain "dot" and "dash".
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

CATALOG.push(...SETS_CATALOG);

const guide = createGuide({
  name: 'Domain guide', feature: 'domains_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DOMAIN TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your business name or domain, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDomainsTutor: guide.ask,
};
