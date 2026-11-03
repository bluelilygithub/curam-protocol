// What the Email Follow-Up page is made of, the plain-words help for it, and the controls its guide (the round button) can point at.
// The ids are the guide's catalogue (server/services/emailFollowUpTutor.js); npm run test:email-follow-up-tutor fails if the two drift.
// The page has a case list and, inside a case, four tabs. EF_TOOLS are those five places; `tool` on a GUIDE_TOOLS entry says which
// place its Open button shows (the guide's Open button switches the tab, or goes back to the case list).

export const EF_TOOLS = [
  { id: 'cases', label: 'Your cases', group: 'Cases', icon: 'list-checks' },
  { id: 'ledger', label: 'Ledger', group: 'Inside a case', icon: 'list-checks' },
  { id: 'ask', label: 'Summary and Ask', group: 'Inside a case', icon: 'chat' },
  { id: 'mail', label: 'Mail', group: 'Inside a case', icon: 'mail' },
  { id: 'drafts', label: 'Drafts', group: 'Inside a case', icon: 'file-text' },
  { id: 'coverage', label: 'What was covered', group: 'Inside a case', icon: 'shield' },
];

export const GROUPS = ['Cases', 'Inside a case'];

export const GROUP_TIPS = {
  Cases: 'Every matter you have opened by hand: what is owed, by whom, and how many drafts are waiting.',
  'Inside a case': 'The five views of one case: the ledger of what is owed, a summary and questions about the mail, the mail itself, the follow-up drafts, and what the tool could not see.',
};

export const TOOL_TIPS = {
  cases: 'Your list of cases. Open a new one by saying what is owed, then attach the email threads about it.',
  ledger: 'Everything owed in the case, each with the exact words it came from, its deadline and what you can do about it.',
  ask: 'A summary of where the negotiation stands, and a box to ask questions about the attached mail. Every answer points at the emails it came from.',
  mail: 'The email threads attached to this case, and a search for more threads with the people involved.',
  drafts: 'Follow-up text written from the ledger, waiting for you to read, approve and copy. Nothing is ever sent.',
  coverage: 'What the tool read, what it could not see (phone calls, portals, scans and pictures) and what you must check yourself.',
};

export const TOOL_BLURBS = {
  cases: 'Matters you opened by hand.',
  ledger: 'What is owed, in the sender\'s own words.',
  ask: 'The whole story, and your questions.',
  mail: 'The threads attached to the case.',
  drafts: 'Follow-up text to read and copy.',
  coverage: 'What was and was not seen.',
};

