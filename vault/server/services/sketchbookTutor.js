'use strict';

// The Sketchbook guide (the round button on Vault's /sketchbook page): a person says what they want to do ("draw my idea in blue pen",
// "make the dog bigger", "put the picture in a note") and the guide points at the real controls, in order, or says plainly that Sketchbook
// does not do it. It only knows what is written here and never sees any sketch. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/sketchbook/sketchbookTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/sketchbook.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'list', label: 'Your sketches', group: 'Your sketches',
    does: 'Shows every sketch you have saved, newest change first, each with a small preview, its name, its look (pencil, pen or coloured in), how many changes it has had and when it was last changed. Click a sketch to open it. A card shows an In a note button when the sketch has been put in a note.',
    notes: 'Only your own sketches appear. You can keep up to 200.' },
  { id: 'describe', label: 'Describe a scene', group: 'Your sketches',
    does: 'The Describe a scene box at the top of the page: say (with the microphone) or type a scene, a theory or a possibility, then press Draw it. It is drawn as a cartoon, saved to your collection, and opened straight away. Say who or what is in it and what they are doing; abstract ideas are shown through a simple picture.',
    notes: 'It uses one paid AI image request each time. It makes one picture at a time (no comic strips yet) and cannot keep the same character across pictures. A description over 2,000 characters is refused. If the admin has set content restrictions, a restricted idea is refused with a message and nothing is drawn.' },
  { id: 'looks', label: 'Pencil, pen or coloured in', group: 'Your sketches',
    does: 'Under the description box, choose how the picture is drawn: Pencil (black and grey), Pen (ink in one colour you choose from seven: black, blue, red, green, brown, purple or orange) or Coloured in (outlines filled with colour). Also choose the shape: Wide, Square or Tall.',
    notes: 'These are looks the AI draws. They are not drawing tools you use by hand. The same choices are used when you redraw an existing sketch in a new look.' },
  { id: 'cost', label: 'Cost and the daily limit', group: 'Your sketches',
    does: 'A line beside the Draw it button says what the picture will cost (about 2 to 3 cents) and how much of today\'s limit for AI pictures is left. The limit is shared with Graphics. On a local copy of Vault, pictures are drawn on the computer and are free.',
    notes: 'When the limit is used up, Draw it says so and nothing is drawn; the limit frees up as older pictures pass 24 hours. If the image service fails, nothing is recorded as spent. If a picture was drawn but could not be saved, the message says you may have been charged and to check Usage.' },
  { id: 'search', label: 'Search', group: 'Your sketches',
    does: 'The search box above your sketches narrows the list to sketches whose name or description has all the words you type. The microphone beside it lets you say the words.',
    notes: 'It searches names and the words you described, not what is in the picture.' },
  { id: 'rename', label: 'Rename', group: 'Your sketches',
    does: 'Each sketch has a Rename button in the list: type a new name and press Enter. Inside a sketch, click its name at the top to do the same, and you can say it with the microphone.',
    notes: 'A new sketch is named after the first words of your description until you rename it. A name can be up to 120 characters.' },
  { id: 'copy', label: 'Make a copy', group: 'Your sketches',
    does: 'The Copy button on a sketch makes another sketch with the same picture, named with "(copy)" added. Use it to try a change without risking the original.',
    notes: 'The copy is a separate sketch and starts with no earlier pictures; changing one never changes the other. A copy is not put in any note.' },
  { id: 'delete', label: 'Delete and undo', group: 'Your sketches',
    does: 'The Delete button on a sketch asks "Delete? Yes / No". After Yes the sketch leaves the list and a message appears with an Undo button for a few seconds. Afterwards it stays in the recycle bin in Settings for 30 days, with its earlier pictures, where it can be put back.',
    notes: 'After 30 days a deleted sketch is gone for good. Deleting a sketch does not delete a note it was put in; the picture in the note stays, but the link back no longer works.' },
  { id: 'editor', label: 'One sketch', group: 'One sketch',
    does: 'An opened sketch: the picture large on the left, and on the right the cards for changing it, its look, earlier pictures, saving, and notes. The name at the top can be changed by clicking it, and All sketches goes back to the list.',
    notes: 'Everything is saved already; there is no Save button. If the same sketch is changed in two tabs, the older tab is refused with a message to reload.' },
  { id: 'change', label: 'Change this picture', group: 'One sketch',
    does: 'The Change this picture box: say (with the microphone) or type what to change, for example make the dog bigger, add rain, and give the man a hat, then press Change it. The same picture is changed, not a new one drawn, and you can ask for several things at once. The picture it replaces is kept under Earlier pictures.',
    notes: 'It uses one paid AI image request each time, and a change is not exact: if the result is not what you wanted, use Put back and try different words. A very large change (a whole new scene) is better as a new sketch.' },
  { id: 'relook', label: 'Redraw in another look, or colour it in', group: 'One sketch',
    does: 'The Pencil, pen or colour card: choose Pencil, Pen (and a pen colour) or Coloured in, then press Redraw in this look, and the same picture is redrawn in that look with everything where it was. Colour it in does that for coloured in with one press, no words needed.',
    notes: 'It uses one paid AI image request each time. The earlier look is kept as an earlier picture, so you can go back. Fine details can shift a little when redrawn.' },
  { id: 'earlier', label: 'Earlier pictures', group: 'One sketch',
    does: 'The Earlier pictures card lists the pictures a change replaced, newest first, each with a small preview and the words that replaced it ("Before: add rain"). Click a preview to look at it large, and press Put back to make it the current picture again, with its look. The picture you had before putting back is kept too, so putting back can be undone.',
    notes: 'The last 6 are kept; older ones are dropped as new changes are made. A copy of a sketch starts with none.' },
  { id: 'save', label: 'Save or copy the picture', group: 'One sketch',
    does: 'The Save or share card: the PNG, JPG and WebP buttons save the picture to your computer in that format, and Copy picture copies it so you can paste it into an email, a document or a chat. PNG is the sharpest, JPG is smaller (white background), WebP is smallest.',
    notes: 'Exports go to your computer; they are not sent into Graphics or Chat. For an SVG, a PDF or a print file, save a PNG and open it in Graphics (Vectorize, Print Ready). Copy picture needs a browser that allows copying pictures.' },
  { id: 'to-notes', label: 'To Notes', group: 'One sketch',
    does: 'The To Notes button on the Save or share card makes a new note named after the sketch, attaches the picture and shows it inside the note in Preview, with a link back to the sketch. Choose a project or client first if the note should be filed. Once a sketch is in a note, the same button changes to Go to note (In 2 notes, with a list, when there are several) and takes you straight to the note, and the sketch card in Your sketches shows an In a note button. Put in another note makes a fresh note with the picture as it is now.',
    notes: 'The button finds notes by the link back to the sketch that To Notes writes into them, so a note whose link has been removed, or that has been deleted, no longer counts and the button goes back to To Notes. It makes a new note each time; later changes to the sketch are not copied into an earlier note. The picture is a PNG. In the note\'s Write and Rich views the picture shows as a line like {picture:41}, which should be left as it is. A note you linked by hand with the same link also counts.' },
];

