'use strict';

// The Page speed guide (the round button on Vault's /html page): a person says what they want to do or understand ("why is my mobile
// score so low", "what should I fix first", "what is LCP") and the guide points at the real parts of the page, in order, or says
// plainly that Page speed does not do it. It only knows what is written here and it never sees any address, score or report. Built on
// guideCore.js; the ids are the page's own, listed in client/src/pages/pageSpeed/pageSpeedTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/html-agent.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'new-run', label: 'New run', group: 'Run a test',
    does: 'The New page speed run button in the left column opens the start screen: a Website URL box, an optional Name, and the Run page speed test button. Vault asks Google PageSpeed Insights to test the page twice at once, as a phone and as a desktop computer, and saves both. It takes about a minute.',
    notes: 'The page must be public: anyone must be able to open it without logging in. It tests one page, not the whole site.' },
  { id: 'saved-runs', label: 'Saved runs', group: 'Run a test',
    does: 'The left column lists every saved run with its performance score, date and website. Search runs filters by name or address, the website drop-down (shown once two or more sites have runs) shows one site only, and Sort orders by newest, oldest, name or score. Click a run to open it; the bin icon deletes it after a Yes.',
    notes: 'Runs are kept until deleted. Choosing one website also draws its progress chart on the start screen.' },
  { id: 'mobile-desktop', label: 'Mobile and Desktop buttons', group: 'Results',
    does: 'Two buttons above a saved run switch between the phone test and the computer test; each shows its performance score. Both the Report and the Actions tabs follow the one chosen.',
    notes: 'Mobile is tested as a mid-range phone on a slower connection, so it usually scores lower. Google mostly ranks on the mobile version, so fix mobile first.' },
  { id: 'copy', label: 'Copy buttons', group: 'Results',
    does: 'Copy this report copies the technical report for the chosen device; Copy mobile + desktop copies both. On the Actions tab, Copy action list copies the plain-English to-do list with ticks. Paste them into an email to a developer.',
    notes: 'They copy text only; nothing is sent from Vault.' },
  { id: 'report', label: 'Report', group: 'Results',
    does: 'The first tab of a saved run: the four category scores, the progress chart, lab metrics, field data and the full findings, for mobile or desktop.',
    notes: 'Everything comes from one Google test, so scores can move a few points between runs.' },
  { id: 'scores', label: 'Category scores', group: 'Results',
    does: 'Four cards: Performance (speed), Accessibility (usable with a screen reader, keyboard or poor eyesight), Best practices (safety and general quality) and Lighthouse SEO (search engine basics). 90 to 100 is green (good), 50 to 89 amber (needs work), under 50 red (poor). Hover a card for what it covers.',
    notes: 'Lighthouse SEO is only basic checks on one page; the separate SEO tool crawls a whole site.' },
  { id: 'trend', label: 'Progress chart', group: 'Results',
    does: 'A line of the performance score over time for one website, drawn once a site has two or more runs. Hover a dot for its date and score.',
    notes: 'Run the test again after each fix to see the line move.' },
  { id: 'lab-metrics', label: 'Lab metrics', group: 'Results',
    does: 'The timings from the test: First Contentful Paint (first thing appears), Largest Contentful Paint (main picture or headline appears), Total Blocking Time (page too busy to respond), Cumulative Layout Shift (how much it jumps), Speed Index and Time to Interactive. Each is coloured good, needs work or poor; hover a row for what it means and what good looks like.',
    notes: 'Largest Contentful Paint, layout shift and blocking time weigh most in the performance score.' },
  { id: 'field-data', label: 'Field data', group: 'Results',
    does: 'Real visitors\' speed from Google\'s Chrome UX Report over the last 28 days, each marked FAST, AVERAGE or SLOW. Hover a row for what it measures.',
    notes: 'Only shown when the site has enough Chrome visitors; small sites often have none. This, not the lab score, is what Google uses for ranking.' },
  { id: 'findings', label: 'Findings', group: 'Results',
    does: 'Lists at the bottom of the Report tab: Opportunities (changes with an estimated time or data saving), Diagnostics, Failed checks and Warnings, each with the exact files or page elements involved and a Developer docs link.',
    notes: 'The same findings appear as plain-English to-dos on the Actions tab.' },
  { id: 'actions', label: 'Actions', group: 'Results',
    does: 'The second tab of a saved run: a plain-English to-do list for the chosen device, grouped Fix first, Do next and When there is time. Each action says what is wrong, why it matters, what to do, who usually does it (developer, content editor or hosting) and roughly how big a job it is. A badge says if it was also found on the other device. A bar at the top shows how many are done.',
    notes: 'Order comes from the test: outright failures and big time savings first. The who and job size are typical, not exact.' },
  { id: 'action-filter', label: 'Category filter', group: 'Results',
    does: 'Buttons at the top of the Actions tab (All, Performance, Accessibility, Best practices, SEO) show only the actions for one score, with a count on each.',
    notes: 'Use it to work on one score at a time.' },
  { id: 'action-done', label: 'Mark as done', group: 'Results',
    does: 'The tick box on each action marks it done with today\'s date; done actions are greyed, show a Done badge with the date and count towards the progress bar. Hide done hides them. Untick to undo.',
    notes: 'Ticks are saved with the run, separately for mobile and desktop, so they show on any computer and in the PDF report. They do not re-test the page: run a new test to confirm a fix worked. A new run starts with no ticks.' },
  { id: 'action-note', label: 'Action note', group: 'Results',
    does: 'A small box under each action\'s What to do for a note, such as what was done or what is in progress. Type or use the microphone; it saves when you click away or press Enter.',
    notes: 'Notes are saved with the run and printed in the PDF report under the action.' },
  { id: 'pdf-report', label: 'PDF report', group: 'Results',
    does: 'The PDF report button (above the tabs, and on the Actions tab) opens choices and then downloads a formatted PDF: title, the address, test date, scores, timings with what they mean, and the actions grouped Fix first, Do next and When there is time, with ticked boxes, done dates and notes. Choose Mobile, Desktop or both; All, Still to do or Done only; Scores and timings on or off; Developer detail on or off; and optional Title, Prepared for, Prepared by and a Summary at the top.',
    notes: 'Use Done only to show a client what has been fixed, Still to do with Developer detail as a developer\'s to-do list. It is downloaded, not emailed; attach it to an email yourself.' },
  { id: 'developer-detail', label: 'For your developer', group: 'Results',
    does: 'Under each action, For your developer opens the technical version: Google\'s own title, the exact fix and the evidence (file addresses, page elements, colours and sizes).',
    notes: 'Copy this report gives a developer the same detail for every action at once.' },
];

