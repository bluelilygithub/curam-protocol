'use strict';

// The Translate guide (the round button on Vault's /translate page): a person says what they want to do ("translate this contract into
// French", "why is Download Word missing", "make it always say X for Y") and the guide points at the real screens and controls, in
// order, or says plainly that Translate does not do it. It only knows what is written here and it never sees any document, translation
// or result. Built on guideCore.js; the ids are the page's own, listed in client/src/pages/translate/translateTools.mjs (a test keeps
// the two in step). See docs/guide-chat.md and docs/translate-agent.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'new', label: 'New translation', group: 'Translate',
    does: 'Drop a file on the box (or click it to choose one), pick the language under "Translate to", say a little about the document, and press Start translation. A window shows the steps while it runs: reading the document, reading scanned pages, preparing the wording, translating, checking, and making the PDF. When it finishes the job is in My translations.',
    notes: 'Takes a PDF, a Word file (.docx), an Excel file (.xlsx or .xls) or a plain text file (.txt), up to 5 MB. An old .doc file is refused: save it as .docx first. The page must stay open until the job finishes, because the PDF is made in the browser at the end; closing or reloading the page stops the job part-way and it has to be run again. The window that shows the steps has a Cancel button.' },
  { id: 'paste-text', label: 'Paste text instead', group: 'Translate',
    does: 'On New translation, press "Paste text instead" above the file box. Paste or dictate the text, press Use this text, then carry on as for a file: pick the language and press Start translation.',
    notes: 'The pasted text is treated as a plain text file, so the result is a PDF and a plain text download; there is no Word or Excel file for it.' },
  { id: 'translate-to', label: 'Translate to', group: 'Translate',
    does: 'The "Translate to" list on New translation chooses the language for this one job. It starts on the workspace\'s usual language, which is set in Settings, AI & Chat, Translate agent. The language of the original is worked out automatically.',
    notes: 'One language per job: for two languages, run the document twice. Languages marked with a warning sign (te reo Māori, Irish, Afrikaans) have fewer examples for the AI to learn from, so expect lower quality and check the result more carefully. Choosing te reo Māori shows an extra box, "Iwi / rohe audience": leave it empty for standard te reo Māori, or name the audience and any regional word choices are listed in the result.' },
  { id: 'about-document', label: 'About the document', group: 'Translate',
    does: 'Three lists on New translation tell the careful translator what it is working on: Kind of document (legal, finance, medical, general business and so on), Who will read it (a client, an auditor, an insurer, your own team), and Style (natural, or close to the original wording). "Notes for the translator" takes anything else in your own words, typed or spoken.',
    notes: 'These only apply to Vault AI; Google Translate ignores them, so they are hidden when it is chosen.' },
  { id: 'must-keep', label: 'Words to keep as they are', group: 'Translate',
    does: 'In the box "Words to keep as they are" on New translation, type or say brand names, product codes and abbreviations with commas between them. They are left exactly as written in the translation.',
    notes: 'This is for one job. For words that should be kept or translated one way in every job, add them to a glossary instead.' },
  { id: 'engine', label: 'Translated by', group: 'Translate',
    does: 'Under More options on New translation, "Translated by" chooses between Vault AI (careful) and Google Translate (fast draft). Vault AI reads what you said about the document, uses the glossary and can be checked by a second model; it takes a few minutes. Google Translate takes seconds and suits a draft in a common language.',
    notes: 'Google Translate is only offered when it has been set up for the workspace; otherwise it shows as "not set up". Which AI model Vault AI uses is chosen once in Settings, AI & Chat, Translate agent, not per job.' },
  { id: 'layout', label: 'PDF layout', group: 'Translate',
    does: 'Under More options on New translation, "PDF layout" chooses what the PDF holds: "The translation only", or "Each original page, then its translation" for checking one against the other.',
    notes: 'The PDF holds the words in order with plain styling. It does not copy the look of the original (fonts, columns, pictures). Every page carries a line saying the translation is for reference and is not legally certified.' },
  { id: 'glossary-choice', label: 'Glossary', group: 'Translate',
    does: 'Under More options on New translation, the tick box "Use and add to the learned glossary" is on by default: the job uses the words Translate has already learned for that language and adds this job\'s new terms afterwards. Untick it to choose one of your own glossaries from the list instead.',
    notes: 'It is one or the other for a job: the learned glossary, or one glossary you pick, or none.' },
  { id: 'second-check', label: 'Second-model check', group: 'Translate',
    does: 'Under More options on New translation, the tick box "Have a second AI model check the translation" makes another model compare every part with the original and list what looks wrong: changed meaning, unsure terms, garbled or unfinished rows, wording that does not suit the reader.',
    notes: 'It finds problems; it does not correct them. It adds time. Checks for empty, missing and cut-short parts always run, with or without this tick. It is off by default for Google Translate.' },
  { id: 'estimate', label: 'Get estimate', group: 'Translate',
    does: 'After adding a file on New translation, press Get estimate to see how many characters the document has and a rough cost in Australian dollars before starting.',
    notes: 'It is a rough figure. The real cost changes with the size of the glossary and whether the second check runs.' },
  { id: 'jobs', label: 'My translations', group: 'Translate',
    does: 'Lists every translation you have run, newest first. The boxes at the top count how many are ready, how many need checking, how many are still running and how many did not finish; press one to show only those. The search box finds a job by file name. Each row has Open result, and Delete.',
    notes: 'A job marked "Stopped part-way" was interrupted, usually because the page was closed while it ran: cancel it and run the document again. Delete removes the job and its files for good; it asks first.' },
  { id: 'open-result', label: 'Open result', group: 'Translate',
    does: 'On a row in My translations, press Open result. The window has the downloads at the top, then one line saying whether the checks found anything, then the list of what to look at: parts whose meaning may have changed, unsure terms, garbled or unfinished rows, and wording that may not suit the reader.',
    notes: 'The verdict ("No problems found", "Worth a look", "Needs checking") is worked out from which kinds of problem the checks listed. It is a guide to where to look, not a measured accuracy score, and a clean result is not proof the translation is right.' },
  { id: 'downloads', label: 'Downloads', group: 'Translate',
    does: 'At the top of a job\'s result: Download translated PDF, Download plain text (the translation only), Download Word or Download Excel (when the original was a Word or Excel file and the editable copy could be built), Download original (the file you gave it, untouched) and Download check report (a text file of what the checks found).',
    notes: 'Download Word is missing when the original was a PDF, a text file or pasted text, or when the Word file\'s structure (text boxes, tables inside tables) could not be matched up; the PDF and plain text are still there. In Excel only cells with words are translated; numbers and their formatting are left alone.' },
  { id: 'email-documents', label: 'Email these documents', group: 'Translate',
    does: 'In a job\'s result, press Email these documents, type the address and press Send. The original, the translated PDF and the check report are sent as attachments, whichever of them exist for the job.',
    notes: 'Nothing is sent until Send is pressed.' },
  { id: 'lessons', label: 'Lessons learnt', group: 'Translate',
    does: 'In a job\'s result, press Lessons learnt. It turns what the checks found into a tick list: a rule for every future job, a word to always leave as it is, or a word to always translate one way. Tick the ones you agree with and press Apply selected.',
    notes: 'Applying changes future translations only. The job you are looking at stays as it is: run the document again to see the difference. Everything applied is listed under What it has learned.' },
  { id: 'glossaries', label: 'Glossaries', group: 'Wording',
    does: 'Lists your glossaries. Press New glossary, give it a name, and add rows: the word as it appears in the original, how it must be translated, or a tick under "Keep as is" to leave it untranslated. Open a glossary to change or remove rows. The ones marked "Learned" are built by Translate itself, one per language, and can be edited the same way.',
    notes: 'Changes apply from the next translation. Deleting a glossary cannot be undone.' },
  { id: 'learned', label: 'What it has learned', group: 'Wording',
    does: 'Shows two things. First, every rule and word applied from Lessons learnt, newest first, with the date and the job it came from; filter it by rules for all languages or by one language. Second, how many translated passages Translate has stored for each pair of languages and how often it has reused them: a passage that appears again word for word is given the same translation as last time. Download translation memory saves those passages as a TMX file for other translation software.',
    notes: 'This screen shows what was learned; to change a learned word, edit the learned glossary under Glossaries. Only passages that match exactly are reused.' },
];

