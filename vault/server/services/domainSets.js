'use strict';

// Saved sets on the Domain page: one naming brief kept with everything found for it. Pure rules, no database: the route calls these so
// a test can too.
//
// A set is stored as JSON in domain_sets.data. Version 2 (this file) holds the brief, the pool of candidate names with their reasons
// and domain checks, the shortlist and preferred name, the feedback that steers new rounds, and (from the check stage on) the verdict
// evidence for each name. Version 1 (the old toolbox: description, suggestions, tool results) is converted when a set is opened, and
// its old tool results are kept untouched under `legacy`.
//
// Nothing the browser sends is trusted: only known keys are kept, text is clipped, lists are capped and the whole set has a size limit,
// so a set cannot be used to store arbitrary data.

const MAX_SETS_PER_USER = 200;
const MAX_SET_BYTES = 400 * 1024;
const MAX_POOL = 150;
const MAX_SEEN = 300;
const MAX_CHECK_BYTES = 12 * 1024;
const MAX_LEGACY_BYTES = 100 * 1024;

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** Longest an availability answer may be reused for the generator's first look (seconds). A live check uses max_age 0. */
const GENERATE_MAX_AGE = 300;
const ENDINGS = ['com', 'com.au', 'org', 'io', 'ai', 'co', 'app'];

/** A name as a domain label or handle: lower case letters, numbers and hyphens only. */
const labelOf = (name) => String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 63);

/**
 * What the data service said about one name's domain endings, in the shape the page keeps: each ending free (true), taken (false) or
 * unknown (null), where the answer came from ('rdap' is a live registry lookup, 'cache' is a saved answer) and when we asked.
 */
function shapeStatus(name, avail, now = new Date()) {
  const results = (avail && Array.isArray(avail.results) ? avail.results : []).slice(0, 12).map((r) => ({
    domain: clip(r && r.domain, 253), tld: clip(r && r.tld, 24).replace(/^\./, ''),
    available: r && (r.available === true || r.available === false) ? r.available : null,
    source: clip(r && r.source, 20),
  }));
  return { name, results, hasAvailable: results.some((r) => r.available === true), checkedAt: new Date(now).toISOString() };
}

/**
 * Names the person already has (a book title, an artist's name, a business) turned into domain labels, so they are always checked and
 * never depend on the AI thinking of them. "The Staircase Suitcase" gives staircasesuitcase and thestaircasesuitcase; "Dorothy Stoner"
 * gives dorothystoner. Returns [{ name, label }]: the label is what the person typed, shown beside the name.
 */
const MAX_OWN_PHRASES = 5;
function ownVariants(text) {
  const phrases = String(text == null ? '' : text).split(/[\n;,]+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_OWN_PHRASES);
  const out = [];
  const seen = new Set();
  for (const phrase of phrases) {
    const words = phrase.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s]+/).map((w) => w.replace(/^-+|-+$/g, '')).filter(Boolean);
    if (!words.length || (words.length === 1 && ['the', 'a', 'an'].includes(words[0]))) continue;
    const joined = words.join('');
    const variants = [joined];
    if (words.length > 1 && ['the', 'a', 'an'].includes(words[0])) variants.push(words.slice(1).join(''));
    for (const v of variants) {
      if (v.length < 3 || v.length > 63 || seen.has(v)) continue;
      seen.add(v);
      out.push({ name: v, label: phrase.slice(0, 80) });
    }
  }
  return out;
}

/** The endings that were asked for but are not in the data service's answer (it may skip some), so they can be asked for again. */
function missingTlds(avail, wanted) {
  const got = new Set((avail && Array.isArray(avail.results) ? avail.results : []).map((r) => String((r && r.tld) || '').replace(/^\./, '').toLowerCase()));
  return (wanted || []).map((t) => String(t).trim().toLowerCase()).filter((t) => t && !got.has(t));
}

