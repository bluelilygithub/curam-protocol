import { Readability } from '@mozilla/readability';
import { countWords, finalize, isBinary, type RawBlock } from './finalize';
import { GateError, type Reader, type Run } from './types';

/**
 * Web pages (.html / .htm, saved with File > Save Page As, or fetched by URL inside Vault). The page is parsed with DOMParser only: a
 * DOMParser document has no browsing context, so its scripts never run and its images, fonts, styles and frames never load. Nothing from
 * the page is ever put into the app's own document. Main content: the page's <main> if it has one, else Mozilla's Readability, else the
 * whole page; navigation, headers, footers, cookie banners, forms' fields, scripts and styles are dropped first.
 * Formatting is what a browser draws by default (CSS is not read): headings and table headers bold, links underlined. Block quotes get
 * Word's "Quote" style name and <pre> the "Code" style, so a page exported to Word (report/wordExport.ts) reads back the same.
 */

type Fmt = Omit<Run, 'text'>;
const WHY_THIN = 'It may be built with JavaScript, which DocCompare does not run. Open the page in your browser, wait for it to load, save it with File > Save Page As (Webpage, HTML only) and upload that file instead.';
export const THIN_WORDS = 30; // fewer words of main content than this: the page is treated as unreadable

// ---- bytes to text: BOM, then <meta charset> in the first 1024 bytes (as browsers do), else UTF-8 ----
export function decodeHtml(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const label = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
  try { return new TextDecoder(label ?? 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

/** The page's own address, if it records one: the browser's "saved from url" comment (also written by Fetch page), <base>, canonical, og:url. */
export function pageUrl(html: string, doc: Document): string | undefined {
  const saved = /<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i.exec(html.slice(0, 2048))?.[1];
  const candidates = [saved, doc.querySelector('base[href]')?.getAttribute('href'), doc.querySelector('link[rel~="canonical"][href]')?.getAttribute('href'), doc.querySelector('meta[property="og:url"]')?.getAttribute('content')];
  for (const c of candidates) { try { if (c) { const u = new URL(c); if (/^https?:$/.test(u.protocol)) return u.toString(); } } catch { /* not absolute */ } }
  return undefined;
}

// ---- clutter ----
const DROP = 'script, style, noscript, template, iframe, frame, frameset, object, embed, svg, canvas, video, audio, map, link, meta, input, select, textarea, option, dialog, [hidden], [aria-hidden="true"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], nav, [role="navigation"], [role="search"]';
const CLUTTER = /cookie|consent|gdpr|onetrust|cookiebot|cc-window|cc-banner|newsletter-popup|modal|popup|skip-link|skip-to|breadcrumb|share-buttons|social-share/i;
const SITE_CHROME = 'header, footer, aside, [role="banner"], [role="contentinfo"], [role="complementary"]';

function removeClutter(root: Document | Element): void {
  root.querySelectorAll(DROP).forEach((e) => e.remove());
  // site header, footer and sidebars; the same elements inside the article (an article's own header holds its title) stay
  root.querySelectorAll(SITE_CHROME).forEach((e) => { if (!e.parentElement?.closest('main, article, [role="main"]')) e.remove(); });
  root.querySelectorAll('[id], [class]').forEach((e) => { if (CLUTTER.test(`${e.id} ${e.getAttribute('class') ?? ''}`) && !e.querySelector('main, article, h1')) e.remove(); });
  root.querySelectorAll('[style]').forEach((e) => { if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.getAttribute('style') ?? '')) e.remove(); });
}

// ---- DOM to blocks ----
const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL', 'SUMMARY', 'CAPTION', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'BODY']);
const headingLevel = (e: Element) => Number(e.getAttribute('data-dc-h') ?? (/^H([1-6])$/.exec(e.tagName)?.[1] ?? 0));

interface Ctx { base?: string; table: number; list?: { depth: number; kind: string }; quote?: boolean }

function href(a: Element, base?: string): string | undefined {
  const raw = (a.getAttribute('data-dc-href') ?? a.getAttribute('href'))?.trim(); // as the page wrote it (see extract)
  if (!raw || raw.startsWith('#')) return undefined;
  try {
    const u = new URL(raw, base);
    return /^(https?|mailto|tel):$/.test(u.protocol) ? u.toString() : undefined; // javascript: and friends are dropped
  } catch { return /^[a-z]+:/i.test(raw) ? undefined : raw; } // relative with no known base: kept as written
}

/** Inline content to runs; images met on the way are returned so the caller can add an image block after the text. */
function inline(node: Node, fmt: Fmt, out: Run[], imgs: string[], ctx: Ctx): void {
  for (const n of Array.from(node.childNodes)) {
    if (n.nodeType === 3) { out.push({ ...fmt, text: (n.textContent ?? '').replace(/[ \t\n\r\f]+/g, ' ') }); continue; }
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    switch (e.tagName) {
      case 'BR': out.push({ ...fmt, text: '\n' }); break;
      case 'IMG': imgs.push((e.getAttribute('alt') ?? '').trim()); break;
      case 'B': case 'STRONG': inline(e, { ...fmt, bold: true }, out, imgs, ctx); break;
      case 'I': case 'EM': case 'CITE': case 'DFN': inline(e, { ...fmt, italic: true }, out, imgs, ctx); break;
      case 'U': inline(e, { ...fmt, underline: true }, out, imgs, ctx); break;
      case 'S': case 'STRIKE': case 'DEL': inline(e, { ...fmt, strike: true }, out, imgs, ctx); break;
      case 'A': { const h = href(e, ctx.base); inline(e, h ? { ...fmt, link: h, underline: true } : fmt, out, imgs, ctx); break; }
      default: inline(e, fmt, out, imgs, ctx); // block elements inside an inline context (a <p> in a <td>) just add their text
    }
  }
}

/** Collapses the whitespace HTML ignores: across run edges, around line breaks, and at both ends. */
function tidy(runs: Run[]): Run[] {
  const out: Run[] = [];
  let prevSpace = true; // at the start, a leading space is dropped
  for (const r of runs) {
    let t = r.text;
    if (t === '\n') { if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, ''); out.push({ ...r }); prevSpace = true; continue; }
    if (prevSpace) t = t.replace(/^ +/, '');
    if (!t) continue;
    prevSpace = t.endsWith(' ');
    out.push({ ...r, text: t });
  }
  while (out.length && /^[ \n]*$/.test(out[out.length - 1].text)) out.pop();
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/[ ]+$/, '');
  return out.filter((r) => r.text);
}
const textOf = (runs: Run[]) => runs.map((r) => r.text).join('');

