'use strict';

/**
 * Merge LLM + pattern candidates; dedupe same entity into one grouped candidate
 * with all occurrence locations.
 */

const crypto = require('crypto');

function normalizeEntity(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function entityKeyFor(surface, categoryLabel) {
  const n = normalizeEntity(surface);
  const cat = String(categoryLabel || 'sensitive').toLowerCase().replace(/\s+/g, '_');
  return `${cat}::${n}`;
}

function locationKey(loc) {
  return [
    loc.part || '',
    loc.paragraphId || '',
    loc.runId || '',
    loc.startOffset,
    loc.endOffset,
  ].join('|');
}

function mergeSurfaceForms(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const s of [...a, ...b]) {
    const t = String(s || '').trim();
    if (!t) continue;
    const k = normalizeEntity(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function mergeLocations(a = [], b = []) {
  const map = new Map();
  for (const loc of [...a, ...b]) {
    if (!loc) continue;
    map.set(locationKey(loc), loc);
  }
  return [...map.values()];
}

function pickPreferredSource(sources) {
  if (sources.includes('local_llm')) return 'local_llm';
  if (sources.includes('deterministic')) return 'deterministic';
  if (sources.includes('user_added')) return 'user_added';
  if (sources.includes('frontier_suggested')) return 'frontier_suggested';
  return sources[0] || 'local_llm';
}

function compositeScore(candidate) {
  const confidence = Number(candidate.confidence) || 0;
  const locBoost = Math.min(1, (candidate.locations || []).length / 5) * 0.2;
  const sourceBoost = candidate.source === 'deterministic' ? 0.15 : 0.1;
  const briefAligned = candidate.source === 'local_llm' ? 0.1 : 0;
  const score = Math.max(0, Math.min(1, confidence * 0.55 + locBoost + sourceBoost + briefAligned));
  return {
    score,
    scoreBreakdown: {
      confidence,
      locationBoost: locBoost,
      sourceBoost,
      llmBriefBoost: briefAligned,
    },
  };
}

/**
 * @param {object[]} candidates
 * @returns {object[]}
 */
function mergeAndDeduplicateCandidates(candidates, jobId) {
  const groups = new Map();

  for (const c of candidates || []) {
    const primary = (c.surfaceForms && c.surfaceForms[0]) || c.locations?.[0]?.quote || '';
    const key = c.entityKey || entityKeyFor(primary, c.categoryLabel);
    if (!groups.has(key)) {
      groups.set(key, {
        ...c,
        id: c.id || crypto.randomUUID(),
        jobId: jobId || c.jobId,
        entityKey: key,
        sources: [c.source],
        surfaceForms: [...(c.surfaceForms || [])],
        locations: [...(c.locations || [])],
      });
      continue;
    }
    const g = groups.get(key);
    g.surfaceForms = mergeSurfaceForms(g.surfaceForms, c.surfaceForms);
    g.locations = mergeLocations(g.locations, c.locations);
    g.sources = [...new Set([...(g.sources || []), c.source])];
    g.confidence = Math.max(Number(g.confidence) || 0, Number(c.confidence) || 0);
    if (c.suggestedReplacement && (!g.suggestedReplacement || g.source === 'deterministic' && c.source === 'local_llm')) {
      g.suggestedReplacement = c.suggestedReplacement;
    }
    if (c.rationale) {
      g.rationale = g.rationale && g.rationale !== c.rationale
        ? `${g.rationale} | ${c.rationale}`
        : c.rationale;
    }
    if (c.categoryLabel && c.source === 'local_llm') {
      g.categoryLabel = c.categoryLabel;
    }
    g.updatedAt = new Date().toISOString();
  }

  const merged = [];
  for (const g of groups.values()) {
    // Expand locations: if we only captured one occurrence but the surface form
    // appears elsewhere, caller may pass ir via re-scan — optional second pass below.
    g.source = pickPreferredSource(g.sources || [g.source]);
    g.sourceLabel = g.source === 'local_llm'
      ? 'llm'
      : g.source === 'deterministic'
        ? 'pattern-match'
        : g.source === 'user_added'
          ? 'user-added-later'
          : g.source;
    const scored = compositeScore(g);
    g.score = scored.score;
    g.scoreBreakdown = scored.scoreBreakdown;
    g.decision = g.decision || 'pending';
    g.entityText = g.surfaceForms[0] || g.locations[0]?.quote || '';
    g.occurrenceCount = (g.locations || []).length;
    delete g.sources;
    merged.push(g);
  }

  merged.sort((a, b) => (b.score || 0) - (a.score || 0));
  return merged;
}

/**
 * After merge, re-scan IR so every surface form gets all occurrence locations.
 */
function expandOccurrencesWithIr(candidates, ir, findOccurrencesFn) {
  return (candidates || []).map((c) => {
    const forms = c.surfaceForms || [];
    let locations = [...(c.locations || [])];
    for (const form of forms) {
      const found = findOccurrencesFn(ir, form);
      locations = mergeLocations(locations, found);
    }
    const next = {
      ...c,
      locations,
      occurrenceCount: locations.length,
    };
    const scored = compositeScore(next);
    next.score = scored.score;
    next.scoreBreakdown = scored.scoreBreakdown;
    return next;
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
}

module.exports = {
  mergeAndDeduplicateCandidates,
  expandOccurrencesWithIr,
  normalizeEntity,
  entityKeyFor,
};
