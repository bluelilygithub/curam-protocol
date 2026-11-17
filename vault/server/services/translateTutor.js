'use strict';

// The Translate guide (the round button on Vault's /translate page): a person says what they want to do ("translate this contract into
// French", "why is Download Word missing", "make it always say X for Y") and the guide points at the real screens and controls, in
// order, or says plainly that Translate does not do it. It only knows what is written here and it never sees any document, translation
// or result. Built on guideCore.js; the ids are the page's own, listed in client/src/pages/translate/translateTools.mjs (a test keeps
// the two in step). See docs/guide-chat.md and docs/translate-agent.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'new', label: 'New translation', group: 'Translate',
    does: 'Drop a file on the box (or click it to choose one), pick the language under "Translate to", say a little about the document, and press Start translation. It goes to My translations and runs there; a message says when it is ready to read.',
    notes: 'Takes a PDF, a Word file (.docx), an Excel file (.xlsx or .xls) or a plain text file (.txt), up to 5 MB. An old .doc file is refused: save it as .docx first. The whole translation runs on the server, the PDF too, so the page can be closed or left while it runs. A running translation can be cancelled from its row in My translations.' },
  { id: 'paste-text', label: 'Paste text instead', group: 'Translate',
    does: 'On New translation, press "Paste text instead" above the file box. Paste or dictate the text and press Use this text. The box then shows "Your pasted text" with Show text (to read all of it) and Change text (back to the paste box with the text still in it). Then pick the language and press Start translation.',
    notes: 'The pasted text is treated as a plain text file, so the result is a PDF and a plain text download; there is no Word or Excel file for it.' },
  { id: 'translate-to', label: 'Translate to', group: 'Translate',
    does: 'The "Translate to" list on New translation chooses the language. It starts on the workspace\'s usual language, which is set in Settings, AI & Chat, Translate agent. The language of the original is worked out automatically.',
    notes: 'Languages marked with a warning sign (te reo Māori, Irish, Afrikaans) have fewer examples for the AI to learn from, so expect lower quality and check the result more carefully. Choosing te reo Māori shows an extra box, "Iwi / rohe audience": leave it empty for standard te reo Māori, or name the audience and any regional word choices are listed in the result. For more than one language, use Also translate into.' },
  { id: 'also-translate', label: 'Also translate into', group: 'Translate',
    does: 'Under "Translate to" on New translation, press the other languages to translate the same document into as well (up to 8 languages in all). The Start button then says how many translations it will make.',
    notes: 'Each language becomes its own translation in My translations, with its own result, versions and Keep. The document is read only once. With the learned glossary ticked, each language uses its own learned glossary.' },
  { id: 'about-document', label: 'About the document', group: 'Translate',
    does: 'Three lists on New translation tell the careful translator what it is working on: Kind of document (legal, finance, medical, general business and so on), Who will read it (a client, an auditor, an insurer, your own team), and Style (natural, or close to the original wording). "Notes for the translator" takes anything else in your own words, typed or spoken.',
    notes: 'These only apply to Vault AI; Google Translate ignores them, so they are hidden when it is chosen.' },
  { id: 'must-keep', label: 'Words to keep as they are', group: 'Translate',
    does: 'In the box "Words to keep as they are" on New translation, type or say brand names, product codes and abbreviations with commas between them. They are left exactly as written in the translation.',
    notes: 'This is for one job. For words that should be kept or translated one way in every job, add them to a glossary, or tick Remember on a word requirement in a draft.' },
  { id: 'engine', label: 'Translated by', group: 'Translate',
    does: 'Under More options on New translation, "Translated by" chooses between Vault AI (careful) and Google Translate (fast draft). Vault AI reads what you said about the document, uses the glossary and can be checked by a second model; it takes a few minutes. Google Translate takes seconds and suits a draft in a common language.',
    notes: 'Google Translate is only offered when it has been set up for the workspace; otherwise it shows as "not set up". Which AI model Vault AI uses is chosen once in Settings, AI & Chat, Translate agent, not per job. Google Translate cannot follow written rules, so another pass on a Google translation uses Vault AI when it is set up.' },
  { id: 'layout', label: 'PDF layout', group: 'Translate',
    does: 'Under More options on New translation, "PDF layout" chooses what the PDF holds: "The translation only", or "Each original page, then its translation" for checking one against the other.',
    notes: 'The PDF holds the words in order with plain styling. It does not copy the look of the original (fonts, columns, pictures). Every page carries a line saying the translation is for reference and is not legally certified.' },
  { id: 'glossary-choice', label: 'Glossary', group: 'Translate',
    does: 'Under More options on New translation, the tick box "Use and add to the learned glossary" is on by default: the job uses the words Translate has already learned for that language and adds this job\'s new terms when it is kept. Untick it to choose one of your own glossaries from the list instead.',
    notes: 'It is one or the other for a job: the learned glossary, or one glossary you pick, or none.' },
  { id: 'second-check', label: 'Second-model check', group: 'Translate',
    does: 'Under More options on New translation, the tick box "Have a second AI model check the translation" makes another model compare every part with the original and list what looks wrong: changed meaning, unsure terms, garbled or unfinished rows, wording that does not suit the reader.',
    notes: 'It finds problems; it does not correct them. To change what it found, run another pass with a requirement. It adds time. Checks for empty, missing and cut-short parts always run, with or without this tick. It is off by default for Google Translate.' },
  { id: 'read-first', label: 'Let me read it before it is kept', group: 'Translate',
    does: 'Under More options on New translation, this tick box is on by default: the finished translation waits in My translations as "Ready to read", so it can be read and changed with more passes before Keep this version makes the files. Untick it to have it kept straight away with its files ready.',
    notes: 'The ready-made job "Get a quick draft" unticks it. A translation kept straight away can still be reopened as a draft later.' },
  { id: 'house-style-choice', label: 'House style', group: 'Translate',
    does: 'When the language under "Translate to" has house styles, New translation shows a "House style" list: Let Translate choose (the closest set for the document), one of the sets by name, or No house style. The result screen says which house style was used.',
    notes: 'House styles are approved examples an admin keeps for a language; the translator matches them and the checker lists departures starting "House style:". For a translation out of a language with house styles (for example te reo Māori into English), Translate chooses one by itself. Saved wording from earlier translations is not reused when a house style is used, so every part is translated with the examples in view.' },
  { id: 'estimate', label: 'Get estimate', group: 'Translate',
    does: 'After adding a file on New translation, press Get estimate to see how many characters the document has and a rough cost in Australian dollars before starting.',
    notes: 'It is a rough figure. The real cost changes with the size of the glossary, whether the second check runs, and each extra pass.' },
  { id: 'jobs', label: 'My translations', group: 'Translate',
    does: 'Lists every translation, newest first. The boxes at the top count how many are ready to read, kept, need checking, are still running and did not finish; press one to show only those. A running one shows what it is doing and how far along it is. The search box finds one by file name. Each row has Open result and Delete.',
    notes: 'The list updates itself while anything runs, and a message with "Open it" appears when one is ready. "Stopped part-way" means the server restarted while it ran: delete it and run the document again. Delete asks first, then moves the job and its files to the recycle bin for 30 days. An Undo button shows straight after; later, Settings, Recycle bin puts it back.' },
  { id: 'keep-time', label: 'Translations are kept for', group: 'Translate',
    does: 'At the top of My translations, the list "Translations are kept for" chooses 90 days, 1 year or Until I delete them.',
    notes: 'Older translations are deleted for good, with their files, the next time Vault starts; they do not go to the recycle bin. 90 days is the starting choice.' },
  { id: 'open-result', label: 'Open result', group: 'Translate',
    does: 'On a row in My translations, press Open result. The screen shows the original and the translation side by side, part by part, with the parts the checks are about marked; the buttons above choose all parts, only the marked ones, or only the ones changed in this version. Copy translation copies the whole text. On the right: Keep this version (for a draft) or the downloads (once kept), Another pass, and what the checks found.',
    notes: 'The verdict ("No problems found", "Worth a look", "Needs checking") is worked out from which kinds of problem the checks listed. It is a guide to where to look, not a measured accuracy score, and a clean result is not proof the translation is right. A draft can be read here without downloading anything.' },
  { id: 'another-pass', label: 'Another pass', group: 'Translate',
    does: 'On a draft\'s result, under Another pass, add what should be different: a rule in your own words (typed or spoken), or a word with the translation it must get, or ticked "Keep as is". "Fix this word" beside an unsure term fills the word in. Choose The whole document, or Only the parts I pick (tick them on the left, or "Pick the parts the checks marked"), and press Run another pass.',
    notes: 'Requirements stay with that translation for every later pass. Tick Remember on one to keep it for future translations too; it is only saved when a version is kept. A pass of the whole document takes about as long, and costs about as much, as the first translation; a few picked parts take seconds. The version shown stays until the new one is ready, and a failed or cancelled pass changes nothing. One pass at a time.' },
  { id: 'versions', label: 'Version', group: 'Translate',
    does: 'After more than one pass, the Version buttons at the top of the result show each version (1 is the first translation). Press one to read it, with its own check results.',
    notes: 'Keep this version keeps the version being shown, so an earlier one can be kept instead of the latest. A new pass always starts from the latest version.' },
  { id: 'keep-version', label: 'Keep this version', group: 'Translate',
    does: 'On a draft\'s result, press Keep this version. The PDF (and the Word or Excel copy) are made, the wording is added to the translation memory and the learned glossary, and the requirements ticked Remember are saved for future translations. The downloads then appear on the same screen.',
    notes: 'Nothing is downloadable, and nothing is added to glossaries or rules, until a version is kept. It waits for a running pass to finish.' },
  { id: 'reopen', label: 'Reopen as a draft', group: 'Translate',
    does: 'On a kept translation\'s result, press Reopen as a draft to run more passes on it (to run it again with new requirements). Keep it again when done.',
    notes: 'The downloads are hidden while it is a draft again and come back, rebuilt, when it is kept. Requirements already saved are not saved twice.' },
  { id: 'downloads', label: 'Downloads', group: 'Translate',
    does: 'On a kept translation\'s result: Download translated PDF, Download plain text (the translation only), Download Word or Download Excel (when the original was a Word or Excel file and the editable copy could be built), Download original (the file you gave it, untouched) and Download check report (a text file of what the checks found).',
    notes: 'Download Word is missing when the original was a PDF, a text file or pasted text, or when the Word file\'s structure (text boxes, tables inside tables) could not be matched up; the PDF and plain text are still there. In Excel only cells with words are translated; numbers and their formatting are left alone. A draft has no downloads until it is kept; Copy translation works on a draft.' },
  { id: 'email-documents', label: 'Email these documents', group: 'Translate',
    does: 'On a kept translation\'s result, press Email these documents, type the address and press Send. The original, the translated PDF and the check report are sent as attachments, whichever of them exist for the job.',
    notes: 'Nothing is sent until Send is pressed.' },
  { id: 'lessons', label: 'Lessons learnt', group: 'Translate',
    does: 'On a kept translation\'s result, press Lessons learnt. It turns what the checks found into a tick list: a rule for every future job, a word to always leave as it is, or a word to always translate one way. Tick the ones you agree with and press Apply selected.',
    notes: 'Applying changes future translations only. To change this translation, reopen it as a draft and run another pass. Everything applied is listed under What it has learned.' },
  { id: 'glossaries', label: 'Glossaries', group: 'Wording',
    does: 'Lists your glossaries. Press New glossary, give it a name, and add rows: the word as it appears in the original, how it must be translated, or a tick under "Keep as is" to leave it untranslated. Open a glossary to change or remove rows. The ones marked "Learned" are built by Translate itself, one per language, and can be edited the same way.',
    notes: 'Changes apply from the next translation. A deleted glossary goes to the recycle bin for 30 days: Undo shows straight after, and Settings, Recycle bin puts it back later.' },
  { id: 'learned', label: 'What it has learned', group: 'Wording',
    does: 'Shows two things. First, every rule and word applied from Lessons learnt, or saved from a requirement ticked Remember, newest first, with the date and the job it came from; filter it by rules for all languages or by one language. Second, how many translated passages Translate has stored for each pair of languages and how often it has reused them: a passage that appears again word for word is given the same translation as last time. Download translation memory saves those passages as a TMX file for other translation software.',
    notes: 'This screen shows what was learned; to change a learned word, edit the learned glossary under Glossaries. Only passages that match exactly are reused, and only from kept translations.' },
];

