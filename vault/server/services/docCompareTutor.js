'use strict';

// The DocCompare guide (the round button on Vault's /doc-compare page): a person says what they want to check ("did the AI drop anything?",
// "compare two PDFs", "why is it warning me?") and the guide points at the real tools and parts of the page, in order, or says plainly that
// DocCompare does not do it. It only knows what is written here and never sees the files or the results (they never leave the person's
// browser). Built on guideCore.js; the ids are the page's own, listed in client/src/pages/docCompare/docCompareTools.mjs (a test keeps the
// two in step). See docs/guide-chat.md and docs/doc-compare.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- Compare ----
  { id: 'projects', label: 'Projects', group: 'Compare',
    does: 'The tool listing every project: a document checked over several drafts, kept with a clean copy of its original. Each shows its name, the original file, how many rounds, when it was updated, its size, whether it was exported, and the latest verdict. Open, Rename, Export (one .doccompare file with the files, rounds and decisions), Delete (asks Yes or No) and Import project. New check goes to Compare documents.',
    notes: 'Projects are kept in this browser only; clearing the browser\'s site data removes them, so export the ones to keep. Importing a project that is already here asks Keep both or Replace. A warning shows when the browser\'s storage is 80% full or a project is over 200 MB.' },
  { id: 'save-project', label: 'Save as a project', group: 'Compare',
    does: 'The box "Save this as your original?" under the two file boxes in Compare documents, ticked by default once an original is chosen. Ticked, Compare creates a project (named from the Project name box, the document title or the file name) with the edited file as round 1. Unticked, the two files are compared once and kept under Saved checks.',
    notes: 'A project keeps the original as a clean copy so every later draft is checked against it.' },
  { id: 'add-round', label: 'Add the latest version', group: 'Compare',
    does: 'Inside an open project, Compare documents shows the original as kept, one box "Add the latest version (round N)", a Note for this round box and Check this version. The draft is checked against the original plus every change already accepted, and against the previous round.',
    notes: 'The same file as the original or an earlier round is not added again ("This is the same file as round 3"). The file type and same-document checks still apply. Close project leaves it (it stays in Projects).' },
  { id: 'compare', label: 'Compare documents', group: 'Compare',
    does: 'The tool where a comparison starts: two file boxes, the Compare button, and the two checks. When it finishes, a summary of what changed appears here, and a job picked on the start screen moves on to its next step by itself.',
    notes: 'Both files are read and compared inside the person\'s browser: nothing is uploaded, nothing is sent to an AI model, and the check (label, both files and decisions) is saved in that browser only, under Saved checks. The start screen ("What do you want to do?", at the top of the tool list) offers ready-made jobs such as checking nothing was left out, or checking numbers and dates.' },
  { id: 'check-label', label: 'Label', group: 'Compare',
    does: 'The optional Label box above the two file boxes in Compare documents. The check is saved under this name when Compare finishes; left empty, the edited file name and the date are used. Once saved it shows "Saved as …" with a link to Saved checks.',
    notes: 'A label can be changed later with Rename in Saved checks.' },
  { id: 'saved', label: 'Saved checks', group: 'Compare',
    does: 'The tool listing every check that has been run, newest first, with its label, the two file names, when it was saved and last opened, its verdict, how many items are decided and its size. A search box finds checks by label or file name (every word must match). Open runs the comparison again from the saved files and brings back the decisions; Rename changes the label; Delete asks Delete? Yes / No and removes the check, its two files and its decisions. New check starts an empty comparison.',
    notes: 'Every comparison is saved automatically; comparing the same two files again updates the same saved check. Everything is kept in this browser only (nothing is uploaded): another browser or computer will not see it, clearing the browser\'s site data removes it, and deleting cannot be undone (there is no recycle bin for these).' },
  { id: 'word-limit', label: 'Word limit', group: 'Compare',
    does: 'The optional Word limit box beside the Label in Compare documents (also in Settings, with a page limit). If the edited version has more words than this, that is a red item on the verdict, saying by how much. The verdict screen and the report show both word totals.',
    notes: 'The reference list (References, Bibliography, Sources, Works cited, Endnotes, Notes) is not counted, and footnotes and endnotes are, unless Settings says otherwise. The page limit uses the page count PDF and Word files record.' },
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
  { id: 'timeline', label: 'Timeline', group: 'Results',
    does: 'For an open project, a table with one row per round: date added, note, words (and how many were lost), sections, references, issues fixed / not fixed / new, red / amber / info counts and the verdict. The round that lost the most words is marked. Press a round to open its results (earlier rounds are read-only, except undoing an acceptance). Delete removes a round and every later round (each round is compared with the one before it). Export project and Compact old rounds are at the top.',
    notes: 'Compacted rounds say "File not kept". When the original was replaced, the row says so with the reason and how many open issues were accepted with it.' },
  { id: 'new-original', label: 'Make the new original', group: 'Results',
    does: 'Under the timeline, "Make round N the new original…" for the latest round: it asks why (required), warns that open issues in that round will be accepted as part of the new original and lists the open red items, then makes that round the original. Later rounds are checked against it.',
    notes: 'For a deliberate restructure. The old original is kept under Earlier originals, and the timeline and report always show when it was replaced, by which round, the reason and how many open issues were absorbed. It cannot be undone.' },
  { id: 'compact', label: 'Compact old rounds', group: 'Results',
    does: 'A button at the top of Timeline that deletes the files of old rounds to free space, keeping their changes, decisions, verdict and summary. The originals and the last two rounds always keep their files.',
    notes: 'A compacted round says "File not kept"; it cannot be re-run, downloaded or made the original. Export first to keep everything.' },
  { id: 'round-summary', label: 'Round summary', group: 'Results',
    does: 'In a project, the line at the top of Verdict and review with the project name and round, the summary under the verdict ("Round 4: 3 issues fixed, 1 not fixed, 2 new changes."), and the This round only box, which shows just what changed since the previous round (nothing to decide there).',
    notes: 'Each card can carry a note: New in this round; You chose to restore this in round 2, but it\'s still missing; Changed again; or that a paragraph removed in an earlier round hasn\'t come back. Those not fixed and new come first.' },
  { id: 'resolved', label: 'Resolved items', group: 'Results',
    does: 'A folded Resolved list at the bottom of Verdict and review in a project: items fixed in this round and items accepted earlier, each with its round. An acceptance can be undone there (Undo acceptance), and the latest round is then checked again.',
    notes: 'Accepted changes become part of the accepted state, so they are not asked about again in later rounds.' },
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
  { id: 'word-counts', label: 'Words by section', group: 'Results',
    does: 'A table at the top of File details: each section\'s word count in the original and the edited version, with the change. A section that lost more than 15% of its words is marked, and the totals and the word limit are in its title.',
    notes: 'Useful for seeing where the LLM cut the most, or where to cut to get under a word limit.' },
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
  { id: 'required-headings', label: 'Required headings', group: 'Share and set up',
    does: 'A box in Settings for the headings this submission must have, one per line (for example an inquiry\'s terms of reference). A missing one is a red item and one out of order is amber; numbering and small wording differences are allowed. A list can be saved as a named template and used again, or cleared.',
    notes: 'With no list, every heading in the original counts as required, and a removed heading or section is already reported, so nothing extra appears. Templates are kept in this browser.' },
  { id: 'glossary', label: 'Protected terms', group: 'Share and set up',
    does: 'A box in Settings for terms the LLM must keep, one per line (names of programs, legislation, defined terms), with Load from a file for a plain-text list and Clear the list. If the edited version stops using one, or uses it less than half as often, that is an amber item.',
    notes: 'Defined terms ("the Act"), acronyms with their expansion and phrases the original repeats are found without a list. The list is kept in this browser; a loaded file is read on the computer and not uploaded.' },
  { id: 'settings', label: 'Settings', group: 'Share and set up',
    does: 'The tool for the same-document threshold, the file-size and word-count percentages that raise flags, which differences count as trivial, and Show trivial changes. Reset to defaults puts them back.',
    notes: 'Settings are remembered in this browser only. Changing them updates the results at once.' },
  { id: 'info', label: 'How DocCompare works', group: 'Compare',
    does: 'The (i) button beside the DocCompare title in the tool list opens a plain-language guide to the whole page. It also opens by itself the first time.',
    notes: '' },
  { id: 'tour', label: 'Guided tour', group: 'Compare',
    does: 'The compass button beside the DocCompare title (also Settings, DocCompare Tour) runs a 14-step tour: Check a document, the jobs, the tool list, Compare documents, labels and saved checks, its two checks, Changes, File details and PDF pages, the review for the author, Settings, and this guide. It switches to each tool as it goes.',
    notes: 'It only shows the page; it never chooses files or compares. Esc or Skip Tour ends it.' },
];

