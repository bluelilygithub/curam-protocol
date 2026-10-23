// The controls the Notes guide (the round button on the Notes page) can point at. The ids and names are the guide's catalogue
// (server/services/notesTutor.js); node server/services/notesTutor.test.js fails if the two lists drift apart. `open` says whether
// the guide's Open button does something: the rest are controls inside an open note, so Open only brings the note into view.

export const NOTES_TOOLS = [
  { id: 'new-note', label: 'New note', open: 'chooser' },
  { id: 'new-voice-note', label: 'New voice note', open: 'recorder' },
  { id: 'search', label: 'Search notes', open: 'search' },
  { id: 'group-notes', label: 'Group notes', open: 'list' },
  { id: 'filter-notes', label: 'Filter notes', open: 'list' },
  { id: 'saved-views', label: 'Saved views', open: 'list' },
  { id: 'dictate', label: 'Dictate', open: 'editor' },
  { id: 'pin-note', label: 'Pin a note', open: 'list' },
  { id: 'templates', label: 'Templates', open: 'chooser' },
  { id: 'daily-note', label: 'Daily note', open: 'list' },
  { id: 'recently-deleted', label: 'Recently deleted', open: 'list' },
  { id: 'tags', label: 'Tags', open: 'editor' },
  { id: 'preview', label: 'Write and Preview', open: 'editor' },
  { id: 'ai-actions', label: 'AI actions', open: 'editor' },
  { id: 'at-menu', label: 'Pull things in with @', open: 'editor' },
  { id: 'project', label: 'Project', open: 'editor' },
  { id: 'convert-task', label: 'Convert to task', open: 'editor' },
  { id: 'open-as-chat', label: 'Open as chat', open: 'editor' },
  { id: 'delete', label: 'Delete', open: 'list' },
];