CATALOG.push({ id: 'styles', label: 'House styles', group: 'Wording',
  does: 'Admins only. Pick a language, press New set, name the kind of content (for example Corporate vision statements), write how it is translated (register, re-expressing ideas rather than word for word, names to keep), and add examples: the original and its approved translation, with an optional note. Save. Test this set translates each example\'s original with the set, without letting the translator see that example\'s answer, and shows the result beside the approved translation. It is a check, not a suggestion: the approved translation stays the standard. Download for review (Word) saves the test as a Word document for a native speaker, with boxes to tick which reads better and room for comments.',
  notes: 'A set applies to the whole workspace, to translations into and out of its language. Most languages need none. The comment and examples are sent with every part of a translation that uses the set, so they add to its cost; the screen says when examples no longer fit and the later ones are left out. Test this set costs about as much as translating the examples. A deleted set goes to the recycle bin for 30 days. Members who are not admins do not see this screen.' });

const RULES = [
  'Start from the list on the left: New translation to translate something, My translations for results, passes, Keep and downloads, Glossaries for fixed wording, What it has learned for the history of that wording. "What do you want to do?" at the top of the list offers ready-made jobs that fill in the options.',
  'A translation needs a file or pasted text, and a language. Everything else has a sensible starting value.',
  'A translation runs on the server: the page can be closed or left while it runs, and My translations shows it when it is ready.',
  'A finished translation is a draft until Keep this version is pressed (unless "Let me read it before it is kept" was unticked). Downloads, the translation memory, the learned glossary and remembered requirements only come from a kept version.',
  'The checks list problems for a person to read. To change a translation, add a requirement and run another pass; nothing in Translate lets the text be typed into directly. The Word, Excel and plain text downloads can be edited in other programs.',
  'Lessons learnt, glossaries and remembered requirements change future translations only, never one that is already kept (reopen it as a draft to change it).',
  'The boxes for must-keep words, notes, pasted text, rules for a pass and the iwi / rohe audience have a microphone button.',
  'Translations are for reference and are not legally certified; the PDF says so on every page.',
  'The Open buttons in this chat only switch to a tool (a screen of the page); they never start, cancel, keep or delete a translation by themselves.',
];

