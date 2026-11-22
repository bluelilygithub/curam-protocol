'use strict';

// The Contract Review guide (the round button on Vault's /contract-review page): a person says what they want to do ("is this lease bad
// for me?", "what changed in their new draft?", "when do I have to give notice?") and the guide points at the real tools and parts of the
// page, in order, or says plainly that Contract Review does not do it. It only knows what is written here and never sees the contracts,
// the reviews or the answers. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/contractReview/contractReviewTools.mjs (a test keeps the two in step). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- Contracts ----
  { id: 'new', label: 'New review', group: 'Contracts',
    does: 'The tool to start a review: a Contract title box (only for finding it again), a drop zone for the file, and Upload & review. The text is pulled out and split into clauses, and the contract type and parties are found straight away; then it asks which party you are.',
    notes: 'PDF or Word (.docx) only, up to 50 MB. The file is uploaded to Vault and read by an AI model.' },
  { id: 'contracts', label: 'Your contracts', group: 'Contracts',
    does: 'Every contract reviewed, with its type and status (Draft, Executed, Expired, Terminated). Click one to open it (it opens on Risk review). Tick several and Delete selected, or Del on one row; both ask Yes or No.',
    notes: 'Opened from a CRM contact, it shows only the contracts linked to that contact, with Show all contracts.' },
  // ---- This contract ----
  { id: 'review', label: 'Risk review', group: 'This contract',
    does: 'The open contract\'s review: Which party are you? while it waits, a progress bar while it runs, then the verdict, the party it was scored for, the coverage report, the summary, every clause and the definitions. When the contract has several reviews, a list at the top picks which one to show.',
    notes: 'Needs a contract open (Your contracts or New review).' },
  { id: 'party', label: 'Which party are you?', group: 'This contract',
    does: 'The step where the review pauses after finding the parties: pick the party that is you, fix a name or role if it is wrong, then Confirm and continue analysis. If no party was found, type your own name and role and press Add and continue analysis.',
    notes: 'Risk is scored for the confirmed party only; the same clause can be risky for one side and standard for the other.' },
  { id: 'verdict', label: 'Verdict', group: 'This contract',
    does: 'The card at the top of a finished review: Read before you sign (a clause is risky), Worth a closer look (one is unclear) or No risky clauses flagged, one sentence for the reviewed party, links to Show the risky (or unclear) clauses and to Obligations, notes for overdue obligations, usual clauses not found and flags not matched to the text, then the counts.',
    notes: 'It counts what the review flagged; it never says a contract is safe.' },
  { id: 'perspective', label: 'Review as a different party', group: 'This contract',
    does: 'The card saying who the review was scored for, with Review as a different party: choose another party and press Run new review to start a separate review of the same document from their side.',
    notes: 'The review you are looking at is not changed; the new one appears in the reviews list.' },
  { id: 'coverage', label: 'Coverage report', group: 'This contract',
    does: 'For the usual clauses of this type of contract (termination, liability and so on): Found, Not found or Could not assess.' },
  { id: 'summary', label: 'Summary', group: 'This contract',
    does: 'A short plain-English summary of the whole contract, each point marked by whether it was matched back to the contract\'s text.' },
  { id: 'clauses', label: 'Clauses', group: 'This contract',
    does: 'Every clause, Risky, Unclear or Standard for the reviewed party. Risky and unclear ones show Why it matters, a Suggested action (wording to copy) and Show source clause text. Filter (All, Risky, Unclear, Standard, Context only) and sort (Clause order or Severity). On a risky clause, Dismiss or Not risky for me marks it standard.',
    notes: 'A suggested change is advisory, copy-paste only, and never applied to the document. Verified means the text was matched to the document exactly, Verified (approx.) once spaces and punctuation were ignored, Unverified that it could not be found.' },
  { id: 'definitions', label: 'Definitions', group: 'This contract',
    does: 'The defined terms ("Confidential Information" and so on) with their definitions, each marked by whether it was matched to the text.' },
  { id: 'obligations', label: 'Obligations', group: 'This contract',
    does: 'What each party has to do and when: deadlines, notice periods and recurring duties. Each shows who owes it (change it there), its due date (set or correct it), its status, and Send to Tasks and Mark done.',
    notes: 'Obligations in a document not yet marked executed are labelled Draft, not active. An unverified one cannot be exported or linked until it is confirmed.' },
  { id: 'obligation-filters', label: 'Obligation filters', group: 'This contract',
    does: 'Above the obligations: filter by owner (or Obligor unresolved), by status (Overdue, Upcoming, Recurring / relative, Unverified, Done) and by a due-date range, and Clear filters.',
    notes: 'While a date range is set, obligations without an exact date are hidden.' },
  { id: 'export-ics', label: 'Export .ics', group: 'This contract',
    does: 'The button above the obligations that downloads them as a calendar file (.ics) to import into Outlook, Google Calendar or Apple Calendar.' },
  { id: 'ask', label: 'Ask about it', group: 'This contract',
    does: 'A box to ask a question about the open contract in your own words, and Ask. The answer comes from the contract\'s own text and quotes the clause (with the version it came from), or says the contract does not answer it.',
    notes: 'It searches every document and revision under the contract, not just the one open.' },
  { id: 'documents', label: 'Documents & reviews', group: 'This contract',
    does: 'Every document and revision under the contract, with its version and status, then every review run on them. On a document: Mark as executed (once signed), Upload new revision, What changed (on a revision), and Review as… with Run review to review it as a chosen party. Click a review to open it on Risk review.' },
  { id: 'revision-upload', label: 'Upload new revision', group: 'This contract',
    does: 'The button on a document to upload its next version (PDF or Word). The revision is reviewed again for your confirmed party, and What changed opens by itself when it finishes.' },
  { id: 'what-changed', label: 'What changed', group: 'This contract',
    does: 'The button on a revision that compares it with the version it replaced: added, removed and changed clauses, with the wording changes marked and any change in risk level.' },
  { id: 'compare', label: 'Compare revisions', group: 'This contract',
    does: 'Choose Review for (whose side), then an Original and a Revised version from the versions reviewed for that party, and press Compare. Each change shows Risk increased, Risk reduced or New risk, what it means for that party and a recommended action (Accept, Negotiate or Investigate), as a list or in two columns.',
    notes: 'A version with no review for that party offers Run review for it. Any two versions can be compared, not only neighbours.' },
  { id: 'overview', label: 'Parties & actions', group: 'This contract',
    does: 'The open contract\'s parties, its actions (legal hold, mark expired, mark terminated, delete) and its history.' },
  { id: 'parties', label: 'Parties', group: 'This contract',
    does: 'Each party with its role, You on your own party, and a list to link it to a CRM contact.',
    notes: 'Linking a contact does not change the review.' },
  { id: 'contract-actions', label: 'Legal hold, status and delete', group: 'This contract',
    does: 'Set legal hold (or release it), Mark expired, Mark terminated (each asks to confirm and changes only the status) and Delete contract (asks you to type the title).',
    notes: 'A contract on legal hold cannot be deleted. Deleting removes every document, review and obligation under it.' },
  // ---- Share ----
  { id: 'report', label: 'PDF report', group: 'Share',
    does: 'Download PDF of the open review (the parties and your role, every flag with its reason and suggested change, and the obligations), or type an email address and press Send report.',
    notes: 'Needs a review first.' },
  // ---- help ----
  { id: 'info', label: 'How Contract Review works', group: 'Contracts',
    does: 'The (i) beside the title: what Contract Review is for, where to start, why it asks which party you are, the verdict, what happens to the file, the badges, and that suggested changes are advisory.' },
  { id: 'tour', label: 'Guided tour', group: 'Contracts',
    does: 'The compass beside the title: a 16-step tour that opens each tool in turn (also in Settings, Contract Review Tour).' },
];

