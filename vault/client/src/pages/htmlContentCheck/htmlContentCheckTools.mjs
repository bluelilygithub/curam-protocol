// What HTML Content Check is made of: the left-hand tool list (ToolSidebar), the hover tips, the one-line blurbs and the jobs on the
// "What do you want to do?" screen (JobStart). Used by client/src/pages/HtmlContentCheckPage.jsx. Built milestone by milestone
// (docs/html-content-check-brief.md): a tool is added here when it works, so the list never offers something that does nothing.

export const HCC_TOOLS = [
  { id: 'new', label: 'New job', group: 'Jobs', icon: 'plus' },
  { id: 'jobs', label: 'Your jobs', group: 'Jobs', icon: 'list-checks' },
  { id: 'lines', label: 'Request lines', group: 'This job', icon: 'clipboard-list' },
  { id: 'rounds', label: 'Rounds', group: 'This job', icon: 'history' },
  { id: 'changes', label: 'Changes', group: 'This job', icon: 'compare' },
  { id: 'details', label: 'Job details', group: 'This job', icon: 'edit' },
  { id: 'returns', label: 'Returned report', group: 'From the client', icon: 'inbox' },
];

/** The tools that work on one open job. */
export const JOB_TOOL_IDS = ['lines', 'rounds', 'changes', 'details'];

export const GROUPS = ['Jobs', 'This job', 'From the client'];

export const GROUP_TIPS = {
  Jobs: 'Start a new check of a web page, or open one you started before.',
  'This job': 'The job you have open: the change request split into numbered lines, each time the page was fetched, and its name, address, client and ticket.',
  'From the client': 'Read the report your client sent back, with their notes against each R number.',
};

export const TOOL_TIPS = {
  new: 'Add the page or pages (each with a name and address) and paste the change request you were sent. The page is fetched as its starting point, and the request is split into numbered lines (R1, R2 ...) you can fix. Or just keep a page to compare over time. A saved copy of the page can be used instead of fetching.',
  jobs: 'Every page you are checking, newest first, with its request lines and status. Search by name or address, open one, or delete it (it goes to the recycle bin for 30 days).',
  rounds: 'Every time the page was read: the starting point (round 0), then each Check again. When, how (plain fetch, real browser or saved copy), and why a fetch failed.',
  changes: 'What changed on the page, word by word, since the round before or since the starting point. Cookie banners, dates, counters and rotating panels that may change by themselves are grouped at the end.',
  lines: 'The change request as numbered lines. Edit, split, join, reorder, add or remove lines, give each its kind (Normal, Held over, Keep) and page, then press Save. The numbers become fixed once a client report has been made.',
  details: 'The job\'s name, page address, the request as pasted, the text from before the edits, the CRM client and ticket, its status, and Delete.',
  returns: 'Upload the PDF report your client filled in and sent back; their notes land against the right R numbers. Not built yet.',
};

export const TOOL_BLURBS = {
  new: 'Check a change request on a web page, or keep a page to compare over time.',
  jobs: 'Open a page you are checking, or tidy up the list.',
  lines: 'The change request as numbered lines you can fix before checking.',
  rounds: 'Each time the page was read, and Check again.',
  changes: 'What changed on the page, word by word.',
  details: 'Name, address, client, ticket and status of this job.',
  returns: 'Read the report your client sent back.',
};

// Shown in the tool list under a tool that cannot be used yet.
export const NOT_BUILT = {
  returns: 'Coming in a later update',
};