// The longer text for the (i) "How Email Follow-Up works" box.
export const HOW_IT_WORKS = [
  ['A case is a matter you open', 'You say what is owed ("Acme owes the Q3 bank statements") and who is involved. Nothing opens itself and no email attaches itself: you choose each thread.'],
  ['The ledger', 'Press Read and the AI proposes a row for each thing owed. Every row must quote the email word for word, or it is thrown away. Dates are worked out by plain code from the sender\'s own words, so "early next week" stays a deadline for you to fill in, never a guess.'],
  ['Summary and Ask', 'The ledger lists what is owed; it does not tell the story. The Summary and Ask tab has the AI read every attached email and readable attachment together. Summarise gives the overview, each negotiated point with its current position (agreed, proposed, disputed or open), a timeline, what is still open and anything that contradicts itself. Ask answers your questions in plain words. Each claim points at the email or attachment it came from, and a quote that is not word for word in that email is thrown away. When the answer is not in the mail it says so. Every summary and every question with its answer is saved with the case so you can come back to them (the latest summary is shown when you reopen it), and it is not legal advice: check the original wording before you rely on it.'],
  ['A note for the case', 'Create note, under the case title, makes a note in Notes called the case name followed by "email followup", so you can find it by searching. The note says what is owed and has a link back to the case; the case then shows Linked note, which opens it. If the case is linked to a CRM client the note is filed under that client too. Delete the note and the button goes back to Create note.'],
  ['Linked to your CRM', 'A case can be linked to a client in your CRM. The case shows the client with an Open in CRM button, and the client\'s page has an Email follow-up section that lists its cases, opens them, and starts a new one for that client. Linking changes nothing in the CRM.'],
  ['Finishing with a case', 'Close case takes a finished case off your list; it stays readable and you can reopen it. Set aside keeps a thread in the case but stops it being read, so anything that quotes it still works; Remove takes a thread out for good, only when nothing quotes it. Delete case removes the whole case after you type its name; a copy waits 30 days in Settings, Recycle bin, unless you choose Delete forever. Your Gmail is never touched, and tasks made from the case stay.'],
  ['Check Sent first', 'Before you chase anyone, the tool checks your Sent folder for the people in the case, so you do not nag about something you already answered. Draft follow-up runs the check itself when the last one is more than 15 minutes old, and drafts nothing if it cannot. On a busy case the check takes a few presses (100 sent messages at a time) and counts as finished only when every page is done; after that, a new check only adds the recent tail.'],
  ['Drafts', 'A draft is fixed sentences around the row\'s own quoted words, checked against the email it came from. Anything the check cannot back up is blocked or flagged. You approve it, then copy it into your own mail program. The tool never sends.'],
  ['Copying is double-checked', 'Just before you copy, the tool looks in Gmail for new mail in the same threads. If the other person has written since, the draft goes back to waiting so you do not send something out of date.'],
  ['Attachments', 'Get attachments downloads the files on the attached mail (read-only) and reads the text of PDFs, Word and plain-text files, so an invoice\'s total and dates can become ledger rows too. A scanned PDF (a picture of a page) is read by OCR, which is a machine reading a picture of the page: it can misread a figure, so anything taken from a scan is marked and you are asked to check it against the original. Pictures and spreadsheets are kept in the list as "not read", with the reason. If an email and its attachment give two different figures, both rows stay open and you must say which is right before anything can be drafted.'],
  ['What it cannot see', 'Phone calls, texts and conversations unless you type them in with Log something said outside email, portals, other mailboxes, and anything that is only a photo, such as a picture of an invoice. The What was covered tab says so, and lists what you must check yourself. Use it for matters where someone has promised to do something and you want a record: work, a landlord or tradie, a council, an insurer, a club, something you lent. Never for health, a mortgage or a legal dispute: the text of attached emails and documents is read by the AI, so you confirm that when you open a case.'],
];

// Everything the guide can point at: the five places plus the controls inside them. `tool` is the place the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'cases', label: 'Your cases', tool: 'cases' },
  { id: 'new-case', label: 'New case', tool: 'cases' },
  { id: 'relationship', label: 'Who this case is with', tool: 'mail' },
  { id: 'hide-details', label: 'Hide personal details from the AI', tool: 'mail' },
  { id: 'log-outside', label: 'Log something said outside email', tool: 'mail' },
  { id: 'people', label: 'People in the case', tool: 'mail' },
  { id: 'client-link', label: 'CRM client link', tool: 'mail' },
  { id: 'case-note', label: 'Case note', tool: 'mail' },
  { id: 'close-case', label: 'Close case', tool: 'mail' },
  { id: 'set-aside', label: 'Set a thread aside', tool: 'mail' },
  { id: 'delete-case', label: 'Delete case', tool: 'mail' },
  { id: 'find-mail', label: 'Find mail', tool: 'mail' },
  { id: 'get-attachments', label: 'Get attachments', tool: 'mail' },
  { id: 'read', label: 'Read new messages', tool: 'mail' },
  { id: 'check-sent', label: 'Check Sent', tool: 'mail' },
  { id: 'mail', label: 'Mail', tool: 'mail' },
  { id: 'ask', label: 'Summary and Ask', tool: 'ask' },
  { id: 'ledger', label: 'Ledger', tool: 'ledger' },
  { id: 'draft-followup', label: 'Draft follow-up', tool: 'ledger' },
  { id: 'resolved-elsewhere', label: 'Resolved elsewhere', tool: 'ledger' },
  { id: 'condition-met', label: 'Condition met', tool: 'ledger' },
  { id: 'took-over', label: 'Someone else took over', tool: 'ledger' },
  { id: 'make-task', label: 'Make a task', tool: 'ledger' },
  { id: 'drafts', label: 'Drafts', tool: 'drafts' },
  { id: 'approve', label: 'Approve', tool: 'drafts' },
  { id: 'copy', label: 'Copy to send myself', tool: 'drafts' },
  { id: 'edit-recipients', label: 'Edit recipients', tool: 'drafts' },
  { id: 'coverage', label: 'What was covered', tool: 'coverage' },
];
