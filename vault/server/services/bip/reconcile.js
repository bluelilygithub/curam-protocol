'use strict';

// BIP Stage 3. Cross-reference the same fact from several modules, keep EVERY value with its source, and label the agreement.
// Deliberately no winner is chosen: a conflict is shown to the person, who can record a decision on the profile.

const { cleanText, valueKey, abnDigits, abnPretty } = require('./normalise');

function confidence(values) {
  if (!values.length) return { level: 'none', icon: '—', label: 'No value found' };
  const distinct = [...new Set(values.map((v) => valueKey(v.value)).filter(Boolean))];
  const sources = new Set(values.map((v) => v.source));
  if (distinct.length > 1) return { level: 'conflicting', icon: '❌', label: 'Sources disagree' };
  if (sources.size >= 2) return { level: 'confirmed', icon: '✅', label: 'Confirmed by 2+ sources' };
  return { level: 'single', icon: '⚠️', label: 'One source only' };
}

function add(list, value, source, url = null) {
  const text = cleanText(value, 300);
  if (!text) return;
  if (list.some((v) => valueKey(v.value) === valueKey(text) && v.source === source)) return;
  list.push({ value: text, source, url });
}

function addAbn(list, value, source, url = null) {
  if (!abnDigits(value)) return;
  add(list, abnPretty(value), source, url);
}

function collectFields(seed = {}, results = {}) {
  const data = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.data || {}]));
  const out = {
    businessName: [], abn: [], address: [], phone: [],
  };

  add(out.businessName, data.registration?.organisation, 'RDAP / WHOIS', data.registration?.lookupUrl);
  add(out.businessName, data.registration?.registrantName, 'RDAP / WHOIS', data.registration?.lookupUrl);
  add(out.businessName, data.abr?.entityName, 'ABN Lookup (ABR)', 'https://abr.business.gov.au');
  add(out.businessName, data.places?.name, 'Google Places', data.places?.mapsUrl);
  add(out.businessName, seed.registration?.organisation, 'RDAP / WHOIS');
  add(out.businessName, seed.domainsTool?.name, 'Domain tool');

  addAbn(out.abn, data.abr?.abn, 'ABN Lookup (ABR)', 'https://abr.business.gov.au');
  for (const match of [data.registration?.organisation, data.registration?.registrantName, data.domainsTool?.abn]) addAbn(out.abn, match, 'Public website / registry');

  add(out.address, data.registration?.address, 'RDAP / WHOIS', data.registration?.lookupUrl);
  add(out.address, data.places?.address, 'Google Places', data.places?.mapsUrl);
  for (const a of data.website?.addresses || []) add(out.address, a, 'Website scrape', (seed.website?.pages || []).find((p) => /contact|about/i.test(p.url || ''))?.url || null);

  add(out.phone, data.places?.phone, 'Google Places', data.places?.mapsUrl);
  for (const p of data.website?.phones || []) add(out.phone, p, 'Website scrape', (seed.website?.pages || []).find((page) => /contact/i.test(page.url || ''))?.url || null);

  return out;
}

/** @returns {{fields: object, conflicts: string[]}} — the raw values are never reduced to a single "answer". */
function reconcile(seed, results, resolutions = {}) {
  const collected = collectFields(seed, results);
  const fields = {};
  const conflicts = [];
  for (const [key, values] of Object.entries(collected)) {
    const conf = confidence(values);
    if (conf.level === 'conflicting') conflicts.push(key);
    fields[key] = {
      values,
      confidence: conf,
      decision: resolutions?.[key] || null,
    };
  }
  return { fields, conflicts };
}

module.exports = { confidence, collectFields, reconcile };
