'use strict';

// Saved sets on the Domain page: one business idea kept with everything found for it (the description, the generated names, the
// preferred name and shortlist, and the result of each tool as it was). Pure rules, no database: the route calls these so a test can too.
//
// Nothing the browser sends is trusted: only known keys are kept, text is clipped, lists are capped and the whole set has a size limit,
// so a set cannot be used to store arbitrary data. Results are what the data service answered; they are kept as JSON and drawn by the page.

const MAX_SETS_PER_USER = 200;
const MAX_SET_BYTES = 400 * 1024;
const MAX_RESULT_BYTES = 100 * 1024;
// 'handles' is the social check of each name in the side-by-side table: { [name]: the Social Handles answer }
const RESULT_KEYS = ['score', 'compare', 'overview', 'social', 'pricing', 'handles'];

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** Longest an availability answer may be reused for the generator's first look (seconds). A fresh check (max_age 0) is used to verify. */
const GENERATE_MAX_AGE = 300;
const ENDINGS = ['com', 'com.au', 'io', 'ai', 'co', 'app'];

/** A name as a domain label or handle: lower case letters, numbers and hyphens only. */
const labelOf = (name) => String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 63);

/**
 * What the data service said about one name's domain endings, in the shape the page keeps: each ending free (true), taken (false) or
 * unknown (null), where the answer came from ('rdap' is a live registry lookup, 'cache' is a saved answer) and when we asked.
 */
function shapeStatus(name, avail, now = new Date()) {
  const results = (avail && Array.isArray(avail.results) ? avail.results : []).slice(0, 12).map((r) => ({
    domain: clip(r && r.domain, 253), tld: clip(r && r.tld, 24),
    available: r && (r.available === true || r.available === false) ? r.available : null,
    source: clip(r && r.source, 20),
  }));
  return { name, results, hasAvailable: results.some((r) => r.available === true), checkedAt: new Date(now).toISOString() };
}

/** What a person insists on being free: some endings and some social platforms. Kept with the set. */
function cleanRequirements(r) {
  const o = r && typeof r === 'object' ? r : {};
  const list = (v, n, len) => [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, len).toLowerCase()).filter(Boolean))].slice(0, n);
  return { tlds: list(o.tlds, 12, 24), platforms: list(o.platforms, 12, 30) };
}

function cleanSuggestion(s) {
  if (!s || typeof s !== 'object') return null;
  const name = clip(s.name, 120);
  if (!name) return null;
  const results = (Array.isArray(s.results) ? s.results : []).slice(0, 12).map((r) => ({
    domain: clip(r && r.domain, 253), tld: clip(r && r.tld, 24), available: r && (r.available === true || r.available === false) ? r.available : null,
    source: clip(r && r.source, 20),
  }));
  const checkedAt = s.checkedAt && Number.isFinite(new Date(s.checkedAt).getTime()) ? new Date(s.checkedAt).toISOString() : null;
  return { name, results, hasAvailable: results.some((r) => r.available === true), checkedAt };
}

function cleanResult(v) {
  if (v == null || typeof v !== 'object') return null;
  const json = JSON.stringify(v);
  if (json.length > MAX_RESULT_BYTES) return { truncated: true };
  return v;
}

/** The data of a set from whatever the browser sent. Throws { status: 400, message } when it cannot be a set. */
function cleanSetData(input) {
  const d = input && typeof input === 'object' ? input : {};
  const suggestions = (Array.isArray(d.suggestions) ? d.suggestions : (d.suggestions && Array.isArray(d.suggestions.suggestions) ? d.suggestions.suggestions : []))
    .slice(0, 40).map(cleanSuggestion).filter(Boolean);
  const names = new Set(suggestions.map((s) => s.name));
  const preferred = clip(d.preferred, 120);
  const shortlist = [...new Set((Array.isArray(d.shortlist) ? d.shortlist : []).map((n) => clip(n, 120)).filter(Boolean))].slice(0, 16);
  // the three names shown in the side-by-side table, if the person chose them
  const tableNames = [...new Set((Array.isArray(d.tableNames) ? d.tableNames : []).map((n) => clip(n, 120)).filter((n) => n && names.has(n)))].slice(0, 3);
  const results = {};
  for (const k of RESULT_KEYS) {
    const r = d.results && d.results[k] != null ? cleanResult(d.results[k]) : null;
    if (r) results[k] = r;
  }
  const errors = {};
  for (const k of RESULT_KEYS) {
    if (d.errors && d.errors[k]) errors[k] = clip(d.errors[k], 300);
  }
  const out = {
    description: String(d.description == null ? '' : d.description).replace(/\r\n/g, '\n').trim().slice(0, 4000),
    suggestions,
    // the preferred name and shortlist must be names the set actually has (or typed by hand when there are no suggestions)
    preferred: suggestions.length && !names.has(preferred) ? '' : preferred,
    shortlist: suggestions.length ? shortlist.filter((n) => names.has(n)) : shortlist,
    tableNames,
    requirements: cleanRequirements(d.requirements),
    results,
    errors,
    runAt: d.runAt && Number.isFinite(new Date(d.runAt).getTime()) ? new Date(d.runAt).toISOString() : null,
  };
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_SET_BYTES) throw Object.assign(new Error('This set is too large to save. Remove some results and try again.'), { status: 400 });
  return out;
}

/** A set's name: required, short, one line. */
function cleanSetName(name) {
  const n = clip(name, 120);
  if (!n) throw Object.assign(new Error('Give the set a name first.'), { status: 400 });
  return n;
}

/** What the list shows for a set. */
function summarise(row) {
  const d = row.data || {};
  return {
    id: row.id, name: row.name, preferred: row.preferred || d.preferred || '', updatedAt: row.updatedAt, createdAt: row.createdAt,
    names: (d.suggestions || []).length, shortlist: (d.shortlist || []).length, results: Object.keys(d.results || {}).length,
  };
}

module.exports = { GENERATE_MAX_AGE, ENDINGS, labelOf, shapeStatus, cleanRequirements, MAX_SETS_PER_USER, MAX_SET_BYTES, RESULT_KEYS, cleanSetData, cleanSetName, summarise };
