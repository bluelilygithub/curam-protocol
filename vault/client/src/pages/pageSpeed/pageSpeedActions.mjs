// Turns a Page speed report's work order (server/services/htmlLighthouse.js workOrder()) into the Actions tab: plain-English
// to-dos grouped Fix first / Do next / When there is time, each with why it matters, what to do, who usually does it and how big a
// job it is. Works on every saved run (old ones too): no server change, the ticket is matched to its Lighthouse audit by title.
// Also holds the hover text for the Report tab's metrics, field data and sections. Test: node client/src/pages/pageSpeed/pageSpeedActions.test.mjs

export const WHO = {
  dev: 'Developer',
  content: 'Content editor',
  host: 'Hosting / developer',
};

export const EFFORT = {
  quick: 'Quick fix',
  medium: 'Half a day or so',
  big: 'Bigger job',
};

export const PRIORITY_GROUPS = [
  { id: 'P0', label: 'Fix first', tip: 'Outright failures or the biggest slow-downs. These move the score most.' },
  { id: 'P1', label: 'Do next', tip: 'Important, but smaller gains than the Fix first list.' },
  { id: 'P2', label: 'When there is time', tip: 'Worth doing for a polished site; small effect on the score on their own.' },
];

export const CATEGORY_WHY = {
  performance: 'A slow page loses visitors: many leave if a page takes more than about three seconds on a phone, and Google uses speed when ranking.',
  accessibility: 'Some visitors use a screen reader, a keyboard only, or have poor eyesight. This stops them using the page, and in Australia it can be a discrimination risk.',
  'best-practices': 'General safety and quality. Problems here can show browser warnings, break features or make the site look untrustworthy.',
  seo: 'Search engines need these basics to understand and show the page. Fixing them helps the page appear, and look right, in Google results.',
};

export const CATEGORY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'performance', label: 'Performance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best practices' },
  { id: 'seo', label: 'SEO' },
];

import { actionImpact, combinedImpact, pointsLabel } from './scoreImpact.mjs';

// Plain-English help per Lighthouse audit id. plain = what is wrong, how = what to do, who/effort keys above.
// why is optional (falls back to the category's reason).
const H = (plain, how, who = 'dev', effort = 'medium', why = '') => ({ plain, how, who, effort, why });

