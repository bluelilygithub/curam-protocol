'use strict';

// Colour palette tool of the Web Extractor: the colours a website's styles actually use, counted, with where each is used (text,
// background, border, other, or a named CSS variable). It reads the page's own style files, the styles written inside the page, the
// style="" attributes and the browser theme colour. Style files are shared by a whole site, so one page usually shows the site's
// palette; `pages` optionally reads a few more pages linked from the first (menu links first, spread across the site) and counts each
// shared style file once.
//
// Reads CSS with PostCSS (never regex over a whole file). Colours are normalised to one spelling (#rrggbb) so #FFF, white and
// rgb(255,255,255) are one colour. Nothing is run: pages that build themselves with JavaScript are not seen. Test:
// node server/services/webExtractorPalette.test.js

const postcss = require('postcss');
const { JSDOM, VirtualConsole } = require('jsdom');

const PAGE_CHOICES = [1, 3, 6]; // the page itself, or with 2 or 5 more
const MAX_COLOURS = 60;
const PAGE_BUDGET_MS = 50000; // no new page is started after this long
const PAGE_CONCURRENCY = 2;
const FILE_EXT_RE = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|zip|docx?|xlsx?|pptx?|mp[34]|mov|css|js|json|xml|txt)$/i;

const NAMED = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', navy: '#000080', teal: '#008080', lime: '#00ff00', aqua: '#00ffff',
  fuchsia: '#ff00ff', olive: '#808000', pink: '#ffc0cb',
};
const NAMED_RE = new RegExp(`\\b(${Object.keys(NAMED).join('|')})\\b`, 'gi');
const TOKEN_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[^)]*\)/gi;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/** "10%" -> 0.1, "0.5" -> 0.5, used for alpha and saturation/lightness. */
function fraction(s) {
  const t = String(s).trim();
  const v = parseFloat(t);
  if (Number.isNaN(v)) return NaN;
  return t.endsWith('%') ? v / 100 : v;
}

function hslToRgb(h, s, l) {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

function rgbToHsl(r, g, b) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * One CSS colour (hex, rgb, rgba, hsl, hsla, or a basic name) -> { hex: '#rrggbb', alpha }, or null when it is not a colour this can read
 * (var(), currentColor, transparent, a bad value).
 */
function parseColour(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (NAMED[s]) return { hex: NAMED[s], alpha: 1 };
  if (s[0] === '#') {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const full = h.split('').map((c) => c + c).join('');
      return { hex: `#${full.slice(0, 6)}`, alpha: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) return { hex: `#${h.slice(0, 6)}`, alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    return null;
  }
  const m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = parts[3] == null ? 1 : fraction(parts[3]);
  if (Number.isNaN(alpha)) return null;
  if (m[1].startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((p) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)));
    if (rgb.some(Number.isNaN)) return null;
    return { hex: `#${rgb.map(hex2).join('')}`, alpha };
  }
  const hue = parseFloat(parts[0]);
  const sat = fraction(parts[1]);
  const lig = fraction(parts[2]);
  if ([hue, sat, lig].some(Number.isNaN)) return null;
  const rgb = hslToRgb(hue, clamp(sat, 0, 1), clamp(lig, 0, 1));
  return { hex: `#${rgb.map(hex2).join('')}`, alpha };
}

const TEXT_PROP = /^(color|-webkit-text-fill-color|text-decoration-color|caret-color|-webkit-text-stroke-color)$/;
const BG_PROP = /^background(-color|-image)?$/;
const BORDER_PROP = /^(border|outline)(-[a-z]+)*$/;
const NAME_OK_PROP = /^(fill|stroke)$/;

function roleOf(prop) {
  if (TEXT_PROP.test(prop)) return 'text';
  if (BG_PROP.test(prop)) return 'background';
  if (BORDER_PROP.test(prop)) return 'border';
  return 'other';
}

