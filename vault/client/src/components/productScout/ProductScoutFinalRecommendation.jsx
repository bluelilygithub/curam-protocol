import React from 'react';

const VERDICT_LABELS = {
  stick_with_amazon: 'Amazon looks competitive',
  possibly_cheaper: 'Worth checking elsewhere',
  insufficient_data: 'Could not verify alternatives',
};

function confidenceStyle(level) {
  if (level === 'high') return { bg: 'rgba(22, 163, 74, 0.12)', color: '#166534' };
  if (level === 'medium') return { bg: 'rgba(245, 158, 11, 0.12)', color: '#b45309' };
  return { bg: 'var(--color-surface)', color: 'var(--color-muted)' };
}

function ExternalCheckSection({
  externalCheck,
  onRunExternalCheck,
  checkingExternal = false,
  searchEnabled = false,
  hasRecommendationPick = false,
}) {
  if (!searchEnabled) {
    return (
      <p className="text-[10px] pt-2 border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        Add SEARCH_API_KEY in Settings to check non-Amazon retailers against this pick.
      </p>
    );
  }

  if (!externalCheck && hasRecommendationPick && onRunExternalCheck) {
    return (
      <div className="pt-4 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Non-Amazon check
        </p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Search other retailers using this product&apos;s specs. Prices are only shown when found in search snippets — verify before you buy.
        </p>
        <button
          type="button"
          onClick={onRunExternalCheck}
          disabled={checkingExternal}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
        >
          {checkingExternal ? 'Searching…' : 'Check non-Amazon options'}
        </button>
      </div>
    );
  }

  if (!externalCheck) return null;

  const verdict = externalCheck.verdict || 'insufficient_data';
  const borderColor = verdict === 'possibly_cheaper' ? '#f59e0b' : 'var(--color-border)';

  return (
    <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Non-Amazon check
          </p>
          <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>
            {VERDICT_LABELS[verdict] || VERDICT_LABELS.insufficient_data}
          </p>
        </div>
        {onRunExternalCheck && (
          <button
            type="button"
            onClick={onRunExternalCheck}
            disabled={checkingExternal}
            className="text-[10px] px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {checkingExternal ? 'Searching…' : 'Re-run'}
          </button>
        )}
      </div>

      {externalCheck.summary && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          {externalCheck.summary}
        </p>
      )}

      {externalCheck.alternatives?.length > 0 && (
        <ul className="space-y-2">
          {externalCheck.alternatives.map((alt) => {
            const conf = confidenceStyle(alt.confidence);
            return (
              <li key={alt.url}>
                <a
                  href={alt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border p-3 transition-opacity hover:opacity-70"
                  style={{ borderColor, background: 'var(--color-surface)' }}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                      {alt.retailer_guess || alt.title}
                    </span>
                    <span
                      className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: conf.bg, color: conf.color }}
                    >
                      {alt.confidence} confidence
                    </span>
                    {alt.price_mentioned && (
                      <span className="text-[10px] font-medium" style={{ color: 'var(--color-text)' }}>
                        {alt.price_mentioned}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                    {alt.note || alt.title}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {externalCheck.verify_before_switching?.length > 0 && (
        <div>
          <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
            Verify before switching retailer
          </p>
          <ul className="text-xs space-y-1 pl-4 list-disc" style={{ color: 'var(--color-muted)' }}>
            {externalCheck.verify_before_switching.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
        Snippet-based only — prices may be stale. Amazon remains your scouted benchmark.
      </p>
    </div>
  );
}

export default function ProductScoutFinalRecommendation({
  recommendation,
  onRefresh,
  refreshing = false,
  canRefresh = false,
  externalCheck,
  onRunExternalCheck,
  checkingExternal = false,
  searchEnabled = false,
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
  const hasRecommendationPick = Boolean(pick.title);

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

      <ExternalCheckSection
        externalCheck={externalCheck}
        onRunExternalCheck={onRunExternalCheck}
        checkingExternal={checkingExternal}
        searchEnabled={searchEnabled}
        hasRecommendationPick={hasRecommendationPick}
      />
    </section>
  );
}
