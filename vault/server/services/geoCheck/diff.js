'use strict';

// What differs, in plain words, with no model (docs/geo-check.md, milestone 4). Two comparisons:
//   diffRun(run, captures)        across the countries of one check: redirects, language, title, currency, prices, cookie notice,
//                                 headings and buttons shown in some countries only
//   diffRuns(older, newer)        the same country in two checks of the same address: what changed between them
// Each returns { lines: [{ topic, text }], notCompared: [...] }. Headings and buttons are only compared between countries that got the
// same language. A country is compared from all its pictures together (headings and
// buttons are the union over its screens; the rest comes from the first picture, since one load serves every screen). Failed and blocked
// countries are left out of the comparison and named. Test: node server/services/geoCheck/diff.test.js

const MAX_ITEMS = 8;
const MAX_GROUPS = 6;

const parse = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
const quote = (list) => {
  const shown = list.slice(0, MAX_ITEMS).map((s) => `"${s}"`).join(', ');
  return list.length > MAX_ITEMS ? `${shown} and ${list.length - MAX_ITEMS} more` : shown;
};

/** host + path without a trailing slash, query or hash: two addresses that open the same page compare equal. */
function samePlace(u) {
  try {
    const x = new URL(u);
    return `${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch { return String(u || '').toLowerCase(); }
}

/** One country's facts from its captures (any order). Null when nothing usable was captured. */
function countryFacts(caps) {
  const usable = caps.filter((c) => c.status === 'ok' && c.extract);
  if (!usable.length) return null;
  const first = parse(usable[0].extract) || {};
  const union = (key) => [...new Set(usable.flatMap((c) => (parse(c.extract) || {})[key] || []))];
  return {
    finalUrl: usable[0].finalUrl || null,
    lang: (usable[0].htmlLang || first.htmlLang || '').trim() || 'none given',
    title: (usable[0].title || first.title || '').trim(),
    currencies: [...(first.currencies || [])].sort(),
    prices: first.prices || [],
    consent: usable.some((c) => (parse(c.extract) || {}).consentBanner),
    headings: union('headings'),
    buttons: union('buttons'),
  };
}

function byCountry(captures, order) {
  const out = new Map();
  const names = order && order.length ? order : [...new Set(captures.map((c) => c.country))];
  for (const code of names) out.set(code, captures.filter((c) => c.country === code));
  return out;
}

/** Groups countries by a value: [{ value, countries: [] }], biggest group first, in a stable order. */
function groupBy(entries, keyOf) {
  const groups = new Map();
  for (const [code, f] of entries) {
    const key = keyOf(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(code);
  }
  return [...groups.entries()].map(([value, countries]) => ({ value, countries })).sort((a, b) => b.countries.length - a.countries.length);
}

const describeGroups = (groups, show) => groups.slice(0, MAX_GROUPS).map((g) => `${show(g.value)} in ${g.countries.join(', ')}`).join('; ');

function diffRun(run, captures) {
  const settings = parse(run.settings) || {};
  const lines = [];
  const notCompared = [];
  const facts = [];
  for (const [code, caps] of byCountry(captures, settings.countries)) {
    const f = countryFacts(caps);
    if (f) facts.push([code, f]);
    else if (caps.length) notCompared.push(`${code} (${caps.some((c) => c.status === 'blocked') ? 'blocked by the site' : 'failed'})`);
  }
  if (facts.length < 2) return { lines, notCompared, compared: facts.map(([c]) => c) };

  // redirects: where each country ended up, when that is not the address asked for
  const asked = samePlace(run.url);
  const moved = facts.filter(([, f]) => f.finalUrl && samePlace(f.finalUrl) !== asked);
  if (moved.length) {
    const groups = groupBy(moved, (f) => f.finalUrl);
    const stayed = facts.length - moved.length;
    lines.push({ topic: 'Redirects', text: `${describeGroups(groups, (u) => `Sent to ${u}`)}${stayed ? `; the others stayed on the address asked for` : ''}.` });
  }
  const differ = (keyOf, topic, show) => {
    const groups = groupBy(facts, keyOf);
    if (groups.length > 1) lines.push({ topic, text: `${describeGroups(groups, show)}.` });
  };
  differ((f) => f.lang, 'Language', (v) => v);
  differ((f) => f.title, 'Page title', (v) => `"${v || 'no title'}"`);
  differ((f) => f.currencies.join(' '), 'Currency', (v) => v || 'no currency shown');
  const priceGroups = groupBy(facts, (f) => f.prices.slice(0, 5).join(', '));
  if (priceGroups.length > 1) lines.push({ topic: 'Prices', text: `${describeGroups(priceGroups, (v) => (v ? `first prices ${v}` : 'no prices'))}.` });

  const withConsent = facts.filter(([, f]) => f.consent).map(([c]) => c);
  if (withConsent.length && withConsent.length < facts.length) lines.push({ topic: 'Cookie notice', text: `A cookie or consent notice only in ${withConsent.join(', ')}.` });

  // headings and buttons shown in some countries only, grouped by which countries show them. Only between countries that got the same
  // language: across languages every heading differs, which would bury the lines that matter.
  for (const { countries: sameLang } of groupBy(facts, (f) => f.lang)) {
    if (sameLang.length < 2) continue;
    const group = facts.filter(([c]) => sameLang.includes(c));
    for (const [key, word] of [['headings', 'Headings'], ['buttons', 'Buttons']]) {
      const where = new Map();
      for (const [code, f] of group) for (const t of f[key]) { if (!where.has(t)) where.set(t, []); where.get(t).push(code); }
      const groups = new Map();
      for (const [t, codes] of where) {
        if (codes.length === group.length) continue;
        const k = codes.join(', ');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      }
      [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_GROUPS)
        .forEach(([codes, texts]) => lines.push({ topic: `${word} only in some countries`, text: `Only in ${codes}: ${quote(texts)}.` }));
    }
  }
  return { lines, notCompared, compared: facts.map(([c]) => c) };
}

/** Changes per country between two checks of the same address (older first). */
function diffRuns(older, newer) {
  const lines = [];
  const notCompared = [];
  const a = byCountry(older.captures);
  const b = byCountry(newer.captures);
  for (const [code, capsB] of b) {
    if (!a.has(code)) { notCompared.push(`${code} (only in the newer check)`); continue; }
    const fa = countryFacts(a.get(code));
    const fb = countryFacts(capsB);
    if (!fa || !fb) { notCompared.push(`${code} (${!fb ? 'failed or blocked in the newer check' : 'failed or blocked in the older check'})`); continue; }
    const say = (topic, text) => lines.push({ topic: `${code}: ${topic}`, text });
    if (samePlace(fa.finalUrl) !== samePlace(fb.finalUrl)) say('redirect', `Was sent to ${fa.finalUrl}, now ${fb.finalUrl}.`);
    if (fa.lang !== fb.lang) say('language', `Was ${fa.lang}, now ${fb.lang}.`);
    if (fa.title !== fb.title) say('page title', `Was "${fa.title}", now "${fb.title}".`);
    if (fa.currencies.join(' ') !== fb.currencies.join(' ')) say('currency', `Was ${fa.currencies.join(' ') || 'none'}, now ${fb.currencies.join(' ') || 'none'}.`);
    const addedP = fb.prices.filter((p) => !fa.prices.includes(p));
    const goneP = fa.prices.filter((p) => !fb.prices.includes(p));
    if (addedP.length || goneP.length) say('prices', [addedP.length ? `new ${addedP.slice(0, MAX_ITEMS).join(', ')}` : '', goneP.length ? `gone ${goneP.slice(0, MAX_ITEMS).join(', ')}` : ''].filter(Boolean).join('; ') + '.');
    if (fa.consent !== fb.consent) say('cookie notice', fb.consent ? 'A cookie or consent notice appeared.' : 'The cookie or consent notice is gone.');
    for (const [key, word] of [['headings', 'headings'], ['buttons', 'buttons']]) {
      const added = fb[key].filter((t) => !fa[key].includes(t));
      const gone = fa[key].filter((t) => !fb[key].includes(t));
      if (added.length || gone.length) say(word, [added.length ? `new ${quote(added)}` : '', gone.length ? `gone ${quote(gone)}` : ''].filter(Boolean).join('; ') + '.');
    }
  }
  for (const code of a.keys()) if (!b.has(code)) notCompared.push(`${code} (only in the older check)`);
  return { lines, notCompared };
}

module.exports = { diffRun, diffRuns, samePlace, countryFacts };