/** Every colour written in one declaration value: [{ hex, alpha }]. Basic colour names only count where a colour is expected. */
function coloursIn(prop, value) {
  // url(...) and quoted text (content: "#fed", font names) are not colours
  const v = String(value || '').replace(/url\([^)]*\)/gi, ' ').replace(/"[^"]*"|'[^']*'/g, ' ');
  const found = [];
  for (const m of v.matchAll(TOKEN_RE)) { const c = parseColour(m[0]); if (c) found.push(c); }
  const role = roleOf(prop);
  if (role !== 'other' || NAME_OK_PROP.test(prop)) {
    for (const m of v.matchAll(NAMED_RE)) found.push({ hex: NAMED[m[1].toLowerCase()], alpha: 1 });
  }
  return found;
}

/** What is counted across every page: colours, how each CSS variable is used and which variables point at others. */
function newAccumulator() {
  return { map: new Map(), uses: new Map(), varRoles: new Map(), aliases: new Map() };
}

const VAR_RE = /var\(\s*(--[\w-]+)/g;

/**
 * Count the colours in some CSS.
 * @param {string[]} cssTexts one string per style file or block
 * @param {object} [acc] an accumulator to add to (one is made when it is left out)
 * @returns the accumulator: map (hex -> { count, roles, variables:Set }), uses (variable name -> times var(--name) appears),
 *   varRoles (variable name -> what it is used for: background, text, border, other), aliases (variable name -> variables it points at)
 */
function collectColours(cssTexts, acc = newAccumulator()) {
  const into = acc.map;
  for (const text of cssTexts) {
    const css = String(text || '');
    for (const m of css.matchAll(VAR_RE)) acc.uses.set(m[1], (acc.uses.get(m[1]) || 0) + 1);
    let root;
    try { root = postcss.parse(css); } catch { continue; }
    root.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      const isVar = prop.startsWith('--');
      // what a variable is used for: background: var(--surface) is a background use; --surface: var(--cream) makes --surface an alias of --cream
      for (const m of String(decl.value || '').matchAll(VAR_RE)) {
        if (isVar) {
          if (!acc.aliases.has(prop)) acc.aliases.set(prop, new Set());
          acc.aliases.get(prop).add(m[1]);
        } else {
          let r = acc.varRoles.get(m[1]);
          if (!r) { r = { background: 0, text: 0, border: 0, other: 0 }; acc.varRoles.set(m[1], r); }
          r[roleOf(prop)] += 1;
        }
      }
      const found = coloursIn(isVar ? '' : prop, decl.value);
      for (const c of found) {
        if (c.alpha === 0) continue;
        let e = into.get(c.hex);
        if (!e) { e = { count: 0, roles: { background: 0, text: 0, border: 0, other: 0 }, variables: new Set(), semiTransparent: false }; into.set(c.hex, e); }
        e.count += 1;
        if (isVar) e.variables.add(prop); else e.roles[roleOf(prop)] += 1;
        if (c.alpha < 1) e.semiTransparent = true;
      }
    });
  }
  return acc;
}

