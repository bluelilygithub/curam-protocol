'use strict';

const { sameOriginLinks, robotsAllows } = require('./siteCrawler');

function attr(html, tagRe) {
  const m = String(html || '').match(tagRe);
  return m ? String(m[1] || '').trim() : '';
}

function countTags(html, re) {
  const m = String(html || '').match(re);
  return m ? m.length : 0;
}

function imagesMissingAlt(html) {
  const imgs = String(html || '').match(/<img\b[^>]*>/gi) || [];
  let missing = 0;
  for (const tag of imgs) {
    const alt = tag.match(/\balt\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!alt || !String(alt[2] || '').trim()) missing += 1;
  }
  return { total: imgs.length, missing };
}

function extractHeadings(html) {
  const out = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html || '')) && out.length < 40) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ level: Number(m[1]), text: text.slice(0, 160) });
  }
  return out;
}

// Weighted scoring ----------------------------------------------------------
// A flat "-12 per fail, -5 per warn" formula treats a missing OG tag the same
// as a site the robots.txt has effectively de-indexed. A professional audit
// weighs findings by real SEO impact instead. Tiers, heaviest first:
//   CRITICAL (indexability-blocking) — robots.txt blocking everything,
//     noindex on the homepage or a page meant to rank, X-Robots-Tag noindex,
//     4xx/5xx, no usable HTML in the response, a redirect loop. These can
//     remove a page (or the whole site) from the index outright.
//   HIGH — missing/duplicate title, missing H1, query-canonical failures,
//     duplicate/near-duplicate content across pages, broken internal links.
//     These badly split or blunt ranking signal without necessarily blocking
//     indexing.
//   MEDIUM — missing/short/long meta description, missing canonical on a
//     non-query page, missing schema on a commercial page, thin content.
//     Real but secondary ranking signals.
//   LOW — missing OG tags, missing alt text, a redirect chain under 3 hops,
//     hreflang hygiene, missing html lang / viewport. Polish, not
//     indexability or ranking blockers.
// `severity` ('pass'|'warn'|'fail') stays exactly as before for client
// compatibility; `weight` is additive and drives the score.
const FINDING_WEIGHTS = {
  // Critical
  fetch: { fail: 30 },
  status: { fail: 30 },
  'x-robots': { fail: 30 },
  'redirect-loop': { fail: 30 },
  'robots-txt': { fail: 30, warn: 4 },
  'robots-meta': { fail: 30, warn: 6 },
  // High
  title: { fail: 18, warn: 8 },
  h1: { fail: 18, warn: 8 },
  'query-canonical': { fail: 18, warn: 8 },
  'dup-title': { fail: 18, warn: 10 },
  'dup-description': { fail: 14, warn: 8 },
  'dup-h1': { fail: 14, warn: 8 },
  'duplicate-content': { fail: 18, warn: 10 },
  broken: { fail: 18 },
  'noindex-sitemap': { fail: 14, warn: 8 },
  'internal-links': { warn: 8 },
  // Medium
  description: { fail: 10, warn: 6 },
  canonical: { warn: 6 },
  schema: { warn: 6 },
  'schema-fields': { warn: 5 },
  thin: { fail: 10, warn: 6 },
  'query-params': { fail: 10, warn: 5 },
  // Low
  og: { warn: 3 },
  alt: { fail: 6, warn: 3 },
  'redirect-chain': { warn: 3 },
  hreflang: { warn: 3 },
  'html-lang': { warn: 3 },
  viewport: { warn: 3 },
  'js-heavy': { warn: 3 },
};
const DEFAULT_WEIGHT = { fail: 12, warn: 5 };

function weightFor(id, severity) {
  const w = FINDING_WEIGHTS[id] || DEFAULT_WEIGHT;
  if (severity === 'fail') return w.fail != null ? w.fail : DEFAULT_WEIGHT.fail;
  if (severity === 'warn') return w.warn != null ? w.warn : DEFAULT_WEIGHT.warn;
  return 0;
}

function addFinding(list, item) {
  list.push({
    id: item.id,
    severity: item.severity,
    title: item.title,
    detail: item.detail || '',
    recommendation: item.recommendation || '',
    weight: item.severity === 'pass' ? 0 : weightFor(item.id, item.severity),
  });
}

function scoreFromFindings(findings) {
  let score = 100;
  for (const f of findings) {
    score -= f.weight != null ? f.weight : weightFor(f.id, f.severity);
  }
  return Math.max(0, Math.min(100, score));
}

function recommendationsFrom(findings) {
  return (findings || [])
    .filter((f) => f.severity !== 'pass' && f.recommendation)
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      action: f.recommendation,
      why: f.detail || f.title,
    }));
}

