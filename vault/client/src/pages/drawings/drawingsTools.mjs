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
  ['Draw it for me', 'Press Draw it for me, then say (with the microphone) or type a scenario: the steps of a process, who reports to whom, an idea with branches, or things in time order. The AI works out the boxes, arrows and labels and they are drawn on your drawing, tidily laid out, in the look the drawing is in. You can move and change everything, and one Undo removes the whole diagram. A Change it box lets you say what to change and redraws the diagram. It uses one AI request each time and only sends the words you say or type, never your drawings. It is made for flows, org charts, mind maps, timelines and relationship diagrams, not for floor plans or pictures. A step that sends things back to an earlier one is drawn as a loop round the outside, and things that act on each other both ways get a two-way arrow.'],
  ['Stretch, arrows and grid', 'Keep shape and Free decide what happens when you drag a corner to stretch what is selected (drag a box round everything to select it all): Keep shape grows it evenly so nothing is squashed or bent, Free lets it go wider or taller on its own, and holding Shift does the opposite for one drag. Select an arrow and press Two-way arrow to give it a head at both ends. Snap to grid shows a grid and snaps what you draw and move to it so boxes line up, and is saved with the drawing.'],
  ['Sketch and Clean', 'Sketch is the hand-drawn look. Press Clean for a more conservative one: steady straight lines, square corners, straight arrows, solid fills, a plain font and Vault\'s own text colour for lines. Colours you chose yourself are kept. Every piece remembers how it was drawn, so pressing Sketch again gives you exactly what you drew, and Undo works too. New pieces you add start in the look the drawing is in. Each drawing in the list says which look it is in.'],
  ['Export and files', 'Export a PNG or SVG picture of the drawing, or save it as a file ending in .excalidraw that you can open again here (Open a file) or in other Excalidraw programs. The Pictures choice beside the buttons can show a picture in the other look without changing the drawing.'],
  ['To Notes', 'The To Notes button makes a new note named after the drawing, with the picture attached and shown inside the note (in Preview), and a link back to the drawing. You can file the note under a project or client as you save it. Once a drawing is in a note, an In a note button appears above the drawing, and on its card in the list, and takes you to that note (a short list when it is in several). Later changes to the drawing are not copied into the note: press To Notes again for a fresh picture.'],
  ['Private', 'Your drawings are yours alone. Nobody else can see them, and there is no sharing link or live co-editing in Vault yet.'],
  ['Not included yet', 'Several people drawing at once, share links, drawings to scale (such as a floor plan made from words), and sending a drawing into Graphics or Chat. Export a picture and use it there for now.'],
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
  { id: 'draw-it', label: 'Draw it for me', tool: 'editor' },
  { id: 'undo', label: 'Undo and Redo', tool: 'editor' },
  { id: 'arrange', label: 'Stretch, two-way arrows and grid', tool: 'editor' },
  { id: 'style', label: 'Sketch and Clean look', tool: 'editor' },
  { id: 'to-notes', label: 'To Notes', tool: 'editor' },
];