/** Style="" attributes and the browser theme colour from a page's HTML. */
function readHtmlColours(html, pageUrl) {
  const doc = new JSDOM(html, { url: pageUrl, virtualConsole: new VirtualConsole() }).window.document;
  const styles = [];
  doc.querySelectorAll('[style]').forEach((el) => {
    const s = el.getAttribute('style');
    if (s && /#|rgb|hsl|[a-z]/i.test(s)) styles.push(`x{${s}}`);
  });
  const themeEl = doc.querySelector('meta[name="theme-color" i], meta[name="msapplication-TileColor" i]');
  const theme = themeEl ? parseColour(themeEl.getAttribute('content')) : null;
  return { styles, themeColor: theme ? theme.hex : '' };
}

/** Which colours are "colourful" and which are greys, whites and blacks. A pale cream or a warm near-black is a neutral too. */
function isNeutral(hsl) {
  return hsl[1] < 12 || hsl[2] > 96 || hsl[2] < 5 || (hsl[1] < 30 && (hsl[2] > 75 || hsl[2] < 20));
}

/** Counted colours -> the result: every colour with its use, plus a suggested background, text, primary and accent. */
function summarise(acc, themeColor) {
  const { map, uses, varRoles, aliases } = acc;
  // every variable that ends up as this one: itself, and the variables that point at it (up to three steps: --text: var(--ink); --ink: #222)
  const reaching = (name) => {
    const out = new Set([name]);
    for (let step = 0; step < 3; step += 1) {
      for (const [alias, targets] of aliases) if (!out.has(alias) && [...targets].some((t) => out.has(t))) out.add(alias);
    }
    return out;
  };
  let total = 0;
  const list = [];
  for (const [hex, e] of map) {
    // a colour held in a CSS variable counts for every place the variable (or one that points at it) is used, and for what
    let used = 0;
    const roles = { ...e.roles };
    const seen = new Set();
    for (const v of e.variables) {
      for (const name of reaching(v)) {
        if (seen.has(name)) continue;
        seen.add(name);
        used += uses.get(name) || 0;
        const r = varRoles.get(name);
        if (r) for (const k of Object.keys(roles)) roles[k] += r[k];
      }
    }
    const count = e.count + used;
    total += count;
    const r = parseInt(hex.slice(1, 3), 16); const g = parseInt(hex.slice(3, 5), 16); const b = parseInt(hex.slice(5, 7), 16);
    const hsl = rgbToHsl(r, g, b);
    list.push({
      hex, rgb: [r, g, b], hsl, count, roles, variables: [...e.variables].sort().slice(0, 4),
      kind: isNeutral(hsl) ? 'neutral' : 'brand', semiTransparent: e.semiTransparent,
    });
  }
  list.sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
  const colors = list.slice(0, MAX_COLOURS).map((c) => ({ ...c, share: total ? Math.round((c.count / total) * 1000) / 10 : 0 }));

  const brand = colors.filter((c) => c.kind === 'brand');
  const pick = (arr, role) => arr.slice().sort((a, b) => b.roles[role] - a.roles[role] || b.count - a.count).find((c) => c.roles[role] > 0);
  // a brand colour is a vivid one: a pale cream or a near-black tint is a background or a text colour, not the colour of the brand
  const vivid = brand.filter((c) => c.hsl[1] >= 25 && c.hsl[2] >= 15 && c.hsl[2] <= 85);
  const primary = vivid[0] || brand[0] || null;
  const hueGap = (a, b) => { const d = Math.abs(a.hsl[0] - b.hsl[0]); return Math.min(d, 360 - d); };
  const accent = primary ? [...vivid, ...brand].find((c) => c !== primary && hueGap(c, primary) >= 30) || null : null;
  const bg = pick(colors, 'background');
  // body text is nearly always a plain dark neutral; a link colour is only taken when there is no neutral text colour
  const others = colors.filter((c) => c !== bg);
  const text = pick(others.filter((c) => c.kind === 'neutral'), 'text') || pick(others, 'text');
  return {
    colors,
    colourCount: map.size,
    suggested: { primary: primary && primary.hex, accent: accent && accent.hex, background: bg && bg.hex, text: text && text.hex },
    themeColor,
  };
}

/** The first `n` internal pages to read besides the page itself: menu links first, spread across the site's sections. */
function pickPages(links, pageUrl, n) {
  if (n <= 0) return [];
  let here;
  try { here = new URL(pageUrl); } catch { return []; }
  const seen = new Set([here.origin + here.pathname.replace(/\/$/, '')]);
  const groups = new Map();
  for (const l of links) {
    if (l.type !== 'internal') continue;
    let u;
    try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || FILE_EXT_RE.test(u.pathname)) continue;
    const key = u.origin + u.pathname.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const section = u.pathname.split('/').filter(Boolean)[0] || '';
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(u.origin + u.pathname + u.search);
  }
  // one from each section in the order met, then a second from each, and so on
  const out = [];
  for (let round = 0; out.length < n; round += 1) {
    let any = false;
    for (const g of groups.values()) {
      if (g[round]) { out.push(g[round]); any = true; if (out.length >= n) break; }
    }
    if (!any) break;
  }
  return out;
}

