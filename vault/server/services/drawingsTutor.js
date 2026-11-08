'use strict';

// The Drawings guide (the round button on Vault's /drawings page): a person says what they want to do ("draw a floor plan", "put a
// picture in my drawing", "get my drawing out as a picture") and the guide points at the real controls, in order, or says plainly that
// Drawings does not do it. It only knows what is written here and never sees any drawing. Built on guideCore.js; the ids are the page's
// own, listed in client/src/pages/drawings/drawingsTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/drawings.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'list', label: 'Your drawings', group: 'Your drawings',
    does: 'Shows every drawing you have saved, newest change first, each with a small preview, its name, how many pieces it holds and when it was last changed. Click a drawing to open it on the drawing board.',
    notes: 'Only your own drawings appear. You can keep up to 300.' },
  { id: 'new', label: 'New drawing', group: 'Your drawings',
    does: 'The New drawing button starts an empty drawing and opens it straight away on the drawing board. It is called "Untitled drawing" until you rename it.',
    notes: 'It is saved as soon as you start drawing.' },
  { id: 'open-file', label: 'Open a file', group: 'Your drawings',
    does: 'The Open a file button takes a drawing file ending in .excalidraw (from Excalidraw itself, another program, or an earlier export from here) and saves it as a new drawing in your list, named after the file.',
    notes: 'Only Excalidraw drawing files work. A shape library file is refused with a message. A file over 6 MB is refused.' },
  { id: 'search', label: 'Search', group: 'Your drawings',
    does: 'The search box above the drawings narrows the list to drawings whose name has all the words you type. The microphone beside it lets you say the words.',
    notes: 'It searches names only, not what is drawn or written inside a drawing.' },
  { id: 'rename', label: 'Rename', group: 'Your drawings',
    does: 'Each drawing has a Rename button in the list: type a new name and press Enter. Inside a drawing, the name box at the top does the same, and you can say it with the microphone.',
    notes: 'A name can be up to 120 characters.' },
  { id: 'copy', label: 'Make a copy', group: 'Your drawings',
    does: 'The Copy button on a drawing makes another drawing with the same pieces, named with "(copy)" added. Use it to try changes without losing the original.',
    notes: 'The copy is a separate drawing; changing one never changes the other.' },
  { id: 'delete', label: 'Delete and undo', group: 'Your drawings',
    does: 'The Delete button on a drawing asks "Delete? Yes / No". After Yes the drawing leaves the list and a message appears with an Undo button for a few seconds. Afterwards it stays in the recycle bin in Settings for 30 days, where it can be put back.',
    notes: 'After 30 days a deleted drawing is gone for good.' },
  { id: 'editor', label: 'Drawing board', group: 'Drawing board',
    does: 'The drawing itself: an endless page. Tools along the top draw shapes, arrows, lines, text and freehand, and an eraser removes pieces. Click a piece to select it, then change its colour, fill, line style, text size and more in the panel on the left. Undo and redo and zoom are at the bottom left. The page can be moved with the hand tool or by holding the space bar while dragging.',
    notes: 'It is the real Excalidraw editor, in its hand-sketched style. Excalidraw\'s own online features (live sharing, its paid plan, its web links) are not part of Vault.' },
  { id: 'shapes', label: 'Shapes, text and pens', group: 'Drawing board',
    does: 'The tools along the top of the drawing board: select, rectangle, diamond, ellipse, arrow, line, freehand pen, text, picture, and eraser. Each has a one-key shortcut shown beside it. Arrows stick to shapes and move with them, and double-clicking a shape lets you type text inside it.',
    notes: 'Hover a tool to see its shortcut key.' },
  { id: 'pictures', label: 'Pictures', group: 'Drawing board',
    does: 'Put a picture on the page by choosing the picture tool, by pasting one, or by dropping a file onto the page. You can move, resize and rotate it like any other piece.',
    notes: 'A drawing with pictures can pass the 6 MB save limit; the page then says so and the drawing is not saved until a picture is removed or shrunk.' },
  { id: 'library', label: 'Shape library', group: 'Drawing board',
    does: 'The Library button at the top right opens a panel of ready-made shapes and symbols. Click one to add it to the page, or add your own selected pieces to the panel to reuse them.',
    notes: 'Libraries from other people can be added from the Excalidraw libraries website. The library belongs to the browser, not to the drawing.' },
  { id: 'saving', label: 'Saving', group: 'Drawing board',
    does: 'Everything is saved to your account by itself a moment after you stop drawing. The words beside the name say Saving, or "Saved at" with the time. Going back to Your drawings saves anything still waiting. If a save fails, the drawing stays on screen and the page keeps trying.',
    notes: 'If the same drawing is changed in two tabs, the older tab is refused and asks you to reload, so one tab never overwrites the other without you knowing.' },
  { id: 'export', label: 'Export and save as a file', group: 'Drawing board',
    does: 'The buttons above the drawing board save a PNG picture, an SVG picture, or a .excalidraw file of the whole drawing to your computer. A .excalidraw file can be opened again with Open a file, or in other Excalidraw programs. The Pictures choice beside them shows the PNG and SVG in the same look as the drawing, or in the clean or sketch look, without changing the drawing.',
    notes: 'A picture shows everything on the page, with the page colour behind it. Exports download to your computer; they are not sent into Graphics or Chat (To Notes is the one that puts a picture into a note). The .excalidraw file is always the drawing exactly as it is.' },
  { id: 'style', label: 'Sketch and Clean look', group: 'Drawing board',
    does: 'The Sketch and Clean buttons above the drawing board switch the whole drawing between the hand-drawn look and a conservative one. Clean gives steady straight lines, square corners, straight arrows, solid fills instead of hatching, a plain font, and Vault\'s own text colour for lines. It is reversible: each piece remembers how it was drawn, so pressing Sketch gives back exactly what was drawn, and Undo works too. New pieces start in the look the drawing is in, and the list shows which look each drawing is in.',
    notes: 'Colours the person chose themselves are kept, and freehand pen strokes and pictures are not changed. Arrows already drawn become straight, not right-angled. The drawing board cannot use Vault\'s own font, so Clean uses a plain built-in one. In a dark Vault theme the line colour is left as it is.' },
  { id: 'to-notes', label: 'To Notes', group: 'Drawing board',
    does: 'The To Notes button above the drawing board makes a new note named after the drawing, attaches a picture of it and shows that picture inside the note in Preview, with a link back to the drawing. Choose a project or client first if the note should be filed. The Pictures choice beside the export buttons says which look the picture has: the same as the drawing, clean, or sketch.',
    notes: 'It makes a new note each time; it does not update an earlier note, and later changes to the drawing are not copied into a note. The picture is a PNG. In the note\'s Write and Rich views the picture shows as a line like {picture:41}, which should be left as it is.' },
  { id: 'look', label: 'Background and dark mode', group: 'Drawing board',
    does: 'The menu at the top left of the drawing board (three lines) changes the page colour and switches between light and dark drawing mode, and also has Help and Clear the page.',
    notes: 'Clear the page removes everything from this drawing; undo brings it back straight away.' },
];