export const ACTION_HELP = {
  // ---- Performance ----
  redirects: H('The address bounces to another address before the page loads', 'Make every link, the sitemap and Google point straight at the final address (for example always https://www. or always without www). Keep one permanent redirect for old links.', 'host', 'quick', 'Each bounce costs a full round trip before anything shows, often half a second or more on a phone.'),
  'redirects-http': H('The plain http:// address does not send visitors to the secure https:// one', 'Set the server or host to send every http:// request to https:// with a permanent redirect.', 'host', 'quick'),
  'lcp-discovery-insight': H('The main picture at the top of the page is found late', 'Tell the browser to fetch the main (hero) picture first: mark it high priority, never lazy-load it, give it a width and height, and make it smaller for phones.', 'dev', 'quick', 'The largest thing at the top of the page decides when the page "looks loaded" to a visitor and to Google.'),
  'lcp-breakdown-insight': H('The main picture or headline takes too long to appear', 'Your developer should look at which step is slow (server, download or drawing) in the detail below and fix that step. Usually: a smaller hero image, loaded first.', 'dev', 'medium'),
  'lcp-phases-insight': H('The main picture or headline takes too long to appear', 'Your developer should look at which step is slow (server, download or drawing) in the detail below and fix that step. Usually: a smaller hero image, loaded first.', 'dev', 'medium'),
  'largest-contentful-paint-element': H('The main picture or headline takes too long to appear', 'Make the item named below load first and make it smaller: compress the picture, size it for phones, and do not lazy-load it.', 'dev', 'medium'),
  'lcp-lazy-loaded': H('The main picture at the top is set to load late', 'Remove "lazy loading" from the picture at the top of the page. Lazy loading is only for pictures further down.', 'dev', 'quick'),
  'tag-manager': H('The tracking / analytics script slows the first view', 'Load Google Tag Manager or analytics after the page has appeared (or after cookie consent) instead of at the very start.', 'dev', 'quick'),
  'unused-javascript': H('The page downloads program code it does not use', 'Remove plugins and scripts the page does not need, and have the rest load only on the pages that use them.', 'dev', 'big'),
  'unused-css-rules': H('The page downloads styling it does not use', 'Remove unused theme or plugin styles, and load only the styling this page needs at the start.', 'dev', 'medium'),
  'unminified-css': H('Styling files are not compressed', 'Turn on CSS minifying (most caching or optimisation plugins have a tick box for it).', 'dev', 'quick'),
  'unminified-javascript': H('Program files are not compressed', 'Turn on JavaScript minifying (most caching or optimisation plugins have a tick box for it).', 'dev', 'quick'),
  'render-blocking-resources': H('Files hold up the page before anything shows', 'Load the files listed below later (defer them) or put the small bits needed for the first view straight into the page.', 'dev', 'medium'),
  'render-blocking-insight': H('Files hold up the page before anything shows', 'Load the files listed below later (defer them) or put the small bits needed for the first view straight into the page.', 'dev', 'medium'),
  'uses-optimized-images': H('Pictures are bigger files than they need to be', 'Compress the pictures listed below (an image optimiser plugin or tool like Squoosh does this) without visibly losing quality.', 'content', 'quick'),
  'image-delivery-insight': H('Pictures are bigger files than they need to be', 'Compress the pictures listed below, save them as WebP or AVIF, and upload them at the size they are shown, not straight from the camera.', 'content', 'medium'),
  'modern-image-formats': H('Pictures use older, heavier file types', 'Serve pictures as WebP or AVIF instead of JPG/PNG. An image plugin or the host\'s image service can do this automatically.', 'dev', 'quick'),
  'uses-responsive-images': H('Phones download pictures sized for big screens', 'Upload pictures at sensible sizes and let the site serve a smaller copy to phones (most themes do this if the images are added normally).', 'dev', 'medium'),
  'offscreen-images': H('Pictures further down the page load straight away', 'Turn on lazy loading for pictures below the first screen so they load only as the visitor scrolls.', 'dev', 'quick'),
  'efficient-animated-content': H('Animated GIFs are very heavy', 'Replace large animated GIFs with short video files (MP4 or WebM), which are many times smaller.', 'content', 'quick'),
  'uses-text-compression': H('The server sends files without compressing them', 'Turn on gzip or Brotli compression on the server or host (often a single setting).', 'host', 'quick'),
  'server-response-time': H('The server is slow to start sending the page', 'Turn on page caching, check the hosting plan is not overloaded, and consider a CDN. A slow server delays everything else.', 'host', 'medium', 'Nothing can show until the server answers, so a slow server makes every other number worse.'),
  'document-latency-insight': H('The server is slow to start sending the page', 'Turn on page caching and compression, avoid extra redirects, and check the hosting plan is not overloaded.', 'host', 'medium', 'Nothing can show until the server answers, so a slow server makes every other number worse.'),
  'uses-long-cache-ttl': H('Returning visitors re-download files', 'Set the server to tell browsers to keep images, styling and scripts for a long time (a caching setting on the host or a caching plugin).', 'host', 'quick'),
  'cache-insight': H('Returning visitors re-download files', 'Set the server to tell browsers to keep images, styling and scripts for a long time (a caching setting on the host or a caching plugin).', 'host', 'quick'),
  'total-byte-weight': H('The page is very heavy to download', 'Cut the biggest files listed below: compress pictures, remove unused plugins, and avoid autoplay videos at the top.', 'dev', 'medium'),
  'dom-size': H('The page is built from too many pieces', 'Simplify the layout: fewer nested blocks, fewer hidden sections, and avoid page builders stacking boxes inside boxes.', 'dev', 'big'),
  'dom-size-insight': H('The page is built from too many pieces', 'Simplify the layout: fewer nested blocks, fewer hidden sections, and avoid page builders stacking boxes inside boxes.', 'dev', 'big'),
  'bootup-time': H('Scripts take a long time to run on a phone', 'Remove or delay heavy scripts (chat widgets, sliders, trackers) so the page responds sooner.', 'dev', 'big'),
  'mainthread-work-breakdown': H('The phone is kept busy for too long while the page loads', 'Reduce scripts, especially third-party widgets, so the browser is free to respond to taps.', 'dev', 'big'),
  'long-tasks': H('The page freezes in short bursts while loading', 'Your developer should break up or delay the long-running scripts listed below.', 'dev', 'big'),
  'third-party-summary': H('Outside services (ads, chat, trackers) slow the page', 'Review each outside service listed below. Remove ones you do not use and load the rest after the page appears.', 'dev', 'medium'),
  'third-parties-insight': H('Outside services (ads, chat, trackers) slow the page', 'Review each outside service listed below. Remove ones you do not use and load the rest after the page appears.', 'dev', 'medium'),
  'font-display': H('Text is invisible while fonts download', 'Set fonts to show a fallback font straight away (font-display: swap), or host the fonts on your own site.', 'dev', 'quick'),
  'font-display-insight': H('Text is invisible while fonts download', 'Set fonts to show a fallback font straight away (font-display: swap), or host the fonts on your own site.', 'dev', 'quick'),
  'layout-shifts': H('The page jumps around while loading', 'Give pictures, videos, ads and banners a fixed space so content below does not move when they load.', 'dev', 'medium', 'A jumping page makes people tap the wrong thing, and Google measures it (CLS).'),
  'cls-culprits-insight': H('The page jumps around while loading', 'Give pictures, videos, ads and banners a fixed space so content below does not move when they load.', 'dev', 'medium', 'A jumping page makes people tap the wrong thing, and Google measures it (CLS).'),
  'unsized-images': H('Pictures have no set width and height', 'Add a width and height to each picture listed so the browser saves the space before it loads.', 'dev', 'quick'),
  'uses-rel-preconnect': H('The browser connects to other sites late', 'Add early "preconnect" hints for the outside sites listed (fonts, CDN) so the connection is ready when needed.', 'dev', 'quick'),
  'legacy-javascript': H('Old-browser code is sent to modern browsers', 'Have the build send modern code to modern browsers instead of extra compatibility code.', 'dev', 'medium'),
  'legacy-javascript-insight': H('Old-browser code is sent to modern browsers', 'Have the build send modern code to modern browsers instead of extra compatibility code.', 'dev', 'medium'),
  'duplicated-javascript': H('The same code is downloaded twice', 'Remove the duplicate libraries listed (often two plugins bundling the same library).', 'dev', 'medium'),
  'duplicated-javascript-insight': H('The same code is downloaded twice', 'Remove the duplicate libraries listed (often two plugins bundling the same library).', 'dev', 'medium'),
  'forced-reflow-insight': H('Page scripts make the browser redo the layout repeatedly', 'Your developer should change the scripts listed so they measure first and change the page after, not back and forth.', 'dev', 'medium'),
  'network-dependency-tree-insight': H('Files load one after another instead of together', 'Shorten the chain shown below: load key files earlier, and add preconnect hints for outside sites.', 'dev', 'medium'),
  'viewport-insight': H('Taps feel delayed on phones', 'Make sure the page has the standard mobile viewport setting so phones do not wait before responding.', 'dev', 'quick'),
  'non-composited-animations': H('Animations make the page stutter', 'Animate only movement and fading (transform and opacity), not size or colour, for the elements listed.', 'dev', 'medium'),
  // ---- Accessibility ----
  'color-contrast': H('Some text is hard to read against its background', 'Darken the text or lighten the background on the items listed until each reaches at least 4.5 to 1 (3 to 1 for large headings). Fix the shared colour, not each item.', 'dev', 'quick'),
  'image-alt': H('Pictures have no description for blind visitors (or Google)', 'Add short alt text to each picture listed saying what it shows. Purely decorative pictures get empty alt text.', 'content', 'quick'),
  'link-name': H('Some links have no readable name', 'Give each link listed visible text or a label, so a screen reader can say where it goes (common with icon-only links).', 'dev', 'quick'),
  'button-name': H('Some buttons have no readable name', 'Give each button listed a text label (common with icon-only buttons such as menu or search).', 'dev', 'quick'),
  label: H('Form fields have no label', 'Give each form field listed a visible label (or an accessible name) so people know what to type.', 'dev', 'quick'),
  'select-name': H('Drop-down lists have no label', 'Give each drop-down listed a label saying what it chooses.', 'dev', 'quick'),
  'heading-order': H('Headings skip levels', 'Use headings in order (H1, then H2, then H3) without jumping from H2 to H4. Pick heading levels by structure, not by size.', 'content', 'quick'),
  'html-has-lang': H('The page does not say what language it is in', 'Add the language to the page (lang="en-AU") so screen readers pronounce it correctly.', 'dev', 'quick'),
  'html-lang-valid': H('The page language setting is not valid', 'Set the page language to a real code such as en-AU.', 'dev', 'quick'),
  'meta-viewport': H('Visitors cannot zoom in on phones', 'Remove the setting that blocks zooming (user-scalable=no or maximum-scale=1).', 'dev', 'quick'),
  'target-size': H('Buttons or links are too small or too close together to tap', 'Make the items listed at least 24 pixels and leave space between them so a finger hits the right one.', 'dev', 'medium'),
  'link-in-text-block': H('Links inside text look like normal text', 'Underline links in paragraphs (or make them clearly different) so they can be told apart without colour.', 'dev', 'quick'),
  list: H('Lists are built incorrectly', 'Your developer should make sure list items sit directly inside a list, as shown below.', 'dev', 'quick'),
  listitem: H('List items sit outside a list', 'Your developer should put each list item inside a proper list.', 'dev', 'quick'),
  'frame-title': H('Embedded frames (maps, videos) have no title', 'Give each embedded frame listed a short title saying what it is.', 'dev', 'quick'),
  tabindex: H('Keyboard order is forced in an odd way', 'Remove positive tabindex values so keyboard users move through the page in its natural order.', 'dev', 'quick'),
  'document-title': H('The page has no title', 'Add a clear page title. It shows in the browser tab and as the headline in Google results.', 'content', 'quick'),
  'aria-generic': H('Screen-reader labels on the page are set up wrongly', 'Your developer should fix the ARIA attributes on the elements listed below, or remove them where plain HTML would do.', 'dev', 'medium'),
  // ---- Best practices ----
  'is-on-https': H('Parts of the site are not secure (https)', 'Make sure the whole site and every picture or script it loads uses https://.', 'host', 'quick'),
  'errors-in-console': H('The page reports errors in the browser', 'Your developer should fix the errors listed: often a broken script, a missing file or a blocked outside service.', 'dev', 'medium'),
  'inspector-issues': H('The browser flagged problems with the page', 'Your developer should review the issues listed below (often cookie or security settings).', 'dev', 'medium'),
  deprecations: H('The page uses browser features that are being removed', 'Update the plugins or code listed before browsers stop supporting them.', 'dev', 'medium'),
  'third-party-cookies': H('Outside services set cookies browsers are phasing out', 'Check the services listed still work without third-party cookies and update or replace them.', 'dev', 'medium'),
  'image-aspect-ratio': H('Pictures are shown stretched or squashed', 'Show the pictures listed at their natural shape, or crop them to the shape needed.', 'content', 'quick'),
  'image-size-responsive': H('Pictures look blurry on sharp screens', 'Upload the pictures listed at a larger size (about twice the shown size).', 'content', 'quick'),
  'paste-preventing-inputs': H('Visitors cannot paste into some fields', 'Allow pasting in the fields listed (blocking it hurts password managers).', 'dev', 'quick'),
  'geolocation-on-start': H('The page asks for location as soon as it opens', 'Only ask for location after the visitor presses a button that needs it.', 'dev', 'quick'),
  'notification-on-start': H('The page asks to send notifications as soon as it opens', 'Only ask after the visitor chooses to get notifications.', 'dev', 'quick'),
  charset: H('The page does not declare its character set', 'Add the standard UTF-8 setting at the top of the page.', 'dev', 'quick'),
  doctype: H('The page is missing its document type', 'Add <!DOCTYPE html> as the very first line.', 'dev', 'quick'),
  // ---- SEO ----
  'meta-description': H('The page has no description for Google', 'Write a one or two sentence description of the page (about 150 characters). Google often shows it under the title.', 'content', 'quick'),
  'http-status-code': H('The page answers with an error code', 'Make sure the page returns a normal "200 OK", not an error, to search engines.', 'host', 'quick'),
  'link-text': H('Links say things like "click here"', 'Change link text to say where it goes ("see our pricing" instead of "click here").', 'content', 'quick'),
  'crawlable-anchors': H('Some links cannot be followed by Google', 'Make each link listed a normal link with a real address, not a script-only click.', 'dev', 'quick'),
  'is-crawlable': H('The page tells Google not to list it', 'Remove the "noindex" setting if this page should appear in Google (check SEO plugin settings).', 'dev', 'quick', 'With this set, the page will not appear in Google at all.'),
  'robots-txt': H('The robots.txt file has problems', 'Fix the errors listed in robots.txt, the file that tells search engines what they may read.', 'dev', 'quick'),
  hreflang: H('Language versions of the page are set up wrongly', 'Fix the hreflang settings listed so Google shows the right language or country version.', 'dev', 'medium'),
  canonical: H('The page points Google at the wrong main address', 'Fix the canonical setting so it names this page\'s own final address.', 'dev', 'quick'),
  'font-size': H('Text is too small to read on a phone', 'Make body text at least 16 pixels on mobile.', 'dev', 'quick'),
  'tap-targets': H('Buttons or links are too small or close together to tap', 'Make the items listed bigger and leave space between them.', 'dev', 'medium'),
  'structured-data': H('Structured data could be checked', 'Test the page in Google\'s Rich Results Test and fix any errors.', 'dev', 'quick'),
};

