// The "What do you want to do?" job screen for Translate (shared screen: components/JobStart.jsx). Each job is DATA: a title in plain
// words, ordered steps (each naming a real screen id from TRANSLATE_TOOLS and one line on what to do there) and a `preset`: the
// choices New translation is filled in with, so the person does not have to work out the options. Every preset value can still be
// changed on the form.
//
//   node client/src/pages/translate/translateGoals.test.mjs   (checks every step names a real screen and every preset is valid)
//
// preset keys: engine 'llm' | 'google' (google falls back to llm when it is not set up), review true|false,
// layout 'translation-only' | 'bilingual-pages', paste true (open on the paste box), targetLang (a language code),
// reviewBeforeKeep false (kept straight away instead of waiting as a draft to read; on unless a job says otherwise).

export const TRANSLATE_GOALS = [
  {
    id: 'draft',
    title: 'Get a quick draft to understand a document',
    blurb: 'Fast and rough. For reading something yourself, not for sending on.',
    icon: 'zap',
    preset: { engine: 'google', review: false, layout: 'translation-only', reviewBeforeKeep: false },
    steps: [
      { tool: 'new', note: 'Add the document and pick the language. This job uses the fast translator, skips the second check and is kept straight away.' },
      { tool: 'jobs', note: 'Open the result to read it beside the original, or download the PDF or the plain text.' },
    ],
  },
  {
    id: 'client',
    title: 'Translate a document to send to someone',
    blurb: 'The careful translator, checked by a second AI model. Takes a few minutes.',
    icon: 'check-circle',
    preset: { engine: 'llm', review: true, layout: 'translation-only' },
    steps: [
      { tool: 'new', note: 'Add the document, pick the language, and say what kind of document it is and who will read it.' },
      { tool: 'jobs', note: 'Open the result and read it beside the original. If something needs changing, add a requirement and run another pass. Then press Keep this version and download.' },
    ],
  },
  {
    id: 'compare',
    title: 'Check a translation against the original',
    blurb: 'A PDF with each original page followed by its translation.',
    icon: 'columns',
    preset: { engine: 'llm', review: true, layout: 'bilingual-pages' },
    steps: [
      { tool: 'new', note: 'Add the document and pick the language. The PDF will show each original page, then its translation.' },
      { tool: 'jobs', note: 'Open the result: each part sits beside its original, and the parts the checks are about are marked. Keep it to get the PDF.' },
    ],
  },
  {
    id: 'office',
    title: 'Translate a Word or Excel file and keep it editable',
    blurb: 'You get a Word or Excel file back as well as the PDF.',
    icon: 'file-pen',
    preset: { engine: 'llm', review: true, layout: 'translation-only' },
    steps: [
      { tool: 'new', note: 'Add a .docx or .xlsx file. In Excel only cells with words are translated; numbers are left alone.' },
      { tool: 'jobs', note: 'Read it, keep it, and Download Word or Download Excel appears when the editable file could be built.' },
    ],
  },
  {
    id: 'scan',
    title: 'Translate a scanned PDF',
    blurb: 'Pages that are pictures of text are read first, then translated.',
    icon: 'scan-text',
    preset: { engine: 'llm', review: true, layout: 'bilingual-pages' },
    steps: [
      { tool: 'new', note: 'Add the scanned PDF. It tells you how many pages need reading as pictures; those take longer.' },
      { tool: 'jobs', note: 'Open the result and check the pages that were hard to read against the original before you keep it.' },
    ],
  },
  {
    id: 'maori',
    title: 'Translate into te reo Māori',
    blurb: 'Standard te reo Māori by default, or wording for an iwi or rohe you name.',
    icon: 'languages',
    preset: { engine: 'llm', review: true, layout: 'translation-only', targetLang: 'mi' },
    steps: [
      { tool: 'new', note: 'Add the document. Leave "Iwi / rohe audience" empty for standard te reo Māori.' },
      { tool: 'jobs', note: 'Open the result; any regional word choices are listed beside the standard form. A pass with a word requirement changes one you do not want.' },
    ],
  },
  {
    id: 'paste',
    title: 'Translate some text I paste in',
    blurb: 'An email, a paragraph, a message. No file needed.',
    icon: 'file-text',
    preset: { engine: 'llm', review: false, layout: 'translation-only', paste: true },
    steps: [
      { tool: 'new', note: 'Paste or dictate the text, press Use this text, then pick the language.' },
      { tool: 'jobs', note: 'Open the result to read it, or press Copy translation. Keep it to download the plain text.' },
    ],
  },
  {
    id: 'repeat',
    title: 'Set up a kind of document I translate often',
    blurb: 'Fix the wording once so every later translation uses it.',
    icon: 'repeat',
    preset: { engine: 'llm', review: true, layout: 'translation-only' },
    steps: [
      { tool: 'glossaries', note: 'Make a glossary: the words that must always be translated one way, or left as they are.' },
      { tool: 'new', note: 'Add the document. Under More options, untick the learned glossary and pick yours.' },
      { tool: 'jobs', note: 'Open the result. Add requirements for what should be different and tick Remember on the ones for every time, then keep it.' },
    ],
  },
  {
    id: 'several',
    title: 'Translate one document into several languages',
    blurb: 'Pick them all at once. The document is read only once; each language gets its own result.',
    icon: 'languages',
    preset: { engine: 'llm', review: true, layout: 'translation-only' },
    steps: [
      { tool: 'new', note: 'Add the document, pick the first language under Translate to, then press the others under Also translate into.' },
      { tool: 'jobs', note: 'Each language is its own row. A message says as each one is ready; read and keep them one by one.' },
    ],
  },
];

/** The preset as it can really run here: Google falls back to Vault AI when Google Translate is not set up. */
export function resolvePreset(preset, availability) {
  const p = { ...(preset || {}) };
  if (p.engine === 'google' && !availability?.google) { p.engine = 'llm'; p.fellBack = true; }
  if (p.engine === 'llm' && !availability?.llm && availability?.google) { p.engine = 'google'; p.review = false; p.fellBack = true; }
  return p;
}
