'use strict';

// The SERP Tracker guide (the round button on Vault's /serp-tracker page): a person says what they want to do ("see where I rank",
// "check a search", "delete old lookups") and the guide points at the real parts of the page, in order, or says plainly that the page does not
// do it (yet). It only knows what is written here and it never sees any site, keyword, result, cost or setting. Built on guideCore.js; the ids
// are the page's own, listed in client/src/pages/serpTracker/serpTrackerTools.mjs (a test keeps the two in step). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'setup', label: 'Site setup', group: 'Set up',
    does: 'The first tab. It holds your site details (site address, brand names, searches to track, competitors, pages to health-check, where Google is asked from, devices) and a box showing whether DataForSEO is connected and what has been spent this month.',
    notes: 'Saving the details costs nothing and does not search anything.' },
  { id: 'site-address', label: 'Site address', group: 'Set up',
    does: 'Type the site you want to track, for example www.example.com.au. A leading https:// or www. is tidied away when you save.',
    notes: 'One site per person for now. Saving again replaces it.' },
  { id: 'brand-names', label: 'Brand names', group: 'Set up',
    does: 'One name per line: the words people type when they look for you by name. They will be used to split searches into branded and non-branded.',
    notes: 'Nothing uses them yet.' },
  { id: 'keywords', label: 'Keywords to track', group: 'Set up',
    does: 'One search per line. To say which page you want to rank for it, type a | after the words and then the full page address. Up to 50 searches.',
    notes: 'The searches are saved now but are not collected every day yet; that is a later stage. A target page must be on your own site.' },
  { id: 'competitors', label: 'Competitors', group: 'Set up',
    does: 'One competitor site per line. To watch particular pages of theirs, type a | then the page addresses separated by commas. Competitors named here are marked when Google\'s AI summary names them.',
    notes: 'Up to 20 competitors, 10 pages each. Each page must be on that competitor\'s own site.' },
  { id: 'health-urls', label: 'Pages to health-check', group: 'Set up',
    does: 'One page of your own site per line. A later stage will check these every day for redirects, errors and a changed canonical address.',
    notes: 'Nothing checks them yet.' },
  { id: 'location-depth', label: 'Where Google is asked from', group: 'Set up',
    does: 'Four boxes: where Google is asked from ("Australia" gives national results; a city such as "Brisbane,Queensland,Australia" gives local ones), how many results to request (10 to 100 in steps of 10), the language and your time zone.',
    notes: 'Asking for more results costs more. Lookup uses the place and language set here. The time zone decides which day a result belongs to.' },
  { id: 'devices', label: 'Devices', group: 'Set up',
    does: 'Tick Desktop, Mobile or both. Google can show different results to each.',
    notes: 'At least one must be ticked.' },
  { id: 'save-site', label: 'Save site details', group: 'Set up',
    does: 'Checks everything you typed and saves it. If something is wrong it lists every problem in plain words next to the form and saves nothing.',
    notes: 'Lookup works without saved details, but then it cannot tell you where your site is.' },
  { id: 'spending', label: 'DataForSEO and spending', group: 'Set up',
    does: 'Says whether DataForSEO is connected, and shows what has been spent this month, the monthly limit and what was spent last month. Spending counts everyone using the workspace\'s DataForSEO account.',
    notes: 'The limit is set on the server, not on the page. If it says Not connected, an administrator has to set the DataForSEO login and password on the server. If the account is not verified, DataForSEO refuses searches until it is.' },
  { id: 'lookup', label: 'Lookup', group: 'Lookup',
    does: 'The second tab. Check any search on Google right now, and keep a list of the lookups you have saved.',
    notes: 'Each lookup is a paid search.' },
  { id: 'lookup-form', label: 'Lookup search box and options', group: 'Lookup',
    does: 'The search box, the choice of Desktop or Mobile, how many results to ask for (10, 20, 50 or 100) and a tick box for Google\'s AI summary.',
    notes: 'More results cost more. The AI summary can add a small charge, and it only appears for searches where Google shows one.' },
  { id: 'lookup-run', label: 'Look up', group: 'Lookup',
    does: 'Searches Google through DataForSEO and shows the answer straight away. The result is saved automatically.',
    notes: 'It stops with a message if DataForSEO is not connected, if the monthly limit has been reached, or if you have done too many lookups this hour. A refused search is not saved and not charged.' },
  { id: 'lookup-result', label: 'Lookup result', group: 'Lookup',
    does: 'Shows where your site is (or that it is not in the results asked for), how many ads or other boxes sit above you, whether Google\'s AI summary appears and whether it names you or a competitor, the top 10 results and the order of everything on the page.',
    notes: 'A search that comes back with no ordinary results is shown as a failed search, never as "not ranked". Even then the cost is shown, because DataForSEO charges for it.' },
  { id: 'saved-lookups', label: 'Saved lookups', group: 'Lookup',
    does: 'The list of your saved lookups, newest first: the search, device, when, where you were, and the cost. Click one to open it again. The latest 50 are kept.',
    notes: 'The full original answer from DataForSEO is kept for 90 days; the readable result stays.' },
  { id: 'select-delete', label: 'Select and delete', group: 'Lookup',
    does: 'Tick the box beside any lookups, or tick Select all at the top, then press Delete selected. Delete all removes every saved lookup. Both ask "Yes / No" first.',
    notes: 'Deleted lookups are kept for 30 days and the Undo on the message brings them back (the original DataForSEO answer is not brought back). They can also be restored from Settings, Recycle bin.' },
  { id: 'runs', label: 'Runs', group: 'Runs',
    does: 'The third tab. The daily checks and the ones you start by hand.',
    notes: 'Right now a run only checks that DataForSEO is connected and records the balance and the cost. Collecting your rankings every day is the next stage and is not switched on yet.' },
  { id: 'run-now', label: 'Run now', group: 'Runs',
    does: 'Starts today\'s check straight away instead of waiting for 6:00 am Brisbane time. It needs saved site details and a connected DataForSEO.',
    notes: 'At the moment this only reads the account balance, which is free.' },
  { id: 'run-list', label: 'Run list', group: 'Runs',
    does: 'Every run, newest first: whether it finished or failed, when, whether it was daily or by hand, the balance and the cost, and each step with what happened.',
    notes: 'A failed step is shown as a failure, never as a missing ranking.' },
];