const GLOBAL_SPECS = {
  https: {
    applyIn: 'Hosting / CMS',
    action: 'Force HTTPS site-wide (hosting SSL certificate + your CMS’s site URL setting, or hardcode https:// in the template base URL) and 301 all http:// URLs. (On WordPress: hosting SSL + WordPress Address / Site Address.)',
  },
  og: {
    applyIn: 'CMS/SEO plugin defaults, or template',
    action: 'Set default Open Graph tags (title, description, share image) once in your CMS/SEO plugin, or hardcode them in the page template. Then override per URL only where needed. (On WordPress: turn on Open Graph in Yoast, Rank Math, or AIOSEO.)',
  },
  jsonld: {
    applyIn: 'Homepage / Knowledge Graph',
    action: 'Add Organization or LocalBusiness JSON-LD once, in your CMS/SEO plugin’s knowledge-graph setting or a snippet in the site template. (On WordPress: the SEO plugin’s Knowledge Graph setting, or a footer snippet.)',
  },
  title: {
    applyIn: 'CMS/SEO plugin title template',
    action: 'Set a title template per content type (e.g. “%%title%% | Brand”) and make sure every URL has a unique title. Do not use the same homepage title on inner pages. (On WordPress: the SEO plugin’s title template.)',
  },
  description: {
    applyIn: 'CMS/SEO plugin meta templates',
    action: 'Set a meta description template (and write custom ones for key pages) in your CMS/SEO plugin, or in the template. Empty descriptions on many URLs are a template gap, not a one-page fix.',
  },
  h1: {
    applyIn: 'Site templates',
    action: 'Output one H1 in each template (page, post/article, category/archive). If several templates omit H1, fix the template rather than editing copy page by page.',
  },
  canonical: {
    applyIn: 'CMS/SEO plugin',
    action: 'Enable canonical URLs in your CMS/SEO plugin (or hardcode <link rel="canonical"> in the template) so every public URL self-canonicalises. Then 301 www vs apex to one host.',
  },
  alt: {
    applyIn: 'Media library / CMS / template',
    action: 'Require alt text on new uploads and add alts to existing images in the media library or CMS. Decorative images in the template can use empty alt="".',
  },
  thin: {
    applyIn: 'Templates + content',
    action: 'Put unique body copy in the page content (or server-render it). If many URLs are thin, the template is probably outputting chrome with no main text.',
  },
  'js-heavy': {
    applyIn: 'Front-end framework / page builder',
    action: 'Ensure headings and body copy exist in the initial HTML, not only after JS runs (server-side render or pre-render key content). Check the page builder and cookie/script banners.',
  },
  'query-canonical': {
    applyIn: 'CMS/SEO plugin / filters',
    action: 'Query-string URLs (?series=, ?sort=, etc.) must canonicalise to the clean path (e.g. /products), not to themselves or to each other. Otherwise Google can treat filters as duplicate pages.',
  },
  schema: {
    applyIn: 'CMS/SEO plugin / schema, or template',
    action: 'Add JSON-LD that matches the page type: Organization or LocalBusiness on the homepage, Product on product URLs, BreadcrumbList on inner pages. Set this in your CMS/SEO plugin, or hardcode it in the template.',
  },
  'robots-meta': {
    applyIn: 'CMS/SEO plugin robots settings',
    action: 'Review noindex/nofollow on templates. Public commercial pages must be indexable; thank-you and cart pages can stay noindex.',
  },
  'html-lang': {
    applyIn: 'Site template / base layout',
    action: 'Set <html lang="..."> (e.g. lang="en-AU") once in the base layout template so every page inherits it.',
  },
  viewport: {
    applyIn: 'Site template / base layout',
    action: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> once in the base layout <head> so every page inherits it.',
  },
};

function hostKey(hostname) {
  return String(hostname || '').replace(/^www\./i, '').toLowerCase();
}

function buildGlobalUpdates(pageReports, siteFindings, crawl) {
  const usable = (pageReports || []).filter((p) => {
    if (p.statusCode === 202 || p.statusCode === 204) return false;
    return !(p.findings || []).some((f) => f.id === 'fetch' && f.severity === 'fail');
  });
  const total = usable.length;
  const updates = [];

  const add = (item) => {
    updates.push({
      id: item.id,
      severity: item.severity,
      action: item.action,
      why: item.why,
      applyIn: item.applyIn || 'Site-wide',
      pagesAffected: item.pagesAffected || 0,
      totalPages: total,
    });
  };

  Object.entries(GLOBAL_SPECS).forEach(([id, spec]) => {
    const hits = usable.filter((p) => (p.findings || []).some((f) => f.id === id && f.severity !== 'pass'));
    if (!hits.length) return;
    const failCount = hits.filter((p) => (p.findings || []).some((f) => f.id === id && f.severity === 'fail')).length;
    const alwaysGlobal = ['https', 'og', 'jsonld', 'canonical', 'query-canonical', 'schema'].includes(id);
    if (!alwaysGlobal && hits.length < 2 && total > 1) return;
    if (!alwaysGlobal && total === 1 && hits.length === 1 && !['jsonld'].includes(id)) {
      /* still useful as a template note on a one-page crawl */
    }
    add({
      id: `global-${id}`,
      severity: failCount ? 'fail' : 'warn',
      action: spec.action,
      applyIn: spec.applyIn,
      pagesAffected: hits.length,
      why: total
        ? `Seen on ${hits.length} of ${total} crawled page${total === 1 ? '' : 's'}. Fix it once in ${spec.applyIn.toLowerCase()} rather than page by page.`
        : spec.applyIn,
    });
  });

  const hosts = new Set();
  usable.forEach((p) => {
    try { hosts.add(new URL(p.url).host.toLowerCase()); } catch { /* skip */ }
  });
  const hostNames = [...hosts];
  if (!siteFindings?.some((f) => f.id === 'host-canonical') && hostNames.length > 1 && hostNames.some((h) => h.startsWith('www.')) && hostNames.some((h) => !h.startsWith('www.'))) {
    add({
      id: 'global-host',
      severity: 'warn',
      applyIn: 'DNS / redirects',
      action: 'Pick one host (www or apex) and 301 the other. Mixed www and non-www URLs split ranking signals.',
      pagesAffected: usable.length,
      why: `Crawled both ${hostNames.join(' and ')}.`,
    });
  }

  (siteFindings || []).forEach((f) => {
    if (f.severity === 'pass' || !f.recommendation) return;
    if (f.id === 'fetch-via' || f.id === 'crawl-cap') return;
    add({
      id: `global-site-${f.id}`,
      severity: f.severity,
      applyIn: 'Site settings',
      action: f.recommendation,
      pagesAffected: 0,
      why: f.detail || f.title,
    });
  });

  const order = { fail: 0, warn: 1 };
  updates.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2) || (b.pagesAffected - a.pagesAffected));
  return updates;
}

function jsonLdTypes(html) {
  const types = new Set();
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    try { walkJsonLd(JSON.parse(m[1]), types, 0); } catch { /* ignore */ }
  }
  return [...types];
}

function walkJsonLd(node, types, depth) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkJsonLd(item, types, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;
  const t = node['@type'];
  if (typeof t === 'string') types.add(t);
  if (Array.isArray(t)) t.forEach((x) => { if (typeof x === 'string') types.add(x); });
  if (node['@graph']) walkJsonLd(node['@graph'], types, depth + 1);
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    try { blocks.push(JSON.parse(m[1])); } catch { /* ignore */ }
  }
  return blocks;
}

function jsonHasKey(node, key, depth = 0) {
  if (!node || depth > 8) return false;
  if (Array.isArray(node)) return node.some((item) => jsonHasKey(item, key, depth + 1));
  if (typeof node !== 'object') return false;
  if (node[key] != null && String(node[key]).trim() !== '') return true;
  return Object.values(node).some((v) => jsonHasKey(v, key, depth + 1));
}

