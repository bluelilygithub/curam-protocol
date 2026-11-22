// What Contract Review is made of, the plain-words help for it, and the jobs on its start screen.
// Used by Vault's page (client/src/pages/ContractReviewPage.jsx): the left-hand tool list (ToolSidebar), the job screen (JobStart),
// the (i) box, and the guided tour.

export const CONTRACT_REVIEW_TOOLS = [
  { id: 'new', label: 'New review', group: 'Contracts', icon: 'upload' },
  { id: 'contracts', label: 'Your contracts', group: 'Contracts', icon: 'folder' },
  { id: 'review', label: 'Risk review', group: 'This contract', icon: 'shield-check' },
  { id: 'obligations', label: 'Obligations', group: 'This contract', icon: 'list-checks' },
  { id: 'ask', label: 'Ask about it', group: 'This contract', icon: 'message-circle' },
  { id: 'documents', label: 'Documents & reviews', group: 'This contract', icon: 'file-text' },
  { id: 'compare', label: 'Compare revisions', group: 'This contract', icon: 'columns' },
  { id: 'overview', label: 'Parties & actions', group: 'This contract', icon: 'info' },
  { id: 'report', label: 'PDF report', group: 'Share', icon: 'download' },
];

/** The tools that work on one open contract (the rest work without one). */
export const CONTRACT_TOOL_IDS = ['review', 'obligations', 'ask', 'documents', 'compare', 'overview', 'report'];

export const GROUPS = ['Contracts', 'This contract', 'Share'];

export const GROUP_TIPS = {
  Contracts: 'Start a new review by uploading a contract, or open one you reviewed before.',
  'This contract': 'Everything about the contract you have open: the risk review, what you have to do, questions, its documents and revisions, and its parties.',
  Share: 'Download the review as a PDF report or email it to someone.',
};

export const TOOL_TIPS = {
  new: 'Give the contract a title and drop in the PDF or Word (.docx) file. The review starts straight away; it asks which party you are before it scores any risk.',
  contracts: 'Every contract you have reviewed, with its type and status. Open one to see its review, or select several and delete them.',
  review: 'The verdict first (how many clauses are risky or unclear for your side), then the summary, every clause with why it matters and a suggested change, and the defined terms. Dismiss a flag that does not apply to you.',
  obligations: 'What each party has to do and when: deadlines, notice periods and recurring duties. Filter them, fix the owner or date, mark one done, send it to Tasks, or export them all to your calendar (.ics).',
  ask: 'Ask a question in your own words ("how much notice do I need to give?") and get an answer from the contract\'s own text, quoting the clause it comes from.',
  documents: 'Every document and revision under this contract. Upload a new revision, mark a draft as signed (executed), see what changed from the last version, or run a review as another party.',
  compare: 'Pick whose side to look from, then any two reviewed versions: what changed, whether the risk went up or down, and what to do about it. As a list or in two columns.',
  overview: 'The parties (link each to a CRM contact), legal hold, marking the contract expired or terminated, deleting it, and its history.',
  report: 'A PDF of the review: the parties and your role, every flag with its reason and suggested change, and the obligations. Download it or email it.',
};

export const TOOL_BLURBS = {
  new: 'Upload a contract to review it. Informational only, not legal advice.',
  contracts: 'Open a contract you reviewed before, or tidy up the list.',
  review: 'What is risky or unclear for your side, most serious first.',
  obligations: 'What you have to do, by when, and who owes it.',
  ask: 'Ask anything about this contract; the answer quotes the clause.',
  documents: 'The documents and revisions under this contract, and the reviews run on them.',
  compare: 'What changed between two versions, and whether it is better or worse for you.',
  overview: 'Who the parties are, and the contract\'s status and history.',
  report: 'The review as a PDF, to download or email.',
};

// The "What do you want to do?" jobs (components/JobStart.jsx). Each step names a tool above. A job that starts at "Your contracts"
// moves on to its next step once a contract is opened; "Review a contract" moves on once the upload has started.
export const CONTRACT_REVIEW_GOALS = [
  {
    // shown as the large "Is it safe to sign?" panel above the other jobs (ContractReviewPage.jsx), not as a card
    id: 'check', title: 'Review a contract before you sign', icon: 'shield-check',
    blurb: 'Upload the contract, say which party you are, and see what is risky for your side and what you would have to do.',
    steps: [
      { tool: 'new', note: 'Give the contract a title, drop in the PDF or Word file, then press Upload & review.' },
      { tool: 'review', note: 'Confirm which party you are, then read the verdict and start with the risky clauses.' },
      { tool: 'obligations', note: 'Check the deadlines and duties you would be signing up to.' },
    ],
  },
  {
    id: 'revision', title: 'Check a new revision', icon: 'columns',
    blurb: 'The other side sent back a new version. Upload it and see what changed, and whether it is better or worse for you.',
    steps: [
      { tool: 'contracts', note: 'Open the contract the revision belongs to.' },
      { tool: 'documents', note: 'Press Upload new revision on the document and drop in the new version. It is reviewed again and What changed opens by itself.' },
      { tool: 'compare', note: 'Compare any two versions from your side: risk increased, reduced or new, and what to do.' },
    ],
  },
  {
    id: 'other-side', title: 'See it from the other side', icon: 'user',
    blurb: 'Review the same contract as the other party, to see what they will push back on.',
    steps: [
      { tool: 'contracts', note: 'Open the contract.' },
      { tool: 'review', note: 'Press Review as a different party, choose the other party and press Run new review. Your own review is not changed.' },
    ],
  },
  {
    id: 'obligations', title: 'What do I have to do, and when?', icon: 'calendar-check',
    blurb: 'Deadlines, notice periods and recurring duties, sent to Tasks or your calendar.',
    steps: [
      { tool: 'contracts', note: 'Open the contract.' },
      { tool: 'obligations', note: 'Filter by owner or status, fix any owner or date, then Send to Tasks or Export .ics.' },
    ],
  },
  {
    id: 'ask', title: 'Find something in a contract', icon: 'message-circle',
    blurb: 'Ask in your own words, such as "can I end this early?", and get the clause that answers it.',
    steps: [
      { tool: 'contracts', note: 'Open the contract.' },
      { tool: 'ask', note: 'Type your question and press Ask. The answer quotes the clause it comes from.' },
    ],
  },
  {
    id: 'report', title: 'Send a review to someone', icon: 'mail',
    blurb: 'A PDF of the review for your lawyer, a colleague or your own records.',
    steps: [
      { tool: 'contracts', note: 'Open the contract.' },
      { tool: 'report', note: 'Press Download PDF, or type an email address and press Send report.' },
    ],
  },
];