const RULES = [
  'Start from the list on the left: New translation to translate something, My translations for results and downloads, Glossaries for fixed wording, What it has learned for the history of that wording. "What do you want to do?" at the top of the list offers ready-made jobs that fill in the options.',
  'A translation needs a file or pasted text, and a language. Everything else has a sensible starting value.',
  'The page must stay open while a translation runs. The PDF is made in the browser at the end, so closing or reloading the page stops the job part-way.',
  'The checks list problems for a person to read. Nothing in Translate corrects a translation or lets it be edited; the Word, Excel and plain text downloads can be edited in other programs.',
  'Lessons learnt and glossaries change future translations only, never one that is already finished.',
  'The boxes for must-keep words, notes, pasted text and the iwi / rohe audience have a microphone button.',
  'Translations are for reference and are not legally certified; the PDF says so on every page.',
  'The Open buttons in this chat only switch to a tool (a screen of the page); they never start, cancel or delete a translation by themselves.',
];

const NOT_POSSIBLE = [
  'Keeping the look of the original PDF: fonts, columns, pictures and page design are not copied, only the words in order.',
  'Reading PDFs with several columns, side tabs or tables reliably: the text can be read in the wrong order, which spoils the translation without any warning. Check those against the original, or give it the Word or Excel file instead.',
  'Editing a translation inside Translate, or re-running one part of it. Download the Word, Excel or plain text file and edit that.',
  'Running a finished job again with one click: add the document again on New translation.',
  'Translating one document into several languages in one go: run it once per language.',
  'Files over 5 MB, old .doc files, PowerPoint, pictures (JPG, PNG) and web pages. Scanned pages must be inside a PDF.',
  'A certified or sworn translation for a court, an immigration office or a regulator: that needs a qualified human translator.',
  'An accuracy score. The verdict on a result says which kinds of problem the checks listed, not how accurate the translation is.',
  'Carrying on a job after the page was closed: it has to be run again.',
  'Getting a deleted translation back: deleting a job removes it for good.',
  'Translating speech or a live conversation, or files straight from Google Drive (download them as Word or Excel first).',
];

const SYSTEM = `You are the guide to Translate in Vault for one person who wants a document or some text translated into another language. They say, in everyday words, what they want to do. You point them to the right screen(s) and controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Translate cannot do.
- You cannot see any document, translation or result. Never state or guess what is in them, and never translate anything yourself in place of the tool: point at the tool.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about which translator fits: Vault AI for anything that will be sent to someone or must be right, Google Translate for a fast draft to read yourself.
- If the document matters (a contract, a safety or medical text, anything for a regulator), say that the checks only list problems and that a person who reads both languages should check it.
- If they mention a PDF with columns or tables, warn them it can be read in the wrong order and suggest the Word or Excel file if they have it.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Translate guide', feature: 'translate_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'TRANSLATE SCREENS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to translate or find, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askTranslateTutor: guide.ask,
};
