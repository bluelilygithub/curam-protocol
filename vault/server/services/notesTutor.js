'use strict';

// The Notes guide (the round button on Vault's /notes page): a person says what they want to do ("record my voice", "turn this into a
// task", "find the note about the budget") and the guide points at the real controls, in order, or says plainly that Notes does not do
// it. It only knows what is written here (the controls Notes really has) and it never sees any note. Built on guideCore.js; the ids are
// Notes' own, listed in client/src/pages/notes/notesTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/voice-notes.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'new-note', label: 'New note', group: 'Notes list',
    does: 'The + button at the top of the notes list (on a phone it says + New) opens a small choice: Write a note, or Record a voice note. Write a note opens a new note with the cursor in the title, where you type the title and then the text; it saves by itself a moment after you stop typing. On a phone, the Type button at the bottom opens the keyboard, and Dictate beside it speaks into the note. A note with no title is listed by its first line.', notes: 'Notes are plain text: no bold, headings or images.' },
  { id: 'new-voice-note', label: 'New voice note', group: 'Notes list',
    does: 'Press the + button at the top of the notes list and choose Record a voice note. It records your voice and writes it into a new note. Press Start recording, talk through a plan, an idea or a chat across the table, and Pause or Resume if you need to. Stop and make the note writes your words up. By default it also tidies them into a note with a short title and plain sections (Summary, Ideas, Plan, To do, Open questions, only those that apply); untick the tidy-up to keep your words exactly as spoken. What was said is always kept at the bottom of the note. Voice notes get an audio-lines icon in the list and a "Voice note" tag above the editor.',
    notes: 'Only the words are kept: the recording is turned into text and then deleted, so there is nothing to replay. Up to about an hour per recording. Needs the microphone allowed in the browser and the speech-to-text service set up on the server. Has a small cost per note (the speech-to-text, and the tidy-up). It does not know who is speaking by name. If it fails, the recorder window stays open with the recording kept and a Try again button, so nothing is lost until you press Discard or close the window. Let anyone you are recording know.' },
  { id: 'search', label: 'Search notes', group: 'Notes list',
    does: 'The search box above the list finds notes a moment after you stop typing, by words in the title or the text, or by the name of the project or client a note is filed under. It works together with the filters and grouping.', notes: 'It searches your own notes only.' },
  { id: 'group-notes', label: 'Group notes', group: 'Notes list',
    does: 'The Group by buttons under the search box (Date, Project, Client) split the list into labelled sections. By Date the sections are Today, Yesterday, Previous 7 days, Previous 30 days, then one section per month. By Project or Client each project or client is a section, with notes that are not filed under one at the bottom. Your choice is remembered on this device.',
    notes: 'This only changes how the list is laid out; it never moves or changes a note.' },
  { id: 'filter-notes', label: 'Filter notes', group: 'Notes list',
    does: 'The filter button (sliders icon) beside the search box opens the filters: a date range (Today, 7 days, 30 days, This year, or Pick dates for your own from and to days), whether the dates mean Last edited or Created, and a project and a client. Several filters work together. The number on the button shows how many are on, and Clear all filters turns them off. The list shows the most recent 100 notes at a time, with a Show more notes button at the bottom.',
    notes: 'The date range applies to the Last edited date unless you switch it to Created.' },
  { id: 'dictate', label: 'Dictate', group: 'Editor',
    does: 'The mic button in the editor toolbar (on a phone, the Dictate button at the bottom of the open note) types what you say straight into the open note while you speak, using the browser\'s own speech recognition. Press it again (it says Stop) to stop.',
    notes: 'This is different from New voice note: Dictate types live into a note you already have open and keeps no recording and does no tidy-up. It needs a browser that has speech recognition.' },
  { id: 'at-menu', label: 'Pull things in with @', group: 'Editor',
    does: 'Typing @ in a note opens a menu with your projects, your open tasks and your saved prompts, plus Search the web, Search Gmail and Search Calendar. Choose one to put that text into the note.',
    notes: 'Searching Gmail or Calendar needs them to be connected to Vault.' },
  { id: 'project', label: 'Project', group: 'Editor',
    does: 'The two drop-downs under the title of an open note file it under one of your projects and/or one of your clients (or No project, No client). To see only one project\'s or client\'s notes, use the filter button in the list. Opening Notes from a project starts with that project\'s notes shown.', notes: 'A note belongs to at most one project and at most one client. There are no folders or tags.' },
  { id: 'convert-task', label: 'Convert to task', group: 'Editor',
    does: 'The tick-list button (in the list when you hover a note, under the ⋯ button on a phone, and in the editor toolbar) opens Quick Capture with the note\'s title and the start of its text filled in, so it can become a task. A "task created" tag then shows on the note.',
    notes: 'Only the first 500 characters of the note go into the task. The note itself is not changed or removed.' },
  { id: 'open-as-chat', label: 'Open as chat', group: 'Editor',
    does: 'The chat button in the editor toolbar sends the note\'s text to a chat as the first message to edit and send. Choose an existing project, make a new project, or use a general chat.', notes: 'It copies the note into the chat; the note stays as it is.' },
  { id: 'delete', label: 'Delete', group: 'Notes list',
    does: 'The bin button deletes the note: in the list when you hover a note (on a phone, tap the ⋯ button beside it), and in the toolbar of an open note. It asks "Delete?" first, and nothing is deleted until you press Yes.', notes: 'Deleting is permanent: there is no bin to restore from.' },
];