function walk(el: Element, out: RawBlock[], ctx: Ctx): void {
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const holder = el.ownerDocument.createElement('span');
    pending.forEach((n) => holder.appendChild(n.cloneNode(true)));
    pending = [];
    para(holder, out, ctx);
  };
  for (const n of Array.from(el.childNodes)) {
    const e = n.nodeType === 1 ? (n as Element) : undefined;
    if (!e || !BLOCK_TAGS.has(e.tagName)) { if (n.nodeType === 3 || e) pending.push(n); continue; }
    flush();
    const level = headingLevel(e);
    if (level) {
      const runs: Run[] = [], imgs: string[] = [];
      inline(e, { bold: true }, runs, imgs, ctx);
      const r = tidy(runs);
      if (textOf(r).trim()) out.push({ type: 'heading', level, text: textOf(r), runs: r });
      imgs.forEach((alt) => out.push({ type: 'image', text: alt, runs: [] }));
      continue;
    }
    switch (e.tagName) {
      case 'P': case 'DT': case 'DD': case 'FIGCAPTION': case 'SUMMARY': case 'CAPTION': case 'ADDRESS': para(e, out, ctx); break;
      case 'PRE': { const t = (e.textContent ?? '').replace(/\n$/, ''); if (t.trim()) out.push({ type: 'paragraph', style: 'Code', text: t, runs: t.split(/(\n)/).filter(Boolean).map((x) => ({ text: x })) }); break; }
      case 'BLOCKQUOTE': walk(e, out, { ...ctx, quote: true }); break;
      case 'UL': case 'OL': {
        const depth = (ctx.list?.depth ?? 0) + 1;
        const ordered = e.tagName === 'OL';
        let num = Number(e.getAttribute('start') ?? 1) || 1;
        for (const li of Array.from(e.children).filter((c) => c.tagName === 'LI')) {
          const first = out.length;
          walk(li, out, { ...ctx, list: { depth, kind: ordered ? 'ordered list' : 'bullet list' } });
          if (ordered && out[first]?.type === 'listItem') out[first].number = `${num}.`;
          num++;
        }
        break;
      }
      case 'TABLE': {
        const t = ctx.table++;
        const rows = Array.from(e.querySelectorAll('tr')).filter((tr) => tr.closest('table') === e);
        rows.forEach((tr, r) => Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH').forEach((cell, c) => {
          const runs: Run[] = [], imgs: string[] = [];
          inline(cell, cell.tagName === 'TH' ? { bold: true } : {}, runs, imgs, ctx);
          const rr = tidy(runs);
          out.push({ type: 'tableCell', text: textOf(rr), runs: rr, location: { table: { t, r, c } } });
          imgs.forEach((alt) => out.push({ type: 'image', text: alt, runs: [] }));
        }));
        break;
      }
      case 'HR': case 'NAV': break;
      default: walk(e, out, ctx); // div, section, article, figure, main ...
    }
  }
  flush();
}

