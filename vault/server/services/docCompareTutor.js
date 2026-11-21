'use strict';

// The DocCompare guide (the round button on Vault's /doc-compare page): a person says what they want to check ("did the AI drop anything?",
// "compare two PDFs", "why is it warning me?") and the guide points at the real tools and parts of the page, in order, or says plainly that
// DocCompare does not do it. It only knows what is written here and never sees the files or the results (they never leave the person's
// browser). Built on guideCore.js; the ids are the page's own, listed in client/src/pages/docCompare/docCompareTools.mjs (a test keeps the
// two in step). See docs/guide-chat.md and docs/doc-compare.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- Compare ----
  { id: 'compare', label: 'Compare documents', group: 'Compare',
    does: 'The tool where a comparison starts: two file boxes, the Compare button, and the two checks. When it finishes, a summary of what changed appears here, and a job picked on the start screen moves on to its next step by itself.',
    notes: 'Both files are read and compared inside the person\'s browser: nothing is uploaded, nothing is sent to an AI model and nothing is saved. Leaving the page loses the comparison unless the PDF report was downloaded. The start screen ("What do you want to do?", at the top of the tool list) offers ready-made jobs such as checking nothing was left out, or checking numbers and dates.' },
  { id: 'files', label: 'Original and Edited files', group: 'Compare',
    does: 'Two boxes in Compare documents, Original and Edited (LLM output). Drop a file on each, or press Choose file. Each box then shows the file name, type and size, with Replace and Remove.',
    notes: 'Both files must be the same type: PDF, Word (.docx), Markdown (.md) or plain text (.txt). Old Word .doc files must be saved as .docx first. Changing either file clears the results.' },
  { id: 'compare-button', label: 'Compare button', group: 'Compare',
    does: 'Starts the comparison once both files are chosen. A line beside it says which step is running.',
    notes: 'Most documents take a few seconds; two PDFs then also have their pages compared, which shows its own progress in PDF pages.' },
  { id: 'file-check', label: 'File type check', group: 'Compare',
    does: 'The first check. If the two files are different types (for example Word and PDF), or a file is unsupported, damaged, password-protected or a scanned PDF with no text, a red box says why and nothing is compared.',
    notes: 'There is no way past this check: convert one file so both are the same type. Scanned PDFs need text recognition first, which DocCompare does not do.' },
  { id: 'same-document', label: 'Same-document check', group: 'Compare',
    does: 'The second check. It scores how alike the two files are from 0 to 100 (matching headings, shared wording and structure). Below the threshold (60 unless changed in Settings) an amber box lists the reasons and offers Cancel or Compare anyway.',
    notes: 'Compare anyway is allowed and is recorded in the report. A low score usually means the wrong file was picked.' },
  // ---- Results ----
  { id: 'review', label: 'Verdict and review', group: 'Results',
    does: 'The tool that opens first after comparing (and the second step of "Check a document", the large panel on the start screen): the verdict, one sentence on what the LLM changed, and a card for each change that needs a decision, red ones first. Each card says what happened, why it matters and what to do, with the original and edited text.',
    notes: 'Decisions are kept in this browser for these two exact files, so they are still there after a reload or when the same files are compared again; nothing is uploaded. Minor changes (typos, small formatting, page layout, file details) are not on the cards; they are under All changes.' },
  { id: 'verdict', label: 'Verdict', group: 'Results',
    does: 'The large banner at the top of Verdict and review. Not ready to submit: a red item (removed content, a changed figure, a section cut by more than 15%) has no decision or is marked Fix later. Review recommended: no red items are open but some amber ones (rewording, added text, moved text, structure) are. No significant changes found: only minor changes, or everything decided.',
    notes: 'It shows what changed, not whether the content is accurate, and it never says a document is safe or correct. The PDF report carries the same verdict, and while a red item is open every page has an UNRESOLVED ISSUES watermark that cannot be turned off.' },
  { id: 'review-queue', label: 'Review cards', group: 'Results',
    does: 'The cards under the verdict. Red cards: Restore (copies the original text to the clipboard to paste back, and records the decision), Accept (the change was intended), Fix later (stays open; the verdict stays red). Amber cards: Accept, and Dismiss all similar to accept every open change of that kind at once. Undo takes a decision back; Show in all changes finds the change in the full table. A counter shows how many are decided; Hide decided hides the rest.',
    notes: 'Keyboard: R restore, A accept, L fix later, arrow keys to move between cards. Restore does not change the document itself: the person pastes the copied text back into their own file.' },
  { id: 'changes', label: 'All changes', group: 'Results',
    does: 'The tool listing every change in one table, including the minor ones: number, location (section and paragraph, page, or table row and column), change type, the original text, the edited text and severity (High, Medium or Low). Press a row, or Enter on it, to see the words that changed (red struck-through for removed, green underlined for added), and for a removed section or table row the list of everything in it.',
    notes: 'High means removed content, removed sections or table rows, changed numbers or dates, or a big word-count drop. A wording change that drops a large part of a paragraph is also High. It is empty until two files have been compared.' },
  { id: 'summary', label: 'Summary bar', group: 'Results',
    does: 'The row at the top of Changes (and under the Compare button once done) counting each kind of change, for example "1 section missing" or "12 wording changes". Missing sections, removed content and number changes are shown in red. Pressing an item shows only that kind in the table.',
    notes: '"No differences found" means the documents match once trivial differences are set aside.' },
  { id: 'trivial', label: 'Trivial changes', group: 'Results',
    does: 'Differences in spaces, line breaks, curly or straight quotes, dashes and invisible characters. They are hidden but counted ("7 trivial changes hidden"); the tick box beside that count in the summary bar shows them in the table.',
    notes: 'Which of these count as trivial is chosen in Settings.' },
  { id: 'filters', label: 'Filters and search', group: 'Results',
    does: 'Above the Changes table: a search box, a button per change type and per severity (press several), and Clear filters. Column headings with arrows sort the table.',
    notes: 'The PDF report uses the same filters and says which ones were set. A job from the start screen may set a filter for you.' },
  { id: 'metadata', label: 'File details', group: 'Results',
    does: 'The tool comparing the two files\' details: size, dates, author, revision, title, application, and counts of pages, words, characters, headings, tables and images, with the difference. Flagged rows are marked.',
    notes: 'It flags a file-size change over 20%, a word-count drop over 5% (High), changed counts, a different internal created date (suggesting a new document rather than an edit) and an edited file that claims to be older. Details a file does not record are shown as a dash and never flagged.' },
  { id: 'pages', label: 'PDF pages', group: 'Results',
    does: 'The tool for two PDFs: after the text results appear, each page is drawn and compared pixel by pixel, with progress shown. Every page pair is listed with how much changed; changed pages are marked and have a picture of the changes.',
    notes: 'PDF files only. PDFs over 500 pages wait for a click on Compare layout. Small edits such as one changed number may not count as a page change, but they are still listed in Changes.' },
  { id: 'page-viewer', label: 'Page viewer', group: 'Results',
    does: 'Opens from a page in PDF pages (or a Layout row in Changes): the original and edited page side by side, with the changed pixels in red over the edited page. Arrows (or the arrow keys) move between pages; Changed pages only skips the rest; Diff overlay turns the red on and off.',
    notes: 'PDF files only, once the page check has finished.' },
  // ---- Share and set up ----
  { id: 'report', label: 'PDF report', group: 'Share and set up',
    does: 'The tool that downloads a PDF named comparison_<original name>_<date>.pdf with the file names, the two checks, counts by type and severity, the file details, the changes table (removed text in red, added in green) and pictures of changed PDF pages. Landscape table puts the changes table on wide pages.',
    notes: 'It uses the filters currently set in Changes and says which. Characters outside Western European languages print as question marks in the report.' },
  { id: 'author-report', label: 'Review for the author', group: 'Share and set up',
    does: 'The Download review for the author button (in PDF report, and on the Comparison done card under Compare documents). It downloads review_<edited name>_<date>.pdf: a to-do list for whoever made the edit, with a summary of how many items must be fixed, reviewed or are minor, then every change sorted into Must fix, Please review and Minor. Each item has a tick box, where it is, one plain instruction (for example "Restore this text", "Check the changed figure"), and the original and edited text with removed words in red and added words in green.',
    notes: 'It always lists every change, whatever filters are set in Changes; differences only in spacing, quotes or invisible characters are counted but not listed, and file details are included only when flagged. Characters outside Western European languages print as question marks. DocCompare does not send it: the person downloads it and sends it themselves.' },
  { id: 'settings', label: 'Settings', group: 'Share and set up',
    does: 'The tool for the same-document threshold, the file-size and word-count percentages that raise flags, which differences count as trivial, and Show trivial changes. Reset to defaults puts them back.',
    notes: 'Settings are remembered in this browser only. Changing them updates the results at once.' },
  { id: 'info', label: 'How DocCompare works', group: 'Compare',
    does: 'The (i) button beside the DocCompare title in the tool list opens a plain-language guide to the whole page. It also opens by itself the first time.',
    notes: '' },
  { id: 'tour', label: 'Guided tour', group: 'Compare',
    does: 'The compass button beside the DocCompare title (also Settings, DocCompare Tour) runs a 13-step tour: Check a document, the jobs, the tool list, Compare documents and its two checks, Changes, File details and PDF pages, the review for the author, Settings, and this guide. It switches to each tool as it goes.',
    notes: 'It only shows the page; it never chooses files or compares. Esc or Skip Tour ends it.' },
];