/**
 * @param {string} pageUrl     where the first page ended up
 * @param {string} body        the first page's HTML, already fetched
 * @param {{ pages?: number }} [opts]
 * @param {{ fetcher: Function, scrapeCss?: Function, now?: Function }} deps  fetcher is the page fetcher (restyle/pageFetch.js)
 */
async function buildPalette(pageUrl, body, opts = {}, deps = {}) {
  const scrape = deps.scrapeCss || require('./restyle/scrapeCss').scrapePageCss;
  const { extractLinks } = require('./webExtractorService');
  const { normaliseHttpUrl } = require('./htmlFetch');
  const now = deps.now || Date.now;
  const started = now();
  const want = PAGE_CHOICES.includes(Number(opts.pages)) ? Number(opts.pages) : 1;

  const acc = newAccumulator();
  const cssSeen = new Set(); // a style file used by many pages is counted once
  const pages = [];
  const flags = [];
  let themeColor = '';
  let fileCount = 0;

  const cached = new Map([[normaliseHttpUrl(pageUrl), { body, statusCode: 200, finalUrl: pageUrl }]]);
  const assets = new Map(); // a style file used by several pages is fetched once
  const fetchHtml = async (u, o) => {
    if (!o && cached.has(u)) return cached.get(u); // the page already fetched is not fetched again
    if (o && o.asset) {
      if (!assets.has(u)) assets.set(u, deps.fetcher(u, o));
      return assets.get(u);
    }
    return deps.fetcher(u, o);
  };

  const readOne = async (url, html) => {
    const got = await scrape(url, {}, { fetchHtml });
    const texts = [];
    for (const f of got.files) {
      const key = f.url || `inline:${f.css.length}:${f.css.slice(0, 80)}`;
      if (cssSeen.has(key)) continue;
      cssSeen.add(key);
      texts.push(f.css);
      fileCount += 1;
    }
    const inline = readHtmlColours(html, got.finalUrl || url);
    if (!themeColor && inline.themeColor) themeColor = inline.themeColor;
    collectColours([...texts, ...inline.styles], acc);
    for (const fl of got.flags || []) if (!flags.includes(fl)) flags.push(fl);
    return got;
  };

  const first = await readOne(pageUrl, body);
  pages.push({ url: first.finalUrl || pageUrl, ok: true });

  if (want > 1) {
    const targets = pickPages(extractLinks(body, pageUrl).links, pageUrl, want - 1);
    if (!targets.length) flags.push('No other pages on this site were found in the page\'s links, so only this page was read.');
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const u = targets[next++];
        if (now() - started > PAGE_BUDGET_MS) { pages.push({ url: u, ok: false, skipped: true }); continue; }
        try {
          // fetched once here, kept for the style reader so the page is not asked for twice
          const page = await deps.fetcher(u);
          if (page.statusCode >= 400) throw new Error(`Server returned ${page.statusCode}`);
          cached.set(normaliseHttpUrl(u), page);
          const got = await readOne(u, page.body);
          cached.delete(normaliseHttpUrl(u));
          pages.push({ url: got.finalUrl || u, ok: true });
        } catch (err) {
          pages.push({ url: u, ok: false });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, targets.length) }, worker));
    const failed = pages.filter((p) => !p.ok).length;
    if (failed) flags.push(`${failed} of the other pages could not be read (blocked, missing, or the time ran out), so they are not counted.`);
  }

  const result = summarise(acc, themeColor);
  const read = pages.filter((p) => p.ok).length;
  const notes = [...flags];
  if (!result.colors.length) notes.push('No colours were found in this page\'s styles. Pages that build themselves with JavaScript are not run, so their styles and colours are not seen.');
  return { ...result, pages, pagesRead: read, files: fileCount, notice: notes.join(' ') };
}

module.exports = { buildPalette, parseColour, collectColours, newAccumulator, readHtmlColours, summarise, pickPages, rgbToHsl, isNeutral, PAGE_CHOICES };
