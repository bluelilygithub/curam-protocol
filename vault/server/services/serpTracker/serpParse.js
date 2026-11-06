'use strict';

// SERP Tracker: reads one DataForSEO "Advanced" Google result (tasks[0].result[0]) into the few things the tool keeps and shows.
// Pure: no database, no network. Used by Lookup now and by the daily collection later (stage 3).
//
// Field names come from the DataForSEO docs pages (items[].type, rank_group, rank_absolute, url, domain, title). The AI Overview's
// `references` list (url / domain / title) is NOT shown on the docs pages read, so it is read defensively and has only been tested against a
// hand-made fixture. Check it against a real answer before relying on it (docs/serp-tracker.md).
//
// Rules from the brief: "not ranked" is NULL with a status, never 0; a SERP with no organic results is an ERROR, not "not ranked";
// domains are compared as the typed domain or a subdomain of it.

const { hostBelongsTo, normaliseDomain } = require('./siteProfile');

class SerpParseError extends Error {
  constructor(message) { super(message); this.name = 'SerpParseError'; }
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const cleanText = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

// Seen in a REAL answer (6 Nov 2026, a Live search for Australia): many "organic" items come back as Google redirect links
// (https://google.com/goto?url=<opaque>) with domain "google.com", and the real website only appears in `breadcrumb`
// ("https://www.retravision.com.au > product > ..."). Some (Pinterest pins) have no web address at all, only a site name.
// So the real domain is read from the breadcrumb when the link is a Google redirect, and is '' when it cannot be known.
const GOOGLE_HOSTS = new Set(['google.com', 'google.com.au']);
function isGoogleRedirect(item) {
  try {
    const u = new URL(item.url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return GOOGLE_HOSTS.has(host) && /^\/(goto|url)/.test(u.pathname);
  } catch { return false; }
}
function hostFromBreadcrumb(b) {
  const m = /^https?:\/\/([^\s›/]+)/i.exec(String(b == null ? '' : b).trim());
  return m ? m[1].replace(/^www\./, '').toLowerCase() : '';
}
/** { domain, shownUrl, redirected }: the real website of an item and the address to show for it. */
function resolveItem(item) {
  if (isGoogleRedirect(item)) {
    const b = cleanText(item.breadcrumb, 300);
    return { domain: hostFromBreadcrumb(b), shownUrl: /^https?:\/\//i.test(b) ? b.replace(/\s*›\s*/g, '/') : '', redirected: true };
  }
  return { domain: (cleanText(item.domain, 200) || hostOf(item.url)).replace(/^www\./, '').toLowerCase(), shownUrl: cleanText(item.url, 500), redirected: false };
}

/**
 * @param result      tasks[0].result[0] of an Advanced Google organic answer
 * @param opts.myDomain      the site's own domain ('wiwc.com.au'), or null
 * @param opts.competitors   competitor domains to flag in AI Overview citations
 * @param opts.depth         how many results were asked for (names the "not in top N" status)
 */
function parseSerp(result, { myDomain = null, competitors = [], depth = 100 } = {}) {
  if (!result || typeof result !== 'object') throw new SerpParseError('There is no result to read.');
  const items = Array.isArray(result.items) ? result.items : [];
  const organic = items.filter((i) => i && i.type === 'organic' && isNum(i.rank_group) && i.url);
  if (!organic.length) throw new SerpParseError('The search returned no organic results, so it cannot be read as "not ranked". Treat it as a failed search.');

  const resolved = new Map(organic.map((i) => [i, resolveItem(i)]));
  const mine = myDomain ? organic.filter((i) => resolved.get(i).domain && hostBelongsTo(resolved.get(i).domain, myDomain)) : [];
  mine.sort((a, b) => a.rank_group - b.rank_group);
  const best = mine[0] || null;
  // results whose website cannot be told (a Google redirect with no web address shown): if the site is not found, it could still be one of these
  const unknownDomainCount = organic.filter((i) => !resolved.get(i).domain).length;

  const compSet = (competitors || []).map(normaliseDomain).filter(Boolean);
  const isMine = (d) => Boolean(myDomain) && hostBelongsTo(d, myDomain);
  const compOf = (d) => compSet.find((c) => hostBelongsTo(d, c)) || null;

  const aiItem = items.find((i) => i && i.type === 'ai_overview');
  const refs = aiItem && Array.isArray(aiItem.references) ? aiItem.references : [];
  const citations = [];
  const seen = new Set();
  for (const r of refs) {
    const url = cleanText(r && r.url, 500);
    const domain = (cleanText(r && r.domain, 200) || hostOf(url)).replace(/^www\./, '').toLowerCase();
    if (!url && !domain) continue;
    const key = `${domain}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ url, domain, title: cleanText(r && r.title, 200), isMine: isMine(domain), competitor: compOf(domain) });
  }

  return {
    keyword: cleanText(result.keyword, 200),
    checkUrl: cleanText(result.check_url, 500) || null,
    itemsCount: items.length,
    organicCount: organic.length,
    layout: items.filter((i) => i && i.type).map((i) => ({ type: i.type, absolute: isNum(i.rank_absolute) ? i.rank_absolute : null })),
    searched: { seDomain: cleanText(result.se_domain, 100) || null, locationCode: isNum(result.location_code) ? result.location_code : null, languageCode: cleanText(result.language_code, 20) || null },
    unknownDomainCount,
    top10: organic.filter((i) => i.rank_group <= 10).map((i) => {
      const r = resolved.get(i);
      return {
        position: i.rank_group, absolute: isNum(i.rank_absolute) ? i.rank_absolute : null,
        url: cleanText(i.url, 500), shownUrl: r.shownUrl, domain: r.domain, site: cleanText(i.website_name, 100), title: cleanText(i.title, 200),
        isMine: Boolean(r.domain) && isMine(r.domain),
      };
    }),
    ads: items.filter((i) => i && i.type === 'paid').slice(0, 10).map((i) => {
      const r = resolveItem(i);
      return { position: isNum(i.rank_group) ? i.rank_group : null, absolute: isNum(i.rank_absolute) ? i.rank_absolute : null, domain: r.domain, title: cleanText(i.title, 200), shownUrl: r.shownUrl, description: cleanText(i.description, 300), isMine: Boolean(r.domain) && isMine(r.domain) };
    }),
    mine: !myDomain ? null : {
      status: best ? 'ranked' : `not_in_top_${depth}`,
      uncertain: !best && unknownDomainCount > 0, // not found, but some results hide their website, so it cannot be ruled out
      bestPosition: best ? best.rank_group : null,           // NULL when not ranked, never 0
      bestAbsolute: best && isNum(best.rank_absolute) ? best.rank_absolute : null,
      bestUrl: best ? resolved.get(best).shownUrl || cleanText(best.url, 500) : null,
      urls: mine.map((i) => ({ position: i.rank_group, url: resolved.get(i).shownUrl || cleanText(i.url, 500) })),
      // how many non-organic things (ads, AI Overview, local pack, People Also Ask...) sit above my first result
      itemsAboveMe: best && isNum(best.rank_absolute) ? items.filter((i) => i && i.type !== 'organic' && isNum(i.rank_absolute) && i.rank_absolute < best.rank_absolute).length : null,
    },
    aiOverview: {
      present: Boolean(aiItem),
      citations,
      mineCited: citations.some((c) => c.isMine),
      competitorsCited: [...new Set(citations.map((c) => c.competitor).filter(Boolean))],
    },
  };
}

module.exports = { parseSerp, SerpParseError };
