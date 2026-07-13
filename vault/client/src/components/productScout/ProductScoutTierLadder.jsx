import React, { useState } from 'react';
import { formatPriceBand } from './ProductScoutFeatureBrief';
import ProductScoutResults from './ProductScoutResults';
import ProductScoutFinalRecommendation from './ProductScoutFinalRecommendation';
import { getScoutedTierKeys, tierIsScouted } from '../../utils/productScoutGuide';

function TierStep({ tier, isLast, defaultOpen, onScoutTier, scoutingTierKey }) {
  const [open, setOpen] = useState(defaultOpen);
  const band = formatPriceBand(tier.price_min, tier.price_max);
  const gains = tier.gains_vs_below || tier.feature_adds || [];
  const scout = tier.scout;
  const scouted = tierIsScouted(tier);
  const hasScout = scout?.comparison?.top3?.length > 0;
  const isScouting = scoutingTierKey === tier.key;

  return (
    <div className="relative pl-4 sm:pl-6">
      {!isLast && (
        <div
          className="absolute left-[7px] sm:left-[11px] top-8 bottom-0 w-px"
          style={{ background: 'var(--color-border)' }}
        />
      )}
      <div
        className="absolute left-0 sm:left-1 top-2 w-4 h-4 rounded-full border-2"
        style={{
          borderColor: scouted ? 'var(--color-primary)' : 'var(--color-border)',
          background: scouted ? 'var(--color-primary)' : 'var(--color-surface)',
        }}
      />
      <article
        className="rounded-2xl border overflow-hidden mb-4"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="p-4 flex items-start gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex-1 min-w-0 text-left transition-opacity hover:opacity-80"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {tier.label}
              </h3>
              <span className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                {band}
              </span>
              {scouted && hasScout && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                  Top {scout.comparison.top3.length} scouted
                </span>
              )}
              {scouted && !hasScout && !tier.scout_error && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                  No matches
                </span>
              )}
              {!scouted && (
                <span
                  className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
                >
                  Not scouted
                </span>
              )}
            </div>
            {tier.subtitle && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>{tier.subtitle}</p>
            )}
          </button>
          {!scouted && onScoutTier && (
            <button
              type="button"
              onClick={() => onScoutTier(tier.key)}
              disabled={Boolean(scoutingTierKey)}
              className="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {isScouting ? '…' : 'Scout'}
            </button>
          )}
        </div>
        {open && (
          <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
            {gains.length > 0 && (
              <div className="pt-3">
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
                  What you gain at this step
                </p>
                <ul className="text-xs space-y-1 pl-4 list-disc" style={{ color: 'var(--color-muted)' }}>
                  {gains.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            )}

            {tier.scout_error && (
              <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
                {tier.scout_error}
              </p>
            )}

            {hasScout ? (
              <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium mb-3 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                  Product scout · max ~${scout.budget?.maxPrice ?? tier.price_max ?? '—'}
                </p>
                <ProductScoutResults result={scout} compact />
              </div>
            ) : !tier.scout_error && !scouted && (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Products have not been gathered for this tier yet.
                </p>
                {onScoutTier && (
                  <button
                    type="button"
                    onClick={() => onScoutTier(tier.key)}
                    disabled={Boolean(scoutingTierKey)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {isScouting ? 'Scouting…' : `Scout ${tier.label}`}
                  </button>
                )}
              </div>
            )}
            {!hasScout && !tier.scout_error && scouted && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                No products found in this price band.
              </p>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

export default function ProductScoutTierLadder({
  result,
  onScoutTier,
  scoutingTierKey,
  onRefreshRecommendation,
  refreshingRecommendation = false,
}) {
  const tiers = result?.tiers || [];
  const brief = result?.feature_brief;
  const scoutedTiers = getScoutedTierKeys(result);
  const firstScoutedIndex = tiers.findIndex((t) => tierIsScouted(t));
  const recommendation = result?.final_recommendation;
  const canRecommend = scoutedTiers.length > 0;

  if (!tiers.length) return null;

  return (
    <div className="space-y-4">
      {brief?.summary && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
          {brief.summary}
        </p>
      )}

      {result.budget_fit_note && (
        <div
          className="rounded-xl border p-3 text-xs leading-relaxed"
          style={{ borderColor: 'var(--color-primary)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
        >
          {result.budget_fit_note.replace(/\*\*/g, '')}
        </div>
      )}

      <ProductScoutFinalRecommendation
        recommendation={recommendation}
        onRefresh={onRefreshRecommendation}
        refreshing={refreshingRecommendation}
        canRefresh={canRecommend}
      />

      {scoutedTiers.length > 0 && scoutedTiers.length < tiers.length && (
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
          {scoutedTiers.length} of {tiers.length} tiers scouted — scout remaining tiers individually below.
        </p>
      )}

      <div>
        {tiers.map((tier, i) => (
          <TierStep
            key={tier.key || tier.label}
            tier={tier}
            isLast={i === tiers.length - 1}
            defaultOpen={i === (firstScoutedIndex >= 0 ? firstScoutedIndex : 0)}
            onScoutTier={onScoutTier}
            scoutingTierKey={scoutingTierKey}
          />
        ))}
      </div>
    </div>
  );
}
