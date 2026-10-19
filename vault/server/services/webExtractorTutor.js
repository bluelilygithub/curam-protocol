'use strict';

// The Web Extractor guide (the round button on Vault's /web-extractor page): a person says what they want from a web page ("get the
// text of this article", "save all the pictures", "copy the page's code") and the guide points at the real tools and buttons, in order,
// or says plainly that Web Extractor does not do it. It only knows what is written here and it never sees any page or result. Built on
// guideCore.js; the ids are the page's own, listed in client/src/pages/webExtractor/webExtractorTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/web-extractor.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'article', label: 'Article content', group: 'Text',
    does: 'Paste a web address at the top and press Extract. You get the readable words of the page with its headings, in a box you can read, copy or save as a PDF. The menus, header and footer, adverts, sidebars, comments, "most read" and "related stories" boxes, forms and all pictures are left out.',
    notes: 'Only public pages. A page that builds itself with JavaScript, needs a sign-in, or blocks automatic visitors can come back empty or thin, and the tool says so.' },
  { id: 'exclude-sections', label: 'Also exclude sections', group: 'Text',
    does: 'In Article content, the box "Also exclude sections titled…" takes names separated by commas, for example Author, Date, Newsletter signup. Any box on the page whose heading is one of those names is left out of the text. It matches the whole heading word, so "Date" does not remove a heading such as "Updates".',
    notes: 'It works on headings. Plain text with no heading above it cannot be picked out this way.' },
  { id: 'copy-text', label: 'Copy text', group: 'Text',
    does: 'The Copy text button above the article puts the extracted text on the clipboard.', notes: 'It copies the text only, with the headings marked by # signs.' },
  { id: 'download-pdf', label: 'Download PDF', group: 'Text',
    does: 'The Download PDF button above the article saves the extracted text as a plain A4 PDF with the title, the author and the web address at the top.',
    notes: 'The PDF has text only, in one plain font. Letters outside the Western alphabets (such as Chinese or emoji) show as ?, and the tool tells you how many.' },
  { id: 'images', label: 'Extract images', group: 'Pictures',
    does: 'Paste a web address and press Extract. You get every picture on the page as a grid, the biggest version of each, with its description. The picture the page chose for sharing comes first.',
    notes: 'It finds pictures written into the page. Pictures drawn by JavaScript cannot be seen. Tiny tracking dots are skipped.' },
  { id: 'download-images', label: 'Download images', group: 'Pictures',
    does: 'The Download button under a picture saves that one. Download all at the top saves up to 60 pictures in one zip, a few at a time. If some could not be fetched, the tool says how many.',
    notes: 'Up to 60 pictures and about 150 MB per zip. Only real pictures are downloaded. You are responsible for having the right to use them.' },
  { id: 'styled', label: 'Exact scrape', group: 'Page',
    does: 'Paste a web address and press Extract. The page appears in a framed preview the way the website shows it, with its own styling. Nothing on the page can run in the preview.',
    notes: 'It is a still snapshot. Anything the page draws with JavaScript is missing, and it can look a little different from the live site.' },
  { id: 'copy-html', label: 'Copy HTML', group: 'Page',
    does: 'The Copy HTML button above the preview puts the snapshot\'s code on the clipboard, with its addresses made complete so pictures and styles still load when pasted somewhere else.',
    notes: 'Scripts are removed from the copy.' },
];

const RULES = [
  'Every tool starts the same way: paste or speak a web address in the box at the top, choose the tool in the list on the left, then press Extract.',
  'The web address box and the sections box both have a microphone button. Spoken addresses work as "example dot com slash news".',
  'Each tool keeps its own result while you switch between them, so you can run Article content, then Extract images, on the same address without pasting it again.',
  'It reads the page like a search engine does: the page text as the website sends it. It does not run JavaScript, sign in, click anything or scroll.',
  'Only public web addresses work. Addresses on a private network or the person\'s own computer are refused.',
  'Nothing is saved. Results are on the screen until the page is left; copy or download what is needed.',
  'The Open buttons in this chat only switch to a tool; they never extract anything by themselves.',
];

const NOT_POSSIBLE = [
  'Pages that need a sign-in, a paywall, or a CAPTCHA to open, or that block automatic visitors.',
  'Pages that build their content with JavaScript after they load (many apps, some shops and news sites): they come back empty or thin.',
  'Taking a whole website: it reads one page at a time, with no crawling, no following links and no scheduled or repeated runs.',
  'Saving results inside Vault: there is no history or library, so copy or download them before leaving the page.',
  'Rewriting, summarising or translating what it extracts. Nothing here uses AI on the page; the text can be taken to chat or other tools to do that.',
  'Tables as a spreadsheet, or downloading videos or files other than pictures.',
  'Checking whether the person may copy or reuse the page\'s text or pictures: that is the owner\'s copyright and is up to the person.',
];

const SYSTEM = `You are the guide to the Web Extractor in Vault for one person who wants to pull the text, the pictures or a snapshot out of a public web page. They say, in everyday words, what they want. You point them to the right tool(s) and buttons, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say the Web Extractor cannot do.
- You cannot see any page or any result. Never state or guess what is on a web page.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about which of the three tools fits the job: Article content for the words, Extract images for the pictures, Exact scrape for how the page looks or its code.
- If they want something the page cannot give (a sign-in page, a page built with JavaScript, a whole website), say so plainly and say what they could do instead.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Web Extractor guide', feature: 'web_extractor_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'WEB EXTRACTOR TOOLS AND BUTTONS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want from the web page, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askWebExtractorTutor: guide.ask,
};
