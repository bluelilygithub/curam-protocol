// What DocCompare is made of, the plain-words help for it, and the parts its guide (the round button) can point at. Shared by three places:
//   - the app itself (vault/doc-compare/, imported through its @vault-client alias): the (i) box text and the Open-button ids;
//   - the guide's catalogue (server/services/docCompareTutor.js): node server/services/docCompareTutor.test.js fails if the two lists drift apart;
//   - Vault's host page (client/src/pages/DocComparePage.jsx).
// DocCompare is one page with one job, so there is one "tool"; `tool` on a guide entry says which tool its Open button shows, and the app marks
// each part with data-guide="<id>" so an Open button can scroll to it.

export const DOC_COMPARE_TOOLS = [
  { id: 'doc-compare', label: 'DocCompare', group: 'DocCompare', icon: 'compare' },
];

export const GROUPS = ['DocCompare'];

export const GROUP_TIPS = {
  DocCompare: 'Compare an original document with an AI-edited version and see everything that changed.',
};

export const TOOL_TIPS = {
  'doc-compare': 'Drop in the original and the AI-edited version of a document (PDF, Word, Markdown or text) and see every change: missing text, added text, wording, numbers, formatting and page layout. Your files never leave your computer.',
};

export const TOOL_BLURBS = {
  'doc-compare': 'Catch what an AI edit skipped or changed.',
};

// The longer text for the (i) "How DocCompare works" box, shown once per browser and from the (i) button.
export const HOW_IT_WORKS = [
  ['What it is for', 'When an AI edits a document it sometimes drops a paragraph, changes a number or quietly rewords a sentence. DocCompare puts the original and the edited version side by side and lists every difference, with missing content shown first and most prominently.'],
  ['Your files stay on your computer', 'Both files are read and compared inside this browser tab. Nothing is uploaded, nothing is sent to an AI model, and nothing is saved. Close the tab and the comparison is gone, so download the PDF report if you want to keep it.'],
  ['Choosing files', 'Drop a file on Original and another on Edited (LLM output), or press Choose file. Both must be the same type: PDF, Word (.docx), Markdown (.md) or plain text (.txt). Old Word .doc files must be saved as .docx first. A scanned PDF with no text in it cannot be read, and a password-protected PDF must be unlocked first.'],
  ['The two checks before comparing', 'First, the file types must match, or DocCompare stops and says why. Second, it scores how alike the two files are (0 to 100, from matching headings, shared wording and structure). Below the threshold in Settings (60 unless changed) it warns that they may not be versions of the same document, lists the reasons, and lets you Cancel or Compare anyway. Compare anyway is noted in the report.'],
  ['Reading the results', 'The summary bar counts each kind of change; press one to show only those. Removed content, removed sections and changed numbers or dates are marked High, because they are what an AI edit most often gets wrong. The table lists each change with where it is, what it was and what it became; press a row to open it and see the words that changed (struck through in red for removed, underlined in green for added). Filters, search and sorting are above the table.'],
  ['Kinds of change', 'Removed and Added: whole paragraphs, sections or table rows. Moved: the same text in a new place. Wording: words changed inside a paragraph (marked High when a large part was dropped). Typo: one small word fix. Number/date: anything with a digit changed. Formatting: headings, lists, bold, italic, fonts and sizes. Layout: PDF pages that look different. Metadata: file size, dates, author and counts, for example a word count that dropped.'],
  ['Trivial changes', 'Differences in spaces, line breaks, curly or straight quotes, dashes and invisible characters are hidden by default but still counted ("7 trivial changes hidden"). Tick that box to show them, or choose in Settings which of them count as trivial.'],
  ['PDF pages', 'For two PDFs, each page is also drawn and compared pixel by pixel after the text results appear. Pages where more than a tiny share changed are listed as Layout changes. The page viewer shows the two pages side by side with the changed pixels in red. Very long PDFs (over 500 pages) wait for you to start this step.'],
  ['The report', 'Download PDF report saves the checks, the summary, the metadata, the changes table (with the filters you have set, which it names) and thumbnails of changed PDF pages.'],
  ['What it cannot do', 'It cannot compare two different file types (for example Word against PDF), read scanned PDFs, compare spreadsheets or images yet, or tell you which version is right. It reports differences; you decide what to keep.'],
];

// Everything the guide can point at: the page plus its parts. `tool` is the tool the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'doc-compare', label: 'DocCompare', tool: 'doc-compare' },
  { id: 'files', label: 'Original and Edited files', tool: 'doc-compare' },
  { id: 'compare', label: 'Compare button', tool: 'doc-compare' },
  { id: 'file-check', label: 'File type check', tool: 'doc-compare' },
  { id: 'same-document', label: 'Same-document check', tool: 'doc-compare' },
  { id: 'summary', label: 'Summary bar', tool: 'doc-compare' },
  { id: 'trivial', label: 'Trivial changes', tool: 'doc-compare' },
  { id: 'changes', label: 'Changes table', tool: 'doc-compare' },
  { id: 'filters', label: 'Filters and search', tool: 'doc-compare' },
  { id: 'metadata', label: 'Metadata table', tool: 'doc-compare' },
  { id: 'layout', label: 'PDF page layout check', tool: 'doc-compare' },
  { id: 'page-viewer', label: 'Page viewer', tool: 'doc-compare' },
  { id: 'report', label: 'Download PDF report', tool: 'doc-compare' },
  { id: 'settings', label: 'Settings', tool: 'doc-compare' },
  { id: 'info', label: 'How DocCompare works', tool: 'doc-compare' },
];

// postMessage types between Vault's page and the app in its frame (same origin only)
export const OPEN_TYPE = 'doc-compare:open'; // Vault -> app  { type, id }
export const CONTEXT_TYPE = 'doc-compare:context'; // app -> Vault  { type, tool }