// The "What do you want to do?" jobs. Each step names a tool above; `kind` presets the New job form.
export const HCC_GOALS = [
  {
    id: 'request', kind: 'request', title: 'Check a change request', icon: 'list-checks',
    blurb: 'You were sent a list of edits for a web page. Paste it with the page address and check each line was done.',
    steps: [
      { tool: 'new', note: 'Enter the page address and paste the change request, then press Create job.' },
      { tool: 'lines', note: 'Check the request was split into the right lines. Fix, split or join them, then press Save.' },
      { tool: 'rounds', note: 'Round 0 is the page before the edits. Once the developer says they are done, press Check again.' },
      { tool: 'changes', note: 'Go through the request line by line: Approve each edit that is right or mark it Needs work, then make the client report.' },
    ],
  },
  {
    id: 'compare', kind: 'compare', title: 'Just compare a page', icon: 'columns',
    blurb: 'Keep a page\'s address and see what changed on it between checks, with no request to tick off.',
    steps: [
      { tool: 'new', note: 'Choose "Just compare the page", enter the address, then press Create job.' },
      { tool: 'rounds', note: 'Round 0 is the page now. Press Check again whenever you want to see it again.' },
      { tool: 'changes', note: 'What changed since the last round, or since the starting point.' },
    ],
  },
  {
    id: 'returns', title: 'Read a client\'s returned report', icon: 'inbox',
    blurb: 'Upload the PDF report your client filled in; it finds the job and puts their notes against each R number.',
    steps: [
      { tool: 'returns', note: 'Not built yet: reading returned reports comes in a later update.' },
    ],
  },
];

export const STATUS_LABELS = { open: 'Open', with_client: 'With the client', closed: 'Closed' };
export const KIND_LABELS = { request: 'Change request', compare: 'Page comparison' };

// The (i) "How HTML Content Check works" box: [heading, text].
export const HOW_IT_WORKS = [
  ['What it is for', 'A client sent a list of edits for a web page, and the developer says they are done. HTML Content Check reads the page before and after, shows every change word by word, and lines each change up against the request, so you can see what was done, what was not, and what changed that nobody asked for. Or just keep a page and see what changes on it over time.'],
  ['Where to start', 'Pick a job on the "What do you want to do?" screen ("Check a change request" or "Just compare a page") and it walks you through, or pick a tool in the list on the left. Tools under This job need a job open first. Hover any tool or button for a short explanation. The compass beside the title runs a guided tour (also in Settings, HTML Content Check Tour), and the round button at the bottom right is a guide you can ask in your own words.'],
  ['Several pages', 'One change request often covers several pages of a site. A job holds up to 12 pages, each with a name and address. Name them as the request does: a line pasted under "Under The Artist" goes on the page named The Artist, and a line with no heading is matched against every page. Every round reads all the pages, and changes are shown page by page.'],
  ['Kinds of request line', 'Normal lines are edits to check. A Held over line (the request says "hold over") is shown but never checked. A Keep line (the request says "Keep: …") is text that must stay as it is: code checks it is still on its page, word for word, and warns if it changed. Lines that look like repeats of an earlier line are flagged so you can join them.'],
  ['Rounds: before and after', 'Creating a job reads the page as round 0, the starting point. When the developer says the edits are done, press Check again on Rounds: that is round 1, and so on. An unchanged page is still kept as a round, so a check that found nothing done is on record. A round that failed shows why and is replaced by the next check.'],
  ['How the page is read', 'Everything a visitor can see is read: the menu, headings, text, lists, tables, captions, sidebars and footer, but not scripts or hidden parts. A plain fetch comes first; a real browser is used for pages that build themselves with JavaScript, or when you tick Load in a real browser. For a staging site or a page behind a login, save it from your browser and use a saved copy. Later rounds are read the same way as the starting point, so the way of reading does not show up as changes.'],
  ['What counts as a change', 'Changes are worked out by comparing the text: added, removed, changed (word by word) and moved. Spaces, non-breaking spaces and curly or straight quotes are ignored; a different capital letter or dash counts. Cookie banners, dates, counters and rotating panels that can change by themselves are grouped under "May have changed by itself", never thrown away. If a round has far less text than the starting point (a rebuilt site, or one blocking the check), it is flagged so the removals are not taken at face value.'],
  ['What the AI does, and does not do', 'Match to request is the only AI step. It suggests which changes look like they answer each request line, with a one-line reason; code then lists the lines with no change found and the changes nobody asked for. It never says an edit is right or done: you judge that, and you can link or unlink any change by hand. Each match uses the workspace\'s AI model and costs a little (under a cent for a typical page).'],
  ['Reviewing line by line', 'Changes opens on Review by line for a change request: one list of request lines, page by page, each with the changes linked to it. A bar at the top stays on screen with how many lines are decided, Next undecided, the client report and the list for the developer. Keys: J and K move between lines, A approves, N marks Needs work, U clears. Approved lines fold to one row (Show all opens them). Keep and held-over lines and the changes nobody asked for are at the end. All changes shows every change on each page, and is where you link or unlink changes by hand.'],
  ['Approving and the client report', 'On Changes, in a round after the starting point, mark each request line Approve (you checked it and it is right) or Needs work (back to the developer). Make the client report then gives a fillable PDF, page by page: each approved line with its changes and a Looks right / Needs a change tick and notes, Keep and held-over lines listed, a Further changes table and a sign-off. Changes nobody asked for are left out unless you tick to include them. The first report fixes the R numbers.'],
  ['Not built yet', 'Reading the report the client fills in and sends back comes in a later update.'],
];