const RULES = [
  'Every lookup is a paid search through DataForSEO, and the page shows the cost afterwards. Asking for more results costs more.',
  'The tool stops making searches when this month\'s spending reaches the monthly limit, which is set on the server.',
  'A search that returns no ordinary results is a failed search, never "not ranked". "Not ranked" means the site is not in the results that were asked for.',
  'Saving the site details costs nothing and does not search anything.',
  'Deleting lookups moves them to the recycle bin for 30 days and the Undo brings them back; the original DataForSEO answer is not brought back.',
  'The Open buttons in this chat only switch to a tool (they show a tab or scroll to a part of the page); they never search, save or delete anything.',
  'It shows only the signed-in person\'s own site, lookups and runs.',
];

const NOT_POSSIBLE = [
  'Collecting your rankings every day and showing a history of where you ranked: that is the next stage and is not switched on yet.',
  'A weekly report, alerts or notifications when your ranking changes.',
  'Importing Search Console data, or checking the pages listed for health, yet: those are later stages.',
  'Tracking more than one site: there is one site per person for now.',
  'Changing the monthly spending limit or the DataForSEO login: those are set on the server by an administrator.',
  'Local map results (the map pack) or exact city-by-city tracking.',
  'Editing a saved lookup, or exporting lookups to a file.',
  'Seeing other people\'s sites, lookups or runs.',
  'Verifying the DataForSEO account: that is done by the account owner on DataForSEO\'s own website.',
];

const SYSTEM = `You are the guide to SERP Tracker in Vault for one person who wants to find out where their website shows on Google. They say, in everyday words, what they want to do. You point them to the right parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do (yet).
- You cannot see their site, searches, results, costs or settings. Never state or guess a ranking, a cost, a competitor or a number.
- Be plain and short, as to a friend who is not technical. Explain any search word (SERP, keyword, AI summary, ranking) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Every lookup costs money. Say so when a step makes a search.
- Daily ranking collection, history, reports and alerts are not built yet. Say so plainly rather than pointing at something that is not there.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'SERP Tracker guide', feature: 'serp_tracker_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'SERP TRACKER TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with SERP Tracker, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askSerpTrackerTutor: guide.ask,
};
