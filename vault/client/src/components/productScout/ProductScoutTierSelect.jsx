import React, { useMemo, useState } from 'react';
import { formatPriceBand } from './ProductScoutFeatureBrief';

function tierKey(tier, index) {
  return tier.key || ['essentials', 'smart_upgrade', 'enthusiast', 'pro'][index] || `tier_${index}`;
}

function defaultSelection(tiers, previouslyScouted = []) {
  const scouted = new Set(previouslyScouted);
  const available = tiers.filter((t, i) => !scouted.has(tierKey(t, i)));
  if (!available.length) return [];

  const first = available[0];
  return [tierKey(first, tiers.indexOf(first))];
}

export default function ProductScoutTierSelect({
  tiers = [],
  previouslyScouted = [],
  onConfirm,
  onBack,
  loading = false,
  mergeMode = false,
}) {
  const scoutedSet = useMemo(() => new Set(previouslyScouted), [previouslyScouted]);

  const [selected, setSelected] = useState(() => defaultSelection(tiers, previouslyScouted));

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {mergeMode ? 'Search more tiers' : 'Choose price tiers to search'}
        </h2>
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
          {mergeMode
            ? 'Select tiers that have not been searched yet. Each tier runs a full Amazon comparison.'
            : 'Select one or more tiers. We only search Amazon for the tiers you pick — faster than searching all four.'}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {tiers.map((tier, i) => {
          const key = tierKey(tier, i);
          const already = scoutedSet.has(key);
          const checked = selected.includes(key);
          const disabled = already;

          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => toggle(key, disabled)}
              className="text-left rounded-xl border p-3 transition-opacity hover:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                borderColor: checked ? 'var(--color-primary)' : 'var(--color-border)',
                background: checked ? 'var(--color-bg)' : 'transparent',
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
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                      {tier.label}
                    </span>
                    {already && (
                      <span
                        className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(22, 163, 74, 0.12)', color: '#166534' }}
                      >
                        Searched
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-primary)' }}>
                    {formatPriceBand(tier.price_min, tier.price_max)}
                  </p>
                  {tier.subtitle && (
                    <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                      {tier.subtitle}
                    </p>
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
