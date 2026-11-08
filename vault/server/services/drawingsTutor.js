'use strict';

// The Drawings guide (the round button on Vault's /drawings page): a person says what they want to do ("draw a floor plan", "put a
// picture in my drawing", "get my drawing out as a picture") and the guide points at the real controls, in order, or says plainly that
// Drawings does not do it. It only knows what is written here and never sees any drawing. Built on guideCore.js; the ids are the page's
// own, listed in client/src/pages/drawings/drawingsTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/drawings.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'list', label: 'Your diagrams', group: 'Your diagrams',
    does: 'Shows every diagram you have saved, newest change first, each with a small preview, its name, how many pieces it holds and when it was last changed. Click a diagram to open it on the board.',
    notes: 'Only your own diagrams appear. You can keep up to 300.' },
  { id: 'new', label: 'New diagram', group: 'Your diagrams',
    does: 'The New diagram button starts an empty diagram and opens it straight away on the board. It is called "Untitled diagram" until you rename it.',
    notes: 'It is saved as soon as you start diagram.' },
  { id: 'open-file', label: 'Open a file', group: 'Your diagrams',
    does: 'The Open a file button takes a diagram file ending in .excalidraw (from Excalidraw itself, another program, or an earlier export from here) and saves it as a new diagram in your list, named after the file.',
    notes: 'Only Excalidraw diagram files work. A shape library file is refused with a message. A file over 6 MB is refused.' },
  { id: 'search', label: 'Search', group: 'Your diagrams',
    does: 'The search box above the diagrams narrows the list to diagrams whose name has all the words you type. The microphone beside it lets you say the words.',
    notes: 'It searches names only, not what is drawn or written inside a diagram.' },
  { id: 'rename', label: 'Rename', group: 'Your diagrams',
    does: 'Each diagram has a Rename button in the list: type a new name and press Enter. Inside a diagram, the name box at the top does the same, and you can say it with the microphone.',
    notes: 'A name can be up to 120 characters.' },
  { id: 'copy', label: 'Make a copy', group: 'Your diagrams',
    does: 'The Copy button on a diagram makes another diagram with the same pieces, named with "(copy)" added. Use it to try changes without losing the original.',
    notes: 'The copy is a separate diagram; changing one never changes the other.' },
  { id: 'delete', label: 'Delete and undo', group: 'Your diagrams',
    does: 'The Delete button on a diagram asks "Delete? Yes / No". After Yes the diagram leaves the list and a message appears with an Undo button for a few seconds. Afterwards it stays in the recycle bin in Settings for 30 days, where it can be put back.',
    notes: 'After 30 days a deleted diagram is gone for good.' },
  { id: 'editor', label: 'Board', group: 'Board',
    does: 'The diagram itself: an endless page. Tools along the top draw shapes, arrows, lines, text and freehand, and an eraser removes pieces. Click a piece to select it, then change its colour, fill, line style, text size and more in the panel on the left. Undo and redo and zoom are at the bottom left. The page can be moved with the hand tool or by holding the space bar while dragging.',
    notes: 'It is the real Excalidraw editor, in its hand-sketched style. Excalidraw\'s own online features (live sharing, its paid plan, its web links) are not part of Vault.' },
  { id: 'shapes', label: 'Shapes, text and pens', group: 'Board',
    does: 'The tools along the top of the board: select, rectangle, diamond, ellipse, arrow, line, freehand pen, text, picture, and eraser. Each has a one-key shortcut shown beside it. Arrows stick to shapes and move with them, and double-clicking a shape lets you type text inside it.',
    notes: 'Hover a tool to see its shortcut key.' },
  { id: 'pictures', label: 'Pictures', group: 'Board',
    does: 'Put a picture on the page by choosing the picture tool, by pasting one, or by dropping a file onto the page. You can move, resize and rotate it like any other piece.',
    notes: 'A diagram with pictures can pass the 6 MB save limit; the page then says so and the diagram is not saved until a picture is removed or shrunk.' },
  { id: 'library', label: 'Shape library', group: 'Board',
    does: 'The Library button at the top right opens a panel of ready-made shapes and symbols. Click one to add it to the page, or add your own selected pieces to the panel to reuse them.',
    notes: 'Libraries from other people can be added from the Excalidraw libraries website. The library belongs to the browser, not to the diagram.' },
  { id: 'saving', label: 'Saving', group: 'Board',
    does: 'Everything is saved to your account by itself a moment after you stop diagram. The words beside the name say Saving, or "Saved at" with the time. Going back to Your diagrams saves anything still waiting. If a save fails, the diagram stays on screen and the page keeps trying.',
    notes: 'If the same diagram is changed in two tabs, the older tab is refused and asks you to reload, so one tab never overwrites the other without you knowing.' },
  { id: 'export', label: 'Export and save as a file', group: 'Board',
    does: 'The buttons above the board save a PNG picture, an SVG picture, or a .excalidraw file of the whole diagram to your computer. A .excalidraw file can be opened again with Open a file, or in other Excalidraw programs. The Pictures choice beside them shows the PNG and SVG in the same look as the diagram, or in the clean or sketch look, without changing the diagram.',
    notes: 'A picture shows everything on the page, with the page colour behind it. Exports download to your computer; they are not sent into Graphics or Chat (To Notes is the one that puts a picture into a note). The .excalidraw file is always the diagram exactly as it is.' },
  { id: 'draw-it', label: 'Draw it for me', group: 'Board',
    does: 'Draw it for me is in the More tools menu of the board (the last icon in the row of tools along the top of the board, in the Generate section, with the AI tag). Choosing it opens a box where you say (with the microphone) or type a scenario: the steps of a process, who reports to whom, an idea with branches, or things in time order. Press Draw it and the AI works out the boxes, arrows and labels, which are laid out neatly and added to the diagram below anything already there, in the look the diagram is in. One Undo removes the whole diagram. Afterwards a Change it box appears whenever the diagram has a diagram in it (boxes with writing in them, joined by arrows), even one made by hand or on an earlier visit. Say what to change, such as insert a step between two others, add a step at the start or at the end, add a loop back, rename a box or make it left to right, and the diagram is redrawn in the same place with the change made. If there are several diagrams, select a box in the one you mean, otherwise the biggest is used. Boxes you moved by hand in it are laid out again; arrows not joined to boxes, and anything outside the diagram, are left alone. For a step that must wait (a deposit being paid, an approval) say what happens if it has not happened, for example if the deposit is not paid, go back to sending the invoice, and it is drawn as a Yes or No question with the No arrow looping back until it is done.',
    notes: 'It uses one AI request each time, and only the words in the box are sent, never your diagrams. It makes flows (including loops back to an earlier step, drawn round the outside), org charts, mind maps, timelines and relationship diagrams, with two-way arrows where things act on each other, and at most 40 boxes; it cannot draw to scale, so not a floor plan, a map or an illustration. A change replaces the diagram drawn last time, including any edits made to it by hand, and the Change it box only lasts until the diagram is closed. A description over 4,000 characters is refused.' },
  { id: 'numbers', label: 'Shape numbers', group: 'Board',
    does: 'The Numbers button above the board shows a small number on each box, diamond and oval that has writing in it, so you can refer to a shape when asking for a change: add a step after 7, or if 4.1 is no, loop back to 2. A shape gets its number once and keeps it, even if you move it, so a number you have written down stays right. A step put in between two others gets a sub-number of the one before it (put in after 4 it becomes 4.1, the next after 4 becomes 4.2), and anything added at the start or the end, or on its own, takes the next whole number, so nothing else is renumbered. The numbers are only shown on screen: they are not part of the diagram and never appear in PNG, SVG, the file or the picture sent to Notes.',
    notes: 'A copy of a shape gets a new number. A number freed by deleting a shape is not given out again during the same visit, but after the diagram is reopened a deleted shape is gone and its number could be used again. Hand-drawn boxes are numbered once they have writing in them, when numbers are switched on or a change is asked for. Numbers are saved with the diagram.' },
  { id: 'missed', label: 'What have I missed?', group: 'Board',
    does: 'The What have I missed? button in the Draw it for me box asks the AI to look over the diagram and list what you may not have considered, for example a Yes or No question with nowhere to go on one answer, a step that could wait forever, no clear end, or a step nobody is named for. Each suggestion names the shapes it is about by number and may have an Add this button, which makes that change to the diagram (one Undo removes it). Dismiss hides a suggestion. Nothing changes until you press Add this.',
    notes: 'It uses one AI request each time and only the words in the shapes are sent, never a picture. The AI only knows what is drawn plus ordinary common sense for that kind of process, so some suggestions will not apply to your business: it is a prompt for thought, not a check. It lists at most six.' },
  { id: 'undo', label: 'Undo and Redo', group: 'Board',
    does: 'The Undo and Redo arrows at the bottom left of the board (or Ctrl+Z and Ctrl+Shift+Z). You can undo as many steps as you need, back through everything done since the diagram was opened, and redo them again until you make a new change. Drawing, moving, stretching, switching the look and Draw it for me are each one step, so one Undo removes a whole diagram.',
    notes: 'The history belongs to this visit: it starts empty each time a diagram is opened, so changes from an earlier visit cannot be undone.' },
  { id: 'arrange', label: 'Select all, fit, stretch and grid', group: 'Board',
    does: 'Select all, Keep shape and Free are in the top right of the board itself (beside the Library button); Fit to screen and Snap to grid are in the bar above the board. Select all selects every box, arrow and text (Ctrl+A does the same) so you can stretch or move them together. Fit to screen zooms so the whole diagram fills the screen. Keep shape and Free choose what happens when you drag a corner to stretch what is selected (one thing, or everything with a drag box or Select all): Keep shape grows or shrinks it evenly so nothing is squashed, and text and arrows scale with it; Free lets it become wider or taller on its own. Holding Shift while dragging does the opposite for that one drag, and the choice is remembered. For a two-way arrow, click the arrow and in the panel on the left choose an arrowhead for both ends under Arrowheads (Draw it for me makes two-way arrows itself where things act on each other). Snap to grid shows a grid and makes what you draw and move snap to it so boxes line up; it is saved with the diagram.',
    notes: 'The Arrowheads panel appears on the left when an arrow is selected. Keep shape and Free only change stretching by dragging a corner. The grid is the one built into the board, with one fixed spacing.' },
  { id: 'style', label: 'Sketch and Clean look', group: 'Board',
    does: 'The Sketch and Clean buttons above the board switch the whole diagram between the hand-drawn look and a conservative one. Clean gives steady straight lines, square corners, straight arrows, solid fills instead of hatching, a plain font, and Vault\'s own text colour for lines. It is reversible: each piece remembers how it was drawn, so pressing Sketch gives back exactly what was drawn, and Undo works too. New pieces start in the look the diagram is in, and the list shows which look each diagram is in.',
    notes: 'Colours the person chose themselves are kept, and freehand pen strokes and pictures are not changed. Arrows already drawn become straight, not right-angled. The board cannot use Vault\'s own font, so Clean uses a plain built-in one. In a dark Vault theme the line colour is left as it is.' },
  { id: 'to-notes', label: 'To Notes', group: 'Board',
    does: 'The To Notes button above the board (one button for all note jobs) makes a new note named after the diagram, attaches a picture of it and shows that picture inside the note in Preview, with a link back to the diagram. Choose a project or client first if the note should be filed. Once a diagram is in a note, that same button changes to an In a note button (In 2 notes when there are several) and opens a short list: Go to each note, or Put in another note. The diagram card in Your diagrams also shows an In a note button that goes straight to the note. The Pictures choice beside the export buttons says which look the picture has: the same as the diagram, clean, or sketch.',
    notes: 'The In a note state finds notes by the link back to the diagram that To Notes writes into them, so a note whose link has been removed, or that has been deleted, no longer shows. It makes a new note each time; it does not update an earlier note, and later changes to the diagram are not copied into a note. The picture is a PNG. In the note\'s Write and Rich views the picture shows as a line like {picture:41}, which should be left as it is.' },
  { id: 'make-plan', label: 'Make a plan', group: 'Board',
    does: 'The Make a plan button above the board, beside To Notes, turns the diagram into a plan on the Plans page. It only shows when Plans is switched on for the person. Each box with writing in it becomes a step and each arrow means the next step waits for the one before it. A decision (diamond) or an oval that is not a Start becomes a milestone with no length. Press it, then give the start date, the finish-by date and the working days each step takes; a line under the dates says whether the steps fit or by how many working days they run over, and a start date is suggested if only the finish date is given. Create plan makes the plan, links it to the diagram and opens it; the button then says In a plan and lists the plans made from this diagram, with Make another plan.',
    notes: 'Every decision is taken as Yes: the arrows leaving a decision that say No, and any step only reachable through them, are left out unless Include the No branches is ticked. Arrows that loop back to an earlier step are left out and counted, because a plan cannot go in circles. A plain Start oval is dropped. No AI is used and nothing is sent to a model; the lengths are the numbers typed, one working day when left empty. Up to 40 boxes; with several separate diagrams on the board it uses the selected one, or the biggest. Later changes to the diagram are not copied into a plan already made.' },
  { id: 'look', label: 'Background and dark mode', group: 'Board',
    does: 'The menu at the top left of the board (three lines) changes the page colour and switches between light and dark diagram mode, and also has Help and Clear the page.',
    notes: 'Clear the page removes everything from this diagram; undo brings it back straight away.' },
];

