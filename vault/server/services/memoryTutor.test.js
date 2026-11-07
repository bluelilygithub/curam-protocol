'use strict';

// node server/services/memoryTutor.test.js   (the Memory guide). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./memoryTutor');

checkGuide({
  name: 'memoryTutor',
  service,
  askName: 'askMemoryTutor',
  feature: 'memory_guide',
  toolsFile: 'memory/memoryTools.mjs',
  menuExport: 'MEMORY_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'memory',
  exampleStepId: 'add-memory',
  facts: [
    ['memory', 'notes', /Chat reads them but never saves a new one/, 'chat never saves a memory'],
    ['memory', 'notes', /nobody else sees them/, 'memories are private'],
    ['add-memory', 'notes', /cannot edit an existing memory/, 'there is no edit'],
    ['add-memory', 'notes', /kept once/, 'the same words saved twice are kept once'],
    ['search-memory', 'notes', /most recent memories instead of real matches/, 'search falls back to recent memories without an embedding model'],
    ['delete-memory', 'does', /Delete\? Yes \/ No/, 'delete asks Yes / No'],
    ['delete-memory', 'notes', /permanent.*no Undo/, 'delete is permanent'],
    ['memory-mic', 'does', /Add a memory box and of the Search memories box/, 'the mic is on both boxes'],
    ['memory-status', 'notes', /cannot see which/, 'the guide cannot see what is wrong'],
  ],
  gaps: [/Saving a memory from a chat/, /Editing a memory/, /Recovering a deleted memory/, /Sharing memories/, /turning memories off for one chat/, /embedding model/, /cannot see any memory/],
  rules: [/up to 8/, /never saves them/, /permanent/, /no edit button/, /embedding model/, /signed-in person only/],
  system: [/Never state or guess what a memory says/, /Deleting is permanent/, /Chat reads them but never saves them/],
}).catch((e) => { console.error(e); process.exit(1); });
