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
  { id: 'site-switcher', label: 'Site switcher', group: 'Set up',
    does: 'The Site box at the top of the page. Choose which of your sites to work on, or Quick lookup (no site). Site setup, Lookup and Runs all follow the choice, and the choice is remembered in this browser.',
    notes: 'Each site has its own saved details, lookups and runs. You can track up to 20 sites, one for each client or website.' },
  { id: 'add-site', label: 'Add site', group: 'Set up',
    does: 'Starts a new site: it opens an empty Site setup form. Fill in at least the site address and press Add site. The new site then appears in the Site box.',
    notes: 'Each web address can be tracked once. Adding a site costs nothing.' },
  { id: 'delete-site', label: 'Delete site', group: 'Set up',
    does: 'Deletes the chosen site and its saved lookups after a Yes / No. They go to the recycle bin for 30 days, and the Undo on the message brings both back.',
    notes: 'The site\'s run history does not come back, and what it cost stays in the cost log. Undo cannot bring a site back if you have added the same web address again since.' },
  { id: 'site-name', label: 'Site name', group: 'Set up',
    does: 'An optional name for the site, such as a client\'s name. The Site box shows it. If it is empty the web address is shown.',
    notes: '' },
  { id: 'client-link', label: 'CRM client', group: 'Set up',
    does: 'Optionally links the site to one of your clients in the CRM, so you can tell whose it is. The client\'s name then shows beside the site name.',
    notes: 'It changes nothing else. Only your own clients can be chosen, and if the client is deleted from the CRM the link is simply removed.' },
  { id: 'site-address', label: 'Site address', group: 'Set up',
    does: 'Type the site you want to track, for example www.example.com.au. A leading https:// or www. is tidied away when you save.',
    notes: 'You can track each address once. To follow another client\'s website, add it as another site.' },
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
    notes: 'A Quick lookup works without a site, but then it cannot tell you where your own site is.' },
  { id: 'spending', label: 'DataForSEO and spending', group: 'Set up',
    does: 'Says whether DataForSEO is connected, and shows what has been spent this month, the monthly limit and what was spent last month. Spending counts everyone using the workspace\'s DataForSEO account.',
    notes: 'The limit is set on the server, not on the page. If it says Not connected, an administrator has to set the DataForSEO login and password on the server. If the account is not verified, DataForSEO refuses searches until it is.' },
  { id: 'lookup', label: 'Lookup', group: 'Lookup',
    does: 'The second tab. Check any search on Google right now, and keep a list of the lookups you have saved for the chosen site (or your Quick lookups).',
    notes: 'Each lookup is a paid search.' },
  { id: 'lookup-form', label: 'Lookup search box and options', group: 'Lookup',
    does: 'The search box, the choice of Desktop or Mobile, how many results to ask for (10, 20, 50, 100 or 200) and a tick box for Google\'s AI summary. Under them it shows the expected cost of the search.',
    notes: 'More results cost more, about a fifth of a cent for each 10. The AI summary can add a small charge, and it only appears for searches where Google shows one. A site\'s lookups use that site\'s place and language.' },
  { id: 'lookup-run', label: 'Look up', group: 'Lookup',
    does: 'Searches Google through DataForSEO and shows the answer straight away. The result is saved automatically.',
    notes: 'It stops with a message if DataForSEO is not connected, if the monthly limit has been reached, or if you have done too many lookups this hour. A refused search is not saved and not charged.' },
  { id: 'find-my-site', label: 'Find my site', group: 'Lookup',
    does: 'For when your site is not in the top 10. It asks for the top 100 results for the chosen site, without the AI summary, and shows your position and about which page of Google that is, for example #118, page 12. Google often gives only a short page, so a short answer is tried again (up to 4 times) and the result says how many results were really checked. If a full answer still does not have your site, a button offers to search the top 200.',
    notes: 'It needs a site, so it is not available for a Quick lookup. It is a paid search with the cost shown before and after; a short answer costs less, but the retries can add up to a few cents. The page number is approximate: it counts ten ordinary results to a page. If the result says only some of the results were checked, your site could be further down and Try again may help. Searching past 200 is not available.' },
  { id: 'lookup-result', label: 'Lookup result', group: 'Lookup',
    does: 'Shows where your site is (or that it is not in the results asked for), how many ads or other boxes sit above you, whether Google\'s AI summary appears and whether it names you or a competitor, the top 10 results and the order of everything on the page.',
    notes: 'A search that comes back with no ordinary results is shown as a failed search, never as "not ranked". Even then the cost is shown, because DataForSEO charges for it.' },
  { id: 'saved-lookups', label: 'Saved lookups', group: 'Lookup',
    does: 'The list of the saved lookups for the chosen site (or your Quick lookups), newest first: the search, device, when, where you were, and the cost. Click one to open it again. The latest 50 in each list are kept.',
    notes: 'The full original answer from DataForSEO is kept for 90 days; the readable result stays.' },
  { id: 'select-delete', label: 'Select and delete', group: 'Lookup',
    does: 'Tick the box beside any lookups, or tick Select all at the top, then press Delete selected. Delete all removes every saved lookup in the list you are looking at (one site\'s, or the Quick lookups). Both ask "Yes / No" first.',
    notes: 'Deleted lookups are kept for 30 days and the Undo on the message brings them back (the original DataForSEO answer is not brought back). They can also be restored from Settings, Recycle bin.' },
  { id: 'runs', label: 'Runs', group: 'Runs',
    does: 'The third tab. The daily checks and the ones you start by hand, for the chosen site.',
    notes: 'Right now a run only checks that DataForSEO is connected and records the balance and the cost. Collecting your rankings every day is the next stage and is not switched on yet.' },
  { id: 'run-now', label: 'Run now', group: 'Runs',
    does: 'Starts today\'s check for the chosen site straight away instead of waiting for 6:00 am Brisbane time. It needs a saved site and a connected DataForSEO.',
    notes: 'At the moment this only reads the account balance, which is free.' },
  { id: 'run-list', label: 'Run list', group: 'Runs',
    does: 'Every run, newest first: whether it finished or failed, when, whether it was daily or by hand, the balance and the cost, and each step with what happened.',
    notes: 'A failed step is shown as a failure, never as a missing ranking.' },
];

