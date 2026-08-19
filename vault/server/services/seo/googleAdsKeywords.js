'use strict';

const { callModel } = require('../callModel');
const { getModelsForUser, pickTextModel } = require('../modelResolver');
const { logUsage } = require('../../utils/logUsage');
const { parseModelJson } = require('../../utils/parseModelJson');

const TARGET = 100;
const MATCH_TYPES = new Set(['broad', 'phrase', 'exact']);

const KEYWORD_SYSTEM = `You are a senior Google Ads strategist building an initial Search campaign keyword list from a scraped website.
Return ONLY valid JSON. No markdown fences.
Rules:
- Keywords must be things a paying customer would type into Google.
- Mix single words, 2–4 word phrases, and a few longer phrases.
- Include brand terms from the site, core services/products, location + service combos if a city/region is clear, problem/solution phrasing, and commercial-intent variants (buy, near me, cost, quote, professional).
- Prefer phrase and exact match for most items; use broad sparingly.
- Do not invent unrelated industries. Stay grounded in the site content.
- No duplicate phrases (case-insensitive). No URLs. No punctuation except hyphens/apostrophes.`;

const NEGATIVE_SYSTEM = `You are a senior Google Ads strategist writing an initial negative keyword list so the advertiser does not waste spend.
Return ONLY valid JSON. No markdown fences.
Negatives should block:
- job seekers (jobs, salary, careers, hiring, intern)
- DIY / free / cheap / torrent / template / how to make
- informational-only queries that will not convert (wikipedia, definition, meaning) when the site sells a commercial service
- competitors only if they are clearly NOT this business
- unrelated product categories that share words with this business
- student, wholesale, used, second hand, diy, tutorial — when they do not match the offer
Do not negate the advertiser's own brand or core service names from the positive list.
Phrase match for most negatives. No duplicates.`;

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function cleanPhrase(raw) {
  return String(raw || '')
    .replace(/[\[\]"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function asItem(entry, fallbackMatch = 'phrase') {
  if (typeof entry === 'string') {
    const phrase = cleanPhrase(entry);
    return phrase ? { phrase, matchType: fallbackMatch } : null;
  }
  if (!entry || typeof entry !== 'object') return null;
  const phrase = cleanPhrase(entry.phrase || entry.keyword || entry.text);
  if (!phrase) return null;
  const match = String(entry.matchType || entry.match_type || fallbackMatch).toLowerCase();
  return {
    phrase,
    matchType: MATCH_TYPES.has(match) ? match : fallbackMatch,
    intent: entry.intent ? String(entry.intent).slice(0, 40) : undefined,
  };
}

function uniqueTake(list, limit, fallbackMatch) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const item = asItem(raw, fallbackMatch);
    if (!item) continue;
    const key = item.phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function dropOverlaps(negatives, keywords) {
  const positive = new Set(keywords.map((k) => k.phrase.toLowerCase()));
  return negatives.filter((n) => !positive.has(n.phrase.toLowerCase()));
}

async function resolveModel(userId) {
  const tiers = await getModelsForUser(userId);
  const modelId = pickTextModel(tiers, 'standard');
  if (!modelId) {
    throw new Error('No text model configured — add a chat model in Settings → AI & Chat');
  }
  return modelId;
}

async function callJson(userId, modelId, prompt, { system, maxTokens, feature }) {
  const result = await callModel(modelId, prompt, { system, maxTokens, returnUsage: true });
  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature,
  });
  let parsed = parseModelJson(result.text);
  if (parsed) return parsed;

  const retry = await callModel(
    modelId,
    `The previous response was not valid JSON. Return ONLY valid JSON with no markdown fences.\n\nPrevious output:\n${String(result.text || '').slice(0, 8000)}`,
    { system: 'You fix malformed JSON. Output valid JSON only.', maxTokens, returnUsage: true }
  );
  logUsage({
    userId,
    model: retry.model,
    inputTokens: retry.inputTokens,
    outputTokens: retry.outputTokens,
    feature: `${feature}_retry`,
  });
  parsed = parseModelJson(retry.text);
  if (!parsed) throw new Error('Could not parse keyword response — try again');
  return parsed;
}

function extractList(parsed, keys) {
  if (Array.isArray(parsed)) return parsed;
  for (const key of keys) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  return [];
}