const RULES = [
  'Your drawings is the list; the drawing board is where you draw. New drawing and the list controls are on the list; the tools, the Library button, the Saving words and the Export buttons are on the drawing board.',
  'Drawings are saved by themselves. There is no Save button to press.',
  'Delete asks first and shows an Undo button; a deleted drawing also waits 30 days in the recycle bin in Settings.',
  'Exports (PNG, SVG, file) go to the person\'s computer. The only thing that sends a picture anywhere is To Notes, which puts it in a new note of the person\'s own.',
  'Sketch and Clean are two looks of the same drawing and can be switched back and forth without losing anything.',
  'Drawings are private to the person. There is no sharing and no drawing together with other people.',
  'The Open buttons in this chat only switch to a tool (a view of the page); they never create, change or delete a drawing by themselves.',
];

const NOT_POSSIBLE = [
  'Drawing together with other people at the same time, or sharing a link to a drawing.',
  'Sending a drawing straight into Graphics or Chat (export a picture and use it there). Putting it in a note is possible with To Notes.',
  'Changing the font to Vault\'s own font or to any CSS style: the drawing board has a fixed set of fonts, and the Clean look uses a plain one.',
  'Right-angled arrows on arrows that are already drawn: Clean makes them straight. New arrows can be drawn right-angled with the arrow type choice in the panel on the left.',
  'Making a drawing from a description in words, or having the AI draw or tidy a diagram.',
  'Searching inside what is drawn or written in a drawing: search finds names only.',
  'Opening files from other drawing programs that are not Excalidraw files (for example Visio, Figma or PowerPoint files).',
  'Folders or tags for drawings: the list is one list, searched by name.',
  'Drawings with very large pictures: a drawing over 6 MB cannot be saved.',
];

const SYSTEM = `You are the guide to Drawings in Vault for one person who makes sketches, diagrams and plans on an endless drawing page. They say, in everyday words, what they want to do. You point them to the right view and controls and say plainly when Drawings cannot do something.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Drawings cannot do.
- You cannot see any drawing, its name or what is in it. Never state or guess what a person's drawings contain, and never draw anything yourself: point at the controls.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about where each control is: the list of drawings, or the drawing board.
- If they ask for something in the list of things Drawings does not do, say so plainly and, where the notes allow, suggest the nearest thing that does work (for example, export a picture).
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Drawings guide', feature: 'drawings_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DRAWINGS VIEWS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to draw or do, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDrawingsTutor: guide.ask,
};
