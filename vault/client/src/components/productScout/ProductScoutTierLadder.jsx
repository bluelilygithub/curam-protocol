import React, { useState } from 'react';
import { formatPriceBand } from './ProductScoutFeatureBrief';
import { formatListingRatings } from '../../utils/productScoutCompareTable';

function TierPickCard({ pick }) {
  if (!pick) {
    return (
      <p className="text-xs rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        No strong match in search results for this tier — try a broader product phrase.
      </p>
    );
  }

  const bullets = pick.key_features || pick.feature_bullets || [];

  return (
    <div
      className="rounded-xl border p-4 space-y-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="flex justify-between gap-3">
        <h4 className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)' }}>
          {pick.title}
        </h4>
        <p className="text-sm font-semibold shrink-0" style={{ color: 'var(--color-text)' }}>
          {pick.price ?? pick.price_display ?? '—'}
        </p>
      </div>
      {pick.rating != null && (
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
          {pick.rating}★ · {formatListingRatings(pick.review_count)}
          {pick.pre_score != null && <> · pre-score {pick.pre_score}</>}
        </p>
      )}
      {bullets.length > 0 && (
        <ul className="text-xs space-y-1 pl-4 list-disc" style={{ color: 'var(--color-muted)' }}>
          {bullets.slice(0, 3).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {pick.link && (
        <a
          href={pick.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-primary)' }}
        >
          View on Amazon →
        </a>
      )}
    </div>
  );
}

function TierStep({ tier, isLast, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const band = formatPriceBand(tier.price_min, tier.price_max);
  const gains = tier.gains_vs_below || tier.feature_adds || [];

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
        style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
      />
      <article
        className="rounded-2xl border overflow-hidden mb-4"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full text-left p-4 transition-opacity hover:opacity-80"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              {tier.label}
            </h3>
            <span className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
              {band}
            </span>
          </div>
          {tier.subtitle && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>{tier.subtitle}</p>
          )}
          {tier.tier_rationale && (
            <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-text)' }}>
              {tier.tier_rationale}
            </p>
          )}
        </button>
        {open && (
          <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            {gains.length > 0 && (
              <div>
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
            <TierPickCard pick={tier.pick} />
            {tier.alternate?.title && (
              <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                Alternate:{' '}
                {tier.alternate.link ? (
                  <a href={tier.alternate.link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                    {tier.alternate.title}
                  </a>
                ) : tier.alternate.title}
                {tier.alternate.price ? ` · ${tier.alternate.price}` : ''}
              </div>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

export default function ProductScoutTierLadder({ result }) {
  const tiers = result?.tiers || [];
  const brief = result?.feature_brief;

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
          {result.budget_fit_note}
        </div>
      )}

      <div>
        {tiers.map((tier, i) => (
          <TierStep key={tier.key || tier.label} tier={tier} isLast={i === tiers.length - 1} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}