// The guide's Open buttons (server/services/htmlContentCheckTutor.js CATALOG has the same ids): `tool` is the tool to show; the page then
// scrolls to data-guide="<id>" when that part exists. 'info' and 'tour' open the (i) box and the tour.
export const GUIDE_TOOLS = [
  { id: 'new', label: 'New job', tool: 'new' },
  { id: 'pages', label: 'Pages', tool: 'new' },
  { id: 'saved-copy', label: 'Use a saved copy instead', tool: 'new' },
  { id: 'real-browser', label: 'Load in a real browser', tool: 'new' },
  { id: 'jobs', label: 'Your jobs', tool: 'jobs' },
  { id: 'lines', label: 'Request lines', tool: 'lines' },
  { id: 'line-kinds', label: 'Kinds of line', tool: 'lines' },
  { id: 'rounds', label: 'Rounds', tool: 'rounds' },
  { id: 'check-again', label: 'Check again', tool: 'rounds' },
  { id: 'changes', label: 'Changes', tool: 'changes' },
  { id: 'page-tabs', label: 'Page tabs', tool: 'changes' },
  { id: 'self-changing', label: 'May have changed by itself', tool: 'changes' },
  { id: 'match', label: 'Match to request', tool: 'changes' },
  { id: 'change-links', label: 'Change links', tool: 'changes' },
  { id: 'review-mode', label: 'Review by line', tool: 'changes' },
  { id: 'approve', label: 'Approve or Needs work', tool: 'changes' },
  { id: 'developer', label: 'List for the developer', tool: 'changes' },
  { id: 'report', label: 'Client report', tool: 'changes' },
  { id: 'details', label: 'Job details', tool: 'details' },
  { id: 'returns', label: 'Returned report', tool: 'returns' },
  { id: 'info', label: 'How HTML Content Check works', tool: 'new' },
  { id: 'tour', label: 'Guided tour', tool: 'new' },
];

// Milestone 4b: several pages per job, and kinds of request line (keep in step with server/routes/htmlContentCheck.js LIMITS.pages).
export const MAX_PAGES = 12;
export const LINE_KINDS = {
  request_line: { label: 'Normal', tip: 'An edit to check: it is matched to the changes on its page (or every page, when it has none).' },
  held_over: { label: 'Held over', tip: 'Not decided yet ("I will have to think about this"): shown as held, never checked or matched.' },
  keep: { label: 'Keep', tip: 'Text that must stay exactly as it is: you are warned if it is changed or removed from its page.' },
};
// Where a request line stands in a round (server/services/htmlContentCheck/summary.js), in plain words.
export const LINE_STATUS = {
  linked: 'Changes linked',
  noChange: 'No change found',
  unreadable: 'Could not read this line in the AI\'s answer',
  notMatched: 'Not matched yet',
  held: 'Held over: not checked',
  kept: 'Kept: still on the page as it was',
  keepChanged: 'Changed or removed: it was meant to stay',
  keepNotOnStartingPage: 'Not found on the starting page, so it cannot be checked (the wording may differ)',
  keepNotRead: 'Its page was not read in this round',
};
