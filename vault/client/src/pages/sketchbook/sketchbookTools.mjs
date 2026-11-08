// What the Sketchbook page shows: its two views (the collection and one sketch), the hover text for them, the words in the (i) box, and every
// control the guide (the round button) can point at. The ids are the guide's catalogue (server/services/sketchbookTutor.js);
// `node server/services/sketchbookTutor.test.js` fails if the two lists drift apart. `tool` is the view the guide's Open button shows.

export const SKETCH_TOOLS = [
  { id: 'list', label: 'Your sketches', group: 'Your sketches', icon: 'pencil-line' },
  { id: 'editor', label: 'One sketch', group: 'One sketch', icon: 'image' },
];

export const GROUPS = ['Your sketches', 'One sketch'];

export const GROUP_TIPS = {
  'Your sketches': 'Describe a new scene and see every sketch you have saved: open one, rename, copy or delete.',
  'One sketch': 'The picture itself: change it with more words, redraw it in pencil, pen or colour, go back to an earlier picture, save it or put it in a note.',
};

export const TOOL_TIPS = {
  list: 'Describe a scene to be drawn, and see all your saved sketches. Click one to open it.',
  editor: 'One sketch, large. Change it with more words, change its look, go back to an earlier picture, save it as a file or put it in a note.',
};

// One short line under the page title for the open view.
export const TOOL_BLURBS = {
  list: 'Describe a scene or an idea and have it drawn as a cartoon.',
  editor: 'Change this picture, or save it.',
};

// The longer text for the (i) "How Sketchbook works" box.
export const HOW_IT_WORKS = [
  ['Describe', 'Say (with the microphone) or type a scene, a theory or a possibility, choose how it is drawn and its shape, and press Draw it. It is drawn as a cartoon and saved to your collection straight away.'],
  ['Pencil, pen or colour', 'Pencil is black and grey. Pen is ink in one of seven colours you choose. Coloured in has outlines filled with colour. Any sketch can be redrawn in another look later, or coloured in with one button, without changing what is in it.'],
  ['Change it', 'Open a sketch and say what to change ("make the dog bigger, add rain"). The same picture is changed, not a new one drawn. The picture it replaces is kept under Earlier pictures (the last 6), and Put back brings one back, with its look.'],
  ['Notes', 'The To Notes button makes a new note with the picture inside it and a link back to the sketch. Once a sketch is in a note, the same button becomes Go to note (or In 2 notes, with a list) and takes you straight there, and the sketch card in the list shows In a note too. From the note, the link goes back to the sketch. Put in another note makes a fresh note with the picture as it is now.'],
  ['Save and copy', 'Save a sketch as PNG, JPG or WebP, or copy the picture to paste into an email or document. For an SVG, a PDF or a print file, save a PNG and open it in Graphics.'],
  ['Cost', 'Each picture or change is one paid AI image request (about 2 to 3 cents), shown before you press the button. It shares the daily limit for AI pictures with Graphics.'],
  ['Private', 'Your sketches are yours alone. Nobody else can see them. A deleted sketch waits 30 days in the recycle bin in Settings, and an Undo button appears straight away.'],
  ['Not included yet', 'Drawing or painting by hand on the picture, several pictures in a row (a comic strip), keeping the same character across pictures, and sending a sketch into Graphics in one click (save a PNG and open it there for now).'],
];

// Everything the guide can point at: the two views plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'list', label: 'Your sketches', tool: 'list' },
  { id: 'describe', label: 'Describe a scene', tool: 'list' },
  { id: 'looks', label: 'Pencil, pen or coloured in', tool: 'list' },
  { id: 'cost', label: 'Cost and the daily limit', tool: 'list' },
  { id: 'search', label: 'Search', tool: 'list' },
  { id: 'rename', label: 'Rename', tool: 'list' },
  { id: 'copy', label: 'Make a copy', tool: 'list' },
  { id: 'delete', label: 'Delete and undo', tool: 'list' },
  { id: 'editor', label: 'One sketch', tool: 'editor' },
  { id: 'change', label: 'Change this picture', tool: 'editor' },
  { id: 'relook', label: 'Redraw in another look, or colour it in', tool: 'editor' },
  { id: 'earlier', label: 'Earlier pictures', tool: 'editor' },
  { id: 'save', label: 'Save or copy the picture', tool: 'editor' },
  { id: 'to-notes', label: 'To Notes', tool: 'editor' },
];
