// What HTML Content Check is made of: the left-hand tool list (ToolSidebar), the hover tips, the one-line blurbs and the jobs on the
// "What do you want to do?" screen (JobStart). Used by client/src/pages/HtmlContentCheckPage.jsx. Built milestone by milestone
// (docs/html-content-check-brief.md): a tool is added here when it works, so the list never offers something that does nothing.

export const HCC_TOOLS = [
  { id: 'new', label: 'New job', group: 'Jobs', icon: 'plus' },
  { id: 'jobs', label: 'Your jobs', group: 'Jobs', icon: 'list-checks' },
  { id: 'lines', label: 'Request lines', group: 'This job', icon: 'clipboard-list' },
  { id: 'details', label: 'Job details', group: 'This job', icon: 'edit' },
  { id: 'returns', label: 'Returned report', group: 'From the client', icon: 'inbox' },
];

/** The tools that work on one open job. */
export const JOB_TOOL_IDS = ['lines', 'details'];

export const GROUPS = ['Jobs', 'This job', 'From the client'];

export const GROUP_TIPS = {
  Jobs: 'Start a new check of a web page, or open one you started before.',
  'This job': 'The job you have open: the change request split into numbered lines, and its name, address, client and ticket.',
  'From the client': 'Read the report your client sent back, with their notes against each R number.',
};

export const TOOL_TIPS = {
  new: 'Give the page address and paste the change request you were sent. It is split into numbered lines (R1, R2 ...) you can fix before anything is checked. Or just keep an address to compare the page over time.',
  jobs: 'Every page you are checking, newest first, with its request lines and status. Search by name or address, open one, or delete it (it goes to the recycle bin for 30 days).',
  lines: 'The change request as numbered lines. Edit, split, join, reorder, add or remove lines, then press Save. The numbers become fixed once a client report has been made.',
  details: 'The job\'s name, page address, the request as pasted, the text from before the edits, the CRM client and ticket, its status, and Delete.',
  returns: 'Upload the PDF report your client filled in and sent back; their notes land against the right R numbers. Not built yet.',
};

export const TOOL_BLURBS = {
  new: 'Check a change request on a web page, or keep a page to compare over time.',
  jobs: 'Open a page you are checking, or tidy up the list.',
  lines: 'The change request as numbered lines you can fix before checking.',
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
    ],
  },
  {
    id: 'compare', kind: 'compare', title: 'Just compare a page', icon: 'columns',
    blurb: 'Keep a page\'s address and see what changed on it between checks, with no request to tick off.',
    steps: [
      { tool: 'new', note: 'Choose "Just compare the page", enter the address, then press Create job.' },
      { tool: 'details', note: 'The job keeps the address. Fetching the page and comparing rounds come in the next update.' },
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
