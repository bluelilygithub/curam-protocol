'use strict';

// The HTML Content Check guide (the round button on Vault's /html-content-check page): a person says what they want to do ("the client sent
// a list of edits for their about page", "did the developer change the footer?") and the guide points at the real tools and parts of the
// page, in order, or says plainly that HTML Content Check does not do it. It only knows what is written here and never sees a job, a page,
// a request or a result. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/htmlContentCheck/htmlContentCheckTools.mjs (a test keeps the two in step). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- Jobs ----
  { id: 'new', label: 'New job', group: 'Jobs',
    does: 'Starts a job: choose Check a change request (you have a list of edits) or Just compare the page (no request), add the pages (one or several pages of the same site, each with a name and address), an optional job name, paste the change request as you received it, and optionally the text from before the edits, a CRM client and a ticket. Create job reads every page as round 0, the starting point, and splits the request into numbered lines (R1, R2 ...); a line pasted under a heading such as "Under The Artist" goes on the page named The Artist.',
    notes: 'Only public pages can be fetched. The page is read on Vault\'s server; nothing on the page is run in Vault.' },
  { id: 'pages', label: 'Pages', group: 'Jobs',
    does: 'The list of pages on New job and Job details: a name and an address for each page (up to 12), Add a page, move up or down, Remove (Yes or No), and Load in a real browser per page.',
    notes: 'Name the pages as the request does: lines under "Under <name>" are put on that page. A page that has been read keeps its address; removing a page removes its reads, and its request lines stay with no page.' },
  { id: 'saved-copy', label: 'Use a saved copy instead', group: 'Jobs',
    does: 'On New job: choose a page saved from your browser (File > Save Page As, Webpage HTML only) to use as the starting point instead of fetching. Also on Rounds as Upload a saved copy.',
    notes: 'For staging sites, pages behind a login, or sites that refuse to be fetched. .html or .htm, 5 MB at most.' },
  { id: 'real-browser', label: 'Load in a real browser', group: 'Jobs',
    does: 'The tick on New job (and Job details) for pages that build themselves with JavaScript: the page is always read in a real browser. Without the tick a real browser is still used when a plain fetch finds almost no text, far less text than the starting point, or the site turns the plain fetch away.',
    notes: 'Slower (about 10 seconds a page).' },
  { id: 'jobs', label: 'Your jobs', group: 'Jobs',
    does: 'Every job, newest first, with its kind, status, number of request lines and rounds, and the last time the page was read. Search by name or address; click one to open it; Delete (Yes or No) moves it to the recycle bin for 30 days, with Undo.' },
  // ---- This job ----
  { id: 'lines', label: 'Request lines', group: 'This job',
    does: 'The change request as numbered lines beside the request as pasted. Edit a line, split it where the cursor is (scissors), join it with the next, move it up or down, remove it, or Add a line; give each line its kind and page; then Save (or Discard). A line that looks like a repeat of an earlier one says so, with Join into. With several pages, a box puts every line under a heading on one page at once. Split the request again replaces the lines with a fresh split.',
    notes: 'Only for change-request jobs. Until a client report is made the R numbers follow the order of the list; after that they are fixed and never reused.' },
  { id: 'line-kinds', label: 'Kinds of line', group: 'This job',
    does: 'Each request line is Normal (an edit to check), Held over (not decided yet: shown, never checked; "(hold over)" in the request sets it) or Keep (text that must stay as it is: you are warned if it changes or disappears; "Keep:" in the request sets it). Each line can also be on one page, or All pages (matched against every page).',
    notes: 'A Keep line is checked by code, word for word, not by the AI. If its words are not on the starting page it cannot be checked, and says so.' },
  { id: 'rounds', label: 'Rounds', group: 'This job',
    does: 'Every time the pages were read: round 0 (the starting point), then each Check again. Each round lists every page with when and how it was read (plain fetch, real browser or saved copy), its title and word count, how many changes since the round before and since its starting point, and Show changes. A page that could not be read has Upload a saved copy, which takes its place in that round.',
    notes: 'An unchanged page is still kept as a round. A failed round shows its reason and is replaced by the next check. Later rounds are read the same way as the starting point where possible.' },
  { id: 'check-again', label: 'Check again', group: 'This job',
    does: 'The button on Rounds that reads every page again now and keeps them as the next round, then works out what changed. Pages are read one after another, so several pages can take a minute.' },
  { id: 'changes', label: 'Changes', group: 'This job',
    does: 'What changed on the page, word by word (removed words struck through in red, added words underlined in green), in reading order: added, removed, changed and moved text, with where on the page it is. Pick a round, and Since the starting point or Since last round.',
    notes: 'Worked out by comparing the text. It never says an edit is right or done: you judge that.' },
  { id: 'page-tabs', label: 'Page tabs', group: 'This job',
    does: 'On Changes, for a job with several pages: one tab per page with its number of changes (or "starting point" or "could not be read"). The request beside the changes shows that page\'s lines and the lines on All pages.' },
  { id: 'self-changing', label: 'May have changed by itself', group: 'This job',
    does: 'The closed group under the changes: cookie banners, dates and times, counters and rotating panels that can change without anyone editing the page. Open it to check them; one that a request line is linked to moves up into the main list.',
    notes: 'They are kept, never thrown away, in case one is a real edit.' },
  { id: 'match', label: 'Match to request', group: 'This job',
    does: 'The button beside the changes (change-request jobs): page by page, the AI suggests which changes since the starting point look like they answer that page\'s lines and the lines on All pages, with a one-line reason. Held-over and Keep lines are not sent. Lines with no change found (across all pages), changes nobody asked for (per page), Keep lines that changed and held-over lines are then listed, and a filter shows All changes, Asked for, or Nobody asked for.',
    notes: 'Suggestions only: the AI never says an edit is right or done. It uses the workspace\'s AI model, one call per page with changes, and costs a little each time (under a cent for a typical page).' },
  { id: 'change-links', label: 'Change links', group: 'This job',
    does: 'Click a request line beside the changes to highlight its changes, then Change links for that line: each change gets Link or Unlink. Done linking when finished.',
    notes: 'Your own links are kept when you match again.' },
  { id: 'approve', label: 'Approve or Needs work', group: 'This job',
    does: 'Under each normal request line beside the changes, in a round after the starting point: Approve (you checked the edit and it is right; it goes on the client report) or Needs work (missing or wrong; it stays off the report for the developer to fix). Press again to clear. Each round starts with none.',
    notes: 'Your own verdict, never the AI\'s. Held-over and Keep lines have no verdict: the report lists them as they are.' },
  { id: 'report', label: 'Client report', group: 'This job',
    does: 'The box under the request on Changes: Make the client report downloads a fillable PDF of the approved lines, grouped by page, each with its changes, Looks right and Needs a change ticks and a notes box; then Keep and held-over lines, a Further changes table and Approved as is, name and date. Tick Include changes nobody asked for to list those too.',
    notes: 'The first report fixes the R numbers, so the client\'s answers keep pointing at the right lines. Making a report uses no AI.' },
  { id: 'details', label: 'Job details', group: 'This job',
    does: 'The job\'s pages (add, rename, reorder, remove, real browser per page), name, the request as pasted, the text from before the edits, CRM client, ticket and status (Open, With the client, Closed); Save. Delete job (Yes or No) moves it to the recycle bin.',
    notes: 'A page\'s address cannot change once the page has been read: remove it and add the new address as another page.' },
  // ---- From the client ----
  { id: 'returns', label: 'Returned report', group: 'From the client',
    does: 'Where a report the client filled in and sent back will be read, with their notes against each R number. Not built yet.' },
  // ---- help ----
  { id: 'info', label: 'How HTML Content Check works', group: 'Jobs',
    does: 'The (i) beside the title: what the tool is for, where to start, how the page is read, what counts as a change, what the AI does and does not do, and what is not built yet.' },
  { id: 'tour', label: 'Guided tour', group: 'Jobs',
    does: 'The compass beside the title: a tour that opens each tool in turn (also in Settings, HTML Content Check Tour).' },
];

