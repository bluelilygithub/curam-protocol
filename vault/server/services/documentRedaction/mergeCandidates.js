'use strict';

/**
 * Merge LLM + pattern candidates; dedupe same real entity into one candidate.
 *
 * Identity key = normalized surface value (NOT category). Category disagreements
 * (e.g. "Financial figure" vs "Capacity amount" for $1,173,624) collapse into
 * one candidate with the more specific category and the better replacement.
 */

const crypto = require('crypto');
const {
  normalizeCategoryLabel,
  pickPreferredCategory,
} = require('./categories');
const { bankEntityKey, findBankFamily } = require('./bankLexicon');

function normalizeEntity(text) {
  let s = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';

  // Currency identity: $1,173,624 / $1173624 / 1,173,624.00 → amt:1173624[.xx]
  const currency = s.match(/^\$?\s*([\d,]+(?:\.\d{1,2})?)$/);
  if (currency) {
    const raw = currency[1].replace(/,/g, '');
    if (/^\d+(\.\d{1,2})?$/.test(raw)) return `amt:${raw}`;
  }

  // Percentage identity: 5.29% / 5.290% → pct:5.29%
  const pct = s.match(/^([\d,]+(?:\.\d+)?)\s*%$/);
  if (pct) {
    const n = Number(pct[1].replace(/,/g, ''));
    if (Number.isFinite(n)) return `pct:${n}%`;
  }

  return s;
}

/**
 * Entity identity from surface text. Second arg kept for call-site compatibility
 * but is intentionally ignored — category must not split the same real value.
 * Known bank aliases share one key (Macquarie ≡ Macquarie Bank).
 */
function entityKeyFor(surface, _categoryLabel) {
  const bank = bankEntityKey(surface);
  if (bank) return bank;
  return normalizeEntity(surface);
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

function isPlaceholderReplacement(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/\[redacted\]/i.test(t)) return true;
  if (/^redacted$/i.test(t)) return true;
  if (/\$\s*X/i.test(t) || /\$\s*N/i.test(t) || /\$\s*#/.test(t)) return true;
  if (/^[X#N]+([,.][X#N]+)*$/i.test(t)) return true;
  if (/^\$?[X#N]+([,.][X#N]+)*$/i.test(t)) return true;
  return false;
}

/**
 * Prefer realistic synthetics over placeholder-style replacements.
 * When quality is equal, prefer the replacement from the more specific category.
 */
function pickPreferredReplacement(current, incoming, currentCat, incomingCat) {
  const a = current || '';
  const b = incoming || '';
  if (!a) return b;
  if (!b) return a;
  const aPh = isPlaceholderReplacement(a);
  const bPh = isPlaceholderReplacement(b);
  if (aPh && !bPh) return b;
  if (bPh && !aPh) return a;
  const preferredCat = pickPreferredCategory(currentCat, incomingCat);
  if (normalizeCategoryLabel(incomingCat) === preferredCat
    && normalizeCategoryLabel(currentCat) !== preferredCat) {
    return b;
  }
  return a;
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
    // Ignore legacy category::value keys — re-key on normalized value only
    const key = (c.entityKey && !String(c.entityKey).includes('::'))
      ? c.entityKey
      : entityKeyFor(primary);
    if (!key) continue;

    const categoryLabel = normalizeCategoryLabel(c.categoryLabel);

    if (!groups.has(key)) {
      groups.set(key, {
        ...c,
        id: c.id || crypto.randomUUID(),
        jobId: jobId || c.jobId,
        entityKey: key,
        categoryLabel,
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

    g.suggestedReplacement = pickPreferredReplacement(
      g.suggestedReplacement,
      c.suggestedReplacement,
      g.categoryLabel,
      categoryLabel,
    );

    if (c.rationale) {
      g.rationale = g.rationale && g.rationale !== c.rationale
        ? `${g.rationale} | ${c.rationale}`
        : (g.rationale || c.rationale);
    }

    g.categoryLabel = pickPreferredCategory(g.categoryLabel, categoryLabel);
    g.updatedAt = new Date().toISOString();
  }

  const merged = [];
  for (const g of groups.values()) {
    g.source = pickPreferredSource(g.sources || [g.source]);
    g.sourceLabel = g.source === 'local_llm'
      ? 'llm'
      : g.source === 'deterministic'
        ? 'pattern-match'
        : g.source === 'user_added'
          ? 'user-added-later'
          : g.source === 'frontier_suggested'
            ? 'frontier'
            : g.source;
    g.categoryLabel = normalizeCategoryLabel(g.categoryLabel);
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
  const { BANK_FAMILIES } = require('./bankLexicon');

  function findWordBoundary(irDoc, needle) {
    const raw = String(needle || '');
    if (!raw) return [];
    const locations = [];
    const re = new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    for (const p of irDoc.paragraphs || []) {
      const text = p.text || '';
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const quote = m[0];
        locations.push({
          part: p.part,
          paragraphId: p.paragraphId,
          xmlPath: p.xmlPath,
          startOffset: m.index,
          endOffset: m.index + quote.length,
          quote,
        });
      }
    }
    return locations;
  }

  function dedupePreferLonger(locs) {
    const sorted = [...locs].sort((a, b) => {
      const lenA = (a.endOffset - a.startOffset) || String(a.quote || '').length;
      const lenB = (b.endOffset - b.startOffset) || String(b.quote || '').length;
      return lenB - lenA;
    });
    const kept = [];
    for (const loc of sorted) {
      const overlaps = kept.some((k) => (
        k.paragraphId === loc.paragraphId
        && loc.startOffset < k.endOffset
        && loc.endOffset > k.startOffset
      ));
      if (!overlaps) kept.push(loc);
    }
    return kept;
  }

  return (candidates || []).map((c) => {
    let forms = [...(c.surfaceForms || [])];
    const primary = forms[0] || c.entityText || '';
    let family = findBankFamily(primary);
    if (!family && c.entityKey && String(c.entityKey).startsWith('bank:')) {
      const id = String(c.entityKey).slice(5);
      const row = BANK_FAMILIES.find((f) => f.id === id);
      if (row) {
        family = {
          id: row.id,
          canonical: row.canonical,
          replacement: row.replacement,
          aliases: row.aliases,
        };
      }
    }
    if (family?.aliases) {
      forms = mergeSurfaceForms(forms, family.aliases);
    }

    let locations = [...(c.locations || [])];
    for (const form of forms) {
      const found = family
        ? findWordBoundary(ir, form)
        : findOccurrencesFn(ir, form);
      locations = mergeLocations(locations, found);
    }
    if (family) {
      locations = dedupePreferLonger(locations);
    }

    const presentLower = new Set(
      locations.map((l) => String(l.quote || '').trim().toLowerCase()).filter(Boolean),
    );
    const surfaceForms = forms.filter((f) => presentLower.has(String(f).toLowerCase()));

    const next = {
      ...c,
      surfaceForms: surfaceForms.length ? surfaceForms : forms.slice(0, 1),
      locations,
      occurrenceCount: locations.length,
      categoryLabel: normalizeCategoryLabel(c.categoryLabel),
      entityText: (surfaceForms.length ? surfaceForms : forms).sort((a, b) => b.length - a.length)[0]
        || c.entityText,
    };
    if (family && (!next.suggestedReplacement || isPlaceholderReplacement(next.suggestedReplacement))) {
      next.suggestedReplacement = family.replacement;
    }
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
  isPlaceholderReplacement,
  pickPreferredReplacement,
};
