// What the SERP Tracker page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids are
// the guide's catalogue (server/services/serpTrackerTutor.js); node server/services/serpTrackerTutor.test.js fails if the two lists drift apart.
// The page has three tabs, so the three "tools" below are its tabs. `tool` on a guide entry says which tab its Open button shows, and the page
// marks each part with data-guide="<id>" so the button can scroll to it.

export const SERP_TOOLS = [
  { id: 'setup', label: 'Site setup', group: 'Set up', icon: 'settings' },
  { id: 'lookup', label: 'Lookup', group: 'Lookup', icon: 'search' },
  { id: 'runs', label: 'Runs', group: 'Runs', icon: 'clock' },
];

export const GROUPS = ['Set up', 'Lookup', 'Runs'];

export const GROUP_TIPS = {
  'Set up': 'Tell SERP Tracker which site, searches and competitors to follow, and check that DataForSEO is connected.',
  Lookup: 'See who is on Google right now for any search, and keep the ones you want.',
  Runs: 'The daily checks: when they ran, whether they worked, and what they cost.',
};

export const TOOL_TIPS = {
  setup: 'Your site, the searches to track, your competitors and where Google is asked from. Also shows whether DataForSEO is connected and what it has cost this month.',
  lookup: 'Look up any search on Google right now, see where your site is, and keep the result to open again later.',
  runs: 'The daily checks and the ones you start by hand, with what each one found and cost.',
};

export const TOOL_BLURBS = {
  setup: 'Your site, searches and competitors.',
  lookup: 'A search on Google right now, saved.',
  runs: 'Daily checks and their cost.',
};

// The longer text for the (i) "How SERP Tracker works" box.
export const HOW_IT_WORKS = [
  ['What it is for', 'SERP Tracker looks at Google for the searches that matter to you and tells you where your site shows up. "SERP" just means the page of Google results for one search. It gets those results from a paid service called DataForSEO.'],
  ['Site setup', 'Say which site is yours, which searches to follow, who your competitors are, and where Google should be asked from (Australia, or a city). Saving costs nothing.'],
  ['Lookup', 'Type any search and Vault asks Google through DataForSEO right now. You see the top 10 results, where your site is (or that it is not in the results asked for), whether Google shows an AI summary and who it names, and what else sits above you, such as ads. Each lookup is saved so you can open it again.'],
  ['What a lookup costs', 'Every lookup is a paid search, and the exact cost is shown after it. The tool keeps a running total for the month and stops making searches when it reaches the monthly limit. The AI summary is an optional extra that can cost a little more, and asking for more results costs more too.'],
  ['Saved lookups', 'The latest 50 are kept. Tick any number of them, or Select all, and delete them together. Deleted lookups are kept for 30 days, and the Undo on the message brings them back. The full original answer is kept for 90 days.'],
  ['Runs', 'Every day at 6:00 am Brisbane time, SERP Tracker checks that DataForSEO is connected and records the balance and cost. You can also press Run now. A failed step is shown as a failure, never as a missing ranking. Collecting your rankings every day is the next stage and is not switched on yet.'],
  ['What it does not do yet', 'It does not yet collect your rankings every day, draw a history, pull in Search Console, or send a weekly report. Those come in later stages.'],
];

// Everything the guide can point at: the three tabs plus the controls on them. `tool` is the tab the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'setup', label: 'Site setup', tool: 'setup' },
  { id: 'site-address', label: 'Site address', tool: 'setup' },
  { id: 'brand-names', label: 'Brand names', tool: 'setup' },
  { id: 'keywords', label: 'Keywords to track', tool: 'setup' },
  { id: 'competitors', label: 'Competitors', tool: 'setup' },
  { id: 'health-urls', label: 'Pages to health-check', tool: 'setup' },
  { id: 'location-depth', label: 'Where Google is asked from', tool: 'setup' },
  { id: 'devices', label: 'Devices', tool: 'setup' },
  { id: 'save-site', label: 'Save site details', tool: 'setup' },
  { id: 'spending', label: 'DataForSEO and spending', tool: 'setup' },
  { id: 'lookup', label: 'Lookup', tool: 'lookup' },
  { id: 'lookup-form', label: 'Lookup search box and options', tool: 'lookup' },
  { id: 'lookup-run', label: 'Look up', tool: 'lookup' },
  { id: 'lookup-result', label: 'Lookup result', tool: 'lookup' },
  { id: 'saved-lookups', label: 'Saved lookups', tool: 'lookup' },
  { id: 'select-delete', label: 'Select and delete', tool: 'lookup' },
  { id: 'runs', label: 'Runs', tool: 'runs' },
  { id: 'run-now', label: 'Run now', tool: 'runs' },
  { id: 'run-list', label: 'Run list', tool: 'runs' },
];