const RULES = [
  'Every lookup is a paid search through DataForSEO. The page shows an expected cost before and the real cost after. Asking for more results costs more.',
  'The tool refuses a search when this month\'s spending has reached the monthly limit, or when the search would pass it. The limit is set on the server and is shared by all sites.',
  'A search that returns no ordinary results is a failed search, never "not ranked". "Not found" only means the site is not in the results that really came back, and Google often returns far fewer results than were asked for, so each result says how many were actually checked.',
  'Saving the site details costs nothing and does not search anything.',
  'Deleting lookups moves them to the recycle bin for 30 days and the Undo brings them back; the original DataForSEO answer is not brought back.',
  'The Open buttons in this chat only switch to a tool (they show a tab or scroll to a part of the page); they never search, save or delete anything.',
  'A person can track up to 20 sites, each web address once. Each site has its own details, lookups and runs; Quick lookups belong to no site.',
  'A site can be linked to one of the person\'s own CRM clients; the link changes nothing else.',
  'It shows only the signed-in person\'s own sites, lookups and runs.',
];

const NOT_POSSIBLE = [
  'Collecting your rankings every day and showing a history of where you ranked: that is the next stage and is not switched on yet.',
  'A weekly report, alerts or notifications when your ranking changes.',
  'Importing Search Console data, or checking the pages listed for health, yet: those are later stages.',
  'Tracking more than 20 sites, or the same web address twice.',
  'Searching further down than the top 200 results: that needs DataForSEO\'s slower queued mode, which is not switched on.',
  'Showing a client\'s SEO results inside the CRM client page: the link only tells you whose site it is for now.',
  'Changing the monthly spending limit or the DataForSEO login: those are set on the server by an administrator.',
  'Local map results (the map pack) or exact city-by-city tracking.',
  'Editing a saved lookup, or exporting lookups to a file.',
  'Seeing other people\'s sites, lookups or runs.',
  'Verifying the DataForSEO account: that is done by the account owner on DataForSEO\'s own website.',
];

const SYSTEM = `You are the guide to SERP Tracker in Vault for one person who wants to find out where their website shows on Google. They say, in everyday words, what they want to do. You point them to the right parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do (yet).
- You cannot see their site, searches, results, costs or settings. Never state or guess a ranking, a cost, a competitor, a client or a number.
- Be plain and short, as to a friend who is not technical. Explain any search word (SERP, keyword, AI summary, ranking) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Every lookup costs money. Say so when a step makes a search.
- A person may track several sites (one for each client). Say which site a step is for when it matters, and point at the Site box to switch.
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