function siteBrief(snapshot, notes) {
  const headings = (snapshot.headings || []).slice(0, 20).map((h) => h.text).join('; ');
  return `Website: ${snapshot.finalUrl || snapshot.url}
Title: ${snapshot.title || ''}
Meta description: ${snapshot.description || ''}
Headings: ${headings}
${notes ? `Advertiser notes: ${notes}\n` : ''}
Site content:
${String(snapshot.text || '').slice(0, 12000)}`;
}

async function fillToTarget(userId, modelId, current, { kind, brief, system, feature }) {
  let list = current.slice();
  for (let i = 0; i < 2 && list.length < TARGET; i++) {
    const need = TARGET - list.length;
    const existing = list.map((x) => x.phrase).join(', ');
    const parsed = await callJson(userId, modelId, `${brief}

You already have ${list.length} ${kind} items:
${existing}

Add exactly ${need} MORE unique ${kind} that are not in that list.
Return JSON: { "items": [ { "phrase": "...", "matchType": "phrase|exact|broad" } ] }`, {
      system,
      maxTokens: 4000,
      feature: `${feature}_fill`,
    });
    const extra = uniqueTake(extractList(parsed, ['items', 'keywords', 'negatives', 'phrases']), need, 'phrase');
    const seen = new Set(list.map((x) => x.phrase.toLowerCase()));
    for (const item of extra) {
      if (seen.has(item.phrase.toLowerCase())) continue;
      seen.add(item.phrase.toLowerCase());
      list.push(item);
      if (list.length >= TARGET) break;
    }
  }
  return list.slice(0, TARGET);
}

async function generateGoogleAdsKeywords(userId, snapshot, { notes = '' } = {}) {
  if (!snapshot?.text || snapshot.text.length < 80) {
    throw new Error('Not enough text on that site to build keywords — check the URL is a public page');
  }
  const modelId = await resolveModel(userId);
  const brief = siteBrief(snapshot, notes);

  const kwParsed = await callJson(userId, modelId, `${brief}

Build the initial Google Ads keyword list for this advertiser.
Return JSON:
{
  "business": "one-line what they sell",
  "geo": "city/region if clear, else empty string",
  "keywords": [
    { "phrase": "example phrase", "matchType": "phrase", "intent": "commercial" }
  ]
}
The keywords array MUST contain exactly ${TARGET} items.`, {
    system: KEYWORD_SYSTEM,
    maxTokens: 8000,
    feature: 'seo_keywords',
  });

  let keywords = uniqueTake(extractList(kwParsed, ['keywords', 'items', 'phrases']), TARGET, 'phrase');
  keywords = await fillToTarget(userId, modelId, keywords, {
    kind: 'keywords',
    brief,
    system: KEYWORD_SYSTEM,
    feature: 'seo_keywords',
  });

  const negParsed = await callJson(userId, modelId, `${brief}

Business: ${kwParsed.business || snapshot.title || ''}
Positive keywords (do not negate these):
${keywords.map((k) => k.phrase).join(', ')}

Build the initial Google Ads NEGATIVE keyword list.
Return JSON:
{
  "negatives": [
    { "phrase": "jobs", "matchType": "phrase" }
  ]
}
The negatives array MUST contain exactly ${TARGET} items.`, {
    system: NEGATIVE_SYSTEM,
    maxTokens: 8000,
    feature: 'seo_negatives',
  });

  let negatives = uniqueTake(extractList(negParsed, ['negatives', 'items', 'keywords', 'phrases']), TARGET, 'phrase');
  negatives = dropOverlaps(negatives, keywords);
  negatives = await fillToTarget(userId, modelId, negatives, {
    kind: 'negative keywords',
    brief: `${brief}\nDo not include: ${keywords.map((k) => k.phrase).join(', ')}`,
    system: NEGATIVE_SYSTEM,
    feature: 'seo_negatives',
  });
  negatives = dropOverlaps(negatives, keywords).slice(0, TARGET);

  return {
    kind: 'google_ads_keywords',
    business: String(kwParsed.business || snapshot.title || '').slice(0, 240),
    geo: String(kwParsed.geo || '').slice(0, 120),
    keywords,
    negatives,
    counts: { keywords: keywords.length, negatives: negatives.length },
    generatedAt: new Date().toISOString(),
    model: modelId,
  };
}

async function getSeoStatus(userId) {
  const tiers = await getModelsForUser(userId);
  const textModel = pickTextModel(tiers, 'standard') || pickTextModel(tiers, 'light');
  return {
    ai: Boolean(textModel),
    textModel,
  };
}

module.exports = {
  TARGET,
  generateGoogleAdsKeywords,
  getSeoStatus,
  uniqueTake,
  parseJsonField,
};