const RULES = [
  'A job is one web page: either a change request (a list of edits the client asked for) checked against the page, or just the page compared over time.',
  'Round 0 is the page as it was first read, the starting point; after the developer says the edits are done, Check again on Rounds reads it again and Changes shows what changed.',
  'Changes are worked out by code, word by word. Nothing in HTML Content Check says an edit is right, complete or done; the person judges.',
  'Match to request is the only AI step: it suggests which changes answer which request line, with a reason, and the person can link or unlink by hand.',
  'The tools under This job need a job open first, from Your jobs or New job. Request lines and Match to request are for change-request jobs only.',
  'Only public pages can be fetched; for a staging site, a page behind a login, or one that refuses to be fetched, save it from the browser and use a saved copy.',
  'Deleting a job moves it to the recycle bin for 30 days.',
  'The Open buttons in this chat only switch to a tool (they show a tool and scroll to a part of it, or open the (i) box or the tour); they never fetch, match, save or delete anything.',
];

const NOT_POSSIBLE = [
  'Making the edits on the website, or sending anything to the developer or the client by itself.',
  'Saying whether an edit is correct, well written or finished: it shows what changed and the person judges.',
  'Reading a report the client filled in and sent back: not built yet (coming in a later update).',
  'Comparing pictures by what they show: a picture is compared by its address and description only.',
  'Checking a whole website at once, or checking pages on a schedule by itself.',
  'Reading pages behind a login directly (use a saved copy).',
  'Spelling, grammar or fact checks on the page.',
  'Showing what the person\'s jobs, pages or requests contain: the guide cannot see them.',
];

const SYSTEM = `You are the guide to HTML Content Check in Vault, for one person checking that edits asked for on a web page were really made. They say, in everyday words, what they want to do. You point them to the right tools and parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do.
- You cannot see their jobs, pages, requests or results. Never state or guess what a page says, what changed, or whether an edit was made.
- Never say an edit is correct or done: HTML Content Check shows what changed and the person judges.
- Be plain and short, as to a friend who is not technical. Explain any word like round, starting point or saved copy in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there. A new page always starts in "new"; a job made before starts in "jobs".
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'HTML Content Check guide', feature: 'html_content_check_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'HTML CONTENT CHECK TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to check on the web page, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askHtmlContentCheckTutor: guide.ask,
};
