// What the Drawings page shows: its two views (the list of drawings and the drawing board), the hover text for them, the words in the (i)
// box, and every control the guide (the round button) can point at. The ids are the guide's catalogue (server/services/drawingsTutor.js);
// `node server/services/drawingsTutor.test.js` fails if the two lists drift apart. `tool` is the view the guide's Open button shows.

export const DRAWING_TOOLS = [
  { id: 'list', label: 'Your diagrams', group: 'Your diagrams', icon: 'folder' },
  { id: 'editor', label: 'Board', group: 'Board', icon: 'pen-tool' },
];

export const GROUPS = ['Your diagrams', 'Board'];

export const GROUP_TIPS = {
  'Your diagrams': 'Every diagram you have saved: open one, make a new one, rename, copy or delete.',
  'Board': 'The diagram itself: shapes, arrows, text, pictures and freehand on an endless page.',
};

export const TOOL_TIPS = {
  list: 'See all your saved diagrams with a small preview of each. Click one to open it.',
  editor: 'Draw on an endless page with shapes, arrows, text, pictures and freehand. Your changes save by themselves.',
};

// One short line under the page title for the open view.
export const TOOL_BLURBS = {
  list: 'Your saved diagrams. Click one to open it, or start a new one.',
  editor: 'Draw here. Everything you do is saved by itself.',
};

// The longer text for the (i) "How Drawings works" box.
export const HOW_IT_WORKS = [
  ['Your diagrams', 'Every diagram you make is saved to your Vault account and shown with a small preview. Click one to open it. You can rename it, make a copy, or delete it. A deleted diagram waits 30 days in the recycle bin in Settings, and a message with an Undo button appears straight away.'],
  ['The board', 'An endless page with shapes, arrows, lines, text, freehand and an eraser, drawn in a hand-sketched style. Pick a tool along the top, drag on the page, and change colours and line style in the panel on the left. Everything saves by itself a moment after you stop; the words next to the title say when it last did.'],
  ['Pictures and shapes', 'Paste or drop a picture onto the page, or use the picture tool. The Library button holds ready-made shapes you can add to the page. Very large pictures make a diagram too big to save (the limit is 6 MB), so shrink them first.'],
  ['Draw it for me', 'Open the More tools menu (the last icon in the row of tools along the top of the board) and choose Draw it for me under Generate, then say (with the microphone) or type a scenario: the steps of a process, who reports to whom, an idea with branches, or things in time order. The AI works out the boxes, arrows and labels and they are drawn on your diagram, tidily laid out, in the look the diagram is in. You can move and change everything, and one Undo removes the whole diagram. A Change it box shows whenever the diagram has a diagram in it, even one made by hand or on an earlier visit: say what to change (insert a step between two others, add one at the start or the end, add a loop back, rename a box) and it is redrawn in the same place. Select a box first if there are several diagrams. For a step that must wait, say what happens if it has not happened (if the deposit is not paid, go back to sending the invoice) and it is drawn as a question with a No arrow looping back. It uses one AI request each time and only sends the words you say or type, never your diagrams. It is made for flows, org charts, mind maps, timelines and relationship diagrams, not for floor plans or pictures. A step that sends things back to an earlier one is drawn as a loop round the outside, and things that act on each other both ways get a two-way arrow.'],
  ['Shape numbers', 'The Numbers button shows a small number on each shape so you can say add a step after 7, or if 4.1 is no, loop back to 2. A shape keeps its number once it has one; a step put in between two others gets a sub-number (4.1, then 4.2) and anything else takes the next whole number, so nothing is renumbered. The numbers show on screen only and never print or export.'],
  ['What have I missed?', 'In the Draw it for me box, What have I missed? has the AI look over the diagram and list what you may not have considered, naming shapes by number. Press Add this on a suggestion to make that change, or Dismiss. Nothing changes until you do. It uses one AI request and sends only the words in the shapes.'],
  ['Select all, fit, stretch and grid', 'Select all picks every box, arrow and text so you can stretch or move them together, and Fit to screen zooms so the whole diagram fills the screen. Keep shape and Free decide what happens when you drag a corner to stretch what is selected (drag a box round everything to select it all): Keep shape grows it evenly so nothing is squashed or bent, Free lets it go wider or taller on its own, and holding Shift does the opposite for one drag. For a two-way arrow, click the arrow and choose an arrowhead for both ends under Arrowheads in the left panel. Snap to grid shows a grid and snaps what you draw and move to it so boxes line up, and is saved with the diagram.'],
  ['Sketch and Clean', 'Sketch is the hand-drawn look. Press Clean for a more conservative one: steady straight lines, square corners, straight arrows, solid fills, a plain font and Vault\'s own text colour for lines. Colours you chose yourself are kept. Every piece remembers how it was drawn, so pressing Sketch again gives you exactly what you drew, and Undo works too. New pieces you add start in the look the diagram is in. Each diagram in the list says which look it is in.'],
  ['Export and files', 'Export a PNG or SVG picture of the diagram, or save it as a file ending in .excalidraw that you can open again here (Open a file) or in other Excalidraw programs. The Pictures choice beside the buttons can show a picture in the other look without changing the diagram.'],
  ['To Notes', 'The To Notes button makes a new note named after the diagram, with the picture attached and shown inside the note (in Preview), and a link back to the diagram. You can file the note under a project or client as you save it. Once a diagram is in a note, the same button changes to In a note and opens a short list: go to the note, or Put in another note (its card in the list also has an In a note button). Later changes to the diagram are not copied into the note: choose Put in another note for a fresh picture.'],
  ['Make a plan', 'The Make a plan button (beside To Notes, shown when Plans is switched on for you) turns the diagram into a plan. Each box becomes a step, each arrow means the next step waits for the one before, and decisions and end shapes become milestones. Decisions are taken as Yes, so the No branches are left out (a tick brings them back), and arrows that loop back to an earlier step are left out because a plan cannot go in circles. A box asks for the start date, the finish-by date and the working days each step takes, and a line says whether it fits. The plan is linked to the diagram, and the button then says In a plan.'],
  ['Private', 'Your diagrams are yours alone. Nobody else can see them, and there is no sharing link or live co-editing in Vault yet.'],
  ['Not included yet', 'Several people diagram at once, share links, diagrams to scale (such as a floor plan made from words), and sending a diagram into Graphics or Chat. Export a picture and use it there for now.'],
];