// The curated tickets from htmlLighthouse.js curatedTickets() have their own titles; map each to an audit id above.
const CURATED_TITLES = [
  [/^Serve one host/i, 'redirects'],
  [/^Make the hero LCP image discoverable/i, 'lcp-discovery-insight'],
  [/^Defer the tag-manager script/i, 'tag-manager'],
  [/^Trim unused JavaScript/i, 'unused-javascript'],
  [/^Minify and split unused CSS/i, 'unused-css-rules'],
  [/^Fix heading levels/i, 'heading-order'],
  [/^Raise text contrast/i, 'color-contrast'],
  [/^Remove forced reflow/i, 'forced-reflow-insight'],
];

/** The Lighthouse audit id behind one work-order ticket ('' if not found). */
export function auditIdFor(ticket, view) {
  if (ticket?.auditId) return ticket.auditId;
  const title = String(ticket?.title || '');
  for (const [re, id] of CURATED_TITLES) if (re.test(title)) return id;
  for (const bag of [view?.failedAudits, view?.opportunities, view?.diagnostics, view?.warnings]) {
    const hit = (bag || []).find((a) => a && a.title === title);
    if (hit) return hit.id;
  }
  return '';
}

function helpFor(auditId) {
  if (ACTION_HELP[auditId]) return ACTION_HELP[auditId];
  if (/^aria-/.test(auditId)) return ACTION_HELP['aria-generic'];
  return null;
}

