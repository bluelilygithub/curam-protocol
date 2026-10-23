'use strict';

// The Notes guide (the round button on Vault's /notes page): a person says what they want to do ("record my voice", "turn this into a
// task", "find the note about the budget") and the guide points at the real controls, in order, or says plainly that Notes does not do
// it. It only knows what is written here (the controls Notes really has) and it never sees any note. Built on guideCore.js; the ids are
// Notes' own, listed in client/src/pages/notes/notesTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/voice-notes.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'new-note', label: 'New note', group: 'Notes list',
    does: 'The + button at the top of the notes list (on a phone it says + New) opens a small choice: Write a note, or Record a voice note. Write a note opens a new note with the cursor in the title, where you type the title and then the text; it saves by itself a moment after you stop typing. On a phone, the Type button at the bottom opens the keyboard, and Dictate beside it speaks into the note. A note with no title is listed by its first line.', notes: 'Notes are text with simple markdown symbols (see Write and Preview): no formatting buttons or images.' },
  { id: 'new-voice-note', label: 'New voice note', group: 'Notes list',
    does: 'Press the + button at the top of the notes list and choose Record a voice note. It records your voice and writes it into a new note. Press Start recording, talk through a plan, an idea or a chat across the table, and Pause or Resume if you need to. Stop and make the note writes your words up. By default it also tidies them into a note with a short title and plain sections (Summary, Ideas, Plan, To do, Open questions, only those that apply); untick the tidy-up to keep your words exactly as spoken. What was said is always kept at the bottom of the note. Voice notes get an audio-lines icon in the list and a "Voice note" tag above the editor.',
    notes: 'Only the words are kept: the recording is turned into text and then deleted, so there is nothing to replay. Up to about an hour per recording. Needs the microphone allowed in the browser and the speech-to-text service set up on the server. Has a small cost per note (the speech-to-text, and the tidy-up). It does not know who is speaking by name. If it fails, the recorder window stays open with the recording kept and a Try again button, so nothing is lost until you press Discard or close the window. Let anyone you are recording know.' },
  { id: 'search', label: 'Search notes', group: 'Notes list',
    does: 'The search box above the list finds notes a moment after you stop typing, by words in the title or the text, or by the name of the project or client a note is filed under, or by its tags. It works together with the filters and grouping.', notes: 'It searches your own notes only.' },
  { id: 'group-notes', label: 'Group notes', group: 'Notes list',
    does: 'The Group by buttons under the search box (Date, Project, Client, Tag) split the list into labelled sections. By Date the sections are Today, Yesterday, Previous 7 days, Previous 30 days, then one section per month. By Project or Client each project or client is a section, with notes that are not filed under one at the bottom. By Tag a note with several tags is listed under each of them, and notes with no tags are under Untagged at the bottom. Your choice is remembered on this device.',
    notes: 'This only changes how the list is laid out; it never moves or changes a note.' },
  { id: 'saved-views', label: 'Saved views', group: 'Notes list',
    does: 'The layers button beside the filter button, above the list, opens Views. Pick a saved view to bring back its search, date range, project, client, tags and grouping in one tap, or pick All notes to clear the search and filters. To make a view, set up the search, filters and grouping you want, open Views, type a name at the bottom and press Save. If you change the filters after opening a view, Views offers to update that view with the new ones, or to save them as a new view. A view can be renamed with the pencil or deleted with the bin; a deleted view is kept 30 days in Recently deleted, and the message that appears has an Undo. The list shows the name of the view you are in.',
    notes: 'You can keep up to 30 views, each with a different name. A date range such as 30 days stays relative, so a view saved with 30 days always means the last 30 days from today. If the project or client in a view has been deleted since, that part is left out and you are told.' },
  { id: 'filter-notes', label: 'Filter notes', group: 'Notes list',
    does: 'The filter button (sliders icon) beside the search box opens the filters: a date range (Today, 7 days, 30 days, This year, or Pick dates for your own from and to days), whether the dates mean Last edited or Created, a project and a client, and tags (a note must have all the tags you pick). Several filters work together. To keep a combination you use often, save it as a view. The number on the button shows how many are on, and Clear all filters turns them off. The list shows the most recent 100 notes at a time, with a Show more notes button at the bottom.',
    notes: 'The date range applies to the Last edited date unless you switch it to Created.' },
  { id: 'preview', label: 'Write and Preview', group: 'Editor',
    does: 'Above the text of an open note are two buttons, Write and Preview. Write is the plain text box where you type. Preview shows the same note formatted. You can type simple markdown symbols: a line starting with # is a heading (## a smaller one), **bold**, *italic*, a line starting with - is a bullet, 1. is a numbered list, [words](https://link) is a link, a line starting with > is a quote, and - [ ] makes a to-do with a tick-box. In Preview you can tick the to-dos, and the tick is saved into the note; a count such as 2 of 5 done shows beside the buttons. On a computer, double-click the preview to go back to editing. The list shows words only, without the symbols. Your choice of Write or Preview is remembered on that device.',
    notes: 'The note is still saved as plain text with the symbols in it, so search finds the words. There are no formatting buttons, images or attachments; the formatting is typed. Web searches, emails and calendar events you pull in with @ are added with bold headings and links, which show properly in Preview. Pasted HTML is shown as text, never run.' },
  { id: 'tags', label: 'Tags', group: 'Editor',
    does: 'Under the title of an open note, below the project and client, is the tags row. Type a word and press Enter or a comma to add a tag, and tap the x on a tag to remove it. Tags you already use are offered as you type. A note can have up to 20 tags of up to 30 characters, and capital letters do not matter (Budget and budget are the same tag). In the list a note shows its first three tags. The filter button has a Tags section: pick tags to see only notes that have all of them, and use Manage tags there to rename a tag everywhere (naming it after an existing tag joins the two) or take it off every note. Group by Tag lists a note under each of its tags, with Untagged at the bottom. The AI button has Suggest tags, which proposes a few and reuses the tags you already have.',
    notes: 'Tagging is filing: it does not change the edited date of a note. Taking a tag off every note never deletes a note. Tags are private to the person who made them. Search also finds notes by their tags.' },
  { id: 'templates', label: 'Templates', group: 'Notes list',
    does: 'The + button, then From a template, opens the template list. The built-in templates are Meeting notes, Client call, Weekly review, Project kick-off, Idea and To-do list. Choosing one makes a new note with its headings, tick-boxes and tags, with dates such as the day filled in. Your own templates are listed above the built-in ones. To make one, open a note you like, press + then From a template, type a name at the bottom and press Save: it keeps the title, the text and the tags. A template of your own has a bin button; deleting it sends it to Recently deleted for 30 days.',
    notes: 'You can keep up to 50 of your own. A template is only a starting point: changing or deleting it never changes notes already made from it.' },
  { id: 'daily-note', label: 'Daily note', group: 'Notes list',
    does: 'The calendar-tick button at the top of the notes list opens the note for the day, and makes it if there is not one yet, titled with the date. A new daily note starts with a heading and three empty to-dos, and any to-dos left unticked in your most recent earlier daily note are copied in under Carried over. Daily notes are tagged daily, so the Tags filter finds them all. Pressing the button again the same day opens the same note.',
    notes: 'There is only one daily note for each day, and the earlier note is not changed when its to-dos are carried over. If you delete the note for the day and press the button again, you get a fresh one.' },
  { id: 'recently-deleted', label: 'Recently deleted', group: 'Notes list',
    does: 'The bin button at the top of the notes list opens Recently deleted: the notes and templates you deleted in the last 30 days. Restore puts one back as it was, with its text, tags, pin and dates. Delete for good removes it straight away, and Empty recycle bin clears the lot. Right after you delete a note, the message that appears has an Undo. The same recycle bin, including items from other tools, is in Settings under Recycle bin.',
    notes: 'After 30 days an item is removed for good. A restored note whose project or client was deleted in the meantime comes back without it.' },
  { id: 'pin-note', label: 'Pin a note', group: 'Notes list',
    does: 'The pin button keeps a note at the top of the list in its own Pinned section, above every other group. In the list it shows when you hover a note (on a phone, tap the ⋯ button beside the note and choose Pin); in an open note it is the pin button in the toolbar. Press it again to unpin. Pinned notes show a small pin.',
    notes: 'Pinning does not change the note or its edited date. Search and filters still apply, so a pinned note that does not match them is not shown.' },
  { id: 'ai-actions', label: 'AI actions', group: 'Editor',
    does: 'The AI button in the toolbar of an open note (the wand on a phone) has five actions. Summarise writes a few sentences you can add to the top of the note. Pull out to-dos lists the things to do in the note; you tick the ones you want, can change the wording and due date, and press Create to make them tasks (filed under the same project and client as the note). Tidy up fixes spelling, repeats and layout, and you choose to replace the text of the note or add the tidied version below. Suggest a title offers a short title you can edit and use. Suggest tags proposes a few tags, reusing the ones you already have, for you to tick and add. After Summarise, Tidy up or a new title, an Undo AI change button appears until you type again.',
    notes: 'The AI only proposes: nothing in the note changes and no task is made until you press the button for it. It sends the note\'s text to the AI service and has a small cost each time. It only works from what is written in the note and only gives a due date when the note states one. Very long notes (about 60,000 characters) and empty notes are refused. It does not see other notes.' },
  { id: 'dictate', label: 'Dictate', group: 'Editor',
    does: 'The mic button in the editor toolbar (on a phone, the Dictate button at the bottom of the open note) types what you say straight into the open note while you speak, using the browser\'s own speech recognition. Press it again (it says Stop) to stop.',
    notes: 'This is different from New voice note: Dictate types live into a note you already have open and keeps no recording and does no tidy-up. It needs a browser that has speech recognition.' },
  { id: 'at-menu', label: 'Pull things in with @', group: 'Editor',
    does: 'Typing @ in a note opens a menu with your projects, your open tasks and your saved prompts, plus Search the web, Search Gmail and Search Calendar. Choose one to put that text into the note.',
    notes: 'Searching Gmail or Calendar needs them to be connected to Vault.' },
  { id: 'project', label: 'Project', group: 'Editor',
    does: 'The two drop-downs under the title of an open note file it under one of your projects and/or one of your clients (or No project, No client). To see only one project\'s or client\'s notes, use the filter button in the list. Opening Notes from a project starts with that project\'s notes shown.', notes: 'A note belongs to at most one project and at most one client. There are no folders; use tags when a note needs several labels.' },
  { id: 'convert-task', label: 'Convert to task', group: 'Editor',
    does: 'The tick-list button (in the list when you hover a note, under the ⋯ button on a phone, and in the editor toolbar) opens Quick Capture with the note\'s title and the start of its text filled in, so it can become a task. A "task created" tag then shows on the note.',
    notes: 'Only the first 500 characters of the note go into the task. The note itself is not changed or removed.' },
  { id: 'open-as-chat', label: 'Open as chat', group: 'Editor',
    does: 'The chat button in the editor toolbar sends the note\'s text to a chat as the first message to edit and send. Choose an existing project, make a new project, or use a general chat.', notes: 'It copies the note into the chat; the note stays as it is.' },
  { id: 'delete', label: 'Delete', group: 'Notes list',
    does: 'The bin button deletes the note: in the list when you hover a note (on a phone, tap the ⋯ button beside it), and in the toolbar of an open note. It asks "Delete?" first, and nothing is deleted until you press Yes. The note then waits 30 days in Recently deleted.', notes: 'You can restore a deleted note for 30 days from Recently deleted, or press Undo in the message straight after.' },
];

