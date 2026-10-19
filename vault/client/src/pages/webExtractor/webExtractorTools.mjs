// What the Web Extractor page shows in its left-hand list, the hover text for it, and the controls its guide (the round button) can
// point at. The ids are the guide's catalogue (server/services/webExtractorTutor.js); npm run test:web-extractor-tutor fails if the
// two lists drift apart. `mode` is the tool the guide's Open button switches to.

export const WEB_EXTRACTOR_TOOLS = [
  { id: 'article', label: 'Article content', group: 'Text', icon: 'file-text' },
  { id: 'images', label: 'Extract images', group: 'Pictures', icon: 'image' },
  { id: 'links', label: 'Links', group: 'Data', icon: 'link' },
  { id: 'tables', label: 'Tables', group: 'Data', icon: 'grid' },
  { id: 'metadata', label: 'Metadata', group: 'Data', icon: 'tag' },
  { id: 'styled', label: 'Exact scrape', group: 'Page', icon: 'layout-grid' },
];

export const GROUPS = ['Text', 'Pictures', 'Data', 'Page'];

export const GROUP_TIPS = {
  Text: 'Pull the readable words out of a page, without the menus, adverts and sidebars.',
  Pictures: 'List every picture on a page so you can look through them and download the ones you want.',
  Data: 'Pull the structured parts out of a page: its links, its tables, and what it says about itself.',
  Page: 'Keep the page looking the way it does on the website, as a safe preview you can copy the code from.',
};

export const TOOL_TIPS = {
  article: 'Readable text only, with its headings, a word count and reading time. No menus, adverts, sidebars, "most read" boxes or pictures. Copy it or save it as a PDF, or point it at one part of the page with a CSS selector.',
  images: 'Every picture on the page, biggest version first, with its description. Download one, or all of them in one zip.',
  links: 'Every link on the page with its words, split into this site, other sites, and email or phone. Filter them, copy them or download a CSV.',
  tables: 'Every table on the page as a grid. Copy one or download it as CSV, or download all of them as JSON.',
  metadata: 'What the page says about itself: title, description, author, dates, social-card tags, structured data and its headings outline.',
  styled: 'The page as it looks on the site, in a safe preview where nothing can run. Copy its code to use elsewhere.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  article: 'Pull the readable text out of a page: no adverts, menus, sidebars or pictures.',
  images: 'List every picture on a page, with its description, and download them.',
  links: 'List every link on a page and where it goes.',
  tables: 'Turn the tables on a page into grids you can copy or download.',
  metadata: 'See the page\'s title, description, dates, share tags, structured data and headings.',
  styled: 'Show the page the way it looks on the website, in a safe preview, and copy its code.',
};

// The longer text for the (i) "How the Web Extractor works" box.
export const HOW_IT_WORKS = [
  ['Article content', 'Paste a web address and press Extract. You get the words of the page with its headings, a word count and reading time, ready to copy or save as a PDF. Type section names in "Also exclude sections titled…" to drop boxes the tool left in, such as "Author" or "Newsletter signup". To read only one part of the page, put a CSS selector such as .product-card in "Only extract inside…".'],
  ['Extract images', 'Lists every picture on the page, the biggest version of each, with its description. Press Download under a picture, or Download all for a zip of up to 60.'],
  ['Links', 'Every link with its words, marked This site, Other site, Email or Phone. Filter by type or by words, copy the list, or download it as a CSV for a spreadsheet. It does not check whether the links still work.'],
  ['Tables', 'Each table on the page as a grid, with its header row when it has one. Copy or download a table as CSV, or download all of them as JSON.'],
  ['Metadata', 'The page\'s title, description, canonical address, author, dates, language, share-card tags, structured data (JSON-LD) and the outline of its headings, with a note if it has no single main heading.'],
  ['Exact scrape', 'Shows the page as the website has it. It is a still snapshot: nothing on it can run, and the page may look a little different from the live site. Copy HTML gives you its code.'],
  ['What it cannot do', 'It reads the page the way a search engine does, so pages that build themselves with JavaScript, sit behind a sign-in, or block automatic visitors come back empty or thin. It only reads public pages, one at a time.'],
];

// Everything the guide can point at: the tools plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'article', label: 'Article content', mode: 'article' },
  { id: 'images', label: 'Extract images', mode: 'images' },
  { id: 'links', label: 'Links', mode: 'links' },
  { id: 'tables', label: 'Tables', mode: 'tables' },
  { id: 'metadata', label: 'Metadata', mode: 'metadata' },
  { id: 'styled', label: 'Exact scrape', mode: 'styled' },
  { id: 'exclude-sections', label: 'Also exclude sections', mode: 'article' },
  { id: 'css-selector', label: 'Only extract inside', mode: 'article' },
  { id: 'copy-text', label: 'Copy text', mode: 'article' },
  { id: 'download-pdf', label: 'Download PDF', mode: 'article' },
  { id: 'download-images', label: 'Download images', mode: 'images' },
  { id: 'download-links', label: 'Download links', mode: 'links' },
  { id: 'download-tables', label: 'Download tables', mode: 'tables' },
  { id: 'copy-metadata', label: 'Copy metadata', mode: 'metadata' },
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

/** "dot product dash card" -> ".product-card"; say "space" for a descendant ("dot list space dot item" -> ".list .item"). */
export function parseSpokenSelector(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const symbols = { dot: '.', hash: '#', pound: '#', dash: '-', hyphen: '-', underscore: '_', space: '\u0000', 'greater than': '>', comma: ',' };
  const joined = t
    .replace(/\b(greater than|dot|hash|pound|dash|hyphen|underscore|space|comma)\b/gi, (w) => symbols[w.toLowerCase()])
    .replace(/\s+/g, '')
    .replace(/\u0000/g, ' ');
  return joined.toLowerCase();
}

// A cell that starts like this would be run as a formula when the file is opened in a spreadsheet, so it gets a ' in front.
const FORMULA_START = /^[=+@\t\r]|^-(?![\d.])/;

/** Rows of text -> CSV text (quoted where needed, formulas defused, Excel-friendly line ends, a byte-order mark so accents survive). */
export function toCsv(rows) {
  const cell = (v) => {
    let s = String(v == null ? '' : v);
    if (FORMULA_START.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`;
}

/** A table as a list of objects keyed by its headers (a missing or repeated header becomes "column N"). */
export function tableToObjects(table) {
  const width = table.colCount || 0;
  const seen = new Set();
  const keys = Array.from({ length: width }, (_, i) => {
    let key = (table.headers && table.headers[i]) || `column ${i + 1}`;
    while (seen.has(key)) key = `${key} (${i + 1})`;
    seen.add(key);
    return key;
  });
  return table.rows.map((row) => Object.fromEntries(keys.map((k, i) => [k, row[i] == null ? '' : row[i]])));
}

/** Links as CSV rows, header first. */
export function linksToRows(links) {
  const label = { internal: 'This site', external: 'Other site', email: 'Email', phone: 'Phone' };
  return [['Words', 'Address', 'Type', 'Nofollow', 'Times on page'], ...links.map((l) => [l.text, l.href, label[l.type] || l.type, l.nofollow ? 'yes' : '', l.occurrences])];
}

/** One table as CSV rows (headers first when it has them). */
export function tableToRows(table) {
  return [...(table.headers ? [table.headers] : []), ...table.rows];
}
