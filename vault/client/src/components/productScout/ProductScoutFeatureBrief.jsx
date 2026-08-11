import React, { useMemo, useState } from 'react';
import {
  cycleImportance,
  IMPORTANCE_LABELS,
  normalizeBriefFeatures,
  partitionBriefFeatures,
} from '../../utils/productScoutFeatureTypes';
import { resolveRecommendedTier } from '../../utils/productScoutGuide';

function formatPriceBand(min, max) {
  if (min != null && max != null) return `$${min}–$${max}`;
  if (max != null) return `up to $${max}`;
  if (min != null) return `from $${min}`;
  return '—';
}

function importanceStyle(importance) {
  if (importance === 'must') {
    return {
      border: 'var(--color-primary)',
      background: 'color-mix(in srgb, var(--color-primary) 12%, var(--color-bg))',
      color: 'var(--color-text)',
    };
  }
  if (importance === 'nice') {
    return {
      border: 'var(--color-border)',
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
    };
  }
  return {
    border: 'var(--color-border)',
    background: 'transparent',
    color: 'var(--color-muted)',
  };
}

function SpecControl({ spec, onChange, onSkip }) {
  const options = Array.isArray(spec.spec_options) ? spec.spec_options : [];
  const active = spec.importance !== 'skip';

  if (spec.spec_type === 'enum' && options.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = active && String(spec.spec_value) === String(opt);
          const isOpen = /^(any|no preference)$/i.test(String(opt).trim());
          return (
            <button
              key={String(opt)}
              type="button"
              onClick={() => onChange({
                spec_value: opt,
                importance: isOpen ? 'nice' : 'must',
              })}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-opacity duration-200 hover:opacity-70"
              style={{
                borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                background: selected ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-bg))' : 'var(--color-bg)',
                color: selected ? 'var(--color-text)' : 'var(--color-muted)',
              }}
            >
              {opt}
            </button>
          );
        })}
        {active && (
          <button
            type="button"
            onClick={onSkip}
            className="px-2 py-1 rounded-lg text-[10px] transition-opacity duration-200 hover:opacity-70"
            style={{ color: 'var(--color-muted)' }}
          >
            Not important
          </button>
        )}
      </div>
    );
  }

  if (spec.spec_type === 'numeric_min' || spec.spec_type === 'numeric_max') {
    const label = spec.spec_type === 'numeric_max' ? 'Max' : 'Min';
    const numericOptions = options.map((opt) => Number(opt)).filter((n) => Number.isFinite(n));
    const sliderMin = numericOptions.length ? Math.min(...numericOptions) : 0;
    const sliderMax = numericOptions.length ? Math.max(...numericOptions) : 100;
    const sliderValue = active && spec.spec_value != null ? Number(spec.spec_value) : sliderMin;

    return (
      <div className="space-y-2">
        {numericOptions.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={numericOptions.length > 2 ? Math.max(1, Math.round((sliderMax - sliderMin) / (numericOptions.length - 1))) : 1}
              value={sliderValue}
              disabled={!active}
              onChange={(e) => onChange({ spec_value: Number(e.target.value), importance: 'must' })}
              className="flex-1 min-w-[120px]"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            <span className="text-xs font-medium tabular-nums shrink-0" style={{ color: 'var(--color-text)' }}>
              {sliderValue}{spec.spec_unit || ''}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
        {numericOptions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {numericOptions.map((opt) => {
              const selected = active && Number(spec.spec_value) === Number(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onChange({ spec_value: opt, importance: 'must' })}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium border transition-opacity duration-200 hover:opacity-70"
                  style={{
                    borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                    background: selected ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-bg))' : 'var(--color-bg)',
                    color: selected ? 'var(--color-text)' : 'var(--color-muted)',
                  }}
                >
                  {opt}{spec.spec_unit || ''}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{label}</span>
          <input
            type="number"
            value={active ? (spec.spec_value ?? '') : ''}
            onChange={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              onChange({ spec_value: v, importance: v != null ? 'must' : 'skip' });
            }}
            className="w-16 px-2 py-1 rounded-lg border text-xs outline-none"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
          />
          {spec.spec_unit && (
            <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{spec.spec_unit}</span>
          )}
        </div>
        {active && (
          <button
            type="button"
            onClick={onSkip}
            className="text-[10px] transition-opacity duration-200 hover:opacity-70"
            style={{ color: 'var(--color-muted)' }}
          >
            Not important
          </button>
        )}
        </div>
      </div>
    );
  }

  return (
    <input
      type="text"
      value={active ? (spec.spec_value ?? '') : ''}
      onChange={(e) => {
        const v = e.target.value.trim();
        onChange({ spec_value: v, importance: v ? 'must' : 'skip' });
      }}
      placeholder="Your requirement"
      className="w-full max-w-xs px-2.5 py-1.5 rounded-lg border text-xs outline-none"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
    />
  );
}

function FeatureToggleCell({ feature, onCycle }) {
  const imp = feature.importance || 'skip';
  const checked = imp !== 'skip';
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = imp === 'nice';
    }
  }, [imp]);

  return (
    <label
      className="flex items-start gap-2 px-2.5 py-2 rounded-xl border cursor-pointer transition-opacity duration-200 hover:opacity-70 min-h-[2.75rem]"
      style={importanceStyle(imp)}
      title={feature.why_it_matters || `${feature.feature} — click checkbox to cycle skip / nice / must`}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={onCycle}
        className="mt-0.5 rounded shrink-0"
        style={{ accentColor: 'var(--color-primary)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="text-[11px] font-medium leading-snug line-clamp-2 block">{feature.feature}</span>
        <span className="text-[9px] uppercase tracking-wide mt-0.5 opacity-80 block">
          {IMPORTANCE_LABELS[imp]}
        </span>
      </span>
    </label>
  );
}

export default function ProductScoutFeatureBrief({
  brief,
  tierFramework = [],
  onConfirm,
  onBack,
  loading = false,
}) {
  const [features, setFeatures] = useState(
    () => normalizeBriefFeatures(brief?.features || [])
  );
  const [expandedHelp, setExpandedHelp] = useState(null);

  const { specs, features: toggles } = useMemo(
    () => partitionBriefFeatures(features),
    [features]
  );

  const updateFeatureAt = (globalIndex, patch) => {
    setFeatures((prev) => prev.map((f, i) => (i === globalIndex ? { ...f, ...patch } : f)));
  };

  const findGlobalIndex = (target) => features.findIndex(
    (f) => f.feature === target.feature && f.kind === target.kind
  );

  const cycleFeature = (target) => {
    const i = findGlobalIndex(target);
    if (i < 0) return;
    setFeatures((prev) => prev.map((f, idx) => (
      idx === i ? { ...f, importance: cycleImportance(f.importance || 'skip') } : f
    )));
  };

  const setAllToggles = (importance) => {
    setFeatures((prev) => prev.map((f) => (
      f.kind === 'feature' ? { ...f, importance } : f
    )));
  };

  const handleConfirm = (e) => {
    e.preventDefault();
    const framework = tierFramework.length ? tierFramework : brief?.tier_framework;
    const recommendation = resolveRecommendedTier({
      features,
      budgetHint: brief?.budgetHint ?? null,
      tierFramework: framework,
      llmKey: brief?.recommended_tier_key,
      llmWhy: brief?.recommended_tier_why,
    });
    onConfirm({
      ...brief,
      features,
      tier_framework: framework,
      ...recommendation,
    });
  };

  return (
    <form onSubmit={handleConfirm} className="space-y-4">
      {brief?.summary && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
          {brief.summary}
        </p>
      )}

      {specs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Key specs
          </h2>
          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
            Amazon-style filters for this product type — type, form factor, size, style, etc.
          </p>
          <div className="space-y-3">
            {specs.map((spec) => {
              const gi = findGlobalIndex(spec);
              return (
                <div
                  key={`spec-${spec.feature}`}
                  className="rounded-xl border p-3 space-y-2"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                        {spec.feature}
                      </p>
                      {spec.why_it_matters && (
                        <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                          {spec.why_it_matters}
                        </p>
                      )}
                    </div>
                    {spec.importance !== 'skip' && (
                      <span
                        className="text-[9px] font-semibold uppercase tracking-wide shrink-0 px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
                      >
                        Must
                      </span>
                    )}
                  </div>
                  <SpecControl
                    spec={spec}
                    onChange={(patch) => updateFeatureAt(gi, patch)}
                    onSkip={() => updateFeatureAt(gi, { importance: 'skip', spec_value: null })}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {toggles.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Features &amp; capabilities
              </h2>
              <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                Tick a checkbox to include; click again to cycle nice → must → skip. Dash = nice to have.
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setAllToggles('must')}
                className="text-[10px] px-2 py-1 rounded-lg border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                All must
              </button>
              <button
                type="button"
                onClick={() => setAllToggles('skip')}
                className="text-[10px] px-2 py-1 rounded-lg border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Clear all
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {toggles.map((f) => (
              <FeatureToggleCell
                key={`feat-${f.feature}`}
                feature={f}
                onCycle={() => cycleFeature(f)}
              />
            ))}
          </div>

          {toggles.some((f) => f.why_it_matters) && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setExpandedHelp((v) => !v)}
                className="text-[10px] transition-opacity duration-200 hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}
              >
                {expandedHelp ? 'Hide why these matter' : 'Why these matter'}
              </button>
              {expandedHelp && (
                <ul className="mt-2 space-y-1.5">
                  {toggles.filter((f) => f.why_it_matters).map((f) => (
                    <li key={`why-${f.feature}`} className="text-[10px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>{f.feature}:</span>{' '}
                      {f.why_it_matters}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-primary)' }}
        >
          {loading ? 'Saving…' : 'Continue to tier selection'}
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
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