/** What a person insists on being free: some endings and some social platforms. */
function cleanRequirements(r) {
  const o = r && typeof r === 'object' ? r : {};
  const list = (v, n, len) => [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, len).toLowerCase()).filter(Boolean))].slice(0, n);
  return { tlds: list(o.tlds, 12, 24), platforms: list(o.platforms, 12, 30) };
}

/** A set's name: required, short, one line. */
function cleanSetName(name) {
  const n = clip(name, 120);
  if (!n) throw Object.assign(new Error('Give the set a name first.'), { status: 400 });
  return n;
}

// ── version 2 ────────────────────────────────────────────────────────────────

function cleanDomains(d) {
  const results = (d && Array.isArray(d.results) ? d.results : []).slice(0, 12).map((r) => ({
    domain: clip(r && r.domain, 253), tld: clip(r && r.tld, 24).replace(/^\./, ''),
    available: r && (r.available === true || r.available === false) ? r.available : null,
    source: clip(r && r.source, 20),
  }));
  const checkedAt = d && d.checkedAt && Number.isFinite(new Date(d.checkedAt).getTime()) ? new Date(d.checkedAt).toISOString() : null;
  return { checkedAt, results, hasAvailable: results.some((r) => r.available === true) };
}

function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  const name = labelOf(c.name);
  if (!name) return null;
  const label = clip(c.label, 80);
  const score = Number(c.spell && c.spell.score);
  return {
    name,
    ...(label ? { label } : {}),
    ...(c.own ? { own: true } : {}),
    style: clip(c.style, 20),
    syllables: Math.max(0, Math.min(20, Math.round(Number(c.syllables)) || 0)),
    spell: { score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0, notes: (c.spell && Array.isArray(c.spell.notes) ? c.spell.notes : []).slice(0, 3).map((n) => clip(n, 120)).filter(Boolean) },
    reasoning: clip(c.reasoning, 320),
    risks: (Array.isArray(c.risks) ? c.risks : []).slice(0, 4).map((r) => clip(r, 200)).filter(Boolean),
    domains: cleanDomains(c.domains),
    round: Math.max(1, Math.min(99, Math.round(Number(c.round)) || 1)),
  };
}

/** The talk-it-through exchanges kept with a set: the last twelve, each clipped. */
function cleanConversation(v) {
  return (Array.isArray(v) ? v : []).map((t) => ({ q: clip(t && t.q, 800), a: String((t && t.a) == null ? '' : t.a).replace(/\r\n/g, '\n').trim().slice(0, 1500) })).filter((t) => t.q && t.a).slice(-12);
}

function boundedJson(v, max) {
  if (v == null || typeof v !== 'object') return null;
  return JSON.stringify(v).length > max ? { truncated: true } : v;
}

/** The data of a set from whatever the browser sent. Throws { status: 400 } when it is too large. */
function cleanSetData(input) {
  const d = input && typeof input === 'object' ? input : {};
  const { cleanBrief } = require('./domainNaming/brief'); // loaded here: brief.js uses this file
  const seenNames = new Set();
  const pool = [];
  for (const c of (Array.isArray(d.pool) ? d.pool : []).slice(0, MAX_POOL)) {
    const card = cleanCard(c);
    if (card && !seenNames.has(card.name)) { seenNames.add(card.name); pool.push(card); }
  }
  const nameList = (v, n) => [...new Set((Array.isArray(v) ? v : []).map(labelOf).filter(Boolean))].slice(0, n);
  const inPool = (list) => (pool.length ? list.filter((n) => seenNames.has(n)) : list);
  const preferredRaw = labelOf(d.preferred);
  const checks = {};
  for (const [name, v] of Object.entries(d.checks && typeof d.checks === 'object' ? d.checks : {}).slice(0, 50)) {
    const key = labelOf(name);
    const b = boundedJson(v, MAX_CHECK_BYTES);
    if (key && b && (!pool.length || seenNames.has(key))) checks[key] = b;
  }
  const out = {
    schemaVersion: 2,
    brief: cleanBrief(d.brief),
    pool,
    shortlist: inPool(nameList(d.shortlist, 16)),
    preferred: pool.length && !seenNames.has(preferredRaw) ? '' : preferredRaw,
    feedback: { more: nameList(d.feedback && d.feedback.more, 30), less: nameList(d.feedback && d.feedback.less, 30) },
    conversation: cleanConversation(d.conversation),
    seen: nameList(d.seen, MAX_SEEN),
    rounds: Math.max(0, Math.min(99, Math.round(Number(d.rounds)) || 0)),
    checks,
  };
  const legacy = boundedJson(d.legacy, MAX_LEGACY_BYTES);
  if (legacy) out.legacy = legacy;
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_SET_BYTES) throw Object.assign(new Error('This set is too large to save. Remove some names and try again.'), { status: 400 });
  return out;
}