const RULES = [
  'Your diagrams is the list; the board is where you draw. New diagram and the list controls are on the list; the tools, the Library button, the Saving words and the Export buttons are on the board.',
  'Diagrams are saved by themselves. There is no Save button to press.',
  'Delete asks first and shows an Undo button; a deleted diagram also waits 30 days in the recycle bin in Settings.',
  'Exports (PNG, SVG, file) go to the person\'s computer. The only thing that sends a picture anywhere is To Notes, which puts it in a new note of the person\'s own.',
  'Sketch and Clean are two looks of the same diagram and can be switched back and forth without losing anything.',
  'Draw it for me sends only the words typed or said into its box to the AI, never any diagram, and uses one AI request each time.',
  'Diagrams are private to the person. There is no sharing and no diagram together with other people.',
  'The Open buttons in this chat only switch to a tool (a view of the page); they never create, change or delete a diagram by themselves.',
];

const NOT_POSSIBLE = [
  'Diagram together with other people at the same time, or sharing a link to a diagram.',
  'Sending a diagram straight into Graphics or Chat (export a picture and use it there). Putting it in a note is possible with To Notes.',
  'Changing the font to Vault\'s own font or to any CSS style: the board has a fixed set of fonts, and the Clean look uses a plain one.',
  'Right-angled arrows on arrows that are already drawn: Clean makes them straight. New arrows can be drawn right-angled with the arrow type choice in the panel on the left.',
  'Drawing to scale or from a picture: Draw it for me makes flows, org charts, mind maps, timelines and relationship diagrams from words, but not a floor plan, a map or an illustration, and it does not read, tidy or improve a diagram you made yourself.',
  'Searching inside what is drawn or written in a diagram: search finds names only.',
  'Opening files from other diagram programs that are not Excalidraw files (for example Visio, Figma or PowerPoint files).',
  'Folders or tags for diagrams: the list is one list, searched by name.',
  'Diagrams with very large pictures: a diagram over 6 MB cannot be saved.',
];

const SYSTEM = `You are the guide to Diagrams in Vault for one person who makes sketches, diagrams and plans on an endless page. They say, in everyday words, what they want to do. You point them to the right view and controls and say plainly when Diagrams cannot do something.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Diagrams cannot do.
- You cannot see any diagram, its name or what is in it. Never state or guess what a person's diagrams contain, and never draw anything yourself: point at the controls.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about where each control is: the list of diagrams, or the board.
- If they ask for something in the list of things Diagrams does not do, say so plainly and, where the notes allow, suggest the nearest thing that does work (for example, export a picture).
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Diagrams guide', feature: 'drawings_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DRAWINGS VIEWS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to draw or do, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDrawingsTutor: guide.ask,
};