export const HOW_IT_WORKS = [
  ['What it is for', 'Upload a contract and get a plain-English review: who the parties are, which clauses are risky or unclear for your side and why, what you would have to do and by when, and answers to your questions quoted from the contract. It is informational only, not legal advice: confirm important decisions with a qualified lawyer.'],
  ['Where to start', 'Pick a job on the "What do you want to do?" screen (for example "Review a contract before you sign") and Contract Review walks you through it, or pick a tool in the list on the left. Tools under This contract need a contract open first. Hover any tool or button for a short explanation. The compass beside the title runs a 16-step guided tour (also in Settings, Contract Review Tour).'],
  ['Why it asks which party you are', 'A clause that is risky for a tenant can be standard for a landlord, so risk cannot be scored for nobody. After it finds the parties, the review pauses until you confirm which one is you. Fix a name or role there if it is wrong, or add yourself if no party was found. You can later review the same document as another party without changing your own review.'],
  ['The verdict', 'Risk review opens with a verdict for your side: Read before you sign when a clause is risky, Worth a closer look when one is unclear, or No risky clauses flagged. It counts what was flagged; it never says a contract is safe or correct.'],
  ['What happens to the file', 'The contract is uploaded to Vault and read by an AI model, in stages: the text is pulled out and split into clauses, the contract type and parties are found, then (after you confirm your party) the defined terms, the risk of each clause, the obligations and a summary. Each clause, quote and summary point is checked back against the document\'s own text.'],
  ['Verification badges', 'Verified means the text was matched back to the document exactly; Verified (approx.) means it matched once spaces and punctuation were ignored; Unverified means it could not be found in the document, so treat it with more caution.'],
  ['Suggested changes are advisory', 'A suggested change (redline) is wording to copy into a negotiation or take to a lawyer. It is never applied to the document.'],
];

// The parts the guide (the round button) can point at. `tool` says which tool its Open button shows; the page then scrolls to
// data-guide="<id>" if that part is on screen ('info' and 'tour' open the (i) box and the tour). The guide's catalogue
// (server/services/contractReviewTutor.js) lists exactly these ids: node server/services/contractReviewTutor.test.js fails if they drift.
export const GUIDE_TOOLS = [
  { id: 'new', label: 'New review', tool: 'new' },
  { id: 'contracts', label: 'Your contracts', tool: 'contracts' },
  { id: 'review', label: 'Risk review', tool: 'review' },
  { id: 'party', label: 'Which party are you?', tool: 'review' },
  { id: 'verdict', label: 'Verdict', tool: 'review' },
  { id: 'perspective', label: 'Review as a different party', tool: 'review' },
  { id: 'coverage', label: 'Coverage report', tool: 'review' },
  { id: 'summary', label: 'Summary', tool: 'review' },
  { id: 'clauses', label: 'Clauses', tool: 'review' },
  { id: 'definitions', label: 'Definitions', tool: 'review' },
  { id: 'obligations', label: 'Obligations', tool: 'obligations' },
  { id: 'obligation-filters', label: 'Obligation filters', tool: 'obligations' },
  { id: 'export-ics', label: 'Export .ics', tool: 'obligations' },
  { id: 'ask', label: 'Ask about it', tool: 'ask' },
  { id: 'documents', label: 'Documents & reviews', tool: 'documents' },
  { id: 'revision-upload', label: 'Upload new revision', tool: 'documents' },
  { id: 'what-changed', label: 'What changed', tool: 'documents' },
  { id: 'compare', label: 'Compare revisions', tool: 'compare' },
  { id: 'overview', label: 'Parties & actions', tool: 'overview' },
  { id: 'parties', label: 'Parties', tool: 'overview' },
  { id: 'contract-actions', label: 'Legal hold, status and delete', tool: 'overview' },
  { id: 'report', label: 'PDF report', tool: 'report' },
  { id: 'info', label: 'How Contract Review works', tool: 'new' },
  { id: 'tour', label: 'Guided tour', tool: 'new' },
];