function schemaGaps(html, types) {
  const blocks = jsonLdBlocks(html);
  const has = (key) => blocks.some((b) => jsonHasKey(b, key));
  const gaps = [];
  if (types.some((t) => /organization/i.test(t)) && !has('name')) gaps.push('Organization.name');
  if (types.some((t) => /localbusiness/i.test(t)) && !has('address')) gaps.push('LocalBusiness.address');
  if (types.some((t) => /^product$/i.test(t)) && !has('name')) gaps.push('Product.name');
  return gaps;
}

function hreflangTags(html) {
  const out = [];
  const re = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const tag = m[0];
    const lang = (tag.match(/\bhreflang=["']([^"']+)["']/i) || [])[1];
    const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (lang && href) out.push({ lang, href });
  }
  return out;
}

function serpLen(s) {
  return String(s || '').trim().length;
}

function urlQueryKeys(url) {
  try {
    return [...new URL(url).searchParams.keys()].filter((k) => !/^utm_|^gclid$|^fbclid$/i.test(k));
  } catch {
    return [];
  }
}

function urlPathKey(url) {
  try {
    const u = new URL(url);
    const path = (u.pathname.replace(/\/+$/, '') || '/');
    return `${hostKey(u.hostname)}${path}`;
  } catch {
    return '';
  }
}

function resolveHref(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function pageHost(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

// Near-duplicate content detection ------------------------------------------
// Plain-JS shingle/Jaccard similarity — no library, no simhash needed at this
// scale (≤40 pages, O(n²) pairwise is fine). Word-level 5-grams; short texts
// fall back to a single "shingle" of all their words so very short pages can
// still compare (they'll usually miss the similarity threshold anyway).
function wordShingles(text, size = 5) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const shingles = new Set();
  if (words.length <= size) {
    if (words.length) shingles.add(words.join(' '));
    return shingles;
  }
  for (let i = 0; i <= words.length - size; i += 1) {
    shingles.add(words.slice(i, i + size).join(' '));
  }
  return shingles;
}

function jaccardSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  const [small, big] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const item of small) if (big.has(item)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union ? intersection / union : 0;
}