function normCategory(c) {
  return c === 'bestPractices' ? 'best-practices' : (c || '');
}

/** A stable key for "done" ticks: same issue -> same key across runs of the same site. */
export function actionKey(ticket, view) {
  return auditIdFor(ticket, view) || String(ticket?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
}

// ---- turning Lighthouse's raw evidence into something a person can read ----

const TAG_NAMES = {
  a: 'Link', img: 'Picture', picture: 'Picture', svg: 'Icon', button: 'Button', input: 'Form field', select: 'Drop-down',
  textarea: 'Text box', label: 'Form label', h1: 'Main heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  p: 'Text', span: 'Text', li: 'List item', ul: 'List', ol: 'List', iframe: 'Embedded frame', video: 'Video', nav: 'Menu',
  header: 'Page header', footer: 'Footer', form: 'Form', table: 'Table', section: 'Section', div: 'Block', body: 'The whole page', html: 'The whole page',
};

// Words in a selector that say where on the page something is, most specific first.
const AREAS = [
  [/back-?to-?the-?top|backtotop|to-?top|scroll-?top/i, 'the back-to-top area'],
  [/foot/i, 'the footer'],
  [/logo/i, 'the header (logo)'],
  [/header|topbar|top-bar|masthead/i, 'the header'],
  [/nav|menu|hamburger/i, 'the menu'],
  [/gallery|lightbox/i, 'a gallery'],
  [/product|shop|cart/i, 'the products section'],
  [/hero|banner|slider|carousel|slide/i, 'the banner / slider'],
  [/sidebar|aside/i, 'the sidebar'],
  [/form|contact|enquir/i, 'a form'],
  [/social|facebook|instagram|twitter|linkedin|youtube/i, 'the social media links'],
  [/card|box|tile/i, 'a content box'],
];

function humanWords(s) {
  return String(s || '').replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseSegment(seg) {
  const s = String(seg || '').trim().replace(/:nth-[a-z-]+\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  const tag = (s.match(/^[a-z][a-z0-9]*/i) || [''])[0].toLowerCase();
  const id = (s.match(/#([\w-]+)/) || [])[1] || '';
  const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).filter((c) => !/^(col|row|container|d-|flex|wrap|inner|clearfix|w-|mb-|mt-|p-|m-)/i.test(c));
  return { tag, id, classes };
}

function hrefFromSnippet(snippet) {
  const m = String(snippet || '').match(/\bhref=["']([^"']+)["']/i);
  if (!m) return '';
  const h = m[1];
  if (h === '#' || /^javascript:/i.test(h)) return '';
  if (h.startsWith('#')) return `a spot on this page (${h})`;
  try {
    const u = new URL(h, 'https://x.invalid');
    return u.host === 'x.invalid' ? `${u.pathname}${u.hash}` : `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch { return h.slice(0, 60); }
}

function fileLabel(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return { name: last || u.host, host: u.host.replace(/^www\./, '') };
  } catch { return { name: String(url).slice(0, 60), host: '' }; }
}

export function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(v / 1024))} KB`;
}

/** Plain description of one piece of evidence: { where, detail, code } — `code` is for the developer only. */
export function humanEvidence(it) {
  if (!it || typeof it !== 'object') return null;
  const detail = [];
  let where = '';
  if (it.selector) {
    const segs = String(it.selector).split('>').map(parseSegment);
    const last = segs[segs.length - 1] || {};
    const kind = TAG_NAMES[last.tag] || 'Element';
    const ownName = last.id || last.classes[0] || '';
    const label = String(it.label || '').trim();
    const goodLabel = !!label && label !== it.selector && !/[.#>]/.test(label) && label.toLowerCase() !== last.tag;
    let name = '';
    if (goodLabel) name = `"${label.slice(0, 60)}"`;
    else if (ownName) name = `"${humanWords(ownName)}"`;
    else {
      const parent = [...segs].reverse().slice(1).find((p) => p.id || p.classes.length);
      if (parent) name = `inside "${humanWords(parent.id || parent.classes[0])}"`;
    }
    const area = (AREAS.find(([re]) => re.test(it.selector)) || [])[1];
    where = [kind, name].filter(Boolean).join(' ');
    if (area) detail.push(`in ${area}`);
    const href = hrefFromSnippet(it.snippet);
    if (href && last.tag === 'a') detail.push(`goes to ${href}`);
  } else if (it.url) {
    const f = fileLabel(it.url);
    where = f.name;
    if (f.host && f.name.replace(/^www\./, '') !== f.host) detail.push(f.host);
  } else if (it.label || it.subpart) {
    where = String(it.subpart || it.label);
  } else if (it.snippet) {
    where = String(it.snippet).slice(0, 80);
  } else {
    return null;
  }
  if (it.subpart && it.duration != null) detail.push(`${it.duration} ms`);
  if (it.fg && it.bg) detail.push(`text ${it.fg} on ${it.bg}${it.contrastRatio != null ? `, contrast ${Number(it.contrastRatio).toFixed(1)} to 1 (needs 4.5)` : ''}`);
  if (it.wastedBytes != null && it.wastedBytes > 0) detail.push(`${fmtBytes(it.wastedBytes)} could be saved${it.totalBytes ? ` of ${fmtBytes(it.totalBytes)}` : ''}`);
  else if (it.totalBytes) detail.push(fmtBytes(it.totalBytes));
  if (it.wastedMs != null && it.wastedMs > 0) detail.push(`${it.wastedMs} ms slower`);
  const code = [it.selector, it.selector && it.url ? it.url : '', it.snippet && it.snippet !== it.selector ? it.snippet : '']
    .filter(Boolean).map((c) => String(c).slice(0, 240));
  return { where, detail: detail.join(' · '), code };
}

/** Fallback for work-order evidence that is only a pre-joined string ("selector · url · explanation"). */
function evidenceStringToItem(line) {
  const parts = String(line || '').split(' · ').map((p) => p.trim()).filter(Boolean)
    .filter((p) => !/^Fix (all|any) of the following/i.test(p));
  const out = {};
  for (const p of parts) {
    if (/^https?:\/\//i.test(p)) out.url = out.url || p;
    else if (/bytes unused$/.test(p)) out.wastedBytes = Number(p.replace(/\D/g, ''));
    else if (/ms wasted$/.test(p)) out.wastedMs = Number(p.replace(/\D/g, ''));
    else if (!out.selector && /[>.#]|^[a-z][a-z0-9]*$/i.test(p) && !/\s{2,}/.test(p) && p.length < 300 && !/ /.test(p.replace(/ > /g, '>'))) out.selector = p;
    else out.label = out.label || p;
  }
  return out;
}

/**
 * Lighthouse's per-element explanation ("Fix all of the following: ... Fix any of the following: ...") as readable groups:
 * [{ heading, points: [] }]. Returns [] when there is nothing useful.
 */
export function explanationGroups(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw.split(/(Fix (?:all|any) of the following:)/i).map((p) => p.trim()).filter(Boolean);
  const groups = [];
  let heading = '';
  const STARTERS = /\s+(?=(?:Element |aria-|Document |Form element|Image |Link |The element|Required ARIA|ARIA |Heading |List |Page |Text |Background ))/;
  for (const p of parts) {
    if (/^Fix all of the following:/i.test(p)) { heading = 'All of these need fixing'; continue; }
    if (/^Fix any of the following:/i.test(p)) { heading = 'Fixing any one of these is enough'; continue; }
    let points = p.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (points.length === 1) points = points[0].split(STARTERS).map((x) => x.trim()).filter(Boolean);
    groups.push({ heading: heading || 'Why it was flagged', points: points.map((x) => x.replace(/\s+/g, ' ')) });
    heading = '';
  }
  return groups;
}

/** Lighthouse's description without the dangling "Learn more ..." sentence and the [attr] code marks. */
export function cleanLighthouseText(s) {
  return String(s || '')
    .replace(/`?\[([a-z-]+(?:\*)?)\]`?/gi, '$1')
    .replace(/`/g, '')
    .replace(/\s*(Learn (more|how|why)[^.]*\.?)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOURCE_ALIAS = { 'tag-manager': 'unused-javascript' };

function sourceAudit(view, auditId, ticketTitle) {
  const bags = [view?.failedAudits, view?.opportunities, view?.diagnostics, view?.warnings];
  const id = SOURCE_ALIAS[auditId] || auditId;
  for (const bag of bags) {
    const hit = (bag || []).find((a) => a && (a.id === id || (/^lcp-/.test(id) && /lcp-(breakdown|discovery|phases)/.test(a.id || ''))));
    if (hit) return hit;
  }
  for (const bag of bags) {
    const hit = (bag || []).find((a) => a && a.title === ticketTitle);
    if (hit) return hit;
  }
  return null;
}

/**
 * The Actions list for one view (mobile or desktop). `otherView` (the other device) is optional; when given each action says whether
 * it also shows up there.
 */
export function buildActions(view, otherView = null) {
  const otherKeys = otherView ? new Set((otherView.workOrder || []).map((t) => actionKey(t, otherView))) : null;
  return (view?.workOrder || []).map((t) => {
    const auditId = auditIdFor(t, view);
    const help = helpFor(auditId);
    const category = normCategory(t.category);
    const key = actionKey(t, view);
    const src = sourceAudit(view, auditId, t.title);
    const rawItems = src && Array.isArray(src.items) && src.items.length
      ? src.items
      : (Array.isArray(t.evidence) ? t.evidence : []).map(evidenceStringToItem);
    const where = [];
    const seenWhere = new Set();
    for (const it of rawItems) {
      const h = humanEvidence(it);
      if (!h) continue;
      const k = `${h.where}|${h.detail}|${h.code.join('|')}`;
      if (seenWhere.has(k)) continue;
      seenWhere.add(k);
      where.push(h);
    }
    const explanations = [...new Set(rawItems.map((it) => String(it?.explanation || '').trim()).filter(Boolean))];
    const flagged = explanations.slice(0, 3).map(explanationGroups).filter((g) => g.length);
    return {
      impact: actionImpact(view, src, category || src?.category || ''),
      where,
      flagged,
      docsUrl: src?.docsUrl || '',
      technicalActionClean: cleanLighthouseText(t.action || ''),
      technicalTitleClean: cleanLighthouseText(t.title || ''),
      key,
      auditId,
      priority: ['P0', 'P1', 'P2'].includes(t.priority) ? t.priority : 'P2',
      category,
      categoryLabel: t.categoryLabel || 'General',
      title: help ? help.plain : t.title,
      why: (help && help.why) || CATEGORY_WHY[category] || 'Google flagged this on the page. Fixing it improves the score shown at the top.',
      how: help ? help.how : 'Pass this one to your developer: the technical detail is underneath.',
      who: help ? WHO[help.who] : WHO.dev,
      effort: help ? EFFORT[help.effort] : '',
      plainKnown: !!help,
      technicalTitle: t.title,
      technicalAction: t.action || '',
      evidence: Array.isArray(t.evidence) ? t.evidence : [],
      alsoOther: otherKeys ? otherKeys.has(key) : null,
    };
  })
    // Within each priority, the biggest estimated gain first (actions with no estimate keep their order after those with one).
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (PRIORITY_RANK[x.a.priority] - PRIORITY_RANK[y.a.priority])
      || ((y.a.impact?.points ?? -1) - (x.a.impact?.points ?? -1))
      || (x.i - y.i))
    .map(({ a }) => a);
}

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2 };

/** One line for an action's estimated gain, e.g. "+6 Performance (estimate)". */
export function impactText(impact) {
  if (!impact) return '';
  const label = CATEGORY_FILTERS.find((c) => c.id === impact.category)?.label || impact.category;
  return `${pointsLabel(impact.points)} ${label}${impact.exact ? '' : ' (estimate)'}`;
}

/** "Performance 41 -> about 63, Accessibility 79 -> 88" for a set of actions. */
export function combinedText(view, actions) {
  const c = combinedImpact(view, actions);
  return CATEGORY_FILTERS.filter((f) => c[f.id]).map((f) => `${f.label} ${c[f.id].from} -> ${f.id === 'performance' ? 'about ' : ''}${c[f.id].to}`).join(', ');
}

/** Plain-text list of the actions, for the Copy button on the Actions tab. */
export function actionsText(actions, { strategy, url, done = new Set() } = {}) {
  const lines = [`Page speed actions (${strategy || 'mobile'})${url ? ` for ${url}` : ''}`, ''];
  for (const g of PRIORITY_GROUPS) {
    const rows = actions.filter((a) => a.priority === g.id);
    if (!rows.length) continue;
    lines.push(`## ${g.label}`);
    for (const a of rows) {
      lines.push(`[${done.has(a.key) ? 'x' : ' '}] ${a.title} (${a.categoryLabel}${a.who ? `, ${a.who}` : ''}${a.impact ? `, ${impactText(a.impact)}` : ''})`);
      lines.push(`    What to do: ${a.how}`);
      if (a.where?.length) {
        lines.push(`    Where on the page:`);
        for (const w of a.where.slice(0, 10)) lines.push(`      - ${w.where}${w.detail ? ` (${w.detail})` : ''}`);
        if (a.where.length > 10) lines.push(`      - and ${a.where.length - 10} more`);
      }
      if (a.plainKnown && a.technicalTitle !== a.title) lines.push(`    Technical: ${a.technicalTitle}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// ---- hover text for the Report tab ----

export const METRIC_HELP = {
  'first-contentful-paint': 'First Contentful Paint: how long until the first text or picture appears. Good is under 1.8 seconds.',
  'largest-contentful-paint': 'Largest Contentful Paint: how long until the biggest item at the top (usually the main picture or headline) appears. This is when the page "looks loaded". Good is under 2.5 seconds.',
  'total-blocking-time': 'Total Blocking Time: how long the page is too busy running scripts to respond to a tap or click while loading. Good is under 200 milliseconds.',
  'cumulative-layout-shift': 'Cumulative Layout Shift: how much the page jumps around as it loads. Good is under 0.1 (zero means nothing moves).',
  'speed-index': 'Speed Index: how quickly the visible part of the page fills in overall. Good is under 3.4 seconds.',
  interactive: 'Time to Interactive: how long until the page reliably responds to taps and clicks. Good is under 3.8 seconds.',
};

export const FIELD_HELP = {
  LARGEST_CONTENTFUL_PAINT_MS: ['Largest Contentful Paint', 'How long real visitors waited for the main item to appear (milliseconds). Good is under 2500.'],
  INTERACTION_TO_NEXT_PAINT: ['Interaction to Next Paint', 'How quickly the page reacted when real visitors tapped or clicked (milliseconds). Good is under 200.'],
  CUMULATIVE_LAYOUT_SHIFT_SCORE: ['Cumulative Layout Shift', 'How much the page jumped for real visitors (shown times 100). Good is under 10.'],
  FIRST_CONTENTFUL_PAINT_MS: ['First Contentful Paint', 'How long real visitors waited for anything to appear (milliseconds). Good is under 1800.'],
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: ['Time to First Byte', 'How long the server took to start answering real visitors (milliseconds). Good is under 800.'],
  FIRST_INPUT_DELAY_MS: ['First Input Delay', 'Older measure of how quickly the page reacted to the first tap (milliseconds). Good is under 100.'],
};

export const FIELD_CATEGORY_HELP = 'FAST, AVERAGE or SLOW is Google\'s verdict from real Chrome visitors over the last 28 days. The number is the 75th percentile: three in four visits were this fast or faster.';

export const SECTION_HELP = {
  opportunities: 'Changes that would make the page load faster, with Google\'s estimate of the time or data saved.',
  diagnostics: 'Things that are not ideal but have no direct time saving, such as too many scripts or a very large page.',
  failedAudits: 'Yes/no checks the page failed outright, across all four categories. These are in the Fix first list on the Actions tab.',
  warnings: 'Checks the page only partly passed. Worth tidying up.',
  labMetrics: 'Timings from this one test run by Google. Colour shows good (green), needs work (amber) or poor (red). Hover a row for what it means.',
  fieldData: 'Real visitors\' experience from the Chrome UX Report, only shown for sites with enough traffic. This is what Google uses for ranking.',
};