// Everything the guide can point at: the two views plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'list', label: 'Your diagrams', tool: 'list' },
  { id: 'new', label: 'New diagram', tool: 'list' },
  { id: 'open-file', label: 'Open a file', tool: 'list' },
  { id: 'search', label: 'Search', tool: 'list' },
  { id: 'rename', label: 'Rename', tool: 'list' },
  { id: 'copy', label: 'Make a copy', tool: 'list' },
  { id: 'delete', label: 'Delete and undo', tool: 'list' },
  { id: 'editor', label: 'Board', tool: 'editor' },
  { id: 'shapes', label: 'Shapes, text and pens', tool: 'editor' },
  { id: 'pictures', label: 'Pictures', tool: 'editor' },
  { id: 'library', label: 'Shape library', tool: 'editor' },
  { id: 'saving', label: 'Saving', tool: 'editor' },
  { id: 'export', label: 'Export and save as a file', tool: 'editor' },
  { id: 'look', label: 'Background and dark mode', tool: 'editor' },
  { id: 'draw-it', label: 'Draw it for me', tool: 'editor' },
  { id: 'numbers', label: 'Shape numbers', tool: 'editor' },
  { id: 'missed', label: 'What have I missed?', tool: 'editor' },
  { id: 'undo', label: 'Undo and Redo', tool: 'editor' },
  { id: 'arrange', label: 'Select all, fit, stretch and grid', tool: 'editor' },
  { id: 'style', label: 'Sketch and Clean look', tool: 'editor' },
  { id: 'to-notes', label: 'To Notes', tool: 'editor' },
  { id: 'make-plan', label: 'Make a plan', tool: 'editor' },
];
