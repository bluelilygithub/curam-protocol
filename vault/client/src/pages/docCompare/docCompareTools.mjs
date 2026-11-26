// What DocCompare is made of, the plain-words help for it, the jobs on its start screen, and the parts its guide (the round button) can point at.
// Shared by three places:
//   - Vault's page (client/src/pages/DocComparePage.jsx): the left-hand tool list (ToolSidebar), the job screen (JobStart), the (i) box;
//   - the app in the page's frame (vault/doc-compare/, imported through its @vault-client alias): its views are these tool ids;
//   - the guide's catalogue (server/services/docCompareTutor.js): node server/services/docCompareTutor.test.js fails if the lists drift apart.
// `tool` on a guide entry says which tool (view) its Open button shows; the app marks each part with data-guide="<id>" so it can scroll to it.

export const DOC_COMPARE_TOOLS = [
  { id: 'projects', label: 'Projects', group: 'Compare', icon: 'folder' },
  { id: 'compare', label: 'Compare documents', group: 'Compare', icon: 'compare' },
  { id: 'saved', label: 'Saved checks', group: 'Compare', icon: 'history' },
  { id: 'review', label: 'Verdict and review', group: 'Results', icon: 'shield' },
  { id: 'timeline', label: 'Timeline', group: 'Results', icon: 'history' },
  { id: 'changes', label: 'All changes', group: 'Results', icon: 'list-checks' },
  { id: 'metadata', label: 'File details', group: 'Results', icon: 'file-text' },
  { id: 'pages', label: 'PDF pages', group: 'Results', icon: 'columns' },
  { id: 'report', label: 'PDF report', group: 'Share and set up', icon: 'download' },
  { id: 'settings', label: 'Settings', group: 'Share and set up', icon: 'sliders' },
];

export const GROUPS = ['Compare', 'Results', 'Share and set up'];

export const GROUP_TIPS = {
  Compare: 'Choose the original and the AI-edited file and compare them, or open a check you saved before. Your files never leave your computer.',
  Results: 'Is it ready? The verdict and the items to decide first; then every change in a table, the file details, and (for PDFs) the pages side by side.',
  'Share and set up': 'Download a report of the comparison, and choose what counts as a change.',
};

export const TOOL_TIPS = {
  projects: 'Every document you are checking over several drafts: its original, how many rounds, the latest verdict and the space it uses. Open, rename, export (one .doccompare file), import or delete a project. Kept in this browser only.',
  compare: 'Drop in the original and the AI-edited version (PDF, Word, Markdown or text) and press Compare. Two checks run first: the files must be the same type, and they should look like versions of the same document.',
  saved: 'Every check you run is saved here with its label: search by label or file name, open one to come back to it (your decisions come back too), rename it, or delete it. Kept in this browser only.',
  review: 'The verdict (Not ready to submit, Review recommended, or No significant changes found) and a card for each change you need to decide: Restore, Accept or Fix later. Your decisions are kept in this browser.',
  timeline: 'A project\'s rounds in a table: words, sections, references, issues fixed / not fixed / new, and the verdict of each, with the round that lost the most words marked. Open a round, make the latest round the new original, delete rounds, or compact old ones to free space.',
  changes: 'Every change in one table, including the minor ones: removed, added, moved, wording, typos, numbers and dates, formatting and layout, with severity. Filter, search, sort, and open a row to see the exact words that changed.',
  metadata: 'The two files\' details side by side (size, dates, author, and counts of pages, words, headings, tables and images), with anything suspicious flagged, such as a word count that dropped.',
  pages: 'For two PDFs: every page drawn and compared pixel by pixel. See which pages look different and open them side by side with the changes in red.',
  report: 'Two PDFs: a review to send back to the author (every change, with what to fix and a tick box), and a comparison report for your records (the checks, summary, file details, the changes with your filters, and changed PDF pages).',
  settings: 'Choose when files count as unrelated, when size and word-count changes are flagged, and which tiny differences (spaces, quotes, dashes) are ignored.',
};

