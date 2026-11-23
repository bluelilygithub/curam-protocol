'use strict';

// ABN Lookup's public history page (https://abr.business.gov.au/AbnHistory/View?id=<ABN>), read when an ABN is known but ABR_GUID
// (the JSON web service) is not set. No key needed. The page is one table of sections, each a header row (<th>) then value rows
// (<td> value, From, To): Entity name, ABN Status, Entity type, GST, Main business location, and for some entities business or
// trading names. The result has the same shape as the JSON lookup, plus the history lists. Fetches go through htmlFetch (SSRF guard).

const fetchLib = require('../htmlFetch');
const { abnDigits, abnPretty, cleanText } = require('./normalise');

const historyUrl = (abn) => `https://abr.business.gov.au/AbnHistory/View?id=${abnDigits(abn)}`;
const viewUrl = (abn) => `https://abr.business.gov.au/ABN/View?abn=${abnDigits(abn)}`;

const cellText = (html) => cleanText(fetchLib.decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/ /g, ' '), 300);

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "10 Dec 2012" -> "2012-12-10"; "(current)" or anything else -> null. */
function isoDate(s) {
  const m = String(s || '').match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** The sections of the history table: { 'entity name': [[value, from, to], …], … } with lower-case section names. */
function sections(html) {
  const out = {};
  let current = null;
  // a section never runs into the next table (the ACN and gift-recipient tables have no header row of their own)
  for (const tr of String(html || '').match(/<table|<tr[\s\S]*?<\/tr>/gi) || []) {
    if (/^<table/i.test(tr)) { current = null; continue; }
    const heads = [...tr.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => cellText(m[1]));
    if (heads.length) { current = heads[0].toLowerCase(); out[current] = out[current] || []; continue; }
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    if (current && cells.length && cells[0]) out[current].push(cells);
  }
  return out;
}

const period = ([value, from, to]) => ({ value, from: isoDate(from), to: /current/i.test(to || '') ? null : isoDate(to) });
const isCurrent = (row) => /current/i.test(row[2] || '') || row.length === 1;

/** Parse the history page. Returns null when it holds no entity name (no such ABN, or the page changed). */
function parseAbnHistory(html, abn) {
  const s = sections(html);
  const names = (s['entity name'] || []).map(period);
  if (!names.length) return null;
  const pick = (key) => Object.keys(s).find((k) => k.startsWith(key));
  const status = (s[pick('abn status')] || []).find(isCurrent);
  const gst = (s[pick('goods & services tax')] || s[pick('gst')] || []).find(isCurrent);
  const locations = (s[pick('main business location')] || []).map(period).filter((l) => /^[A-Z]{2,3}\s+\d{4}$/.test(l.value));
  const location = locations.find((l) => !l.to) || locations[0] || null;
  const [state, postcode] = String(location?.value || '').split(/\s+/);
  const tradingKey = pick('business name') || pick('trading name');
  const acn = String(html || '').match(/(\d{3}\s?\d{3}\s?\d{3})\s*(?:<[^>]+>\s*)*View record on the ASIC website/i);
  const firstActive = (s[pick('abn status')] || []).map(period).filter((p) => /active/i.test(p.value)).map((p) => p.from).filter(Boolean).sort()[0] || null;
  return {
    abn: abnPretty(abn),
    entityName: (names.find((n) => !n.to) || names[0]).value,
    nameHistory: names,
    entityType: (s[pick('entity type')] || [])[0]?.[0] || null,
    abnStatus: status ? `${status[0]}${status[1] ? ` from ${status[1]}` : ''}` : null,
    registrationDate: firstActive,
    gstStatus: gst ? `${gst[0]}${gst[1] ? ` from ${gst[1]}` : ''}` : null,
    gstFrom: gst ? isoDate(gst[1]) : null,
    state: state || null,
    postcode: postcode || null,
    locationHistory: locations,
    tradingNames: tradingKey ? (s[tradingKey] || []).filter(isCurrent).map((r) => r[0]) : [],
    acn: acn ? acn[1].replace(/\s+/g, ' ') : null,
    lookupUrl: viewUrl(abn),
    via: 'ABN Lookup public page',
  };
}

/** Fetch and parse; null when there is no record. */
async function lookupAbnPublic(abn, deps = {}) {
  const fetchHtml = deps.fetchHtml || fetchLib.fetchHtml;
  const res = await fetchHtml(historyUrl(abn));
  if (!res || res.statusCode >= 400 || !res.body) throw new Error(`ABN Lookup returned HTTP ${res?.statusCode || 'no response'}`);
  return parseAbnHistory(res.body, abn);
}

module.exports = { historyUrl, viewUrl, isoDate, sections, parseAbnHistory, lookupAbnPublic };
