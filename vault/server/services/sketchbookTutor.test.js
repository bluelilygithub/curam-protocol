'use strict';

// node server/services/sketchbookTutor.test.js   No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./sketchbookTutor');

checkGuide({
  name: 'sketchbookTutor',
  service,
  askName: 'askSketchbookTutor',
  feature: 'sketchbook_guide',
  toolsFile: 'sketchbook/sketchbookTools.mjs',
  menuExport: 'SKETCH_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'editor',
  exampleStepId: 'to-notes',
  facts: [
    ['describe', 'does', /microphone/, 'dictation is named'],
    ['describe', 'does', /opened straight away/, 'a new sketch opens at once'],
    ['describe', 'notes', /paid AI image request/, 'the cost is stated'],
    ['describe', 'notes', /content restrictions/, 'restricted ideas are mentioned'],
    ['describe', 'notes', /no comic strips/, 'the comic strip limit is stated'],
    ['looks', 'does', /seven/, 'the seven pen colours are stated'],
    ['looks', 'notes', /not drawing tools you use by hand/, 'pencil and pen are AI looks'],
    ['cost', 'does', /shared with Graphics/, 'the shared limit is stated'],
    ['cost', 'notes', /nothing is recorded as spent/, 'a failed draw is not charged'],
    ['cost', 'notes', /may have been charged/, 'a draw that could not be saved may be charged'],
    ['delete', 'does', /30 days/, 'the recycle bin time is stated'],
    ['delete', 'does', /Undo/, 'delete offers undo'],
    ['delete', 'notes', /does not delete a note/, 'a note is not deleted with the sketch'],
    ['copy', 'notes', /not put in any note/, 'a copy is not in the note'],
    ['change', 'does', /same picture is changed, not a new one/, 'a change keeps the same picture'],
    ['change', 'notes', /not exact/, 'a change is not exact'],
    ['relook', 'does', /Colour it in/, 'colour it in is named'],
    ['earlier', 'does', /Put back/, 'put back is named'],
    ['earlier', 'does', /can be undone/, 'putting back can be undone'],
    ['earlier', 'notes', /last 6/, 'the 6 kept pictures are stated'],
    ['save', 'does', /PNG, JPG and WebP/, 'the formats are named'],
    ['save', 'notes', /not sent into Graphics or Chat/, 'exports do not go into other tools'],
    ['to-notes', 'does', /Go to note/, 'the state after linking is named'],
    ['to-notes', 'does', /In a note button/, 'the list card button is named'],
    ['to-notes', 'does', /Put in another note/, 'a second note is possible'],
    ['to-notes', 'notes', /link back to the sketch/, 'how notes are found is stated'],
    ['to-notes', 'notes', /new note each time/, 'it makes a new note each time'],
  ],
  gaps: [/by hand on the picture/, /comic strip/, /pixel-precise/, /speech bubbles/, /Graphics or Chat/, /SVG, PDF or print/, /Updating a note/, /Searching inside the picture/, /Photographs or realistic/, /Sharing a sketch/],
  rules: [/no Save button/, /one paid AI image request/, /not hand drawing tools/, /Put back can bring it back/, /only thing that sends a picture anywhere in Vault is To Notes/, /Go to note when it is in one/, /private to the person/, /never draw, change or delete/],
  system: [/never draw anything yourself/, /cannot see any sketch/, /one paid request/],
}).catch((e) => { console.error(e); process.exit(1); });
