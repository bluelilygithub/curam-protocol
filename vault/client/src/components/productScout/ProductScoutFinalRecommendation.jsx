import React from 'react';

export default function ProductScoutFinalRecommendation({
  recommendation,
  onRefresh,
  refreshing = false,
  canRefresh = false,
}) {
  if (!recommendation && !canRefresh) return null;

  if (!recommendation?.headline && !recommendation?.error && canRefresh) {
    return (
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Value recommendation
        </h2>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Get an unbiased best-value pick across the tiers you have scouted.
        </p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            {refreshing ? 'Analysing…' : 'Get recommendation'}
          </button>
        )}
      </div>
    );
  }

  if (recommendation?.error) {
    return (
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: '#f59e0b', background: 'var(--color-bg)' }}
      >
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Could not generate value recommendation: {recommendation.error}
        </p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          >
            {refreshing ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
    );
  }

  const pick = recommendation.pick || {};

  return (
    <section
      className="rounded-2xl border p-5 space-y-4"
      style={{ borderColor: 'var(--color-primary)', background: 'var(--color-bg)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-primary)' }}>
            Best value for money
          </p>
          <h2 className="text-sm font-semibold mt-1 leading-snug" style={{ color: 'var(--color-text)' }}>
            {recommendation.headline}
          </h2>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-[10px] px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40 shrink-0"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {refreshing ? 'Updating…' : 'Refresh'}
          </button>
        )}
      </div>

      <article
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(204, 120, 92, 0.15)', color: 'var(--color-primary)' }}
          >
            {pick.tier_label || 'Pick'}
          </span>
          {pick.value_score != null && (
            <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
              Value {pick.value_score}
            </span>
          )}
        </div>
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)' }}>
          {pick.title}
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {pick.price && (
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{pick.price}</span>
          )}
          {pick.link && (
            <a
              href={pick.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-primary)' }}
            >
              View on Amazon
            </a>
          )}
        </div>
      </article>

      {recommendation.rationale && (
        <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
          {recommendation.rationale}
        </p>
      )}

      {(recommendation.worth_stepping_up || recommendation.worth_staying_down) && (
        <div className="space-y-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          {recommendation.worth_staying_down && (
            <p><strong style={{ color: 'var(--color-text)' }}>Stay budget:</strong> {recommendation.worth_staying_down}</p>
          )}
          {recommendation.worth_stepping_up && (
            <p><strong style={{ color: 'var(--color-text)' }}>Worth stepping up:</strong> {recommendation.worth_stepping_up}</p>
          )}
        </div>
      )}
    </section>
  );
}