const RULES = [
  'DocCompare compares two files of the same type: PDF, Word (.docx), Markdown (.md) or plain text (.txt). It stops if the types differ.',
  'Everything happens in the person\'s browser: the files are never uploaded, never sent to an AI model and never saved. The guide cannot see them or the results.',
  'Removed content, removed sections and table rows, and changed numbers or dates are marked High severity.',
  'Spaces, line breaks, curly versus straight quotes, dashes and invisible characters are trivial: hidden but counted, and chosen in Settings.',
  'Page comparison (PDF pages and the page viewer) is for PDFs only.',
  'The results tools (Verdict and review, All changes, File details, PDF pages, PDF report) are empty until two files have been compared in Compare documents.',
  'The verdict shows what changed, not whether anything is accurate; never call a document safe, correct or verified.',
  'DocCompare reports differences; it does not decide which version is right or fix either file.',
  'The Open buttons in this chat only switch to a tool (they show a tool, scroll to a part of it, or open the guide box or the page viewer); they never choose files, compare or delete anything.',
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

const SYSTEM = `You are the guide to DocCompare in Vault for one person who wants to check what an AI edit changed in a document. They say, in everyday words, what they want to do. You point them to the right tools and parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do.
- You cannot see their files or the comparison results. Never state or guess what their documents say, what changed or how many changes there are.
- Be plain and short, as to a friend who is not technical. Explain any word like metadata or severity in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there. A comparison always starts in "compare".
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
