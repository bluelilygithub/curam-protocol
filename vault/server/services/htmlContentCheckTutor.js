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
  { id: 'verify', label: 'Verify', group: 'This job',
    does: 'The strip at the top of Review: when the starting point was read, how many checks so far and the last one, Verify, and Upload a saved copy (per page when there are several). Verify reads every page again, compares it with the starting point and matches the request (the AI step), then shows the review. Press it after each round of edits. A page that could not be read says why, with Upload a saved copy.',
    notes: 'Create the job before editing the site: the starting point is the pages as they were then. Matching is skipped for a page whose changes are the same as last time, so a repeat Verify costs nothing for unchanged pages.' },
  { id: 'changes', label: 'Review', group: 'This job',
    does: 'Where the edits are judged, in three parts: Needs attention (changes nobody asked for that are not marked yet, then questioned items, requests with no change found, and requests approved earlier whose change has since gone or changed), To approve (requests whose change looks done, each with its before and after), and Approved and accounted for (collapsed). When nothing needs attention and nothing is left to approve it says "Ready to send to the client". Changes new since the previous check say "New this check". Keys: J and K move, A approves (or marks Mine), Q questions, E marks Expected, U clears.',
    notes: 'Worked out by comparing the text with the starting point. It never says an edit is right or done: you judge that. Your decisions are kept on later checks.' },
  { id: 'unrequested', label: 'Changes nobody asked for', group: 'This job',
    does: 'The first list under Needs attention: every change on the pages that no request line is linked to, word by word, including changed links, picture addresses, picture descriptions, heading levels and removed text. Mark each one Mine, intentional (you made it on purpose; it goes on the client checklist as "Also changed"), Question (it needs putting back) or Expected (it changes by itself), with an optional note.',
    notes: 'The most important list: an LLM or a developer may make "helpful" edits nobody asked for.' },
  { id: 'self-changing', label: 'Looks automatic', group: 'This job',
    does: 'Cookie banners, dates, counters and rotating panels that change without anyone editing the page are shown dimmed with "Looks automatic" and are marked Expected automatically; the Ready to send line says how many. Mark one otherwise if it is a real edit.',
    notes: 'They are kept, never thrown away, in case one is a real edit.' },
  { id: 'match', label: 'Why it was linked', group: 'This job',
    does: 'Behind the scenes Verify asks the AI which changes look like they answer which request line; on a request line, "why?" shows its one-line reason when you hover.',
    notes: 'Suggestions only: the AI never says an edit is right or done. It uses the workspace\'s AI model, one call per page with new changes, and costs a little (under a cent for a typical page).' },
  { id: 'change-links', label: 'Not this change / pick another', group: 'This job',
    does: 'Under a request line: when the change linked to it is wrong or one is missing, tick the right changes by hand from the list of that page\'s changes. Done picking when finished.',
    notes: 'Your own choice is kept on later checks.' },
  { id: 'approve', label: 'Approve or Question', group: 'This job',
    does: 'Beside each request line: Approve (the edit is right; it goes on the client checklist) or Question (missing or wrong; it stays in Needs attention), with an optional note. Press again to clear. A line approved earlier comes back as "Was approved, now changed" if its change has gone or changed since.',
    notes: 'Your own decision, never the AI\'s. Held-over and Keep lines are listed as they are.' },
  { id: 'open-questions', label: 'Copy the open questions', group: 'This job',
    does: 'In the bar at the top of Review: copies every open item (questioned requests, requests with no change found or changed since approval, and questioned changes nobody asked for), page by page with your notes, written as a request you can paste straight into an LLM or a message to have them fixed.',
    notes: 'Nothing is sent by itself: you paste it.' },
  { id: 'report', label: 'Client checklist', group: 'This job',
    does: 'In the bar at the top of Review: downloads a PDF of the approved request lines, grouped by page, for the client. Tick With unrequested changes to list those too.',
    notes: 'Making it uses no AI. Its new layout (with "Also changed" and a re-read before sending) comes in a later update.' },
  { id: 'details', label: 'Job details', group: 'This job',
    does: 'The job\'s pages (add, rename, reorder, remove, real browser per page), name, the request as pasted, CRM client, ticket and status (Open, With the client, Closed); Save. Delete job (Yes or No) moves it to the recycle bin.',
    notes: 'A page\'s address cannot change once the page has been read: remove it and add the new address as another page.' },
  // ---- help ----
  { id: 'info', label: 'How HTML Content Check works', group: 'Jobs',
    does: 'The (i) beside the title: what the tool is for, where to start, how the page is read, what counts as a change, what the AI does and does not do, and what is not built yet.' },
  { id: 'tour', label: 'Guided tour', group: 'Jobs',
    does: 'The compass beside the title: a tour that opens each tool in turn (also in Settings, HTML Content Check Tour).' },
];

const RULES = [
  'A job is one change request (a list of edits a client asked for) on one or more pages of a site.',
  'Create the job before editing the site: the pages are saved as the starting point. After the edits, Verify on Review compares them with it.',
  'Changes are worked out by code, word by word. Nothing in HTML Content Check says an edit is right, complete or done; the person judges.',
  'Matching, inside Verify, is the only AI step: it suggests which changes answer which request line, with a reason, and the person can pick others by hand.',
  'The tools under This job need a job open first, from Your jobs or New job.',
  'Only public pages can be fetched; for a staging site, a page behind a login, or one that refuses to be fetched, save it from the browser and use a saved copy.',
  'Deleting a job moves it to the recycle bin for 30 days.',
  'The Open buttons in this chat only switch to a tool (they show a tool and scroll to a part of it, or open the (i) box or the tour); they never fetch, match, save or delete anything.',
];

const NOT_POSSIBLE = [
  'Making the edits on the website, or sending anything to the developer or the client by itself.',
  'Saying whether an edit is correct, well written or finished: it shows what changed and the person judges.',
  'Reading a report the client filled in and sent back.',
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
- Be plain and short, as to a friend who is not technical. Explain any word like check, starting point or saved copy in a few everyday words the first time you use it.
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