const RULES = [
  'Contract Review is informational only, not legal advice; important decisions should be confirmed with a qualified lawyer.',
  'A contract is a PDF or Word (.docx) file. It is uploaded to Vault and read by an AI model; the guide cannot see the contracts, the reviews or the answers.',
  'The review pauses after finding the parties until the person confirms which party they are; risk is scored for that party only.',
  'The tools under This contract (Risk review, Obligations, Ask about it, Documents & reviews, Compare revisions, Parties & actions, PDF report) need a contract open first, from Your contracts or New review.',
  'The verdict counts what the review flagged for the reviewed party; never call a contract safe, fair or approved.',
  'Suggested changes are advisory wording to copy; nothing is ever changed in the document.',
  'A review as a different party is a separate review; it never changes the person\'s own review.',
  'Obligations can be sent to Tasks one at a time or exported together as a calendar (.ics) file.',
  'The Open buttons in this chat only switch to a tool (they show a tool and scroll to a part of it, or open the (i) box or the tour); they never upload, confirm, delete or send anything.',
];

const NOT_POSSIBLE = [
  'Giving legal advice, saying whether to sign, or saying a contract is safe, fair or enforceable.',
  'Editing the contract, applying a suggested change, or producing a marked-up (redlined) Word file.',
  'Scanned contracts that are only pictures may not be read well; other formats (.doc, images, spreadsheets) are not accepted.',
  'Signing a contract or sending it for signature.',
  'Reviewing several contracts in one go, or comparing two different contracts (it compares versions of the same contract).',
  'Reminders or emails about obligations by itself: send them to Tasks or a calendar instead.',
  'Showing what the person\'s contracts say or what a review found: the guide cannot see the contracts or the reviews.',
];

const SYSTEM = `You are the guide to Contract Review in Vault for one person who wants to understand a contract before signing or while managing it. They say, in everyday words, what they want to do. You point them to the right tools and parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do.
- You cannot see their contracts, reviews or answers. Never state or guess what their contract says, which clauses are risky or what they owe.
- Never give legal advice and never say whether to sign; Contract Review is informational only, so suggest a qualified lawyer for decisions.
- Be plain and short, as to a friend who is not a lawyer. Explain any word like obligation, redline or executed in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there. A new contract always starts in "new"; one reviewed before starts in "contracts".
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Contract Review guide', feature: 'contract_review_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'CONTRACT REVIEW TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your contract, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askContractReviewTutor: guide.ask,
};