/**
 * A stored set as version 2, whichever version it was saved as. A version 1 set (the old toolbox) keeps its names, shortlist, preferred
 * name, requirements and handle checks; the old tool results (score, compare, profile, pricing) are kept under `legacy` and not shown.
 */
function upgradeSetData(data) {
  const d = data && typeof data === 'object' ? data : {};
  if (d.schemaVersion === 2) return d;
  const { cleanBrief } = require('./domainNaming/brief');
  const { spellingRisk, syllables } = require('./domainNaming/spelling');
  const pool = (Array.isArray(d.suggestions) ? d.suggestions : []).map((s) => {
    const name = labelOf(s && s.name);
    if (!name) return null;
    return {
      name,
      ...(s.label ? { label: clip(s.label, 80) } : {}),
      ...(s.own ? { own: true } : {}),
      style: s.own ? 'own' : '',
      syllables: syllables(name),
      spell: spellingRisk(name),
      reasoning: '',
      risks: [],
      domains: cleanDomains({ checkedAt: s.checkedAt, results: s.results }),
      round: 1,
    };
  }).filter(Boolean);
  const checks = {};
  const handles = (d.results && d.results.handles) || {};
  for (const [name, social] of Object.entries(handles)) {
    const key = labelOf(name);
    if (key) checks[key] = { social, checkedAt: social && social.checked_at ? social.checked_at : null };
  }
  const oldResults = { ...(d.results || {}) };
  delete oldResults.handles;
  const legacy = { results: oldResults, errors: d.errors || {}, runAt: d.runAt || null, tableNames: d.tableNames || [] };
  return {
    schemaVersion: 2,
    brief: cleanBrief({ what: d.description, own: d.ownNames, required: d.requirements }),
    pool,
    shortlist: (d.shortlist || []).map(labelOf).filter(Boolean),
    preferred: labelOf(d.preferred),
    feedback: { more: [], less: [] },
    conversation: [],
    seen: pool.map((p) => p.name),
    rounds: pool.length ? 1 : 0,
    checks,
    legacy,
  };
}

/** What the saved-sets list shows for a set (either version). */
function summarise(row) {
  const d = row.data || {};
  const v2 = d.schemaVersion === 2;
  return {
    id: row.id, name: row.name, preferred: row.preferred || d.preferred || '', updatedAt: row.updatedAt, createdAt: row.createdAt,
    names: v2 ? (d.pool || []).length : (d.suggestions || []).length,
    shortlist: (d.shortlist || []).length,
    checked: v2 ? Object.keys(d.checks || {}).length : Object.keys((d.results && d.results.handles) || {}).length,
    what: v2 ? clip(d.brief && d.brief.what, 120) : clip(d.description, 120),
  };
}

module.exports = {
  GENERATE_MAX_AGE, ENDINGS, MAX_SETS_PER_USER, MAX_SET_BYTES, MAX_POOL, MAX_OWN_PHRASES,
  labelOf, cleanCard, cleanConversation, shapeStatus, ownVariants, missingTlds, cleanRequirements, cleanSetName, cleanSetData, upgradeSetData, summarise,
};
