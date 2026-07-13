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
