'use strict';

// The DocCompare guide (the round button on Vault's /doc-compare page): a person says what they want to check ("did the AI drop anything?",
// "compare two PDFs", "why is it warning me?") and the guide points at the real parts of the page, in order, or says plainly that DocCompare does
// not do it. It only knows what is written here and never sees the files or the results (they never leave the person's browser). Built on
// guideCore.js; the ids are the page's own, listed in client/src/pages/docCompare/docCompareTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/doc-compare.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'doc-compare', label: 'DocCompare', group: 'DocCompare',
    does: 'The whole page: compares an original document with an AI-edited version of it and lists every difference (missing text, added text, wording, numbers, formatting, page layout and file details), with removed content shown most prominently.',
    notes: 'Both files are read and compared inside the person\'s browser: nothing is uploaded, nothing is sent to an AI model and nothing is saved. Closing the tab loses the comparison unless the PDF report was downloaded.' },
  { id: 'files', label: 'Original and Edited files', group: 'DocCompare',
    does: 'Two boxes, Original and Edited (LLM output). Drop a file on each, or press Choose file. Each box then shows the file name, type and size, with Replace and Remove.',
    notes: 'Both files must be the same type: PDF, Word (.docx), Markdown (.md) or plain text (.txt). Old Word .doc files must be saved as .docx first. Changing either file clears the results.' },
  { id: 'compare', label: 'Compare button', group: 'DocCompare',
    does: 'Starts the comparison once both files are chosen. A line beside it says which step is running.',
    notes: 'Most documents take a few seconds; two PDFs then also have their pages compared, which shows its own progress.' },
  { id: 'file-check', label: 'File type check', group: 'DocCompare',
    does: 'The first check. If the two files are different types (for example Word and PDF), or a file is unsupported, damaged, password-protected or a scanned PDF with no text, a red box says why and nothing is compared.',
    notes: 'There is no way past this check: convert one file so both are the same type. Scanned PDFs need text recognition first, which DocCompare does not do.' },
  { id: 'same-document', label: 'Same-document check', group: 'DocCompare',
    does: 'The second check. It scores how alike the two files are from 0 to 100 (matching headings, shared wording and structure). Below the threshold (60 unless changed in Settings) an amber box lists the reasons and offers Cancel or Compare anyway.',
    notes: 'Compare anyway is allowed and is recorded in the report. A low score usually means the wrong file was picked.' },
  { id: 'summary', label: 'Summary bar', group: 'DocCompare',
    does: 'The row at the top of the results counting each kind of change, for example "1 section missing" or "12 wording changes". Missing sections, removed content and number changes are shown in red. Pressing an item shows only that kind in the table.',
    notes: '"No differences found" means the documents match once trivial differences are set aside.' },
  { id: 'trivial', label: 'Trivial changes', group: 'DocCompare',
    does: 'Differences in spaces, line breaks, curly or straight quotes, dashes and invisible characters. They are hidden but counted ("7 trivial changes hidden"); the tick box beside that count shows them in the table.',
    notes: 'Which of these count as trivial is chosen in Settings.' },
  { id: 'changes', label: 'Changes table', group: 'DocCompare',
    does: 'One row per change: number, location (section and paragraph, page, or table row and column), change type, the original text, the edited text and severity (High, Medium or Low). Press a row, or Enter on it, to open the details: the words that changed (red struck-through for removed, green underlined for added), and for a removed section or table row the list of everything in it.',
    notes: 'High means removed content, removed sections or table rows, changed numbers or dates, or a big word-count drop. A wording change that drops a large part of a paragraph is also High. Long text shows a "show more" link.' },
  { id: 'filters', label: 'Filters and search', group: 'DocCompare',
    does: 'Above the table: a search box, a button per change type and per severity (press several), and Clear filters. Column headings with arrows sort the table.',
    notes: 'The downloaded report uses the same filters and says which ones were set.' },
  { id: 'metadata', label: 'Metadata table', group: 'DocCompare',
    does: 'A fold-out table comparing the two files\' details: size, dates, author, revision, title, application, and counts of pages, words, characters, headings, tables and images, with the difference. Flagged rows are marked.',
    notes: 'It flags a file-size change over 20%, a word-count drop over 5% (High), changed counts, a different internal created date (suggesting a new document rather than an edit) and an edited file that claims to be older. Details a file does not record are shown as a dash and never flagged.' },
  { id: 'layout', label: 'PDF page layout check', group: 'DocCompare',
    does: 'For two PDFs only: after the text results appear, each page is drawn and compared pixel by pixel. Pages where more than a tiny share of the page changed become Layout rows in the table.',
    notes: 'PDFs over 500 pages wait for a click on Compare layout. Small edits such as one changed number may not count as a layout change, but they are still listed as text changes.' },
  { id: 'page-viewer', label: 'Page viewer', group: 'DocCompare',
    does: 'Opens from Open page viewer or a Layout row: the original and edited page side by side, with the changed pixels in red over the edited page. Arrows (or the arrow keys) move between pages; Changed pages only skips the rest; Diff overlay turns the red on and off.',
    notes: 'PDF files only.' },
  { id: 'report', label: 'Download PDF report', group: 'DocCompare',
    does: 'Saves a PDF named comparison_<original name>_<date>.pdf with the file names, the two checks, counts by type and severity, the metadata table, the changes table (removed text in red, added in green) and thumbnails of changed PDF pages. Landscape table puts the changes table on wide pages.',
    notes: 'It uses the filters currently set. Characters outside Western European languages print as question marks in the report.' },
  { id: 'settings', label: 'Settings', group: 'DocCompare',
    does: 'The Settings button opens a side panel: the same-document threshold, the file-size and word-count percentages that raise flags, which differences count as trivial, and Show trivial changes. Reset to defaults puts them back.',
    notes: 'Settings are remembered in this browser only. Changing them updates the results at once.' },
  { id: 'info', label: 'How DocCompare works', group: 'DocCompare',
    does: 'The (i) button opens a plain-language guide to the whole page. It also opens by itself the first time.',
    notes: '' },
];