const RULES = [
  'Notes saves by itself a moment after you stop typing. There is no Save button.',
  'A note is plain text. It can be filed under one project and one client; it can be searched by its title and text, grouped by date, project or client, and filtered by date range, project and client.',
  'On a phone the Notes screen is the list first; tapping a note opens it full screen, and the Notes button at the top left goes back to the list.',
  'A voice note is a normal note that began as a recording: you can edit, search, file, convert to a task or delete it like any other. Only its words are kept.',
  'With the tidy-up on, a voice note starts with a short summary and sections, followed by "What was said" (the original words). The tidy-up is only a rewrite of what was said; it does not add facts or tasks that were not spoken.',
  'The two ways to use the microphone: Record a voice note (from the + choice) records and writes up a whole recording into a new note; Dictate (in an open note) types live into that note.',
  'The Open buttons in this chat only open things for you: New note opens the Write-or-Record choice, New voice note opens the recorder window (it does not start recording), and Search notes puts the cursor in the search box. They never create, change or delete a note by themselves.',
  'Typing @ in a note opens a menu of things to pull in: projects, open tasks, saved prompts, and searching the web, Gmail and Calendar.',
];

const NOT_POSSIBLE = [
  'Replaying a voice recording. The audio is deleted once it has been turned into text; only the words are kept.',
  'Knowing who said what by name, or live captions and transcripts of an online meeting (Zoom, Teams). Voice notes record the microphone only: a chat across a table, or your own voice.',
  'Recordings longer than about an hour in one go (record in parts).',
  'Rich formatting (bold, headings, lists that format themselves), images, files or attachments on a note.',
  'Folders, tags or sharing a note with another person. A note can only be filed under one project and one client, and is private to the person who wrote it.',
  'Reminders or due dates on a note. A note can be converted to a task, and tasks have the dates.',
  'Restoring a deleted note, or an edit history to go back to.',
  'Being a legal or evidential record of a conversation: there is no consent step, speaker identification or audit trail. It is a private tool for dictating plans and ideas.',
];

const SYSTEM = `You are the guide to Notes in Vault for one person who uses it privately to write notes and to record their voice for plans and ideas. They say, in everyday words, what they want to do. You point them to the right control(s), in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Notes cannot do.
- You cannot see any of this person's notes or recordings. Never state or guess what is in them.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about the two ways to use the microphone when the person asks about recording or dictating: Record a voice note (choose it after pressing +) records, then writes up the whole recording; Dictate (in an open note) types live into that note.
- If they ask about recording other people, you may say it is a private tool and that it is courteous to let people know they are being recorded, but do not lecture.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Notes guide', feature: 'notes_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'NOTES CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your notes, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askNotesTutor: guide.ask,
};
