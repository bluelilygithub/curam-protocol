// The hover tip for every control on the Notes screen, in plain words (the same convention as Video Tools: the shared Tooltip component,
// never a native title="" attribute). One list so the wording is in one place and a test can check nothing is missing or left behind:
//   node client/src/pages/notes/noteTips.test.mjs
// A tip says what the control does and what happens next. Keys with a nested object are looked up by the control's id.

export const NOTE_TIPS = {
  // header of the list
  info: 'How Notes works: what each part does, what is private, and what Notes does not do.',
  tour: 'Take the guided tour of Notes, step by step.',
  ask: 'Ask your notes: ask a question in your own words and get an answer taken from your notes, with the notes it used.',
  today: "Open today's note. If there is not one yet it is made for you, with any to-dos you left unticked last time carried over.",
  bin: 'Recently deleted: notes, templates and saved views you deleted in the last 30 days. Restore them from here.',
  newNote: 'Start a new note: write one, record your voice, or begin from a template.',

  // search and views
  search: 'Find notes by words in the title or text, in the text inside attached files, or by the name of a project, client, tag or file. Results appear as you type.',
  clearSearch: 'Clear the search.',
  views: 'Saved views: bring back a whole set of search, filters and grouping in one tap, or save the current set under a name.',
  viewsActive: (name) => `You are in the saved view "${name}". Open Views to switch, update or clear it.`,
  filters: 'Filter by date, reminders, tags, project or client. The number shows how many filters are on.',
  groupBy: {
    date: 'Group the list by when each note was last edited: Today, Yesterday, Previous 7 days, then by month.',
    project: 'Group the list by project. Notes with no project are at the bottom.',
    client: 'Group the list by client. Notes with no client are at the bottom.',
    tag: 'Group the list by tag. A note with several tags is listed under each of them.',
  },

  // the filter sheet
  datePreset: {
    all: 'Show notes from any time.',
    today: 'Only notes from today.',
    '7d': 'Only notes from the last 7 days, including today.',
    '30d': 'Only notes from the last 30 days, including today.',
    year: 'Only notes from this calendar year.',
    custom: 'Choose your own from and to dates.',
  },
  dateFrom: 'The first day to include.',
  dateTo: 'The last day to include.',
  dateField: {
    updated: 'The dates above mean when the note was last edited. The list is ordered the same way.',
    created: 'The dates above mean when the note was first made. The list is ordered the same way.',
  },
  reminderFilter: {
    '': 'Do not filter by reminder.',
    due: 'Only notes whose reminder time has come and has not been marked done.',
    upcoming: 'Only notes with a reminder still to come.',
    any: 'Only notes with a reminder that is not done, due or coming up.',
  },
  filesFilter: {
    '': 'Do not filter by attached files.',
    with: 'Only notes that have at least one attached file.',
    without: 'Only notes with no attached files.',
  },
  tagChip: 'Show only notes with this tag. Pick several to see notes that have all of them.',
  manageTags: 'Rename a tag everywhere, or take it off every note. Your notes are never deleted.',
  projectFilter: 'Show only the notes filed under this project.',
  clientFilter: 'Show only the notes filed under this client.',
  clearFilters: 'Turn off the search and every filter. The grouping stays as you chose it.',

  // rows
  row: 'Open this note.',
  rowPin: 'Pin this note to the top of the list, or unpin it.',
  rowTask: 'Make a task from this note. The note itself is not changed.',
  rowDelete: 'Delete this note. It is kept for 30 days in Recently deleted, so you can restore it.',
  rowMenu: 'More actions for this note: pin, make a task, delete.',
  rowAttachments: (n) => `${n} file${n === 1 ? '' : 's'} attached to this note. Open the note to see ${n === 1 ? 'it' : 'them'}.`,
  rowPinned: 'Pinned to the top of the list.',
  rowVoice: 'A voice note: made from a recording. Only the words were kept, not the audio.',
  rowReminder: (text, due) => (due ? `Its reminder is due: ${text}. Open the note to mark it done or snooze it.` : `Reminder: ${text}.`),
  showMore: 'Load the next 100 notes.',

  // the open note
  back: 'Back to the list of notes.',
  pin: 'Pin this note to the top of the list, or unpin it.',
  ai: 'AI actions for this note: summarise, pull out to-dos, tidy up, suggest tags or a title. Nothing changes until you choose.',
  dictate: 'Dictate: speak and your words are typed into this note. Press again to stop.',
  convertTask: 'Make a task from this note. The note itself is not changed.',
  takeToChat: 'Open this note as the first message of a chat, in a project or a general chat.',
  deleteNote: 'Delete this note. It is kept for 30 days in Recently deleted, so you can restore it.',
  undoAi: 'Put the note back as it was before the AI change.',
  saveState: 'Notes save by themselves a moment after you stop typing.',
  retrySave: 'Try saving again.',
  title: 'The note title. A note with no title is listed by its first line.',
  projectPick: 'File this note under one of your projects.',
  clientPick: 'File this note under one of your clients.',
  tagInput: 'Type a tag and press Enter or a comma. Tags you already use are offered as you type.',
  removeTag: 'Take this tag off the note.',
  suggestedTag: 'Add this tag, which you already use on other notes.',
  write: 'Write: the plain text box where you type.',
  preview: 'Preview: see the note formatted, with headings, bold, lists, links and tick-boxes you can tick.',
  typeButton: 'Open the keyboard and type into this note.',
  todoBox: 'Tick or untick this to-do. The change is saved into the note.',
  attach: 'Attach files to this note: PDF, images, text, CSV or Office documents, up to 50 MB each. You can also drop files onto the note or paste an image into the text.',
  attachFull: 'This note already has the most files it can hold (20). Remove one to attach another.',
  attachOpen: (name, size, view, askReads) => `${name}${size ? `, ${size}` : ''}. Click to ${view ? 'open it in a new tab' : 'save it to your computer'}. ${askReads ? 'Ask your notes can read the text inside it.' : 'Ask your notes cannot read inside this file, only its name.'}`,
  attachRemove: 'Remove this file from the note. It is deleted for good, not kept in Recently deleted.',
  reminderButton: 'Set a reminder for this note: pick a time, choose whether it repeats, and whether to email you too.',
  reminderRepeat: 'How often this reminder comes round again: every day, weekday, week, 2 weeks, month or year. It keeps the time of day you pick, even when the clocks change.',
  reminderChip: (text, due) => (due ? `The reminder for this note is due: ${text}. Click to mark it done or snooze it.` : `Reminder set for ${text}. Click to change or clear it.`),
  reminderDone: 'Mark this reminder done. It leaves Reminders due and no email is sent. If it repeats, it moves on to its next time and stays set.',
  reminderSnooze: 'Remind me again at the time you choose.',

  // ask your notes
  askScope: {
    all: 'Look through every one of your notes.',
    filters: 'Look only through the notes in the list as it is now, with its search and filters.',
    note: 'Look only at the note that is open.',
  },
  askScopeNoNote: 'Open a note first to ask about just that note.',
  askInput: 'Type your question. Enter sends it; Shift+Enter starts a new line.',
  askSend: 'Look through your notes and answer. The text of the notes it reads is sent to the AI.',
  askMic: 'Dictate your question: speak and it is typed in. Press again to stop.',
  askClear: 'Clear this conversation. Your notes are not touched.',
  askForget: 'Remove this question and answer.',
  askSource: 'Open this note: it is one the answer was taken from.',
  askStarter: 'Ask this question.',
  askRelated: 'Also read what is linked to the notes it finds: their project and client, and the tasks, deals and recent contact on them. Switch off to answer from the notes alone.',
  askMap: 'Show or hide the map: the projects, clients, tasks, deals and recent contact linked to the notes it read.',
  askMapItem: 'Open this record.',
  askMapNote: 'Open the note that is filed here.',

  // dialogs
  viewSave: 'Save the current search, filters and grouping under this name.',
  viewUpdate: 'Replace what this view holds with the filters you have now.',
  viewRename: 'Rename this view.',
  viewDelete: 'Delete this view. It is kept 30 days in Recently deleted.',
  viewApply: 'Bring back this view: its search, dates, tags, project, client and grouping.',
  tagRename: 'Rename this tag on every note. Naming it after an existing tag joins the two.',
  tagDelete: 'Take this tag off every note. The notes stay.',
  templateUse: 'Make a new note from this template.',
  templateDelete: 'Delete this template. It is kept 30 days in Recently deleted.',
  templateSave: 'Save the open note as a template: its title, text and tags.',
};

/** Every control id a tip is written for (the nested ones are counted by their parent's key). */
export const NOTE_TIP_KEYS = Object.keys(NOTE_TIPS);
