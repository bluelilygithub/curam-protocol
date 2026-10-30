'use strict';

// The Email Follow-Up guide (the round button on Vault's /email-follow-up page): a person says what they want to do ("chase a client for
// documents", "why can't I draft yet", "can it send for me") and the guide points at the real controls, in order, or says plainly that
// Email Follow-Up does not do it. It only knows what is written here and it never sees any case, email, name or draft. Built on
// guideCore.js; the ids are the page's own, listed in client/src/pages/emailFollowUp/emailFollowUpTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/email-follow-up.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'cases', label: 'Your cases', group: 'Cases',
    does: 'The list of every case you have opened, each with what is owed, how many rows are in its ledger, how many messages are attached and how many drafts are waiting. Click a case to open it.',
    notes: 'Cases are never created by the tool itself, and email never creates or joins a case on its own.' },
  { id: 'new-case', label: 'New case', group: 'Cases',
    does: 'The New case button opens a form: a name, what is owed and by whom (both can be spoken), the email addresses of the people involved, the kind of matter, Relaxed or Strict checking, and optionally a CRM client to link it to. Open case creates it empty.',
    notes: 'A case needs a name and a sentence saying what is owed. Strict checking blocks any sentence it cannot back with a quote; Relaxed lets a draft go ahead once you accept the warning. Nothing is read from Gmail until you attach a thread.' },
  { id: 'people', label: 'People in the case', group: 'Inside a case',
    does: 'The box at the top of a case holds the email addresses of the people involved, separated by commas. Save people stores them. They are used to find mail and to check your Sent folder.',
    notes: 'Add every address a person uses. Sent is checked across all of them, not one person at a time.' },
  { id: 'client-link', label: 'CRM client link', group: 'Inside a case',
    does: 'Under the case title, the client the case is linked to (if any) with an Open in CRM button that goes to that client\'s page, and a Change client button to link it to a different client or none. On the client\'s own CRM page, an Email follow-up section lists that client\'s cases, opens them, and starts a new case for the client.',
    notes: 'Linking only records which client a case belongs to and lets a task made from the case sit under that client. It adds nothing to the CRM and sends nothing. Only your own clients can be chosen.' },
  { id: 'find-mail', label: 'Find mail', group: 'Inside a case',
    does: 'Step 1. Looks in Gmail for threads to or from the people in the case, newest first, skips the ones already attached, and lists up to twelve on the Mail tab. Preview shows the emails in a thread before you decide; Attach to case adds every message of a thread you choose.',
    notes: 'It only suggests. If older threads remain it says so: attach what you need and press Find mail again to reach further back. Previewing stores nothing. Nothing attaches itself. Gmail must be connected, and the tool only reads Gmail.' },
  { id: 'get-attachments', label: 'Get attachments', group: 'Inside a case',
    does: 'Step 2. Downloads the files that came with the attached emails (read-only) and reads their text: PDFs (scanned pages are read by OCR), Word documents and plain-text files. Each file appears under its email on the Mail tab with whether it was read. Up to twelve files per press, and only three scanned files by OCR per press; press again if it says more remain.',
    notes: 'OCR is a machine reading a picture of a page and can misread a figure, so a row taken from a scan is marked "from a scan (OCR)" and a draft quoting it asks you to check it against the original. A scan OCR cannot read reliably, plain pictures such as logos, and spreadsheets are kept in the list as not read, with the reason, and are never guessed at. A file whose first bytes show it is really a program is refused. The Read step then treats a readable attachment like an email.' },
  { id: 'read', label: 'Read new messages', group: 'Inside a case',
    does: 'Step 3. The AI reads each attached message and fetched attachment you have not read yet (up to ten at a time) and proposes ledger rows: what is owed, by whom, any amount, whether it was clearly agreed or only conditional, and the deadline wording. Code then checks each one. An invoice you sent becomes a row where they owe you the total.',
    notes: 'A row is kept only if its quote is word for word in the text, otherwise it is dropped and the count is shown. Dates are worked out by code, not the AI. If an email and its attachment give two different amounts, both rows stay open and flagged, and no draft can be made until you waive the wrong one.' },
  { id: 'check-sent', label: 'Check Sent', group: 'Inside a case',
    does: 'Step 4. Looks through your Sent folder for mail to the people in the case, from before the first request until now, and records that it did. After that, drafting a chase for something someone else owes is allowed.',
    notes: 'Required before chasing, and Draft follow-up runs it for you when the last check is more than 15 minutes old, so pressing it yourself is optional. A busy case takes several presses (100 sent messages each): it carries on where it stopped and counts as finished only when every page is done. If the check cannot be done or is not finished, nothing is drafted. Mail you sent to them since the request is shown as a warning on the draft for you to read.' },
  { id: 'mail', label: 'Mail', group: 'Inside a case',
    does: 'The Mail tab lists the threads suggested by Find mail, and every message attached to the case with its date and whether it has been read yet.',
    notes: 'Under each message, its files are listed with whether they were read; a file that was not read says why.' },
  { id: 'ledger', label: 'Ledger', group: 'Inside a case',
    does: 'The Ledger tab shows one card per thing owed: who owes it (you or them), the status, any amount, the deadline, whether it is agreed or conditional, the exact words it came from, and buttons for what you can do next.',
    notes: 'A deadline it could not work out says what is missing and what was said, and is never filled with a guess. A changed ask makes a new row that replaces the old one, with the change in words.' },
  { id: 'draft-followup', label: 'Draft follow-up', group: 'Inside a case',
    does: 'On a ledger card, writes follow-up text from that row\'s own quoted words, then checks every sentence against the email it came from. The draft appears on the Drafts tab.',
    notes: 'When chasing someone it checks Sent first (and drafts nothing if that cannot be done). Refused if the row is not open, if the ask was refused, or if five drafts are already waiting for review. No AI writes the draft, so the wording is fixed.' },
  { id: 'resolved-elsewhere', label: 'Resolved elsewhere', group: 'Inside a case',
    does: 'Closes a row that was dealt with by phone, in person or in a portal. You can add a note saying how.',
    notes: 'This is your own statement and is recorded as such.' },
  { id: 'condition-met', label: 'Condition met', group: 'Inside a case',
    does: 'Only on a conditional row (for example "I might pay if revenue allows"). You say, in your own words, that the condition was met.',
    notes: 'A polite reply such as "thanks" never counts as the condition being met, and a conditional row cannot be completed without it.' },
  { id: 'took-over', label: 'Someone else took over', group: 'Inside a case',
    does: 'When someone says they will handle it instead ("Sarah is out, I will do it"), you give their address, pick the message and copy their words exactly. The original row is suspended and a new row opens for them, marked authority unconfirmed.',
    notes: 'Their words must be word for word in that message. An unconfirmed row cannot be completed until you press Confirm authority.' },
  { id: 'make-task', label: 'Make a task', group: 'Inside a case',
    does: 'Adds a task to your Tasks page for this row, titled with what is owed and the person, with the due date when one is known, linked to the CRM client if the case has one.',
    notes: 'One task per row. The ledger stays the record of what was promised; completing the task does not close the row.' },
  { id: 'drafts', label: 'Drafts', group: 'Inside a case',
    does: 'The Drafts tab lists follow-up drafts with their recipients, the text, a verdict (pass, needs review or fail), any warnings and their status. It shows how many are waiting out of the limit of five.',
    notes: 'A draft is text for you to paste into your own mail program. The tool never sends anything.' },
  { id: 'approve', label: 'Approve', group: 'Inside a case',
    does: 'Records that you read the draft. If there are warnings you must tick each one first. A draft that failed the check cannot be approved.',
    notes: 'Changing the draft afterwards (recipients or subject) makes a new version that needs approving again. No approval record means it cannot be copied.' },
  { id: 'copy', label: 'Copy to send myself', group: 'Inside a case',
    does: 'On an approved draft: first looks in Gmail for new mail in the same threads, then copies To, Subject and the text to your clipboard to paste into your own mail program.',
    notes: 'If the other person has written since, or Gmail cannot be checked, the copy is refused and the draft goes back to waiting. Nothing is sent by Vault.' },
  { id: 'edit-recipients', label: 'Edit recipients', group: 'Inside a case',
    does: 'On a draft, change the subject, who it is to and who is copied. Saving makes a new version that needs approving again.',
    notes: 'The sentences of the draft cannot be edited here, because each one is tied to the email it quotes. Edit the wording in your own mail program after copying.' },
  { id: 'coverage', label: 'What was covered', group: 'Inside a case',
    does: 'The What was covered tab says how many messages were read and over what dates, what the tool could not see (phone calls, portals, other mailboxes, pictures and scans, an unchecked Sent folder), and a list of things you need to check yourself. Copy this copies it.',
    notes: 'Use it to tell a client or an accountant exactly what the ledger is based on.' },
];