const RULES = [
  'Run a test first (New run), then open it; Report and Actions belong to a saved run.',
  'Choose Mobile or Desktop first: both tabs follow that choice. Fix mobile first.',
  'For "what do I fix" questions, the Actions tab is the answer, starting with Fix first; the Report tab is for detail.',
  'Every score comes from one lab test by Google and can move a few points between runs; run again after a fix to check it.',
  'Page speed only tests and reports. It never changes the website, and ticks on the Actions tab do not re-test anything.',
  'To report progress to someone: tick actions as done (add a note of what was done), then use PDF report.',
  'The Open buttons in this chat only switch to a tool (they open a tab or scroll to a part of the page); they never run a test or change anything.',
];

const NOT_POSSIBLE = [
  'Fixing or changing the website itself: Page speed only reports; the changes are made on the site by a developer, content editor or host.',
  'Testing pages behind a login or on a private network.',
  'Testing a whole site at once: it tests one address per run (use the SEO tool for a whole-site crawl).',
  'Running tests on a schedule or sending alerts when a score drops.',
  'Testing on a particular real phone, browser or location: Google uses its own test phone and computer.',
  'Emailing the PDF report from Vault or sharing a live link to the run: download the PDF and attach it yourself.',
  'Carrying ticks over to a new run of the same page: each run starts fresh.',
  'Comparing against a competitor side by side (run each address separately).',
];

const SYSTEM = `You are the guide to Page speed in Vault for one person who wants to test how fast and healthy a public web page is and know what to fix. They say, in everyday words, what they want to do or understand. You point them to the right parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Page speed cannot do.
- You cannot see any address, score, report or action list. Never state or guess a score, a cause or what their page needs fixing; send them to the part of the page that shows it.
- Be plain and short, as to a friend who is not technical. Explain any web word (LCP, layout shift, render-blocking, alt text, CDN, cache) in a few everyday words the first time you use it. General explanations of what a measure or a kind of fix means are fine.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask what to fix, send them to the Actions tab and Fix first. If they want the website changed, say Page speed only reports and the change is made on the site.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Page speed guide', feature: 'page_speed_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'PAGE SPEED TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to check or fix, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askPageSpeedTutor: guide.ask,
};
