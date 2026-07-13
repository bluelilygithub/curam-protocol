import React, { useState } from 'react';

const IMPORTANCE_OPTIONS = [
  { value: 'must', label: 'Must have' },
  { value: 'nice', label: 'Nice to have' },
  { value: 'skip', label: 'Skip' },
];

function formatPriceBand(min, max) {
  if (min != null && max != null) return `$${min}–$${max}`;
  if (max != null) return `up to $${max}`;
  if (min != null) return `from $${min}`;
  return '—';
}

export default function ProductScoutFeatureBrief({
  brief,
  tierFramework = [],
  onConfirm,
  onBack,
  loading = false,
}) {
  const [features, setFeatures] = useState(
    () => (brief?.features || []).map((f) => ({ ...f }))
  );

  const setImportance = (index, importance) => {
    setFeatures((prev) => prev.map((f, i) => (i === index ? { ...f, importance } : f)));
  };

  const handleConfirm = (e) => {
    e.preventDefault();
    onConfirm({
      ...brief,
      features,
      tier_framework: tierFramework.length ? tierFramework : brief?.tier_framework,
    });
  };

  return (
    <form onSubmit={handleConfirm} className="space-y-4">
      {brief?.summary && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
          {brief.summary}
        </p>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Features to consider
        </h2>
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
          Adjust what matters before we search Amazon by price tier.
        </p>
        <ul className="space-y-2">
          {features.map((f, i) => (
            <li
              key={`${f.feature}-${i}`}
              className="rounded-xl border p-3 space-y-2"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                  {f.feature}
                </span>
                <select
                  value={f.importance || 'nice'}
                  onChange={(e) => setImportance(i, e.target.value)}
                  className="text-[10px] px-2 py-1 rounded-lg border outline-none"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                  }}
                >
                  {IMPORTANCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {f.why_it_matters && (
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  {f.why_it_matters}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-primary)' }}
        >
          {loading ? 'Saving…' : 'Continue to tier selection'}
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

export { formatPriceBand };