const NOT_POSSIBLE = [
  'Keeping the look of the original PDF: fonts, columns, pictures and page design are not copied, only the words in order.',
  'Reading PDFs with several columns, side tabs or tables reliably: the text can be read in the wrong order, which spoils the translation without any warning. Check those against the original, or give it the Word or Excel file instead.',
  'Typing changes into a translation by hand inside Translate. Ask for them with a requirement and another pass, or download the Word, Excel or plain text file and edit that.',
  'More than 8 languages in one go: start another translation for the rest.',
  'Files over 5 MB, old .doc files, PowerPoint, pictures (JPG, PNG) and web pages. Scanned pages must be inside a PDF.',
  'A certified or sworn translation for a court, an immigration office or a regulator: that needs a qualified human translator.',
  'An accuracy score. The verdict on a result says which kinds of problem the checks listed, not how accurate the translation is.',
  'Downloading a draft before it is kept: keep it first (Copy translation works on a draft).',
  'Getting a deleted translation or glossary back after 30 days: the recycle bin (Settings, Recycle bin) keeps them for 30 days, then they are gone for good. A very large translation cannot go in the recycle bin at all; the page says so and asks before deleting it for good. Translations past the "kept for" time are deleted for good without the recycle bin.',
  'Translating speech or a live conversation, or files straight from Google Drive (download them as Word or Excel first).',
];

const SYSTEM = `You are the guide to Translate in Vault for one person who wants a document or some text translated into another language. They say, in everyday words, what they want to do. You point them to the right screen(s) and controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Translate cannot do.
- You cannot see any document, translation or result. Never state or guess what is in them, and never translate anything yourself in place of the tool: point at the tool.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about which translator fits: Vault AI for anything that will be sent to someone or must be right, Google Translate for a fast draft to read yourself.
- If they want something in a translation changed, the answer is a requirement and another pass on the draft (reopen it first if it was kept).
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