const RULES = [
  'DocCompare compares two files of the same type: PDF, Word (.docx), Markdown (.md) or plain text (.txt). It stops if the types differ.',
  'Everything happens in the person\'s browser: the files are never uploaded or sent to an AI model. Each check is saved, with its label, files and decisions, in that browser only (Saved checks). The guide cannot see the files, the results or the saved checks.',
  'Removed content, removed sections and table rows, and changed numbers or dates are marked High severity.',
  'Spaces, line breaks, curly versus straight quotes, dashes and invisible characters are trivial: hidden but counted, and chosen in Settings.',
  'Page comparison (PDF pages and the page viewer) is for PDFs only.',
  'The results tools (Verdict and review, All changes, File details, PDF pages, PDF report) are empty until two files have been compared in Compare documents.',
  'The verdict shows what changed, not whether anything is accurate; never call a document safe, correct or verified.',
  'A statistic, quote, citation, link or source in added or changed text that is not in the original is a red New claim; a reworded or removed direct quote is red; over the word or page limit is red; a missing required heading is red and one out of order amber; a version number that did not change with the content is amber, one that went backwards red.',
  'A reference or footnote that was removed, added or changed, and a citation that points to nothing or to a different source, are red; a renumbered reference list, numbering gaps or renumbered paragraphs, spelling switched between Australian and US, and dropped defined terms or unexplained acronyms are amber. In a PDF, references and footnotes are found by best effort.',
  'A project keeps the original as a clean copy; each later draft is a round, checked against the original plus the accepted changes and against the previous round. Projects are kept in this browser only and can be exported as one .doccompare file.',
  'DocCompare reports differences; it does not decide which version is right or fix either file.',
  'The Open buttons in this chat only switch to a tool (they show a tool, scroll to a part of it, or open the guide box or the page viewer); they never choose files, compare or delete anything.',
];

const NOT_POSSIBLE = [
  'Comparing two different file types, for example a Word document against a PDF: convert one first.',
  'Old Word .doc files: save them as .docx first.',
  'Scanned PDFs with no text (text recognition, also called OCR) and password-protected PDFs.',
  'Spreadsheets (.xlsx, .csv), images, PowerPoint or other formats.',
  'Comparing more than two files at once.',
  'Seeing saved checks or projects on another browser or computer without exporting them, sharing them online, or getting a deleted one back: they are kept in this browser only (a project can be exported as a .doccompare file and imported elsewhere).',
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