export const TOOL_BLURBS = {
  projects: 'Documents you check draft after draft, each kept with its original.',
  timeline: 'Every round of a project: what was fixed, what is new, and the verdict.',
  compare: 'Choose the original and the edited file, then press Compare.',
  saved: 'Find, open, rename or delete the checks you have run.',
  review: 'Is it ready to submit? Decide each change that matters, most serious first.',
  changes: 'Every difference between the two files, including the minor ones.',
  metadata: 'Size, dates, author and counts for both files, with suspicious changes flagged.',
  pages: 'PDF pages compared as pictures, side by side with the changes in red.',
  report: 'A to-do list to send back to the author, and a comparison report for your records.',
  settings: 'What counts as a change, and when to warn.',
};

// Verdict and review's subtitle when the two files are intentionally different versions (no verdict there, addendum §0.2)
export const VERSIONS_REVIEW_BLURB = 'Version comparison: which sections are in both versions, worded differently or only in one, and any figures or quotes that differ.';

// The "What do you want to do?" jobs (components/JobStart.jsx). Each step names a tool above; `filter` preselects the Changes table
// (categories and severities as in doc-compare/src/report/model.ts). After Compare finishes, the page moves on to the job's next step.
export const DOC_COMPARE_GOALS = [
  {
    // shown as the large "Is it ready to submit?" panel above the other jobs (DocComparePage.jsx), not as a card
    id: 'check', title: 'Check a document before you submit', icon: 'shield',
    blurb: 'Compare the LLM-edited version with your original and get a verdict, then decide each change that matters.',
    steps: [
      { tool: 'compare', note: 'Choose your original and the LLM-edited version, then press Compare.' },
      { tool: 'review', note: 'Read the verdict, then Restore, Accept or Fix later each card. The verdict turns from red once every red item is decided.' },
    ],
  },
  {
    id: 'rounds', title: 'Check a new draft of the same document', icon: 'history',
    blurb: 'Keep your original as a clean copy and check every later draft against it: what was fixed, what is still missing, and what is new.',
    steps: [
      { tool: 'compare', note: 'First time: choose the original and the LLM draft, leave "Save this as your original?" ticked, and press Compare. Next time: open the project in Projects, add the latest version and press Check this version.' },
      { tool: 'review', note: 'The round summary (fixed, not fixed, new) and the cards: items you chose to restore that are still missing come first.' },
      { tool: 'timeline', note: 'Every round side by side, with the round that lost the most words marked.' },
    ],
  },
  {
    id: 'versions', title: 'Compare two versions meant to differ', icon: 'columns',
    blurb: 'A long and a short version, or one for government and one for industry: which sections are in both, worded differently or only in one, and any figures or quotes that differ.',
    steps: [
      { tool: 'compare', note: 'Tick "These are intentionally different versions", choose version A and version B, then press Compare.' },
      { tool: 'review', note: 'The sections grouped as in both, worded differently, only in A and only in B. There is no verdict; numbers and quotes that differ are still listed to check.' },
    ],
  },
  {
    id: 'missing', title: 'Check the AI did not leave anything out', icon: 'alert-triangle',
    blurb: 'Find removed paragraphs, missing sections and dropped table rows.',
    steps: [
      { tool: 'compare', note: 'Choose the original and the AI-edited file, then press Compare.' },
      { tool: 'changes', note: 'These are the removed items. Open a row to read what is missing.', filter: { categories: ['removed'] } },
      { tool: 'metadata', note: 'Check the word count: a big drop means content was skipped.' },
    ],
  },
  {
    id: 'invented', title: 'Check for invented facts and quotes', icon: 'search',
    blurb: 'Statistics, quotes, sources and links the LLM added that are not in your original, and quotes it reworded.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'New claims and changed quotes. Check each source exists and says this, or remove it.', filter: { categories: ['newClaim', 'quote'] } },
    ],
  },
  {
    id: 'references', title: 'Check references and citations', icon: 'list',
    blurb: 'References and footnotes dropped, changed, renumbered or invented, and citations that now point to nothing or to a different source.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Every reference, footnote and citation finding. A citation that points to nothing, or to a different source, needs fixing before you submit.', filter: { categories: ['reference', 'citation'] } },
    ],
  },
  {
    id: 'consistency', title: 'Check spelling and terms stay consistent', icon: 'type',
    blurb: 'Australian spelling switched to US, defined terms swapped for other words, and acronyms that lost their expansion.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare. Optional: list names and terms the LLM must keep under Protected terms in Settings; the results update.' },
      { tool: 'changes', note: 'Spelling switches (one grouped row with every word) and terminology findings.', filter: { categories: ['spelling', 'terminology'] } },
    ],
  },
  {
    id: 'limit', title: 'Check it is within the word limit', icon: 'file-text',
    blurb: 'Set the word limit, then see the total and where the words are, section by section.',
    steps: [
      { tool: 'compare', note: 'Type the word limit next to the label, choose the two files, then press Compare.' },
      { tool: 'metadata', note: 'Words by section, with the total and the limit at the top. Over the limit is also a red item on the verdict.' },
    ],
  },
  {
    id: 'numbers', title: 'Check numbers and dates were not changed', icon: 'hash',
    blurb: 'Amounts, dates, days and clause numbers: any change with a digit in it.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Every change involving a number or date. Open a row to see the old and new values.', filter: { categories: ['number'] } },
    ],
  },
  {
    id: 'serious', title: 'See only the serious changes', icon: 'shield',
    blurb: 'Just the High severity items: removed content and changed numbers.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Only High severity changes are shown. Clear filters to see everything.', filter: { severities: ['high'] } },
    ],
  },
  {
    id: 'wording', title: 'Review every wording change', icon: 'type',
    blurb: 'Rewording, typos and moved paragraphs, word by word.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Wording, typo and moved changes. Open a row for the word-by-word difference.', filter: { categories: ['wording', 'typo', 'moved'] } },
    ],
  },
  {
    id: 'formatting', title: 'Check the formatting survived', icon: 'list',
    blurb: 'Headings, lists, bold, italic, fonts and table shape.',
    steps: [
      { tool: 'compare', note: 'Choose the two files (Word or PDF keep the most formatting), then press Compare.' },
      { tool: 'changes', note: 'Formatting changes: heading levels, lists, bold, fonts and sizes.', filter: { categories: ['formatting'] } },
    ],
  },
  {
    id: 'added', title: 'Check what the AI added', icon: 'search',
    blurb: 'New sentences, paragraphs and sections: AI edits can add claims that are not in your original.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Everything that is new in the edited version, and the claims in it that are not in your original. Check any figure, quote or source you did not write.', filter: { categories: ['added', 'newClaim'] } },
    ],
  },
  {
    id: 'structure', title: 'Check headings and structure', icon: 'list-checks',
    blurb: 'Missing or renamed headings, changed heading levels, lists turned into paragraphs.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Removed content, formatting and numbering: heading levels, lists, and numbers with a gap, a repeat or a new number. Removed sections show as one row.', filter: { categories: ['removed', 'formatting', 'numbering'] } },
    ],
  },
  {
    id: 'moved', title: 'Find paragraphs that were moved', icon: 'compare',
    blurb: 'Text the AI kept but put somewhere else, which can change the order of an argument.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Paragraphs that moved. The location shows where each one was and where it is now.', filter: { categories: ['moved'] } },
    ],
  },
  {
    id: 'shrink', title: 'Check the document did not shrink', icon: 'file-text',
    blurb: 'Compare word count, size, headings, tables and images between the two files.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'metadata', note: 'Compare the counts. A word count that dropped by more than 5% is flagged, because it often means skipped content.' },
    ],
  },
  {
    id: 'pdf-pages', title: 'Compare two PDFs page by page', icon: 'columns',
    blurb: 'See which pages look different and view them side by side.',
    steps: [
      { tool: 'compare', note: 'Choose the two PDF files, then press Compare.' },
      { tool: 'pages', note: 'Pages with visible changes are listed. Open one to see the two side by side.' },
    ],
  },
  {
    id: 'author', title: 'Send the fixes back to the author', icon: 'list-checks',
    blurb: 'A PDF to-do list of every change, most serious first, with what to fix.',
    steps: [
      { tool: 'compare', note: 'Choose the original and the edited file, then press Compare.' },
      { tool: 'report', note: 'Press Download review for the author and send the PDF to whoever made the edit.' },
    ],
  },
  {
    id: 'share', title: 'Make a report to share', icon: 'share-2',
    blurb: 'Compare, narrow the list if you want, and download a PDF.',
    steps: [
      { tool: 'compare', note: 'Choose the two files, then press Compare.' },
      { tool: 'changes', note: 'Optional: filter the list. The report includes only what is shown here.' },
      { tool: 'report', note: 'Download the PDF report.' },
    ],
  },
];