function auditPage({ url, html, statusCode, title: fetchedTitle, text, error, isHome, via, xRobotsTag, redirectChain, depth, inbound }) {
  const findings = [];
  const skipChrome = via === 'serper' || via === 'jina';
  const htmlStr = String(html || '');
  const title = String(fetchedTitle || attr(htmlStr, /<title[^>]*>([^<]{1,200})<\/title>/i)).trim();
  const description = attr(htmlStr, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || attr(htmlStr, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const headings = extractHeadings(htmlStr);
  const h1s = headings.filter((h) => h.level === 1).length;
  const canonical = attr(htmlStr, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || attr(htmlStr, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const robotsMeta = (
    attr(htmlStr, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i)
    || attr(htmlStr, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']robots["']/i)
  ).toLowerCase();
  const ogTitle = attr(htmlStr, /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
    || attr(htmlStr, /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  const hasJsonLd = /application\/ld\+json/i.test(htmlStr);
  const schemaTypes = jsonLdTypes(htmlStr);
  const img = imagesMissingAlt(htmlStr);
  const https = /^https:/i.test(url || '');
  const charCount = String(text || '').replace(/\s+/g, ' ').trim().length;
  const where = isHome ? 'this page (homepage)' : 'this page';
  const noHtml = !error && statusCode < 400 && !title && charCount < 40;

  if (error) {
    addFinding(findings, {
      id: 'fetch',
      severity: 'fail',
      title: 'Could not fetch this URL',
      detail: error,
      recommendation: `Check the URL is public and not blocked. Retry after fixing hosting or robots rules. (${url})`,
    });
  } else if (statusCode >= 400) {
    addFinding(findings, {
      id: 'status',
      severity: 'fail',
      title: `HTTP ${statusCode}`,
      detail: `${url} returned ${statusCode}.`,
      recommendation: 'Fix or redirect this URL so crawlers get 200 (or a 301 to the live page).',
    });
  } else if (noHtml || statusCode === 202 || statusCode === 204) {
    addFinding(findings, {
      id: 'fetch',
      severity: 'fail',
      title: statusCode === 202
        ? 'Host returned HTTP 202 with no usable HTML'
        : 'No HTML in the response',
      detail: 'The live site may show a full page in a browser while this crawl gets an empty or challenge response. Without HTML there are no links to follow.',
      recommendation: 'If this host blocks cloud IPs (HTTP 202), Vault retries via Serper scrape. Set SERPER_SEARCH_API_KEY. Do not treat missing titles on an empty 202 as the real page.',
    });
  } else {
    addFinding(findings, {
      id: 'status',
      severity: 'pass',
      title: `Fetched (HTTP ${statusCode || 200})`,
      detail: url,
    });
  }

  if (error || (statusCode >= 400) || noHtml || statusCode === 202 || statusCode === 204) {
    const score = scoreFromFindings(findings);
    return {
      url,
      title,
      statusCode: statusCode || 0,
      error: error || null,
      isHome: Boolean(isHome),
      score,
      charCount,
      findings,
      recommendations: recommendationsFrom(findings),
      noindex: false,
      bodyText: '',
      h1Text: '',
      descriptionText: '',
    };
  }

  if (!https) {
    addFinding(findings, {
      id: 'https',
      severity: 'fail',
      title: 'Not on HTTPS',
      detail: url,
      recommendation: 'Serve this URL over HTTPS and redirect HTTP to HTTPS.',
    });
  }

  if (!title) {
    addFinding(findings, {
      id: 'title',
      severity: 'fail',
      title: 'Missing title tag',
      detail: where,
      recommendation: `Add a unique <title> of about 15–60 characters that names the page topic.`,
    });
  } else if (title.length < 12 || title.length > 65) {
    addFinding(findings, {
      id: 'title',
      severity: 'warn',
      title: `Title is ${title.length} characters (aim 15–60)`,
      detail: title,
      recommendation: `Rewrite the title so it is specific and roughly 15–60 characters. Current: “${title}”.`,
    });
  } else {
    addFinding(findings, {
      id: 'title',
      severity: 'pass',
      title: 'Title looks usable',
      detail: title,
    });
  }

  if (!description) {
    addFinding(findings, {
      id: 'description',
      severity: 'warn',
      title: 'No meta description',
      detail: where,
      recommendation: 'Add a meta description of about 70–160 characters summarising this page.',
    });
  } else if (description.length < 50 || description.length > 170) {
    addFinding(findings, {
      id: 'description',
      severity: 'warn',
      title: `Meta description is ${description.length} characters (aim 70–160)`,
      detail: description,
      recommendation: 'Tighten or expand the meta description to about 70–160 characters.',
    });
  } else {
    addFinding(findings, {
      id: 'description',
      severity: 'pass',
      title: 'Meta description present',
      detail: description,
    });
  }

  if (h1s === 0) {
    addFinding(findings, {
      id: 'h1',
      severity: 'fail',
      title: 'No H1 heading',
      detail: where,
      recommendation: 'Add one H1 that matches the page topic (usually similar to the title, not identical fluff).',
    });
  } else if (h1s > 1) {
    addFinding(findings, {
      id: 'h1',
      severity: 'warn',
      title: `${h1s} H1 headings`,
      detail: headings.filter((h) => h.level === 1).map((h) => h.text).join(' · '),
      recommendation: 'Keep a single H1; demote extras to H2.',
    });
  } else {
    addFinding(findings, {
      id: 'h1',
      severity: 'pass',
      title: 'Single H1 found',
      detail: headings.find((h) => h.level === 1)?.text || '',
    });
  }

  const resolvedCanonical = canonical ? resolveHref(canonical, url) : '';
  const queryKeysForUrl = urlQueryKeys(url);
  if (queryKeysForUrl.length) {
    const cleanPath = (() => {
      try {
        const u = new URL(url);
        u.search = '';
        u.hash = '';
        return u.toString();
      } catch { return url.split('?')[0]; }
    })();
    const canonQuery = resolvedCanonical ? urlQueryKeys(resolvedCanonical) : [];
    const pointsAtClean = resolvedCanonical && urlPathKey(resolvedCanonical) === urlPathKey(cleanPath) && !canonQuery.length;
    if (!resolvedCanonical) {
      addFinding(findings, {
        id: 'query-canonical',
        severity: 'fail',
        title: 'Query-string URL has no canonical',
        detail: `${url} — parameters: ${queryKeysForUrl.join(', ')}.`,
        recommendation: `Set canonical to the clean URL (${cleanPath}) so filtered views are not indexed as duplicates.`,
      });
    } else if (!pointsAtClean) {
      addFinding(findings, {
        id: 'query-canonical',
        severity: 'fail',
        title: 'Query-string URL does not canonicalise to the clean path',
        detail: `Page: ${url}. Canonical: ${resolvedCanonical || '(none)'}.`,
        recommendation: `Point canonical at ${cleanPath} (not this query URL, and not another ?series= variant).`,
      });
    } else {
      addFinding(findings, {
        id: 'query-canonical',
        severity: 'pass',
        title: 'Query-string URL canonicalises to the clean path',
        detail: resolvedCanonical,
      });
    }
  } else if (!canonical) {
    addFinding(findings, {
      id: 'canonical',
      severity: 'warn',
      title: 'No canonical URL',
      detail: where,
      recommendation: `Add <link rel="canonical" href="${url}"> (or the preferred version of this URL).`,
    });
  } else {
    addFinding(findings, {
      id: 'canonical',
      severity: 'pass',
      title: 'Canonical present',
      detail: resolvedCanonical,
    });
  }

  let noindex = false;
  if (robotsMeta.includes('noindex') || robotsMeta.includes('none')) {
    noindex = true;
    addFinding(findings, {
      id: 'robots-meta',
      severity: isHome ? 'fail' : 'warn',
      title: 'noindex is set',
      detail: robotsMeta,
      recommendation: isHome
        ? 'Remove noindex from the homepage unless you intend to hide the whole site.'
        : 'Keep noindex only if this page should stay out of Google (thank-you, cart, login).',
    });
  }

  if (robotsMeta.includes('nofollow')) {
    addFinding(findings, {
      id: 'robots-meta',
      severity: 'warn',
      title: 'nofollow is set on this page',
      detail: robotsMeta,
      recommendation: 'Remove nofollow on public pages so Google can follow internal links. Keep it only on untrusted or utility URLs.',
    });
  }

  if (!skipChrome && !ogTitle) {
    addFinding(findings, {
      id: 'og',
      severity: 'warn',
      title: 'No Open Graph title',
      detail: where,
      recommendation: 'Add og:title (and og:description / og:image) for link previews.',
    });
  }

  const pathLower = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();
  // Heuristic only — this is not real product detection (that would require
  // checking for JSON-LD Product schema itself, which is already checked
  // separately below). It just flags likely product/category/listing paths
  // so we can nudge for Product schema on them.
  const looksProduct = /product|shop|store|category/i.test(pathLower) || queryKeysForUrl.includes('series');
  if (!skipChrome && !hasJsonLd && isHome) {
    addFinding(findings, {
      id: 'jsonld',
      severity: 'warn',
      title: 'No JSON-LD on the homepage',
      detail: '',
      recommendation: 'Add Organization or LocalBusiness JSON-LD on the homepage.',
    });
  } else if (!skipChrome && looksProduct && !schemaTypes.some((t) => /product/i.test(t))) {
    addFinding(findings, {
      id: 'schema',
      severity: 'warn',
      title: 'No Product schema on this commercial URL',
      detail: schemaTypes.length ? `Found: ${schemaTypes.join(', ')}` : 'No JSON-LD found.',
      recommendation: 'Add Product JSON-LD (name, image, offers) on product and filtered product URLs, or canonicalise filters to a Product page that has it.',
    });
  } else if (!skipChrome && !isHome && hasJsonLd && !schemaTypes.some((t) => /breadcrumb/i.test(t))) {
    addFinding(findings, {
      id: 'schema',
      severity: 'warn',
      title: 'JSON-LD has no BreadcrumbList',
      detail: schemaTypes.join(', ') || '',
      recommendation: 'Add BreadcrumbList schema so Google can show path trails.',
    });
  } else if (schemaTypes.length) {
    addFinding(findings, {
      id: 'schema',
      severity: 'pass',
      title: `Schema: ${schemaTypes.slice(0, 6).join(', ')}`,
      detail: '',
    });
  }

  const gaps = schemaGaps(htmlStr, schemaTypes);
  if (gaps.length) {
    addFinding(findings, {
      id: 'schema-fields',
      severity: 'warn',
      title: `JSON-LD missing required-looking fields: ${gaps.join(', ')}`,
      detail: where,
      recommendation: 'Fill the named properties so rich results can qualify (name, address, offers as relevant).',
    });
  }

  // hreflang: (a) flag missing x-default, (b) flag missing self-reference.
  // This is a lighter heuristic check against this one page's own tags — it
  // does NOT verify reciprocal hreflang links across the whole site, which
  // would require fetching every alternate URL (out of scope for a
  // same-crawl check).
  const alts = hreflangTags(htmlStr);
  if (alts.length) {
    const hasXDefault = alts.some((a) => /^x-default$/i.test(a.lang));
    const selfRef = alts.some((a) => urlPathKey(resolveHref(a.href, url)) === urlPathKey(url));
    const issues = [];
    if (!hasXDefault) issues.push('no x-default alternate');
    if (!selfRef) issues.push('no self-referencing hreflang entry');
    addFinding(findings, {
      id: 'hreflang',
      severity: issues.length ? 'warn' : 'pass',
      title: issues.length
        ? `hreflang issue: ${issues.join('; ')}`
        : `${alts.length} hreflang alternate${alts.length === 1 ? '' : 's'}`,
      detail: `${alts.slice(0, 8).map((a) => `${a.lang} → ${a.href}`).join('\n')}\n\nNote: checked against this page's own tags only — does not fetch alternate URLs to verify reciprocal hreflang links site-wide.`,
      recommendation: issues.length ? 'Add the missing x-default and/or self-referencing hreflang entries.' : '',
    });
  }

  const xrt = String(xRobotsTag || '').toLowerCase();
  if (/noindex/.test(xrt)) {
    noindex = true;
    addFinding(findings, {
      id: 'x-robots',
      severity: 'fail',
      title: 'X-Robots-Tag includes noindex',
      detail: String(xRobotsTag).slice(0, 200),
      recommendation: 'Remove noindex from the HTTP header if this URL should rank.',
    });
  }

  const hops = Array.isArray(redirectChain) ? redirectChain : [];
  const seenHopFroms = new Set();
  let isRedirectLoop = false;
  for (const h of hops) {
    if (h && seenHopFroms.has(h.from)) { isRedirectLoop = true; break; }
    if (h) seenHopFroms.add(h.from);
  }
  if (isRedirectLoop) {
    addFinding(findings, {
      id: 'redirect-loop',
      severity: 'fail',
      title: `Redirect loop detected (${hops.length} hops)`,
      detail: hops.map((h) => `${h.status} ${h.from} → ${h.to}`).join('\n'),
      recommendation: 'Fix the redirect rule that sends this URL back to a page already in its own chain.',
    });
  } else if (hops.length >= 2) {
    addFinding(findings, {
      id: 'redirect-chain',
      severity: 'warn',
      title: `Redirect chain (${hops.length} hops)`,
      detail: hops.map((h) => `${h.status} ${h.from} → ${h.to}`).join('\n'),
      recommendation: 'Point links and canonicals at the final URL. Collapse chains to a single 301.',
    });
  }

  if (!skipChrome) {
    const htmlLangMatch = htmlStr.match(/<html\b[^>]*\blang=["']([^"']*)["']/i);
    const htmlLang = htmlLangMatch ? htmlLangMatch[1].trim() : '';
    if (!htmlLang) {
      addFinding(findings, {
        id: 'html-lang',
        severity: 'warn',
        title: 'Missing <html lang> attribute',
        detail: where,
        recommendation: 'Add lang="..." (e.g. lang="en-AU") to the <html> tag. Cheap SEO and accessibility signal.',
      });
    }

    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(htmlStr);
    if (!hasViewport) {
      addFinding(findings, {
        id: 'viewport',
        severity: 'warn',
        title: 'Missing viewport meta tag',
        detail: where,
        recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> — a basic mobile-friendliness signal, distinct from Lighthouse\'s deeper mobile UX checks.',
      });
    }
  }

  if (img.total > 0 && img.missing > 0) {
    addFinding(findings, {
      id: 'alt',
      severity: img.missing / img.total > 0.5 ? 'fail' : 'warn',
      title: `${img.missing} of ${img.total} images missing alt text`,
      detail: where,
      recommendation: 'Write descriptive alt text for informative images; use empty alt="" only for decorative ones.',
    });
  }

  if (!error && statusCode < 400 && charCount < 250) {
    addFinding(findings, {
      id: 'thin',
      severity: 'fail',
      title: 'Very little readable text',
      detail: `${charCount} characters. JS-rendered pages often look empty to this HTML crawl.`,
      recommendation: 'Put the main copy in HTML (or server-render it) so crawlers can read the topic.',
    });
  } else if (!error && charCount < 800) {
    addFinding(findings, {
      id: 'thin',
      severity: 'warn',
      title: 'Thin on-page copy',
      detail: `${charCount} characters.`,
      recommendation: 'Add unique copy that explains this page’s offer, not a near-duplicate of other URLs.',
    });
  }

  const scriptCount = countTags(htmlStr, /<script\b/gi);
  if (!skipChrome && scriptCount > 25 && charCount < 800) {
    addFinding(findings, {
      id: 'js-heavy',
      severity: 'warn',
      title: 'Script-heavy with little HTML text',
      detail: `${scriptCount} script tags.`,
      recommendation: 'Ensure important headings and copy exist in the initial HTML, not only after JS.',
    });
  }

  const score = scoreFromFindings(findings);
  return {
    url,
    title,
    statusCode: statusCode || 0,
    error: error || null,
    isHome: Boolean(isHome),
    score,
    charCount,
    findings,
    recommendations: recommendationsFrom(findings),
    titleChars: serpLen(title),
    descriptionChars: serpLen(description),
    depth: Number(depth) || 0,
    inbound: Number(inbound) || 0,
    noindex,
    bodyText: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    h1Text: (headings.find((h) => h.level === 1)?.text || '').trim(),
    descriptionText: description || '',
  };
}

function buildSiteAudit({ crawl }) {
  const startUrl = crawl.startUrl;
  let origin = '';
  try { origin = new URL(startUrl).origin; } catch { origin = ''; }
  const pageReports = (crawl.pages || []).map((p, i) => auditPage({
    url: p.url || p.requestedUrl,
    html: p.html,
    statusCode: p.statusCode,
    title: p.title,
    text: p.text,
    error: p.error,
    isHome: i === 0 || p.url === startUrl,
    via: p.via || null,
    xRobotsTag: p.xRobotsTag || '',
    redirectChain: p.redirectChain || [],
    depth: p.depth,
    inbound: p.inbound,
  }));

  const siteFindings = [];
  const robots = crawl.robots || {};
  const robotsBody = String(robots.body || '');
  const fetchVia = [...new Set((crawl.pages || []).map((p) => p.via).filter((v) => v && v !== 'direct'))];
  if (fetchVia.length) {
    addFinding(siteFindings, {
      id: 'fetch-via',
      severity: 'warn',
      title: `HTML came via ${fetchVia.join(' + ')} because the host blocked a direct fetch`,
      detail: 'On-page checks still run on that HTML. Direct crawler access from this server was refused (often HTTP 202).',
    });
  }
  const hostBlocked = pageReports.some((p) => p.statusCode === 202 || p.statusCode === 204)
    || pageReports[0]?.findings?.some((f) => f.id === 'fetch' && f.severity === 'fail');
  if (hostBlocked && (!robots.ok || robots.statusCode === 202)) {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'warn',
      title: 'Could not check robots.txt (host blocked this crawler)',
      detail: 'The same empty or HTTP 202 response that stopped the HTML crawl also blocked robots.txt. This is not proof the file is missing.',
    });
  } else if (!robots.ok) {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'warn',
      title: robots.statusCode >= 400 ? `robots.txt returned HTTP ${robots.statusCode}` : 'robots.txt not found or empty',
      detail: 'Optional, but useful for crawlers.',
      recommendation: `Publish ${origin}/robots.txt with User-agent: * and allow public pages.`,
    });
  } else if (/disallow:\s*\/\s*$/im.test(robotsBody) && /user-agent:\s*\*/i.test(robotsBody)) {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'fail',
      title: 'robots.txt appears to block all crawlers',
      detail: 'Disallow: / under User-agent: * keeps Google out.',
      recommendation: 'Remove the site-wide Disallow: / unless the site is meant to be private.',
    });
  } else {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'pass',
      title: 'robots.txt is reachable',
      detail: robotsBody.split('\n').slice(0, 8).join('\n').slice(0, 400),
    });
  }

  const titles = pageReports.map((p) => String(p.title || '').trim().toLowerCase()).filter(Boolean);
  const titleCounts = new Map();
  titles.forEach((t) => titleCounts.set(t, (titleCounts.get(t) || 0) + 1));
  const dupTitles = [...titleCounts.entries()].filter(([, n]) => n > 1).map(([t, n]) => `"${t}" ×${n}`);
  if (dupTitles.length) {
    addFinding(siteFindings, {
      id: 'dup-title',
      severity: 'warn',
      title: 'Duplicate titles across crawled pages',
      detail: dupTitles.join(' · '),
      recommendation: 'Give each URL a unique title that matches that page’s topic.',
    });
  }

  const descriptionsForDup = pageReports.map((p) => String(p.descriptionText || '').trim().toLowerCase()).filter(Boolean);
  const descCounts = new Map();
  descriptionsForDup.forEach((d) => descCounts.set(d, (descCounts.get(d) || 0) + 1));
  const dupDescriptions = [...descCounts.entries()].filter(([, n]) => n > 1).map(([d, n]) => `"${d.slice(0, 100)}" ×${n}`);
  if (dupDescriptions.length) {
    addFinding(siteFindings, {
      id: 'dup-description',
      severity: 'warn',
      title: 'Duplicate meta descriptions across crawled pages',
      detail: dupDescriptions.join(' · '),
      recommendation: 'Write a unique meta description for each URL that summarises that specific page.',
    });
  }

  const h1sForDup = pageReports.map((p) => String(p.h1Text || '').trim().toLowerCase()).filter(Boolean);
  const h1Counts = new Map();
  h1sForDup.forEach((h) => h1Counts.set(h, (h1Counts.get(h) || 0) + 1));
  const dupH1s = [...h1Counts.entries()].filter(([, n]) => n > 1).map(([h, n]) => `"${h.slice(0, 100)}" ×${n}`);
  if (dupH1s.length) {
    addFinding(siteFindings, {
      id: 'dup-h1',
      severity: 'warn',
      title: 'Duplicate H1 headings across crawled pages',
      detail: dupH1s.join(' · '),
      recommendation: 'Give each URL its own H1 that matches that page’s specific topic.',
    });
  }

  // Near-duplicate content detection — plain-JS shingle/Jaccard similarity,
  // O(n²) pairwise which is fine at the ≤40-page crawl cap. Pages under 200
  // characters of body text are excluded (already flagged as thin; comparing
  // near-empty pages produces noisy false positives).
  const DUP_CONTENT_THRESHOLD = 0.8;
  const contentCandidates = pageReports.filter((p) => p.statusCode < 400 && !p.error && (p.bodyText || '').length >= 200);
  const shingleEntries = contentCandidates.map((p) => ({ url: p.url, shingles: wordShingles(p.bodyText) }));
  const dupContentPairs = [];
  for (let i = 0; i < shingleEntries.length; i += 1) {
    for (let j = i + 1; j < shingleEntries.length; j += 1) {
      const sim = jaccardSimilarity(shingleEntries[i].shingles, shingleEntries[j].shingles);
      if (sim >= DUP_CONTENT_THRESHOLD) {
        dupContentPairs.push({ a: shingleEntries[i].url, b: shingleEntries[j].url, similarity: Math.round(sim * 100) });
      }
    }
  }
  if (dupContentPairs.length) {
    addFinding(siteFindings, {
      id: 'duplicate-content',
      severity: 'fail',
      title: `${dupContentPairs.length} pair${dupContentPairs.length === 1 ? '' : 's'} of near-duplicate content (≥80% similar)`,
      detail: dupContentPairs.slice(0, 15).map((d) => `${d.similarity}% similar: ${d.a} ↔ ${d.b}`).join('\n'),
      recommendation: 'Merge or differentiate these pages, or canonicalise one to the other. Near-duplicate content splits ranking signal between URLs.',
    });
  }

  if (crawl.discovered > crawl.crawled) {
    addFinding(siteFindings, {
      id: 'crawl-cap',
      severity: 'warn',
      title: `Found ${crawl.discovered} URLs; crawled ${crawl.crawled} (limit ${crawl.pageLimit})`,
      detail: 'Raise Pages to crawl to cover more of the site.',
      recommendation: `Run again with a higher page limit if important URLs were skipped.`,
    });
  } else {
    addFinding(siteFindings, {
      id: 'crawl-cap',
      severity: 'pass',
      title: `Crawled ${crawl.crawled} page${crawl.crawled === 1 ? '' : 's'}`,
      detail: `Discovered ${crawl.discovered} same-origin URLs (HTML links only).`,
    });
  }

  const broken = (crawl.pages || []).filter((p) => p.statusCode >= 400 || p.error);
  if (broken.length) {
    addFinding(siteFindings, {
      id: 'broken',
      severity: 'fail',
      title: `${broken.length} crawled URL${broken.length === 1 ? '' : 's'} returned an error`,
      detail: broken.map((p) => `${p.statusCode || 'err'} ${p.url || p.requestedUrl}`).join('\n'),
      recommendation: 'Fix or 301 these URLs. If a hub such as /products fails, filtered URLs under it are unverified duplicates.',
    });
  }

  const queryPages = pageReports.filter((p) => urlQueryKeys(p.url).length && p.statusCode < 400);
  const queryBad = queryPages.filter((p) => (p.findings || []).some((f) => f.id === 'query-canonical' && f.severity === 'fail'));
  if (queryPages.length) {
    addFinding(siteFindings, {
      id: 'query-params',
      severity: queryBad.length ? 'fail' : 'warn',
      title: `${queryPages.length} query-string URL${queryPages.length === 1 ? '' : 's'} in the crawl`,
      detail: queryPages.map((p) => p.url).slice(0, 12).join('\n'),
      recommendation: queryBad.length
        ? 'These filtered URLs are duplicate-content risk until each canonical points at the clean path (e.g. /products).'
        : 'Confirm each filtered URL canonicalises to the clean hub path, not to itself.',
    });
  }

  const probe = crawl.hostProbe;
  if (probe?.www && probe?.apex) {
    const wwwHost = pageHost(probe.www.requested);
    const apexHost = pageHost(probe.apex.requested);
    const wwwFinalHost = pageHost(probe.www.finalUrl) || wwwHost;
    const apexFinalHost = pageHost(probe.apex.finalUrl) || apexHost;
    const wwwToApex = probe.www.redirected && hostKey(wwwFinalHost) === hostKey(apexHost) && !/^www\./i.test(wwwFinalHost);
    const apexToWww = probe.apex.redirected && /^www\./i.test(apexFinalHost);
    const canonHosts = [...new Set(pageReports.map((p) => {
      const can = (p.findings || []).find((f) => f.id === 'canonical' && f.detail);
      return pageHost(can?.detail || p.url);
    }).filter(Boolean))];
    const preferred = wwwToApex ? apexHost : (apexToWww ? wwwHost : (canonHosts[0] || apexHost));
    if (wwwToApex || apexToWww) {
      addFinding(siteFindings, {
        id: 'host-canonical',
        severity: canonHosts.length > 1 ? 'warn' : 'pass',
        title: wwwToApex
          ? `www 301s to ${apexHost}`
          : `apex 301s to ${wwwHost}`,
        detail: `www request → ${probe.www.finalUrl || probe.www.statusCode}\napex request → ${probe.apex.finalUrl || probe.apex.statusCode}\nCanonical hosts on crawled pages: ${canonHosts.join(', ') || 'none found'}.`,
        recommendation: canonHosts.length > 1
          ? `Redirects pick ${preferred}. Make every canonical use that host only.`
          : undefined,
      });
    } else if (probe.www.statusCode === 202 || probe.apex.statusCode === 202 || !probe.www.statusCode) {
      addFinding(siteFindings, {
        id: 'host-canonical',
        severity: 'warn',
        title: 'Could not confirm www vs apex 301 (direct fetch blocked)',
        detail: `www HTTP ${probe.www.statusCode}; apex HTTP ${probe.apex.statusCode}. Canonical hosts: ${canonHosts.join(', ') || 'unknown'}.`,
        recommendation: `Pick one host (${preferred}) and 301 the other. Then set canonicals to that host.`,
      });
    } else {
      addFinding(siteFindings, {
        id: 'host-canonical',
        severity: 'fail',
        title: 'www and apex both respond without a 301 between them',
        detail: `www → ${probe.www.finalUrl} (${probe.www.statusCode})\napex → ${probe.apex.finalUrl} (${probe.apex.statusCode})\nCanonical hosts: ${canonHosts.join(', ') || 'none found'}.`,
        recommendation: `301 one host to the other (prefer ${preferred}) and point all canonicals at that host.`,
      });
    }
  }

  const inbound = new Map();
  pageReports.forEach((p) => inbound.set(p.url, 0));
  (crawl.pages || []).forEach((p) => {
    if (!p.html) return;
    for (const href of sameOriginLinks(p.html, p.url || p.requestedUrl)) {
      inbound.set(href, (inbound.get(href) || 0) + 1);
    }
  });
  const orphans = pageReports.filter((p) => p.statusCode < 400 && !p.isHome && (p.inbound || inbound.get(p.url) || 0) === 0);
  if (orphans.length) {
    addFinding(siteFindings, {
      id: 'internal-links',
      severity: 'warn',
      title: `${orphans.length} crawled page${orphans.length === 1 ? '' : 's'} had no inbound HTML links in this crawl`,
      detail: orphans.map((p) => p.url).slice(0, 10).join('\n'),
      recommendation: 'Link important URLs from the hub and main nav. Isolated pages are hard to discover.',
    });
  }

  const sitemapUrls = crawl.sitemapUrls || [];
  const crawledSet = new Set(pageReports.map((p) => p.url));
  const linkedSet = new Set();
  (crawl.pages || []).forEach((p) => {
    sameOriginLinks(p.html || '', p.url || p.requestedUrl).forEach((h) => linkedSet.add(h));
  });
  const inSitemapNotCrawled = sitemapUrls.filter((u) => !crawledSet.has(u)).slice(0, 20);
  const inSitemapNotLinked = sitemapUrls.filter((u) => crawledSet.has(u) && !linkedSet.has(u) && u !== startUrl).slice(0, 15);
  if (sitemapUrls.length && inSitemapNotCrawled.length) {
    addFinding(siteFindings, {
      id: 'sitemap-gap',
      severity: 'warn',
      title: `${inSitemapNotCrawled.length} sitemap URL${inSitemapNotCrawled.length === 1 ? '' : 's'} were not crawled (cap or robots)`,
      detail: inSitemapNotCrawled.join('\n'),
      recommendation: 'Raise the page limit or check robots. Sitemap URLs Google can see may still be missing from this sample.',
    });
  }
  if (inSitemapNotLinked.length) {
    addFinding(siteFindings, {
      id: 'sitemap-orphans',
      severity: 'warn',
      title: `${inSitemapNotLinked.length} crawled sitemap URL${inSitemapNotLinked.length === 1 ? '' : 's'} had no HTML inbound link`,
      detail: inSitemapNotLinked.join('\n'),
      recommendation: 'Add nav or hub links so Google does not rely on the sitemap alone.',
    });
  }
  const sitemapSet = new Set(sitemapUrls);
  const noindexInSitemap = pageReports.filter((p) => p.noindex && sitemapSet.has(p.url));
  if (noindexInSitemap.length) {
    addFinding(siteFindings, {
      id: 'noindex-sitemap',
      severity: 'fail',
      title: `${noindexInSitemap.length} URL${noindexInSitemap.length === 1 ? '' : 's'} are both noindex and listed in the sitemap`,
      detail: noindexInSitemap.map((p) => p.url).join('\n'),
      recommendation: 'Remove these URLs from the sitemap, or remove noindex — never both. Wastes crawl budget and sends Google conflicting signals.',
    });
  }

  if (/user-agent/i.test(String(robots.body || '')) && !/^\s*sitemap:/im.test(String(robots.body || ''))) {
    addFinding(siteFindings, {
      id: 'robots-sitemap',
      severity: 'warn',
      title: 'robots.txt has no Sitemap: line',
      detail: '',
      recommendation: `Add Sitemap: ${origin}/sitemap.xml (or your index URL).`,
    });
  }

  const deep = pageReports.filter((p) => (p.depth || 0) >= 4);
  if (deep.length) {
    addFinding(siteFindings, {
      id: 'click-depth',
      severity: 'warn',
      title: `${deep.length} URL${deep.length === 1 ? '' : 's'} are 4+ clicks from the start URL in this crawl`,
      detail: deep.map((p) => `depth ${p.depth} ${p.url}`).slice(0, 12).join('\n'),
      recommendation: 'Promote important pages into the main nav or a hub so they are closer to the homepage.',
    });
  }

  const pageScores = pageReports.map((p) => p.score);
  const avg = pageScores.length
    ? Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length)
    : 0;
  const siteScore = scoreFromFindings(siteFindings);
  const score = Math.round((avg * 0.75) + (siteScore * 0.25));

  const fails = [...siteFindings, ...pageReports.flatMap((p) => p.findings)].filter((f) => f.severity === 'fail').length;
  const warns = [...siteFindings, ...pageReports.flatMap((p) => p.findings)].filter((f) => f.severity === 'warn').length;

  const siteRecommendations = recommendationsFrom(siteFindings);
  const pageRecommendations = pageReports.flatMap((p) => p.recommendations.map((r) => ({ ...r, url: p.url, pageTitle: p.title })));
  const globalUpdates = buildGlobalUpdates(pageReports, siteFindings, crawl);

  // Indexability breakdown — the headline picture a professional audit leads
  // with. "Blocked by robots" is derived from sitemap URLs robots.txt
  // disallows: URLs actually blocked at crawl time are skipped before fetch
  // (siteCrawler never requests a disallowed URL), so they cannot appear as
  // crawled pages here — sitemap cross-reference is the only same-crawl way
  // to surface them. Indexable/Noindexed/Error come from pages actually
  // crawled.
  const indexableCount = pageReports.filter((p) => p.statusCode < 400 && !p.error && !p.noindex).length;
  const noindexedCount = pageReports.filter((p) => p.noindex).length;
  const errorCount = pageReports.filter((p) => p.statusCode >= 400 || p.error).length;
  const blockedByRobotsCount = sitemapUrls.filter((u) => !robotsAllows(u, robots.disallows || [])).length;
  const indexability = {
    indexable: indexableCount,
    noindexed: noindexedCount,
    blockedByRobots: blockedByRobotsCount,
    error: errorCount,
    totalCrawled: pageReports.length,
    note: 'Indexable/Noindexed/Error are counted from crawled pages. Blocked-by-robots counts sitemap URLs robots.txt disallows — those are skipped before fetch, so they never show up as crawled pages.',
  };

  return {
    score,
    summary: `${crawl.crawled} pages · ${fails} fail · ${warns} warn`,
    pageLimit: crawl.pageLimit,
    crawled: crawl.crawled,
    discovered: crawl.discovered,
    findings: siteFindings,
    recommendations: siteRecommendations,
    globalUpdates,
    indexability,
    notCovered: [
      'Page speed, Core Web Vitals, unused JS/CSS, contrast — use HTML (Lighthouse) at /html',
      'Paid search keywords and RSA copy — use Adwords at /google-ads',
      'Backlink profile and rank tracking',
    ],
    pages: pageReports.map((p) => ({
      url: p.url,
      title: p.title,
      statusCode: p.statusCode,
      score: p.score,
      isHome: p.isHome,
      depth: p.depth,
      inbound: p.inbound,
      titleChars: p.titleChars,
      descriptionChars: p.descriptionChars,
      findings: p.findings,
      recommendations: p.recommendations,
    })),
    allRecommendations: [...siteRecommendations.map((r) => ({ ...r, url: startUrl, pageTitle: 'Site' })), ...pageRecommendations],
  };
}

module.exports = { auditPage, buildSiteAudit, buildGlobalUpdates };
