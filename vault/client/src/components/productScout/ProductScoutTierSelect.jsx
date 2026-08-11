import React, { useMemo, useState } from 'react';
import { formatPriceBand } from './ProductScoutFeatureBrief';
import { resolveTierFocus, resolveTierGains } from '../../utils/productScoutGuide';

function tierKey(tier, index) {
  return tier.key || ['essentials', 'smart_upgrade', 'enthusiast', 'pro'][index] || `tier_${index}`;
}

function defaultSelection(tiers, previouslyScouted = [], recommendedKey = null) {
  const scouted = new Set(previouslyScouted);
  const available = tiers
    .map((t, i) => ({ key: tierKey(t, i), index: i }))
    .filter((t) => !scouted.has(t.key));
  if (!available.length) return [];

  if (recommendedKey && available.some((t) => t.key === recommendedKey)) {
    return [recommendedKey];
  }

  return [available[0].key];
}

export default function ProductScoutTierSelect({
  tiers = [],
  previouslyScouted = [],
  recommendedTierKey = null,
  recommendedTierWhy = null,
  onConfirm,
  onBack,
  loading = false,
  mergeMode = false,
}) {
  const scoutedSet = useMemo(() => new Set(previouslyScouted), [previouslyScouted]);

  const [selected, setSelected] = useState(() => (
    defaultSelection(tiers, previouslyScouted, recommendedTierKey)
  ));

  const toggle = (key, disabled) => {
    if (disabled) return;
    setSelected((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev;
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selected.length) return;
    onConfirm(selected);
  };

  const newCount = selected.filter((k) => !scoutedSet.has(k)).length;
  const recommendedAvailable = recommendedTierKey && !scoutedSet.has(recommendedTierKey);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {mergeMode ? 'Search more tiers' : 'Choose price tiers to search'}
        </h2>
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
          {mergeMode
            ? 'Select tiers that have not been searched yet. Each tier runs a full Amazon comparison.'
            : 'Each step up the ladder usually buys better features — not just a higher price. Select one or more tiers to search on Amazon.'}
        </p>
        {recommendedAvailable && recommendedTierWhy && !mergeMode && (
          <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--color-text)' }}>
            <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>Suggested start: </span>
            {recommendedTierWhy}
          </p>
        )}
      </div>

      {!mergeMode && tiers.length > 0 && (
        <div
          className="rounded-xl border p-3 space-y-2"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            What changes as you climb
          </p>
          <ol className="space-y-1.5">
            {tiers.map((tier, i) => {
              const key = tierKey(tier, i);
              const focus = resolveTierFocus(tier, i);
              const isSuggested = key === recommendedTierKey;
              return (
                <li key={`ladder-${key}`} className="flex gap-2 text-[10px] leading-snug">
                  <span
                    className="shrink-0 font-semibold tabular-nums w-4"
                    style={{ color: isSuggested ? 'var(--color-primary)' : 'var(--color-muted)' }}
                  >
                    {i + 1}.
                  </span>
                  <span style={{ color: 'var(--color-text)' }}>
                    <span className="font-medium">{tier.label}</span>
                    <span style={{ color: 'var(--color-muted)' }}>
                      {' '}({formatPriceBand(tier.price_min, tier.price_max)}) — {focus}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {tiers.map((tier, i) => {
          const key = tierKey(tier, i);
          const already = scoutedSet.has(key);
          const checked = selected.includes(key);
          const disabled = already;
          const isRecommended = key === recommendedTierKey && !already;
          const gains = resolveTierGains(tier, i);
          const focus = resolveTierFocus(tier, i);

          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => toggle(key, disabled)}
              className="text-left rounded-xl border p-3 transition-opacity hover:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                borderColor: checked || isRecommended ? 'var(--color-primary)' : 'var(--color-border)',
                background: checked ? 'var(--color-bg)' : 'transparent',
                boxShadow: isRecommended && !checked ? 'inset 0 0 0 1px var(--color-primary)' : undefined,
              }}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked || already}
                  disabled={disabled}
                  readOnly
                  className="mt-0.5 rounded"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                      {tier.label}
                    </span>
                    {isRecommended && (
                      <span
                        className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: 'rgba(204, 120, 92, 0.15)', color: 'var(--color-primary)' }}
                      >
                        Suggested
                      </span>
                    )}
                    {already && (
                      <span
                        className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(22, 163, 74, 0.12)', color: '#166534' }}
                      >
                        Searched
                      </span>
                    )}
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--color-primary)' }}>
                    {formatPriceBand(tier.price_min, tier.price_max)}
                  </p>
                  {focus && (
                    <p className="text-[10px] leading-relaxed font-medium" style={{ color: 'var(--color-text)' }}>
                      {focus}
                    </p>
                  )}
                  {gains.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted)' }}>
                        {i === 0 ? 'Typically includes' : 'What you gain vs below'}
                      </p>
                      <ul className="text-[10px] space-y-0.5 pl-3 list-disc" style={{ color: 'var(--color-muted)' }}>
                        {gains.map((g) => (
                          <li key={g}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={loading || !newCount}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-primary)' }}
        >
          {loading
            ? 'Searching…'
            : mergeMode
              ? `Search ${newCount} tier${newCount !== 1 ? 's' : ''}`
              : `Search ${selected.length} tier${selected.length !== 1 ? 's' : ''}`}
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Back
          </button>
        )}
      </div>
    </form>
  );
}

export { tierKey };
