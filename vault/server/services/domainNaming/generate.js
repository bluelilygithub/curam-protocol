'use strict';

// One round of naming: the heart of the Domain tool. Generate wide, throw most of it away in code for free, check domains for only the
// best few, then explain the finalists.
//
//   1. WIDE      the AI writes about 180 candidates (names only, so it is cheap). Variations skip this: they are made by code.
//   2. FILTER    code drops names that are too long, filler, avoided, hard to spell when heard, near a famous brand or near each other.
//   3. RANK      easy to say and spell, a comfortable length, styles mixed.
//   4. CHECK     only the best CHECK_BATCH are looked up (1 credit each, all endings in one request); a name with a REQUIRED ending taken
//                is dropped, an unanswered ending is kept and shown as unknown.
//   5. EXPLAIN   one more AI call gives the finalists a reason and plain risks. Failure here never loses the names.
//
// The names the person already has (a book title, an artist) are always included and checked, whatever else happens.
// Everything outside the code (model, DomScan, clock) is passed in so this can be tested without a network.

const { ownVariants, shapeStatus, ENDINGS, GENERATE_MAX_AGE } = require('../domainSets');
const { widePrompt, explainPrompt, parseWide, parseExplain } = require('./brief');
const { filterCandidates, rankLocal, variations, describe, normalizeName } = require('./candidates');

const WIDE_CALLS = 2;           // the wide list is written by two calls at once, half each, so no single call has to write 180 names
const WIDE_EACH = 90;
const WIDE_COUNT = WIDE_CALLS * WIDE_EACH;
const WIDE_TIMEOUT_MS = 150000;
const EXPLAIN_TIMEOUT_MS = 120000;
const CHECK_DEADLINE_MS = 170000; // no new domain lookup is started after this, so a slow AI step cannot push the whole request past the gateway limit
const BUDGET_MS = 200000;       // past this the explanations are skipped rather than risk the gateway cutting the request off
const CHECK_BATCH = 40;      // domain lookups for a normal round (1 credit each)
const VARIATION_BATCH = 24;
const SHOW = 12;
const COMBO_WORDS = ['gallery', 'exhibitions', 'collection', 'stories', 'art', 'events'];
const CONCURRENCY = 8;

/** Run `fn` over `items`, at most `limit` at a time, keeping the order of the results. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next; next += 1;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Names built on the person's own names, made by code so they never depend on the AI: the title or the person joined with the brief's
 * own words (or gallery, exhibitions, collection...). Taken in turn across the names so each gets some, at most 8 in all, so they lead the
 * list without crowding out the creative names.
 */
function ownCombos(own, brief) {
  const words = ((brief.include && brief.include.length) ? brief.include.slice(0, 3) : COMBO_WORDS).map(normalizeName).filter((w) => w.length >= 3);
  const byLabel = new Map();
  for (const o of own) if (!byLabel.has(o.label)) byLabel.set(o.label, o.name);
  const out = [];
  for (const w of words) for (const base of byLabel.values()) out.push({ name: base + w, style: 'built on your name' });
  return out.slice(0, 8);
}

/** The plain risks shown on a card: the AI's, then what code found (spelling, a known brand). At most four. */
function risksFor(item, aiRisks) {
  const out = [...(aiRisks || [])];
  if (item.spell && item.spell.score >= 25 && item.spell.notes.length) out.push(`Could be mistyped after hearing it: ${item.spell.notes[0]}.`);
  for (const n of item.brandNotes || []) out.push(`It ${n}.`);
  return out.slice(0, 4);
}

/**
 * @param {object} args { userId, brief (cleaned), mode: 'round'|'variations', seed, feedback, seen, round }
 * @param {object} deps { getModels(userId), callModel, logUsage, statusFor(name, tlds, maxAge), now() }
 */
