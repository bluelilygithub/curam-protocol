'use strict';

// Topic Research: the research brief's shape, and the strict check every answer from the model goes through before it is trusted.
//
// The model is asked for JSON, but nothing it says is believed without this check:
//   - a fact's source links are kept only if they are really among the articles the owner ticked (matched after URL clean-up);
//   - a fact left with no valid source is dropped (and counted): "every fact carries a source" is enforced here, not hoped for;
//   - "single source" is worked out here from how many different outlets back a fact; the model's own flag is ignored;
//   - every list and every length is capped, HTML tags are stripped from all text, and unknown fields are ignored;
//   - the answer must have a summary, at least one sourced fact, at least one suggested angle, an outline and a main keyword,
//     otherwise it is returned as problems (the caller asks once more, then gives up).
// Pure code. See docs/topic-research.md.

const { normaliseUrl } = require('../urlNormalise');

const LIMITS = Object.freeze({
  summary: 1200, fact: 400, sourcesPerFact: 8, facts: 25,
  angleOutlet: 100, framing: 300, anglesTaken: 15,
  gap: 300, gaps: 15,
  angleTitle: 160, angleWhy: 300, suggested: 3, chosen: 200,
  heading: 150, note: 300, notes: 8, outline: 40,
  keyword: 100, relatedKeywords: 12, relatedKeyword: 80,
});

/** Plain one-line text: no tags, no control characters, collapsed spaces, cut to `max`. Anything that is not text is empty. */
function clean(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const list = (v) => (Array.isArray(v) ? v : []);

/**
 * @param raw          the model's parsed JSON
 * @param allowed      Map: normalised article address -> { url, domain } for the ticked articles
 * @param fallbackAngle  the angle to record when the model names none (what the owner asked for, if anything)
 * @returns {{ value, dropped: { facts, sources }, problems: string[] }}  `problems` empty means `value` is safe to use
 */
function validateBrief(raw, { allowed, fallbackAngle = '' } = {}) {
  const problems = [];
  const dropped = { facts: 0, sources: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: null, dropped, problems: ['The answer was not a JSON object.'] };
  const sourceMap = allowed instanceof Map ? allowed : new Map();

  const summary = clean(raw.summary, LIMITS.summary);
  if (!summary) problems.push('"summary" is missing or empty.');

  const keyFacts = [];
  const claimed = list(raw.keyFacts);
  if (!Array.isArray(raw.keyFacts)) problems.push('"keyFacts" must be a list.');
  for (const f of claimed.slice(0, LIMITS.facts * 2)) {
    const fact = clean(f?.fact, LIMITS.fact);
    if (!fact) { dropped.facts += 1; continue; }
    const seen = new Map(); // address -> { url, domain } in the order given
    for (const u of list(f?.sources).slice(0, LIMITS.sourcesPerFact * 2)) {
      const hit = typeof u === 'string' ? sourceMap.get(normaliseUrl(u)) : null;
      if (hit) seen.set(hit.url, hit); else dropped.sources += 1;
    }
    const sources = [...seen.values()].slice(0, LIMITS.sourcesPerFact);
    if (!sources.length) { dropped.facts += 1; continue; } // no source the owner ticked: not a fact we will show
    const outletCount = new Set(sources.map((s) => s.domain)).size;
    keyFacts.push({ fact, sources: sources.map((s) => s.url), outletCount, singleSource: outletCount === 1 });
    if (keyFacts.length >= LIMITS.facts) break;
  }
  if (!keyFacts.length) problems.push('No fact had a source link from the listed articles. Every fact needs the address of at least one listed article.');

  const anglesTaken = list(raw.anglesTaken).slice(0, LIMITS.anglesTaken)
    .map((a) => ({ outlet: clean(a?.outlet, LIMITS.angleOutlet), framing: clean(a?.framing, LIMITS.framing) }))
    .filter((a) => a.outlet && a.framing);

  const gaps = list(raw.gaps).slice(0, LIMITS.gaps).map((g) => clean(g, LIMITS.gap)).filter(Boolean);

  const suggestedAngles = list(raw.suggestedAngles).slice(0, LIMITS.suggested)
    .map((a) => ({ title: clean(a?.title, LIMITS.angleTitle), why: clean(a?.why, LIMITS.angleWhy) }))
    .filter((a) => a.title);
  if (!suggestedAngles.length) problems.push('"suggestedAngles" needs at least one angle with a title.');

  const chosenAngle = clean(raw.chosenAngle, LIMITS.chosen) || clean(fallbackAngle, LIMITS.chosen) || (suggestedAngles[0]?.title || '');

  const outline = [];
  if (!Array.isArray(raw.outline)) problems.push('"outline" must be a list.');
  for (const o of list(raw.outline).slice(0, LIMITS.outline)) {
    const heading = clean(o?.heading, LIMITS.heading);
    if (!heading) continue;
    const level = Number(o?.level) === 3 ? 3 : 2; // only H2 and H3 exist; anything else is treated as a main heading
    outline.push({ level, heading, notes: list(o?.notes).slice(0, LIMITS.notes).map((n) => clean(n, LIMITS.note)).filter(Boolean) });
  }
  if (Array.isArray(raw.outline) && !outline.length) problems.push('"outline" needs at least one heading.');

  const primary = clean(raw.keywords?.primary, LIMITS.keyword);
  if (!primary) problems.push('"keywords.primary" is missing.');
  const related = list(raw.keywords?.related).slice(0, LIMITS.relatedKeywords).map((k) => clean(k, LIMITS.relatedKeyword)).filter(Boolean);

  if (problems.length) return { value: null, dropped, problems };
  return {
    value: { summary, keyFacts, anglesTaken, gaps, suggestedAngles, chosenAngle, outline, keywords: { primary, related } },
    dropped,
    problems: [],
  };
}

/** Every piece of brief text with a name for where it is, so the overlap check can say where it found a match. */
function textFields(brief) {
  const out = [{ field: 'summary', text: brief.summary }];
  brief.keyFacts.forEach((f, i) => out.push({ field: `fact ${i + 1}`, text: f.fact }));
  brief.anglesTaken.forEach((a, i) => out.push({ field: `angle taken ${i + 1}`, text: a.framing }));
  brief.gaps.forEach((g, i) => out.push({ field: `gap ${i + 1}`, text: g }));
  brief.suggestedAngles.forEach((a, i) => { out.push({ field: `suggested angle ${i + 1}`, text: a.title }); out.push({ field: `suggested angle ${i + 1} reason`, text: a.why }); });
  brief.outline.forEach((o, i) => { out.push({ field: `outline heading ${i + 1}`, text: o.heading }); o.notes.forEach((n, j) => out.push({ field: `outline note ${i + 1}.${j + 1}`, text: n })); });
  return out.filter((x) => x.text);
}

module.exports = { validateBrief, textFields, clean, LIMITS };