// The longer text for the (i) "How DocCompare works" box, shown once per browser and from the (i) button.
export const HOW_IT_WORKS = [
  ['What it is for', 'When an AI edits a document it sometimes drops a paragraph, changes a number or quietly rewords a sentence. DocCompare puts the original and the edited version side by side and lists every difference, with missing content shown first and most prominently.'],
  ['Your files stay on your computer', 'Both files are read and compared inside this browser tab. Nothing is uploaded and nothing is sent to an AI model. Each check is saved in this browser only (Saved checks), so it is there when you come back on this computer, and gone if you delete it or clear this browser\'s site data. Download the PDF report to keep a copy anywhere else. The one exception is Fetch a web page: only the address you type is sent, to Vault\'s own server, which downloads that public page and hands it back to this tab. Your files and drafts are never sent.'],
  ['Where to start', 'Pick a job on the "What do you want to do?" screen (for example "Check the AI did not leave anything out") and DocCompare walks you through it, or pick a tool in the list on the left. Hover any tool or button for a short explanation. The compass beside the title runs a 17-step guided tour (also in Settings, DocCompare Tour).'],
  ['Choosing files', 'In Compare documents, drop a file on Original and another on Edited (LLM output), or press Choose file. Both must be the same type: PDF, Word (.docx), web page (.html or .htm), Markdown (.md) or plain text (.txt); the one mix allowed is a web page with a Word file. Old Word .doc files must be saved as .docx first. A scanned PDF with no text in it cannot be read, and a password-protected PDF must be unlocked first.'],
  ['Labels and saved checks', 'Type a label above the two file boxes (optional; otherwise the edited file name and the date are used). Every comparison is then saved under that label, with both files and your decisions, in this browser. Saved checks lists them, newest first: search by label or file name, Open one to come back to it (the comparison runs again and your decisions come back), Rename it, or Delete it (it asks Yes or No, and removes the files and decisions too). Comparing the same two files again updates the same saved check instead of adding a copy. Nothing is uploaded, so another browser or computer will not see them, and clearing this browser\'s site data removes them.'],
  ['The two checks before comparing', 'First, the file types must match, or DocCompare stops and says why. Second, it scores how alike the two files are (0 to 100, from matching headings, shared wording and structure). Below the threshold in Settings (60 unless changed) it warns that they may not be versions of the same document, lists the reasons, and lets you Cancel or Compare anyway. Compare anyway is noted in the report.'],
  ['The verdict', 'After comparing you see one of three verdicts. Not ready to submit: a red item (removed content, a changed figure, a big cut) has not been decided, or is marked Fix later. Review recommended: no red items are open, but some amber ones (rewording, added text, structure) are. No significant changes found: only minor changes, or everything is decided. A card for each item says what happened, why it matters and what to do. Restore copies the original text so you can paste it back; Accept records the change was intended; Fix later keeps it open. Your decisions are kept in this browser for these two files, so they are still there if you reload or compare the same files again. The verdict shows what changed; it does not check whether the content is accurate.'],
  ['Reading the results', 'The summary bar counts each kind of change; press one to see only those in Changes. Removed content, removed sections and changed numbers or dates are marked High, because they are what an AI edit most often gets wrong. The table lists each change with where it is, what it was and what it became; press a row to see the words that changed (struck through in red for removed, underlined in green for added).'],
  ['Kinds of change', 'Removed and Added: whole paragraphs, sections or table rows. Moved: the same text in a new place. Wording: words changed inside a paragraph (marked High when a large part was dropped). Typo: one small word fix. Number/date: anything with a digit changed. Formatting: headings, lists, bold, italic, fonts and sizes. Layout: PDF pages that look different. Metadata: file size, dates, author and counts, for example a word count that dropped.'],
  ['New claims and quotes', 'LLMs sometimes invent statistics, quotes and sources. Any statistic (a percentage, an amount, a count, a year), quote, citation such as [3] or (Smith et al., 2021), link, or source ("a 2021 survey by …") in added or changed text that is nowhere in your original is a red New claim: check the source exists and says this, or remove it. A figure that replaced another figure is a Number change instead. A direct quote (four or more words in quotation marks, or a block quote) must match your original exactly: any change, even a corrected typo, is red.'],
  ['Limits, required headings and versions', 'Set a word limit on the Compare documents screen (and a page limit in Settings): over the limit is red. The reference list is not counted and footnotes are, unless you change that in Settings; File details shows the words section by section. In Settings you can paste the headings this submission must have (and save them as a named template): a missing one is red, one out of order is amber. Without a list, every heading in your original counts, and a removed one is already reported. A version number near the start ("Version 1.3", "v1.3", "Rev B", "Draft 4") that did not change although the content did is amber; one that went backwards is red.'],
  ['References, numbering, spelling and terms', 'References and footnotes: the reference list (under a heading such as References, Bibliography or Sources), footnotes and endnotes are matched between the two versions. A reference or footnote that was removed, added (a possible invented source) or changed (authors, year, title or link) is red. A renumbered list is amber, and every citation such as [3] or (Smith 2021) that now points to nothing, to a different source, or sits on different text is red. In a PDF these are found by best effort, and the item says so. Numbering: a gap, a repeat or a number going backwards that your original did not have, in numbered paragraphs, headings, figures and tables, is amber, and so are paragraphs that got a new number. Spelling: DocCompare works out whether your original uses Australian or US spelling and lists every word the LLM switched to the other one as one amber item. Terms: a defined term ("the Act"), an acronym or a phrase your original repeats that the LLM dropped or used much less, an acronym used without its expansion, and a new acronym never spelled out are amber. Add your own protected terms in Settings.'],
  ['Projects and rounds', 'Leave "Save this as your original?" ticked when you compare, and DocCompare keeps a clean copy of your original as a project. Each later draft you add (Compare documents, "Add the latest version") becomes the next round, with an optional note. Every round is checked against your original plus the changes you accepted, so an intended cut is not flagged again, and against the previous round. Cards say what happened since: "New in this round", "You chose to restore this in round 2, but it\'s still missing", "Changed again", or that a paragraph removed in an earlier round hasn\'t come back. Fixed and accepted items move to Resolved; "This round only" shows just what changed since the last round. Timeline lists every round. If you restructure the document on purpose, make the latest round the new original (a reason is required, and open issues it absorbs are listed and always shown in the report). Projects are kept in this browser: export one as a .doccompare file to keep a copy, and compact old rounds to free space.'],
  ['Versions meant to differ', 'For two versions written to be different (a long and a short one, or one for government and one for industry), tick "These are intentionally different versions" in Compare documents before comparing. There is then no verdict and nothing to decide: Verdict and review becomes a Version comparison that groups the sections as in both versions, worded differently (a renamed section counts too), only in A and only in B. Numbers and quotes that differ are still listed, because a statistic or a quote should not change between versions. The same-document warning only appears below 30, and the PDF report is titled Version comparison, with no verdict or watermark. This option is for one-off comparisons, not project rounds.'],
  ['Web pages', 'To check web copy, type a page\'s address under Original and press Fetch (or choose a page you saved with File > Save Page As, for staging sites and pages behind a login). DocCompare keeps the page\'s main content, without menus, headers, footers, cookie banners and scripts, and with "Save this as your original?" ticked the fetched page becomes a new project at once, dated, so it is kept before you edit anything. Download the original as Word, edit it in Word or Google Docs, save it as .docx and add it as round 1: every check runs against the page as it was. Later, fetch the same address as the next round to check the developer published the approved text. The page is read, never displayed: its scripts never run and its pictures never load (alt text is kept). Page limits and the PDF page pictures do not apply to web pages. A page built with JavaScript may show almost no text: save it from your browser after it loads and choose that file instead.'],
  ['Trivial changes', 'Differences in spaces, line breaks, curly or straight quotes, dashes and invisible characters are hidden by default but still counted ("7 trivial changes hidden"). Tick that box to show them, or choose in Settings which of them count as trivial.'],
  ['PDF pages', 'For two PDFs, each page is also drawn and compared pixel by pixel after the text results appear. Pages where more than a tiny share changed are listed in PDF pages and as Layout changes. Open one to see the two pages side by side with the changed pixels in red. Very long PDFs (over 500 pages) wait for you to start this step.'],
  ['Review for the author', 'Download review for the author (in PDF report, and on the Comparison done card) makes a PDF to send back to whoever made the edit: every change, whatever filters are set, sorted into Must fix, Please review and Minor. Each item has a tick box, where it is, what to do ("Restore this paragraph", "Check the changed figure: 30 to 60") and the original and edited text, with removed words in red and added words in green.'],
  ['The report', 'PDF report also downloads a comparison report for your own records: the checks, the summary, the file details, the changes table (with the filters you set in Changes, which it names) and thumbnails of changed PDF pages.'],
  ['What it cannot do', 'It cannot compare two different file types (for example Word against PDF; a web page against a Word file is the one exception), run a web page\'s scripts or read its styling, read scanned PDFs, compare spreadsheets or images yet, or tell you which version is right. It reports differences; you decide what to keep.'],
];

