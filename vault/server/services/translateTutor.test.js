'use strict';

// node server/services/translateTutor.test.js   (no npm script on purpose: it would change package.json). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./translateTutor');

checkGuide({
  name: 'translateTutor',
  service,
  askName: 'askTranslateTutor',
  feature: 'translate_guide',
  toolsFile: 'translate/translateTools.mjs',
  menuExport: 'TRANSLATE_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'new',
  exampleStepId: 'open-result',
  facts: [
    ['new', 'notes', /5 MB/, 'the size limit is stated'],
    ['new', 'notes', /page must stay open/, 'the page has to stay open'],
    ['new', 'notes', /\.doc file is refused/, 'old .doc files are refused'],
    ['paste-text', 'does', /Use this text/, 'the button is named as on the page'],
    ['translate-to', 'notes', /One language per job/, 'one language per job'],
    ['translate-to', 'notes', /Iwi \/ rohe audience/, 'the te reo Māori box is named as on the page'],
    ['about-document', 'notes', /Google Translate ignores them/, 'the document questions only apply to Vault AI'],
    ['engine', 'does', /Vault AI \(careful\).*Google Translate \(fast draft\)/s, 'both translators are named as on the page'],
    ['layout', 'does', /The translation only.*Each original page, then its translation/s, 'both layouts are named as on the page'],
    ['layout', 'notes', /does not copy the look/, 'the PDF does not keep the original design'],
    ['second-check', 'notes', /does not correct them/, 'the check does not fix anything'],
    ['estimate', 'notes', /rough/, 'the estimate is rough'],
    ['open-result', 'notes', /not a measured accuracy score/, 'the verdict is not an accuracy score'],
    ['downloads', 'notes', /Download Word is missing when/, 'why the Word download can be missing'],
    ['lessons', 'notes', /future translations only/, 'lessons do not change the finished job'],
    ['jobs', 'notes', /Stopped part-way/, 'an interrupted job is explained'],
    ['learned', 'notes', /match exactly/, 'only exact passages are reused'],
  ],
  gaps: [/look of the original PDF/, /several columns/, /Editing a translation/, /several languages in one go/, /certified or sworn/, /accuracy score/i, /deleted translation back/],
  rules: [/page must stay open/, /future translations only/, /not legally certified/, /never start, cancel or delete/],
  system: [/never translate anything yourself/, /columns or tables/],
  noWords: /\b(LLM|DNT|QA|OCR|HITL|preflight)\b/,
}).then(async (tools) => {
  const assert = require('assert');
  // The option names the guide quotes are the ones the form really shows.
  const engine = service.CATALOG.find((t) => t.id === 'engine').does;
  for (const label of Object.values(tools.ENGINE_LABELS)) assert.ok(engine.includes(label), `the guide names "${label}"`);
  const layout = service.CATALOG.find((t) => t.id === 'layout').does;
  for (const l of tools.LAYOUT_OPTIONS) assert.ok(layout.includes(l.label), `the guide names "${l.label}"`);
  console.log('translateTutor wording matches the form');
}).catch((e) => { console.error(e); process.exit(1); });
