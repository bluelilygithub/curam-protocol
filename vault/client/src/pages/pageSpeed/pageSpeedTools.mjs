// What the Page speed page (/html) is made of, the plain-words help for it, and the controls its guide (the round button) can point at.
// The ids are the guide's catalogue (server/services/pageSpeedTutor.js); node server/services/pageSpeedTutor.test.js fails if the two
// lists drift apart. The "tools" are the three places a person can be: a new run, and a saved run's Report and Actions tabs. `tool` on
// a guide entry says which of those its Open button goes to, and the page marks each part with data-guide="<id>" so it can scroll there.

export const PAGE_SPEED_TOOLS = [
  { id: 'new-run', label: 'New run', group: 'Run a test', icon: 'gauge' },
  { id: 'report', label: 'Report', group: 'Results', icon: 'line-chart' },
  { id: 'actions', label: 'Actions', group: 'Results', icon: 'check' },
];

export const GROUPS = ['Run a test', 'Results'];

export const GROUP_TIPS = {
  'Run a test': 'Paste a public web address and Vault asks Google to test it on a phone and on a computer.',
  Results: 'What Google found for one saved run: the scores and details (Report) and the list of things to fix (Actions).',
};

export const TOOL_TIPS = {
  'new-run': 'Test a new web address. Takes about a minute: a phone test and a computer test run side by side.',
  report: 'The scores, timings and every detail Google found, for mobile or desktop.',
  actions: 'Plain-English list of what to fix, most important first, with who usually does it. Tick each one off as it is done, add a note, and make a PDF report.',
};

export const TOOL_BLURBS = {
  'new-run': 'Paste an address and run the test.',
  report: 'Scores, timings and findings.',
  actions: 'What to fix, in order.',
};

// The longer text for the (i) "How Page speed works" box.
export const HOW_IT_WORKS = [
  ['What it does', 'You paste the address of a public web page. Vault asks Google PageSpeed Insights to load it twice, once as a phone on a slower mobile connection and once as a desktop computer, and saves both reports.'],
  ['Mobile and Desktop', 'The two buttons above the report switch between the phone test and the computer test. Mobile scores are usually lower, and Google mostly ranks sites on their mobile version, so fix mobile first.'],
  ['The four scores', 'Performance is how fast the page appears and responds. Accessibility is how usable it is for people with a screen reader, keyboard or poor eyesight. Best practices is general safety and hygiene. SEO is the basics search engines need. 90 or more is good (green), 50 to 89 needs work (amber), under 50 is poor (red).'],
  ['Report tab', 'Every number and detail: the progress chart, the timings (how long until something shows, until the main picture shows, how much the page jumps), real-visitor data when Google has it, and the full findings.'],
  ['Actions tab', 'The same findings turned into a to-do list in plain English: Fix first, Do next and When there is time. Each says why it matters, what to do and who usually does it, with the technical detail for your developer underneath. Tick an action when it is done and add a note of what was done: both are saved with the run (with the date), so they show on any computer.'],
  ['PDF report', 'The PDF report button makes a formatted report of the run to send to a client, a manager or a developer: scores, timings and the actions with ticked boxes, done dates and notes. Choose mobile, desktop or both, all actions or only those still to do or done, and whether to add developer detail.'],
  ['Lab test, not real visitors', 'Each run is one test from Google\'s servers, so scores can move a few points between runs. Run it again after a fix to check it worked. Real-visitor data (field data) only appears for busy sites.'],
  ['What it cannot do', 'It does not change your website. It cannot test pages behind a login, and it tests one page at a time, not the whole site (that is the SEO tool).'],
];

// Everything the guide can point at. `tool` is where the Open button goes.
export const GUIDE_TOOLS = [
  { id: 'new-run', label: 'New run', tool: 'new-run' },
  { id: 'saved-runs', label: 'Saved runs', tool: 'new-run' },
  { id: 'mobile-desktop', label: 'Mobile and Desktop buttons', tool: 'report' },
  { id: 'copy', label: 'Copy buttons', tool: 'report' },
  { id: 'report', label: 'Report', tool: 'report' },
  { id: 'scores', label: 'Category scores', tool: 'report' },
  { id: 'trend', label: 'Progress chart', tool: 'report' },
  { id: 'lab-metrics', label: 'Lab metrics', tool: 'report' },
  { id: 'field-data', label: 'Field data', tool: 'report' },
  { id: 'findings', label: 'Findings', tool: 'report' },
  { id: 'actions', label: 'Actions', tool: 'actions' },
  { id: 'action-filter', label: 'Category filter', tool: 'actions' },
  { id: 'action-done', label: 'Mark as done', tool: 'actions' },
  { id: 'action-note', label: 'Action note', tool: 'actions' },
  { id: 'pdf-report', label: 'PDF report', tool: 'actions' },
  { id: 'developer-detail', label: 'For your developer', tool: 'actions' },
];
