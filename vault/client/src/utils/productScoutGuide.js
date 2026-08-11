/** Derive scouted tier keys from guide result (supports legacy runs without scouted_tiers). */
export function getScoutedTierKeys(result) {
  if (!result) return [];
  if (Array.isArray(result.scouted_tiers) && result.scouted_tiers.length) {
    return result.scouted_tiers;
  }
  return (result.tiers || [])
    .filter((t) => t.scouted || (t.scout?.comparison?.top3?.length > 0))
    .map((t) => t.key)
    .filter(Boolean);
}

export function tierIsScouted(tier) {
  if (!tier) return false;
  if (typeof tier.scouted === 'boolean') return tier.scouted;
  return Boolean(tier.scout?.comparison?.top3?.length);
}

export const GUIDE_TIER_KEYS = ['essentials', 'smart_upgrade', 'enthusiast', 'pro'];

const PREMIUM_RE = /\b(anc|noise\s*cancell|flagship|audiophile|hi-?res|ldac|aptx|studio|pro\b|oled|4k|120hz|rtx|gaming|waterproof|ip6[78]|macbook\s*pro|mirrorless|full[\s-]?frame)\b/i;
const BASIC_RE = /\b(basic|budget|simple|casual|entry[\s-]?level|bluetooth\s*only)\b/i;

/**
 * Suggest the lowest price tier that usually meets must-have needs.
 * Budget hint nudges toward the matching band; LLM suggestion is used when valid.
 */
export function resolveRecommendedTier({
  features = [],
  budgetHint = null,
  tierFramework = [],
  llmKey = null,
  llmWhy = null,
} = {}) {
  const must = (features || []).filter((f) => f && f.importance === 'must');
  const mustText = must
    .map((f) => [f.feature, f.spec_value, f.why_it_matters].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();

  let idx = 1; // smart_upgrade default — everyday value
  let why = 'Smart upgrade usually covers everyday needs without overspending.';

  if (BASIC_RE.test(mustText) && must.length <= 2 && !PREMIUM_RE.test(mustText)) {
    idx = 0;
    why = 'Your must-haves look basic — Essentials is often enough.';
  }
  if (PREMIUM_RE.test(mustText) || must.length >= 5) {
    idx = Math.max(idx, 2);
    why = 'Several must-haves usually appear in the Enthusiast band and above.';
  }
  if (/\b(best|no budget|top.?of.?range|flagship|uncompromising)\b/i.test(mustText)) {
    idx = 3;
    why = 'Your requirements point at flagship / Pro-tier products.';
  }

  const hint = Number(budgetHint);
  if (Number.isFinite(hint) && hint > 0 && tierFramework?.length) {
    const matchIdx = tierFramework.findIndex((t) => {
      const min = t.price_min != null ? Number(t.price_min) : null;
      const max = t.price_max != null ? Number(t.price_max) : null;
      if (Number.isFinite(min) && Number.isFinite(max)) return hint >= min && hint <= max;
      if (Number.isFinite(max)) return hint <= max;
      if (Number.isFinite(min)) return hint >= min;
      return false;
    });
    if (matchIdx >= 0) {
      idx = matchIdx;
      const label = tierFramework[matchIdx]?.label || GUIDE_TIER_KEYS[matchIdx];
      why = `Your ~$${hint} budget aligns with ${label} — a practical starting search.`;
    }
  }

  const llmIdx = GUIDE_TIER_KEYS.indexOf(String(llmKey || '').trim());
  if (llmIdx >= 0) {
    // Prefer LLM when it is at least as demanding as the heuristic (don't under-suggest).
    if (llmIdx >= idx) {
      idx = llmIdx;
      if (llmWhy && String(llmWhy).trim()) why = String(llmWhy).trim();
    }
  }

  const key = GUIDE_TIER_KEYS[idx] || 'smart_upgrade';
  return {
    recommended_tier_key: key,
    recommended_tier_why: why.slice(0, 160),
  };
}