function para(e: Element, out: RawBlock[], ctx: Ctx): void {
  const runs: Run[] = [], imgs: string[] = [];
  inline(e, {}, runs, imgs, ctx);
  const r = tidy(runs);
  const text = textOf(r);
  if (text.trim()) {
    if (ctx.list) out.push({ type: 'listItem', level: ctx.list.depth, style: ctx.list.kind, text, runs: r });
    else out.push({ type: 'paragraph', ...(ctx.quote ? { style: 'Quote' } : {}), text, runs: r });
  }
  imgs.forEach((alt) => out.push({ type: 'image', text: alt, runs: [] }));
}

const words = (e: Element | null | undefined) => countWords(e?.textContent ?? '');
const meta = (doc: Document, sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() || undefined;
const date = (s?: string) => { const d = s ? new Date(s) : undefined; return d && !Number.isNaN(d.getTime()) ? d : undefined; };

/** The page's main content as blocks, plus how it was found. Exported for tests. */
export function extract(html: string): { blocks: RawBlock[]; method: string; url?: string; title?: string; author?: string; published?: Date; modified?: Date; generator?: string } {
  const parse = (s: string) => new DOMParser().parseFromString(s, 'text/html');
  const doc = parse(html);
  const url = pageUrl(html, doc);
  const title = (meta(doc, 'meta[property="og:title"]') ?? doc.querySelector('title')?.textContent ?? '').trim() || undefined;
  const info = {
    url, title,
    author: meta(doc, 'meta[name="author"]'),
    published: date(meta(doc, 'meta[property="article:published_time"]')),
    modified: date(meta(doc, 'meta[property="article:modified_time"]')),
    generator: meta(doc, 'meta[name="generator"]'),
  };
  // Readability rewrites links against the document's base, which for a parsed page is the APP's address (and a <base> cannot be set:
  // Vault's CSP has base-uri 'self', which parsed documents inherit). So keep every link as written; href() resolves it against the page.
  doc.querySelectorAll('a[href]').forEach((a) => a.setAttribute('data-dc-href', a.getAttribute('href') ?? ''));
  // Readability turns <h1> into <h2>: remember every heading's real level first
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => h.setAttribute('data-dc-h', h.tagName.slice(1)));
  removeClutter(doc);
  const ctx: Ctx = { base: url, table: 0 };
  const toBlocks = (root: Element) => { const out: RawBlock[] = []; walk(root, out, ctx); return out; };

  const main = doc.querySelector('main, [role="main"]');
  if (main && words(main) >= THIN_WORDS) return { ...info, blocks: toBlocks(main), method: "The page's main area (<main>)" };

  const bodyWords = words(doc.body);
  const article = new Readability(doc.cloneNode(true) as Document, { keepClasses: false }).parse();
  if (article?.content && countWords(article.textContent ?? '') >= Math.max(THIN_WORDS, bodyWords * 0.5)) {
    const blocks = toBlocks(parse(article.content).body);
    // Readability shows the title apart from the text: put the page's own <h1> back on top when it was taken out
    const h1 = doc.querySelector('h1');
    const h1Text = h1?.textContent?.replace(/\s+/g, ' ').trim();
    if (h1Text && !blocks.some((b) => b.type === 'heading' && b.text.trim() === h1Text)) blocks.unshift({ type: 'heading', level: 1, text: h1Text, runs: [{ text: h1Text }] });
    return { ...info, author: info.author ?? (article.byline?.trim() || undefined), published: info.published ?? date(article.publishedTime ?? undefined), blocks, method: 'Article text found by Readability' };
  }
  return { ...info, blocks: doc.body ? toBlocks(doc.body) : [], method: 'The whole page (menus, header, footer and banners removed)' };
}

export const htmlReader: Reader = {
  id: 'html',
  label: 'Web page (HTML)',
  extensions: ['.html', '.htm'],
  sniff: (bytes, name) => !isBinary(bytes) && /\.(html?|xhtml)$/i.test(name),
  async read(file) {
    const html = decodeHtml(new Uint8Array(await file.arrayBuffer()));
    const x = extract(html);
    const doc = finalize(file, 'html', x.blocks, { title: x.title, author: x.author, created: x.published, modified: x.modified, producer: x.generator, url: x.url, extraction: x.method });
    if (doc.metadata.wordCount < THIN_WORDS) throw new GateError('no-text', `${file.name} has almost no text that DocCompare can read (${doc.metadata.wordCount} word${doc.metadata.wordCount === 1 ? '' : 's'}). ${WHY_THIN}`);
    return doc;
  },
};