const RULES = [
  'DocCompare compares two files of the same type: PDF, Word (.docx), Markdown (.md) or plain text (.txt). It stops if the types differ.',
  'Everything happens in the person\'s browser: the files are never uploaded, never sent to an AI model and never saved. The guide cannot see them or the results.',
  'Removed content, removed sections and table rows, and changed numbers or dates are marked High severity.',
  'Spaces, line breaks, curly versus straight quotes, dashes and invisible characters are trivial: hidden but counted, and chosen in Settings.',
  'Page layout is compared for PDFs only.',
  'DocCompare reports differences; it does not decide which version is right or fix either file.',
  'The Open buttons in this chat only switch to a tool (they show the page, scroll to a part of it, or open Settings, the guide box or the page viewer); they never choose files, compare or delete anything.',
];

const NOT_POSSIBLE = [
  'Comparing two different file types, for example a Word document against a PDF: convert one first.',
  'Old Word .doc files: save them as .docx first.',
  'Scanned PDFs with no text (text recognition, also called OCR) and password-protected PDFs.',
  'Spreadsheets (.xlsx, .csv), images, PowerPoint or other formats.',
  'Comparing more than two files at once, or keeping a history of comparisons: nothing is saved.',
  'Editing or fixing either document, accepting or rejecting changes, or making a merged version.',
  'Deciding which version is correct, or checking the edit against a source or the law.',
  'Showing what the person\'s documents say or what the comparison found: the guide cannot see the files or the results.',
];

const SYSTEM = `You are the guide to DocCompare in Vault for one person who wants to check what an AI edit changed in a document. They say, in everyday words, what they want to do. You point them to the right parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do.
- You cannot see their files or the comparison results. Never state or guess what their documents say, what changed or how many changes there are.
- Be plain and short, as to a friend who is not technical. Explain any word like metadata or severity in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- The files never leave the person's computer. If they worry about privacy, say so plainly; never say a file is uploaded or sent to an AI.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'DocCompare guide', feature: 'doc_compare_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DOCCOMPARE TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to check in your documents, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDocCompareTutor: guide.ask,
};
