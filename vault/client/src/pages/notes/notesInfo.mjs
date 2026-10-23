// The words in Notes' "How Notes Works" box (the (i) beside the title; it opens by itself the first time, like the other tools).
// Plain data so a test can keep it honest: node client/src/pages/notes/noteTips.test.mjs

export const NOTES_INTRO = 'Write, speak and find your notes. Every button has a hover tip that says what it does. Stuck? Press the round button at the bottom right and tell the Notes guide what you want to do, or press the compass beside the title for a step-by-step tour.';

export const HOW_IT_WORKS = [
  ['Write', 'The + button starts a note: type it, record your voice and have it written up, or start from a template (Meeting notes, Client call, Weekly review, your own). Notes save by themselves. The calendar-tick button opens today\'s note and carries over your unfinished to-dos.'],
  ['Write and Preview', 'Type simple symbols (# heading, **bold**, - list, - [ ] to-do) and press Preview to see it formatted. You can tick to-dos right in Preview.'],
  ['Find', 'Search by words, project, client or tag. Filter by date, reminders, tags, project or client, and group the list by date, project, client or tag. Save the combinations you use as views.'],
  ['Keep tidy', 'File a note under a project and a client, add tags, and pin the ones you want at the top. Manage tags renames or removes a tag everywhere.'],
  ['Reminders', 'Set a reminder on a note and choose whether to be emailed too. When it is due the note appears under Reminders due, where you can mark it done or snooze it.'],
  ['AI actions', 'Summarise, pull out to-dos as tasks, tidy up, suggest tags or a title. They only propose: nothing changes until you say so, and the note\'s text is sent to the AI only when you press one.'],
  ['Ask your notes', 'Press the speech-bubble button at the top of the list and ask a question in your own words, such as "what did I agree with Acme in October?". It looks through your notes (all of them, the ones in the current list, or just the open note) by their words and by what they are about, so a question about "money" can find a note that says "invoice". It reads the ones that fit and answers only from them, with numbered notes you can open. With Linked records on, it also reads what is filed against those notes (their project and client, and the tasks, deals and recent contact on them), shows them as a small map under the answer ("Around these notes") and can answer questions such as "what is open for Acme?". If your notes do not say, it says so. The text of the notes it reads is sent to the AI to answer, and your notes are sent to the embedding service once, after you save them, so they can be searched by meaning. Nothing is changed.'],
  ['Recently deleted', 'Deleted notes, templates and views are kept 30 days and can be restored (Undo appears straight after a delete).'],
];

export const NOTES_NOT = 'Notes are private to you: there is no sharing, and no images or attachments yet. A note is plain text with simple formatting symbols.';