const RULES = [
  'Open a case first (New case), then find and attach mail, get its attachments, read it, then check Sent. Each step is a button, in that order. Get attachments only matters when the mail has files.',
  'The tool only reads Gmail. It never sends, drafts in your mailbox, files or deletes mail. Drafts are text you paste into your own mail program.',
  'A ledger row only exists if its quote is word for word in an email or readable attachment of the case. Nothing is inferred from mail you did not attach, or from a file it could not read.',
  'A deadline it cannot work out (such as "early next week" or "within 14 days of receipt" with no receipt date) is left for you with what is missing. It never guesses a date.',
  'Chasing someone always checks your Sent folder first (Draft follow-up does it for you), so you do not nag about something you already answered.',
  'At most five drafts can be waiting for review in a case. Review or decline some to make more.',
  'Cases, emails and drafts are stored in Vault, and the text of attached emails is read by the AI model Vault is set up with.',
  'The Open buttons in this chat only switch to a tool (they show a tab or the case list); they never read, draft, approve or copy anything by themselves. The tabs only exist once a case is open.',
];

const NOT_POSSIBLE = [
  'Sending an email, or putting a draft into your Gmail drafts folder: it only produces text to copy.',
  'Reading photos and pictures of documents (only scanned PDF pages are read by OCR), spreadsheets, or any file that is not a PDF, a Word document or a text file. Handwriting and poor scans may not be readable. It lists each one as not read, with the reason.',
  'Guaranteeing that a figure read from a scan is right: OCR can misread digits, so it asks you to check against the original.',
  'Seeing phone calls, portals, other people\'s mailboxes or anything not attached to the case.',
  'Opening a case by itself, or noticing a new matter in your inbox: a person opens every case.',
  'Deciding that a deadline or legal time limit was met, or giving legal, tax or accounting advice.',
  'Editing the wording of a draft inside Vault, or having the AI rewrite it.',
  'Deleting a case (it can be closed), or running automatically on a schedule.',
  'Medical, mortgage or other sensitive matters: not suitable, because the text of attached emails goes to the AI model.',
];

const SYSTEM = `You are the guide to Email Follow-Up in Vault for one person who tracks what is owed in a matter by reading emails they attach, and who wants careful follow-up text to copy. They say, in everyday words, what they want to do. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Email Follow-Up cannot do.
- You cannot see any case, email, person, amount, date or draft they have. Never state or guess what is in their ledger or why a draft was refused beyond what the rules say.
- Be plain and short, as to a friend who is not technical. Explain any word like "ledger" or "supersede" in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask whether it can send an email, say clearly that it cannot and that they paste the copied text into their own mail program.
- If they ask why they cannot draft, the usual causes are: your Sent folder could not be checked, five drafts are already waiting, the two figures for the row disagree, or the row is not open.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Email Follow-Up guide', feature: 'email_follow_up_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'EMAIL FOLLOW-UP TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your cases, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askEmailFollowUpTutor: guide.ask,
};
