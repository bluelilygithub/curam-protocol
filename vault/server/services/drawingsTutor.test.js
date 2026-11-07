'use strict';

// node server/services/drawingsTutor.test.js   No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./drawingsTutor');

checkGuide({
  name: 'drawingsTutor',
  service,
  askName: 'askDrawingsTutor',
  feature: 'drawings_guide',
  toolsFile: 'drawings/drawingsTools.mjs',
  menuExport: 'DRAWING_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'editor',
  exampleStepId: 'export',
  facts: [
    ['new', 'does', /opens it straight away/, 'a new drawing opens at once'],
    ['open-file', 'does', /\.excalidraw/, 'the file type is named'],
    ['open-file', 'notes', /6 MB/, 'the size limit is stated'],
    ['search', 'notes', /names only/, 'search covers names only'],
    ['delete', 'does', /Undo/, 'delete offers undo'],
    ['delete', 'does', /30 days/, 'the recycle bin time is stated'],
    ['saving', 'does', /by itself/, 'saving is automatic'],
    ['saving', 'notes', /another tab|two tabs/, 'the two-tab guard is explained'],
    ['export', 'does', /PNG.*SVG/s, 'both picture exports are named'],
    ['export', 'notes', /not sent into Graphics, Notes or Chat/, 'exports do not go into other tools'],
    ['pictures', 'notes', /6 MB/, 'the size limit is stated for pictures'],
  ],
  gaps: [/other people at the same time/, /Graphics, Notes or Chat/, /description in words/, /Searching inside/, /Visio/, /Folders or tags/, /over 6 MB/],
  rules: [/no Save button/, /private to the person/, /never create, change or delete/],
  system: [/never draw anything yourself/, /cannot see any drawing/],
}).catch((e) => { console.error(e); process.exit(1); });
