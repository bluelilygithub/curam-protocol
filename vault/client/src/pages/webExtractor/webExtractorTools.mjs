// What the Web Extractor page shows in its left-hand list, the hover text for it, and the controls its guide (the round button) can
// point at. The ids are the guide's catalogue (server/services/webExtractorTutor.js); npm run test:web-extractor-tutor fails if the
// two lists drift apart. `mode` is the tool the guide's Open button switches to.

export const WEB_EXTRACTOR_TOOLS = [
  { id: 'article', label: 'Article content', group: 'Text', icon: 'file-text' },
  { id: 'images', label: 'Extract images', group: 'Pictures', icon: 'image' },
  { id: 'styled', label: 'Exact scrape', group: 'Page', icon: 'layout-grid' },
];

export const GROUPS = ['Text', 'Pictures', 'Page'];

export const GROUP_TIPS = {
  Text: 'Pull the readable words out of a page, without the menus, adverts and sidebars.',
  Pictures: 'List every picture on a page so you can look through them and download the ones you want.',
  Page: 'Keep the page looking the way it does on the website, as a safe preview you can copy the code from.',
};

export const TOOL_TIPS = {
  article: 'Readable text only, with its headings. No menus, adverts, sidebars, "most read" boxes or pictures. Copy it or save it as a PDF.',
  images: 'Every picture on the page, biggest version first, with its description. Download one, or all of them in one zip.',
  styled: 'The page as it looks on the site, in a safe preview where nothing can run. Copy its code to use elsewhere.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  article: 'Pull the readable text out of a page: no adverts, menus, sidebars or pictures.',
  images: 'List every picture on a page, with its description, and download them.',
  styled: 'Show the page the way it looks on the website, in a safe preview, and copy its code.',
};

// The longer text for the (i) "How the Web Extractor works" box.
export const HOW_IT_WORKS = [
  ['Article content', 'Paste a web address and press Extract. You get the words of the page with its headings, ready to copy or save as a PDF. Type section names in "Also exclude sections titled…" to drop boxes the tool left in, such as "Author" or "Newsletter signup".'],
  ['Extract images', 'Lists every picture on the page, the biggest version of each, with its description. Press Download under a picture, or Download all for a zip of up to 60.'],
  ['Exact scrape', 'Shows the page as the website has it. It is a still snapshot: nothing on it can run, and the page may look a little different from the live site. Copy HTML gives you its code.'],
  ['What it cannot do', 'It reads the page the way a search engine does, so pages that build themselves with JavaScript, sit behind a sign-in, or block automatic visitors come back empty or thin. It only reads public pages.'],
];

// Everything the guide can point at: the three tools plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'article', label: 'Article content', mode: 'article' },
  { id: 'images', label: 'Extract images', mode: 'images' },
  { id: 'styled', label: 'Exact scrape', mode: 'styled' },
  { id: 'exclude-sections', label: 'Also exclude sections', mode: 'article' },
  { id: 'copy-text', label: 'Copy text', mode: 'article' },
  { id: 'download-pdf', label: 'Download PDF', mode: 'article' },
  { id: 'download-images', label: 'Download images', mode: 'images' },
  { id: 'copy-html', label: 'Copy HTML', mode: 'styled' },
];

/**
 * Turn what was said into a web address: "example dot com slash news" -> "example.com/news". Only spoken text goes through
 * this (the field's own typing is never changed), so a real word like "dot" in typed text is safe.
 */
export function parseSpokenUrl(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const symbols = { dot: '.', slash: '/', colon: ':', dash: '-', hyphen: '-', underscore: '_' };
  const joined = t.replace(/\b(dot|slash|colon|dash|hyphen|underscore)\b/gi, (w) => symbols[w.toLowerCase()]).replace(/\s+/g, '').replace(/\.+$/, '');
  return joined.toLowerCase();
}

/** "Author comma Date" -> "Author, Date" (browsers rarely write the comma themselves). */
export function parseSpokenList(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  return t.replace(/\s*\bcomma\b\s*/gi, ', ').replace(/,\s*$/, '').replace(/\s{2,}/g, ' ');
}