async function generateRound(args, deps) {
  const { userId, brief, mode = 'round', seed = '', feedback = {}, seen = [], round = 1 } = args;
  const now = deps.now ? deps.now() : new Date();
  const clock = deps.clock || Date.now;
  const started = clock();
  const required = (brief.required && brief.required.tlds) || [];
  const counts = { generated: 0, passedFilters: 0, checked: 0, takenDropped: 0, shown: 0 };
  let model = '';

  // the person's own names are always in (each round of names; not variations of one favourite)
  const own = mode === 'variations' ? [] : ownVariants(brief.own).map((o) => ({ name: o.name, label: o.label, own: true, style: 'own' }));

  // 1. wide (or variations made by code)
  let wide = [];
  if (mode === 'variations') {
    wide = variations(seed, brief);
  } else {
    const tiers = await deps.getModels(userId);
    model = tiers && (tiers.standard || tiers.light);
    if (!model) throw Object.assign(new Error('No AI model is set up in Settings → AI & Chat.'), { status: 400 });
    const calls = await Promise.allSettled(Array.from({ length: WIDE_CALLS }, async (_, i) => {
      const result = await deps.callModel(model, widePrompt(brief, { count: WIDE_EACH, feedback, seen, part: { index: i, of: WIDE_CALLS } }), { maxTokens: 2500, returnUsage: true, timeoutMs: WIDE_TIMEOUT_MS });
      deps.logUsage({ userId, model: result.model || model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'domains_generate' });
      return parseWide(result.text);
    }));
    // one part failing is fine, the other's names are used; only both failing is an error
    wide = [...ownCombos(own, brief), ...calls.filter((c) => c.status === 'fulfilled').flatMap((c) => c.value)];
    const failed = calls.find((c) => c.status === 'rejected');
    if (!wide.length && failed && !own.length) {
      const msg = String((failed.reason && failed.reason.message) || '');
      if (/timed out/i.test(msg)) throw Object.assign(new Error(`The AI took too long to answer, so no names were made. Try again, or choose a faster model in Settings → AI & Chat. (${msg})`), { status: 504 });
      throw Object.assign(new Error(`The AI could not make names just now: ${msg || 'no answer'}`), { status: 502 });
    }
    if (!wide.length && !own.length) throw Object.assign(new Error('The AI did not return usable names. Try rewording the brief and generate again.'), { status: 502 });
  }
  counts.generated = wide.length;

  // 2 and 3. filter, then rank (variations are meant to look like prefixes and suffixes, so they only get described, not judged)
  let candidates;
  let dropped = {};
  if (mode === 'variations') {
    const avoid = brief.avoid || [];
    const seenSet = new Set(seen.map(normalizeName));
    candidates = wide.map(describe).filter((c) => c.name && !avoid.some((w) => c.name.includes(w)) && !seenSet.has(c.name));
    dropped = { avoided_or_seen: wide.length - candidates.length };
  } else {
    const f = filterCandidates([...own, ...wide], brief, { seen });
    candidates = f.kept;
    dropped = f.dropped;
  }
  // (variations are about one favourite, so the person's own names are not added again or looked up again)
  const ranked = rankLocal(candidates);
  counts.passedFilters = ranked.length;

  // 4. check domains for the best few (and every one of the person's own names)
  const batch = mode === 'variations' ? VARIATION_BATCH : CHECK_BATCH;
  const toCheck = [...ranked.filter((c) => c.own), ...ranked.filter((c) => !c.own).slice(0, batch)];
  const tlds = ENDINGS.join(',');
  const checked = await mapLimit(toCheck, CONCURRENCY, async (c) => {
    if (clock() - started > CHECK_DEADLINE_MS) return { c, domains: null, error: 'Not checked: the round ran out of time.' };
    try { return { c, domains: shapeStatus(c.name, await deps.statusFor(c.name, tlds, GENERATE_MAX_AGE), now) }; } catch (e) { return { c, domains: null, error: e.message }; }
  });
  counts.checked = toCheck.length;
  // if every lookup failed the person must be told why, not shown an empty list
  const failures = checked.filter((x) => x.error);
  if (failures.length && failures.length === checked.length && checked.length) {
    throw Object.assign(new Error(`The domain checks failed: ${failures[0].error}`), { status: 502 });
  }

  const takenRequired = (x) => required.some((t) => ((x.domains && x.domains.results) || []).some((r) => r.tld === t && r.available === false));
  const allRequiredFree = (x) => required.length > 0 && required.every((t) => ((x.domains && x.domains.results) || []).some((r) => r.tld === t && r.available === true));
  const survivors = [];
  for (const x of checked) {
    if (!x.c.own && takenRequired(x)) { counts.takenDropped += 1; continue; }
    survivors.push(x);
  }
  // the person's own names first, then names with every required ending confirmed free, then the rest, each in rank order
  const rank = (x) => (x.c.own ? 0 : allRequiredFree(x) || !required.length ? 1 : 2);
  const finalists = [...survivors].sort((a, b) => rank(a) - rank(b)).slice(0, SHOW + own.length);
  counts.shown = finalists.length;

  // 5. explain the finalists; a failure costs only the explanations
  let explain = {};
  let explainError = '';
  if (finalists.length && deps.callModel && model && clock() - started > BUDGET_MS) {
    explainError = 'The explanations were skipped to stay within the time limit.';
  } else if (finalists.length && deps.callModel && model) {
    try {
      const names = finalists.map((x) => x.c.name);
      const result = await deps.callModel(model, explainPrompt(brief, finalists.map((x) => ({ name: x.c.name, label: x.c.label, style: x.c.style, notes: [...(x.c.spell.score >= 25 ? x.c.spell.notes.slice(0, 1) : []), ...(x.c.brandNotes || [])] }))), { maxTokens: 3000, returnUsage: true, timeoutMs: EXPLAIN_TIMEOUT_MS });
      deps.logUsage({ userId, model: result.model || model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'domains_explain' });
      explain = parseExplain(result.text, names);
    } catch (e) { explainError = e.message; }
  }

  const cards = finalists.map((x) => {
    const c = x.c;
    const e = explain[c.name] || {};
    return {
      name: c.name,
      ...(c.label ? { label: c.label } : {}),
      ...(c.own ? { own: true } : {}),
      style: c.style || '',
      syllables: c.syllables,
      spell: c.spell,
      reasoning: e.reasoning || (mode === 'variations' ? `A variation of "${seed}", made by adding to or changing part of it.` : ''),
      risks: risksFor(c, e.risks),
      domains: x.domains || { checkedAt: null, results: [], hasAvailable: false },
      round,
    };
  });

  // every name that was looked at, shown or not, so a later round never offers it again
  return { cards, checkedNames: toCheck.map((c) => c.name), counts, dropped, creditsUsed: counts.checked, model, explainError, checkedAt: now.toISOString() };
}

module.exports = { ownCombos, WIDE_CALLS, WIDE_COUNT, CHECK_BATCH, VARIATION_BATCH, SHOW, mapLimit, risksFor, generateRound };