const RULES = [
  'Your sketches is the list and where a new scene is described; one sketch is where it is changed, saved and put in a note. The Describe a scene box and the list controls are on the list; Change this picture, Earlier pictures, Save or share and To Notes are inside an opened sketch.',
  'Sketches are saved by themselves. There is no Save button to press.',
  'Draw it, Change it, Redraw in this look and Colour it in each use one paid AI image request. Say so when someone asks how to do one of these.',
  'Pencil, pen and coloured in are looks the AI draws. They are not hand drawing tools.',
  'Changing a sketch changes the same picture and keeps the one it replaced under Earlier pictures; Put back can bring it back.',
  'Delete asks first and shows an Undo button; a deleted sketch also waits 30 days in the recycle bin in Settings.',
  'Exports (PNG, JPG, WebP, Copy picture) go to the person\'s computer. The only thing that sends a picture anywhere in Vault is To Notes, which puts it in a new note of the person\'s own.',
  'The To Notes button changes with the state: To Notes when the sketch is in no note, Go to note when it is in one, and In N notes with a list when it is in several. Put in another note is always available once it is in a note.',
  'Sketches are private to the person. There is no sharing and no sketching together with other people.',
  'The Open buttons in this chat only switch to a tool (a view of the page); they never draw, change or delete a sketch by themselves.',
];

const NOT_POSSIBLE = [
  'Drawing or painting by hand on the picture (pens, brushes, fill buckets). Pencil, pen and coloured in are looks the AI draws; colour or change a picture by saying what you want.',
  'Several pictures in a row (a comic strip or storyboard), or keeping exactly the same character looking the same across different sketches.',
  'Exact, pixel-precise edits: a change is the AI redrawing the picture, so details can shift. Use Put back if a change is not right.',
  'Adding words, captions or speech bubbles reliably: the AI is told not to draw lettering. Add text in Graphics (Text Overlay) on a saved PNG.',
  'Sending a sketch straight into Graphics or Chat (save a picture and use it there). Putting it in a note is possible with To Notes.',
  'SVG, PDF or print files from inside Sketchbook (save a PNG and use Graphics: Vectorize or Print Ready).',
  'Updating a note when the sketch changes: a note keeps the picture it was given. Use Put in another note for a fresh picture.',
  'Searching inside the picture: search finds names and the words you described only.',
  'Photographs or realistic images: Sketchbook draws cartoons. Use Graphics (Generate) for other kinds of pictures.',
  'Sharing a sketch with other people or a link to it.',
];

const SYSTEM = `You are the guide to Sketchbook in Vault for one person who describes scenes, theories and possibilities and has them drawn as cartoons. They say, in everyday words, what they want to do. You point them to the right view and controls and say plainly when Sketchbook cannot do something.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Sketchbook cannot do.
- You cannot see any sketch, its name, what was described or what is in the picture. Never state or guess what a person's sketches contain, and never draw anything yourself: point at the controls.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about where each control is: the list of sketches, or inside an opened sketch.
- When a step uses an AI image request, say it is one paid request.
- If they ask for something in the list of things Sketchbook does not do, say so plainly and, where the notes allow, suggest the nearest thing that does work (for example, save a PNG and use Graphics).
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Sketchbook guide', feature: 'sketchbook_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'SKETCHBOOK VIEWS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to draw or do, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askSketchbookTutor: guide.ask,
};
