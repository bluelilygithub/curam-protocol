// What the Drawings page shows: its two views (the list of drawings and the drawing board), the hover text for them, the words in the (i)
// box, and every control the guide (the round button) can point at. The ids are the guide's catalogue (server/services/drawingsTutor.js);
// `node server/services/drawingsTutor.test.js` fails if the two lists drift apart. `tool` is the view the guide's Open button shows.

export const DRAWING_TOOLS = [
  { id: 'list', label: 'Your drawings', group: 'Your drawings', icon: 'folder' },
  { id: 'editor', label: 'Drawing board', group: 'Drawing board', icon: 'pen-tool' },
];

export const GROUPS = ['Your drawings', 'Drawing board'];

export const GROUP_TIPS = {
  'Your drawings': 'Every drawing you have saved: open one, make a new one, rename, copy or delete.',
  'Drawing board': 'The drawing itself: shapes, arrows, text, pictures and freehand on an endless page.',
};

export const TOOL_TIPS = {
  list: 'See all your saved drawings with a small preview of each. Click one to open it.',
  editor: 'Draw on an endless page with shapes, arrows, text, pictures and freehand. Your changes save by themselves.',
};

// One short line under the page title for the open view.
export const TOOL_BLURBS = {
  list: 'Your saved drawings. Click one to open it, or start a new one.',
  editor: 'Draw here. Everything you do is saved by itself.',
};

// The longer text for the (i) "How Drawings works" box.
export const HOW_IT_WORKS = [
  ['Your drawings', 'Every drawing you make is saved to your Vault account and shown with a small preview. Click one to open it. You can rename it, make a copy, or delete it. A deleted drawing waits 30 days in the recycle bin in Settings, and a message with an Undo button appears straight away.'],
  ['The drawing board', 'An endless page with shapes, arrows, lines, text, freehand and an eraser, drawn in a hand-sketched style. Pick a tool along the top, drag on the page, and change colours and line style in the panel on the left. Everything saves by itself a moment after you stop; the words next to the title say when it last did.'],
  ['Pictures and shapes', 'Paste or drop a picture onto the page, or use the picture tool. The Library button holds ready-made shapes you can add to the page. Very large pictures make a drawing too big to save (the limit is 6 MB), so shrink them first.'],
  ['Export and files', 'Export a PNG or SVG picture of the drawing, or save it as a file ending in .excalidraw that you can open again here (Open a file) or in other Excalidraw programs.'],
  ['Private', 'Your drawings are yours alone. Nobody else can see them, and there is no sharing link or live co-editing in Vault yet.'],
  ['Not included yet', 'Several people drawing at once, share links, and sending a drawing into Graphics, Notes or Chat. Export a picture and use it there for now.'],
];

// Everything the guide can point at: the two views plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'list', label: 'Your drawings', tool: 'list' },
  { id: 'new', label: 'New drawing', tool: 'list' },
  { id: 'open-file', label: 'Open a file', tool: 'list' },
  { id: 'search', label: 'Search', tool: 'list' },
  { id: 'rename', label: 'Rename', tool: 'list' },
  { id: 'copy', label: 'Make a copy', tool: 'list' },
  { id: 'delete', label: 'Delete and undo', tool: 'list' },
  { id: 'editor', label: 'Drawing board', tool: 'editor' },
  { id: 'shapes', label: 'Shapes, text and pens', tool: 'editor' },
  { id: 'pictures', label: 'Pictures', tool: 'editor' },
  { id: 'library', label: 'Shape library', tool: 'editor' },
  { id: 'saving', label: 'Saving', tool: 'editor' },
  { id: 'export', label: 'Export and save as a file', tool: 'editor' },
  { id: 'look', label: 'Background and dark mode', tool: 'editor' },
];
