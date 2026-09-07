'use strict';

/**
 * Drop obvious form-factor mismatches so a "wireless earbuds" search
 * doesn't crown mono trucker earpieces just because they have many reviews.
 */

function queryWantsStereoAudioWearable(query) {
  return /\b(earbuds?|earphones?|headphones?|buds|tws|true[\s-]?wireless|in[\s-]?ear|over[\s-]?ear|on[\s-]?ear)\b/i.test(
    String(query || '')
  );
}

function looksLikeMonoCallHeadset(title) {
  const t = String(title || '').toLowerCase();
  const monoSignal = /\b(earpiece|trucker|driver headset|bluetooth earpiece|mono headset|hands[\s-]?free wireless headset)\b/.test(t)
    || /\b(2[\s-]?pack|two pack).{0,40}\b(earpiece|headset)\b/.test(t);
  const stereoSignal = /\b(earbuds?|earphones?|tws|true[\s-]?wireless|buds|stereo headphones?)\b/.test(t);
  return monoSignal && !stereoSignal;
}

/**
 * @param {string} query
 * @param {object[]} candidates
 * @returns {{ kept: object[], removed: object[] }}
 */
function filterFormFactorMismatches(query, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!queryWantsStereoAudioWearable(query)) {
    return { kept: list, removed: [] };
  }

  const kept = [];
  const removed = [];
  for (const c of list) {
    if (looksLikeMonoCallHeadset(c?.title)) removed.push(c);
    else kept.push(c);
  }

  // Never empty the pool entirely — fall back if filter was too aggressive.
  if (!kept.length && removed.length) {
    console.warn('[productScout] form-factor filter removed all candidates — keeping originals');
    return { kept: list, removed: [] };
  }

  if (removed.length) {
    console.log('[productScout] form-factor filter removed', {
      removed: removed.length,
      kept: kept.length,
      samples: removed.slice(0, 3).map((c) => String(c.title || '').slice(0, 60)),
    });
  }

  return { kept, removed };
}

/**
 * Generic core-object vs. accessory-only guard: a query for "21 inch
 * portable monitor ... carry bag cables" should not be won by a carrying
 * bag just because "bag"/"cables" tokens (usually injected from must-have
 * feature terms — see buildEnrichedSearchQuery) also appear in the search
 * string. If the query names a recognised device category, drop candidates
 * whose title reads as ONLY that device's accessory, not the device itself.
 */
const CORE_OBJECT_PATTERNS = [
  /\b(monitor|external display)\b/i,
  /\blaptops?|notebooks?\b/i,
  /\btablets?\b/i,
  /\bsmartphones?|\bphones?\b/i,
  /\bcameras?\b/i,
  /\btelevisions?|\btvs?\b/i,
  /\bspeakers?\b/i,
  /\bwatch(es)?\b/i,
  /\bkeyboards?\b/i,
  /\bmouse|mice\b/i,
  /\bprinters?\b/i,
  /\brouters?\b/i,
  /\bvacuums?\b/i,
  /\bblenders?\b/i,
  /\bdrones?\b/i,
  /\bprojectors?\b/i,
  /\b(ssd|hard drives?)\b/i,
];

const ACCESSORY_ONLY_RE = /\b(carrying case|carry case|travel case|protective case|carrying bag|travel bag|tote|pouch|sleeve|mount|stand|tripod|charging cable|power cable|charger|adapter|dock|strap|screen protector|skin|holder|stylus)\b/i;

/**
 * Whether a single feature/spec term reads as an accessory noun (bag, cable,
 * case, mount, …) rather than a description of the core product itself.
 * Used to keep such terms OUT of the raw Amazon search string — they still
 * reach the LLM as shopper priorities, but as a literal search keyword they
 * bias Amazon's own ranking toward accessory-only listings.
 */
function isAccessoryTerm(term) {
  return ACCESSORY_ONLY_RE.test(String(term || ''));
}

function detectCoreObjectPattern(query) {
  const q = String(query || '');
  return CORE_OBJECT_PATTERNS.find((re) => re.test(q)) || null;
}

function looksLikeAccessoryOnly(title) {
  // Accessory listings almost always mention the device too ("case FOR
  // monitors", "bag for 24 inch screens") — that mention doesn't make it a
  // bundle. Only the explicit accessory-noun match decides mismatch here.
  return ACCESSORY_ONLY_RE.test(String(title || ''));
}

/**
 * @param {string} query
 * @param {object[]} candidates
 * @returns {{ kept: object[], removed: object[] }}
 */
function filterAccessoryMismatches(query, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const corePattern = detectCoreObjectPattern(query);
  if (!corePattern) return { kept: list, removed: [] };

  const kept = [];
  const removed = [];
  for (const c of list) {
    if (looksLikeAccessoryOnly(c?.title)) removed.push(c);
    else kept.push(c);
  }

  if (!kept.length && removed.length) {
    console.warn('[productScout] accessory filter removed all candidates — keeping originals');
    return { kept: list, removed: [] };
  }

  if (removed.length) {
    console.log('[productScout] accessory filter removed', {
      removed: removed.length,
      kept: kept.length,
      samples: removed.slice(0, 3).map((c) => String(c.title || '').slice(0, 60)),
    });
  }

  return { kept, removed };
}

module.exports = {
  queryWantsStereoAudioWearable,
  looksLikeMonoCallHeadset,
  filterFormFactorMismatches,
  filterAccessoryMismatches,
  isAccessoryTerm,
};