const RULES = [
  'Notes saves by itself a moment after you stop typing. There is no Save button.',
  'A note is stored as text, with optional markdown symbols for headings, bold, lists, links and to-do tick-boxes that show formatted in Preview. It can be filed under one project and one client; it can be searched by its title and text, tagged, grouped by date, project, client or tag, and filtered by date range, project, client and tags.',
  'On a phone the Notes screen is the list first; tapping a note opens it full screen, and the Notes button at the top left goes back to the list.',
  'A voice note is a normal note that began as a recording: you can edit, search, file, convert to a task or delete it like any other. Only its words are kept.',
  'With the tidy-up on, a voice note starts with a short summary and sections, followed by "What was said" (the original words). The tidy-up is only a rewrite of what was said; it does not add facts or tasks that were not spoken.',
  'The two ways to use the microphone: Record a voice note (from the + choice) records and writes up a whole recording into a new note; Dictate (in an open note) types live into that note.',
  'The Open buttons in this chat only open things for you: New note opens the Write-or-Record choice, New voice note opens the recorder window (it does not start recording), and Search notes puts the cursor in the search box. They never create, change or delete a note by themselves.',
  'Typing @ in a note opens a menu of things to pull in: projects, open tasks, saved prompts, and searching the web, Gmail and Calendar.',
  'A saved view brings back a whole set of filters and the grouping in one tap.',
  'Deleted notes, templates and saved views stay in Recently deleted for 30 days and can be restored, then they are removed for good.',
  'Pinned notes sit in a Pinned section at the top of the list. The AI actions (Summarise, Pull out to-dos, Tidy up, Suggest tags, Suggest a title) only propose: the person chooses what to use, and nothing is changed or created before that.',
];

const NOT_POSSIBLE = [
  'Replaying a voice recording. The audio is deleted once it has been turned into text; only the words are kept.',
  'Knowing who said what by name, or live captions and transcripts of an online meeting (Zoom, Teams). Voice notes record the microphone only: a chat across a table, or your own voice.',
  'Recordings longer than about an hour in one go (record in parts).',
  'Formatting buttons (a toolbar for bold or headings), images, files or attachments on a note. Formatting is typed as markdown symbols and shown in Preview.',
  'Folders, or sharing a note with another person. A note can only be filed under one project and one client (it can have many tags), and is private to the person who wrote it.',
  'Reminders or due dates on a note. A note can be converted to a task, and tasks have the dates.',
  'An edit history to go back to. A deleted note can be restored for 30 days, but changes made inside a note cannot be undone step by step afterwards.',
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
