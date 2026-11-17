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
  Translate: 'Translate a document, read it beside the original, change it with more passes, keep it, and find it again with its downloads.',
  Wording: 'The words Translate must always use, and what it has picked up from your earlier translations.',
};

export const TOOL_TIPS = {
  new: 'Translate a PDF, Word, Excel or text file, or text you paste, into one language or several. Pick the language, say a little about the document, and press Start translation.',
  jobs: 'Every translation you have run: the ones waiting for you to read, the ones kept with their downloads, and the ones still running.',
  glossaries: 'Lists of words that must always be translated the same way, or never translated (brand names, product codes). One learned list per language is built for you.',
  learned: 'The rules and wording Translate has picked up from your earlier translations, and how much wording it now reuses.',
};

// One short line shown at the top of the open screen.
export const TOOL_BLURBS = {
  new: 'Add your document, pick the language, press Start translation. It runs on the server, so you can carry on or close the page.',
  jobs: 'Your translations, newest first. Open one to read it beside the original, run another pass, keep it, and download it.',
  glossaries: 'Words that must always be translated the same way, or left as they are.',
  learned: 'What Translate has picked up from your earlier translations.',
};

// The longer text for the (i) "How Translate works" box.
export const HOW_IT_WORKS = [
  ['What you can translate', 'A PDF, a Word file (.docx), an Excel file (.xlsx or .xls), a plain text file, or text you paste (you can show it and change it before you start). Up to 5 MB. Scanned PDF pages are read with text recognition first. Old .doc files are not accepted: save them as .docx.'],
  ['One language or several', 'Pick the language under Translate to. To make more at once, pick them under Also translate into: each language becomes its own translation, and the document is read only once.'],
  ['Two ways to translate', 'Vault AI is the careful one: it reads what you say about the document, keeps your must-keep words, and can be checked by a second AI model. It takes a few minutes. Google Translate is the fast one, for a draft you only need to understand. It is only offered when it has been set up for this workspace.'],
  ['It carries on without you', 'The whole translation runs on the server, the PDF too. You can keep working or close the page; it appears in My translations, and a message says when it is ready.'],
  ['Read it, change it, then keep it', 'A finished translation waits as a draft. Open it to read each part beside the original, with the parts the checks are about marked. If something needs changing, add a requirement (a rule in your own words, or a word to translate one way or keep as written) and run another pass, over the whole document or only the parts you pick. Earlier versions stay readable. Press Keep this version when you are happy: only then are the files made and anything you ticked to remember saved for future translations. Untick “Let me read it before it is kept” to skip this.'],
  ['What you get back', 'Once kept: a PDF of the translation, or a PDF with each original page followed by its translation. A Word or Excel file comes back as an editable Word or Excel file too, when its structure allows. You can also download the plain text, the original, and a report of what the checks found, or email them.'],
  ['The checks', 'Every translation is checked for missing, empty and cut-short parts. With the second-model check on, another AI model compares each part with the original and lists anything that looks wrong: changed meaning, unsure terms, garbled rows. The checks find problems; they do not fix them. A pass with your requirements is how you fix them.'],
  ['Glossaries', 'A glossary is a list of words with the translation they must always get, or a mark to leave them as they are. Translate keeps one learned glossary per language and adds to it each time you keep a translation, so the same word is translated the same way next time. You can edit it, or make your own.'],
  ['How long they are kept', 'My translations keeps them for 90 days unless you choose 1 year or Until I delete them (at the top of the list). A deleted translation or glossary waits in the recycle bin (Settings, Recycle bin) for 30 days.'],
  ['What it does not do', 'It does not keep the look of the original PDF (fonts, columns, pictures): you get the words, in order. PDFs with several columns or tables can be read in the wrong order, which spoils the translation, so check those carefully. You cannot type changes into a translation here: ask for them with a requirement and another pass, or edit the Word, Excel or plain text download. Translations are not legally certified.'],
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
  { id: 'also-translate', label: 'Also translate into', tool: 'new' },
  { id: 'about-document', label: 'About the document', tool: 'new' },
  { id: 'must-keep', label: 'Words to keep as they are', tool: 'new' },
  { id: 'engine', label: 'Translated by', tool: 'new' },
  { id: 'layout', label: 'PDF layout', tool: 'new' },
  { id: 'glossary-choice', label: 'Glossary', tool: 'new' },
  { id: 'second-check', label: 'Second-model check', tool: 'new' },
  { id: 'read-first', label: 'Let me read it before it is kept', tool: 'new' },
  { id: 'estimate', label: 'Get estimate', tool: 'new' },
  { id: 'jobs', label: 'My translations', tool: 'jobs' },
  { id: 'keep-time', label: 'Translations are kept for', tool: 'jobs' },
  { id: 'open-result', label: 'Open result', tool: 'jobs' },
  { id: 'another-pass', label: 'Another pass', tool: 'jobs' },
  { id: 'versions', label: 'Version', tool: 'jobs' },
  { id: 'keep-version', label: 'Keep this version', tool: 'jobs' },
  { id: 'reopen', label: 'Reopen as a draft', tool: 'jobs' },
  { id: 'downloads', label: 'Downloads', tool: 'jobs' },
  { id: 'email-documents', label: 'Email these documents', tool: 'jobs' },
  { id: 'lessons', label: 'Lessons learnt', tool: 'jobs' },
  { id: 'glossaries', label: 'Glossaries', tool: 'glossaries' },
  { id: 'learned', label: 'What it has learned', tool: 'learned' },
];