// Everything the guide can point at: the six tools plus the parts inside them. `tool` is the tool (view) the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'compare', label: 'Compare documents', tool: 'compare' },
  { id: 'check-label', label: 'Label', tool: 'compare' },
  { id: 'word-limit', label: 'Word limit', tool: 'compare' },
  { id: 'word-counts', label: 'Words by section', tool: 'metadata' },
  { id: 'required-headings', label: 'Required headings', tool: 'settings' },
  { id: 'glossary', label: 'Protected terms', tool: 'settings' },
  { id: 'files', label: 'Original and Edited files', tool: 'compare' },
  { id: 'saved', label: 'Saved checks', tool: 'saved' },
  { id: 'compare-button', label: 'Compare button', tool: 'compare' },
  { id: 'file-check', label: 'File type check', tool: 'compare' },
  { id: 'same-document', label: 'Same-document check', tool: 'compare' },
  { id: 'projects', label: 'Projects', tool: 'projects' },
  { id: 'save-project', label: 'Save as a project', tool: 'compare' },
  { id: 'versions-mode', label: 'Intentionally different versions', tool: 'compare' },
  { id: 'add-round', label: 'Add the latest version', tool: 'compare' },
  { id: 'fetch-page', label: 'Fetch a web page', tool: 'compare' },
  { id: 'download-word', label: 'Download the original as Word', tool: 'compare' },
  { id: 'timeline', label: 'Timeline', tool: 'timeline' },
  { id: 'new-original', label: 'Make the new original', tool: 'timeline' },
  { id: 'compact', label: 'Compact old rounds', tool: 'timeline' },
  { id: 'round-summary', label: 'Round summary', tool: 'review' },
  { id: 'resolved', label: 'Resolved items', tool: 'review' },
  { id: 'review', label: 'Verdict and review', tool: 'review' },
  { id: 'verdict', label: 'Verdict', tool: 'review' },
  { id: 'review-queue', label: 'Review cards', tool: 'review' },
  { id: 'changes', label: 'All changes', tool: 'changes' },
  { id: 'summary', label: 'Summary bar', tool: 'changes' },
  { id: 'trivial', label: 'Trivial changes', tool: 'changes' },
  { id: 'filters', label: 'Filters and search', tool: 'changes' },
  { id: 'metadata', label: 'File details', tool: 'metadata' },
  { id: 'pages', label: 'PDF pages', tool: 'pages' },
  { id: 'page-viewer', label: 'Page viewer', tool: 'pages' },
  { id: 'report', label: 'PDF report', tool: 'report' },
  { id: 'author-report', label: 'Review for the author', tool: 'report' },
  { id: 'settings', label: 'Settings', tool: 'settings' },
  { id: 'info', label: 'How DocCompare works', tool: 'compare' },
  { id: 'tour', label: 'Guided tour', tool: 'compare' },
];

// postMessage types between Vault's page and the app in its frame (same origin only)
export const OPEN_TYPE = 'doc-compare:open'; // Vault -> app  { type, id }               the guide's Open button: show that part
export const VIEW_TYPE = 'doc-compare:view'; // Vault -> app  { type, view, filter? }   the tool list or a job step: switch view
export const CONTEXT_TYPE = 'doc-compare:context'; // app -> Vault  { type, tool, view, results, pdf, versions }  where the person is
// "Fetch a web page" (inside Vault only): the app asks Vault's page, which calls POST /api/doc-compare/fetch with apiClient and hands
// the HTML back. The app itself makes no network request, and the only thing it ever sends is the address the person typed.
export const FETCH_TYPE = 'doc-compare:fetch-page'; // app -> Vault  { type, id, url }
export const FETCHED_TYPE = 'doc-compare:fetched-page'; // Vault -> app  { type, id, ok, bytes?, finalUrl?, contentType?, error? }
