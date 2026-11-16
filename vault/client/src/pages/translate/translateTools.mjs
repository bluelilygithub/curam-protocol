// What the Translate page shows in its left-hand list, the hover text for it, the wording of its options, and the controls its guide
// (the round button) can point at. The ids are the guide's catalogue (server/services/translateTutor.js);
// `node server/services/translateTutor.test.js` fails if the two lists drift apart. `tool` is the screen the guide's Open button shows.

export const TRANSLATE_TOOLS = [
  { id: 'new', label: 'New translation', group: 'Translate', icon: 'languages', tour: 'translate-tool-new' },
  { id: 'jobs', label: 'My translations', group: 'Translate', icon: 'list', tour: 'translate-tool-jobs' },
  { id: 'glossaries', label: 'Glossaries', group: 'Wording', icon: 'book', tour: 'translate-tool-glossaries' },
  { id: 'learned', label: 'What it has learned', group: 'Wording', icon: 'lightbulb', tour: 'translate-tool-learned' },
];

export const GROUPS = ['Translate', 'Wording'];

export const GROUP_TIPS = {
  Translate: 'Translate a document, then find it again with its downloads and what the checks found.',
  Wording: 'The words Translate must always use, and what it has picked up from your earlier translations.',
};

export const TOOL_TIPS = {
  new: 'Translate a PDF, Word, Excel or text file, or text you paste. Pick the language, say a little about the document, and press Start translation.',
  jobs: 'Every translation you have run: how many are ready, which ones need checking, and the downloads for each.',
  glossaries: 'Lists of words that must always be translated the same way, or never translated (brand names, product codes). One learned list per language is built for you.',
  learned: 'The rules and wording Translate has picked up from the checks on your earlier translations, and how much wording it now reuses.',
};

// One short line shown at the top of the open screen.
export const TOOL_BLURBS = {
  new: 'Add your document, pick the language, press Start translation. Keep this page open until it finishes.',
  jobs: 'Your translations, newest first. Open one for its downloads and what the checks found.',
  glossaries: 'Words that must always be translated the same way, or left as they are.',
  learned: 'What Translate has picked up from your earlier translations.',
};

// The longer text for the (i) "How Translate works" box.
export const HOW_IT_WORKS = [
  ['What you can translate', 'A PDF, a Word file (.docx), an Excel file (.xlsx or .xls), a plain text file, or text you paste. Up to 5 MB. Scanned PDF pages are read with text recognition first. Old .doc files are not accepted: save them as .docx.'],
  ['Two ways to translate', 'Vault AI is the careful one: it reads what you say about the document, keeps your must-keep words, and can be checked by a second AI model. It takes a few minutes. Google Translate is the fast one, for a draft you only need to understand. It is only offered when it has been set up for this workspace.'],
  ['What you get back', 'A PDF of the translation, or a PDF with each original page followed by its translation. A Word or Excel file comes back as an editable Word or Excel file too, when its structure allows. You can also download the plain text, the original, and a report of what the checks found, or email them.'],
  ['The checks', 'Every translation is checked for missing, empty and cut-short parts. With the second-model check on, another AI model compares each part with the original and lists anything that looks wrong: changed meaning, unsure terms, garbled rows. The checks find problems; they do not fix them. Read the list before you rely on the translation.'],
  ['Glossaries', 'A glossary is a list of words with the translation they must always get, or a mark to leave them as they are. Translate keeps one learned glossary per language and adds to it after every job, so the same word is translated the same way next time. You can edit it, or make your own.'],
  ['Keep the page open', 'The PDF is put together in your browser at the end. If you close or reload the page while a translation runs, it stops part-way and has to be run again.'],
  ['What it does not do', 'It does not keep the look of the original PDF (fonts, columns, pictures): you get the words, in order. PDFs with several columns or tables can be read in the wrong order, which spoils the translation, so check those carefully. You cannot edit a translation here. Translations are not legally certified.'],
];

// The words the page uses for each choice; the guide's catalogue uses the same names.
export const ENGINE_LABELS = { llm: 'Vault AI (careful)', google: 'Google Translate (fast draft)' };
export const LAYOUT_OPTIONS = [
  { v: 'translation-only', label: 'The translation only' },
  { v: 'bilingual-pages', label: 'Each original page, then its translation' },
];

// Everything the guide can point at: the four screens plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'new', label: 'New translation', tool: 'new' },
  { id: 'paste-text', label: 'Paste text instead', tool: 'new' },
  { id: 'translate-to', label: 'Translate to', tool: 'new' },
  { id: 'about-document', label: 'About the document', tool: 'new' },
  { id: 'must-keep', label: 'Words to keep as they are', tool: 'new' },
  { id: 'engine', label: 'Translated by', tool: 'new' },
  { id: 'layout', label: 'PDF layout', tool: 'new' },
  { id: 'glossary-choice', label: 'Glossary', tool: 'new' },
  { id: 'second-check', label: 'Second-model check', tool: 'new' },
  { id: 'estimate', label: 'Get estimate', tool: 'new' },
  { id: 'jobs', label: 'My translations', tool: 'jobs' },
  { id: 'open-result', label: 'Open result', tool: 'jobs' },
  { id: 'downloads', label: 'Downloads', tool: 'jobs' },
  { id: 'email-documents', label: 'Email these documents', tool: 'jobs' },
  { id: 'lessons', label: 'Lessons learnt', tool: 'jobs' },
  { id: 'glossaries', label: 'Glossaries', tool: 'glossaries' },
  { id: 'learned', label: 'What it has learned', tool: 'learned' },
];
