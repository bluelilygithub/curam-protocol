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

module.exports = {
  queryWantsStereoAudioWearable,
  looksLikeMonoCallHeadset,
  filterFormFactorMismatches,
};
