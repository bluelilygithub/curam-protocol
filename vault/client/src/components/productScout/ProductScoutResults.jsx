import React from 'react';
import {
  buildFeatureTable,
  formatListingRatings,
  shortTitle,
} from '../../utils/productScoutCompareTable';

const LISTING_RATINGS_HINT =
  'Star ratings for this Amazon listing (may roll up variants; not brand-wide reviews).';

function importanceStyle(level) {
  if (level === 'high') return { bg: 'rgba(204, 120, 92, 0.15)', color: 'var(--color-primary)' };
  return { bg: 'var(--color-bg)', color: 'var(--color-muted)' };
}

function ProductCard({ item, variant = 'top' }) {
  const features = item.key_features || item.feature_bullets || [];
  const isStretch = variant === 'stretch';
  const rationale = isStretch ? (item.stretch_rationale || item.value_rationale) : item.value_rationale;

  return (
    <article
      className="rounded-xl border p-4 space-y-3"
      style={{
        borderColor: isStretch ? '#f59e0b' : 'var(--color-border)',
        background: 'var(--color-bg)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {!isStretch && item.rank != null && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
              >
                #{item.rank}
              </span>
            )}
            {isStretch && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}
              >
                Over budget
                {item.over_budget_pct != null ? ` +${item.over_budget_pct}%` : ''}
              </span>
            )}
            {item.value_score != null && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                style={{ background: 'rgba(204, 120, 92, 0.15)', color: 'var(--color-primary)' }}
                title={item.pre_score != null ? `Pre-score ${item.pre_score} from price, rating & reviews; AI adjusted to ${item.value_score}` : undefined}
              >
                Value {item.value_score}
                {item.pre_score != null ? ` (pre ${item.pre_score})` : ''}
              </span>
            )}
          </div>
          <h3 className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)' }}>
            {item.title}
          </h3>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{item.price ?? '—'}</p>
          {item.rating != null && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {item.rating}★ ·{' '}
              <span title={LISTING_RATINGS_HINT}>{formatListingRatings(item.review_count)}</span>
            </p>
          )}
        </div>
      </div>

      {features.length > 0 && (
        <ul className="text-xs space-y-1 pl-4 list-disc" style={{ color: 'var(--color-muted)' }}>
          {features.slice(0, 4).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {rationale && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
          {rationale}
        </p>
      )}

      {item.link && (
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-primary)' }}
        >
          View on Amazon →
        </a>
      )}
    </article>
  );
}

function FeatureCompareTable({ comparison }) {
  const { products, rows } = buildFeatureTable(comparison);
  if (!products.length || !rows.length) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        Feature comparison
      </h2>
      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
        Verified rows use Amazon listing data. Spec rows below are inferred from listing bullets — treat as approximate.
        {products.some((p) => p.isStretch) ? ' Includes one stretch option.' : ''}
      </p>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-xs border-collapse min-w-[480px]">
          <thead>
            <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
              <th
                className="text-left p-2.5 font-medium sticky left-0 z-10"
                style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', minWidth: 100 }}
              >
                Feature
              </th>
              {products.map((p) => {
                const rationale = p.isStretch
                  ? (p.stretch_rationale || p.value_rationale)
                  : p.value_rationale;
                return (
                <th
                  key={p.asin || p.rank || p.title}
                  className="text-left p-2.5 font-medium align-bottom"
                  style={{ color: 'var(--color-text)', minWidth: 120, maxWidth: 180 }}
                >
                  <span className="block text-[10px] mb-0.5" style={{ color: 'var(--color-muted)' }}>
                    {p.isStretch ? 'Stretch' : `#${p.rank}`}
                    {p.value_score != null && (
                      <> · Value {p.value_score}</>
                    )}
                    {p.pre_score != null && (
                      <> (pre {p.pre_score})</>
                    )}
                  </span>
                  <span className="line-clamp-2 leading-snug">{shortTitle(p.title, 48)}</span>
                  {rationale && (
                    <span
                      className="block mt-1 line-clamp-3 text-[10px] font-normal leading-snug"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {rationale}
                    </span>
                  )}
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.feature}
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <td
                  className="p-2.5 font-medium sticky left-0 z-10 align-top"
                  style={{
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                  }}
                  title={
                    row.hint
                    || (row.feature === 'Listing ratings' ? LISTING_RATINGS_HINT : undefined)
                    || (row.inferred ? 'Inferred from listing text — not verified' : undefined)
                  }
                >
                  {row.feature}
                </td>
                {row.values.map((val, i) => (
                  <td
                    key={`${row.feature}-${products[i]?.asin || i}`}
                    className="p-2.5 align-top leading-relaxed"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ProductScoutResults({ result, compact = false }) {
  const comp = result?.comparison || {};
  const top3 = comp.top3 || [];
  const stretch = comp.stretch_suggestions || [];
  const priorityFeatures = compact ? [] : (comp.priority_features || []);
  const externals = compact ? [] : (result?.external_alternatives || []);
  const budget = result?.budget;
  const filters = result?.filters;

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {(filters?.freeDelivery || filters?.within2Days) && (
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
          Filters:
          {filters.freeDelivery && ' free delivery'}
          {filters.freeDelivery && filters.within2Days && ' ·'}
          {filters.within2Days && ' within 2 days'}
        </p>
      )}
      {budget && (
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          Budget: <strong style={{ color: 'var(--color-text)' }}>${budget.maxPrice}</strong>
          {' · '}
          Variance {budget.variancePct}% (stretch up to ${budget.ceiling})
        </p>
      )}

      {(comp.summary || comp.selection_summary) && (
        <section className="space-y-2">
          {!compact && comp.summary && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
              {comp.summary}
            </p>
          )}
          {comp.selection_summary && (
            <div
              className="rounded-xl border p-4 space-y-2"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <h2 className={`font-semibold ${compact ? 'text-xs' : 'text-sm'}`} style={{ color: 'var(--color-text)' }}>
                {compact ? 'Why these picks' : 'Why these picks?'}
              </h2>
              {comp.selection_summary.split('\n').filter(Boolean).map((para) => (
                <p key={para.slice(0, 40)} className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  {para}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {priorityFeatures.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Features that matter most
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {priorityFeatures.map((pf) => {
              const imp = (pf.importance || 'medium').toLowerCase();
              const style = importanceStyle(imp);
              return (
                <div
                  key={pf.feature}
                  className="rounded-xl border p-3 space-y-1"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{pf.feature}</span>
                    <span
                      className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: style.bg, color: style.color }}
                    >
                      {imp}
                    </span>
                  </div>
                  {pf.why_it_matters && (
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                      {pf.why_it_matters}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(top3.length > 0 || stretch.length > 0) && (
        <FeatureCompareTable comparison={comp} />
      )}

      {top3.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Top 3 on Amazon
            {budget ? ' (within budget)' : ''}
          </h2>
          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }} title={LISTING_RATINGS_HINT}>
            Ratings shown are Amazon listing ratings (may include variant rollup).
          </p>
          <div className="space-y-3">
            {top3.map((item) => (
              <ProductCard key={item.asin || item.rank} item={item} variant="top" />
            ))}
          </div>
        </section>
      )}

      {top3.length === 0 && budget && (
        <p className="text-xs rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
          No products within your max price of ${budget.maxPrice}. See stretch suggestions below if any qualify.
        </p>
      )}

      {stretch.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Worth considering (slightly over budget)
          </h2>
          {budget && (
            <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
              Above ${budget.maxPrice} but within the {budget.variancePct}% admin variance — included because value may justify the extra cost.
            </p>
          )}
          <div className="space-y-3">
            {stretch.map((item) => (
              <ProductCard key={item.asin || item.title} item={item} variant="stretch" />
            ))}
          </div>
        </section>
      )}

      {externals.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            External alternatives
          </h2>
          <ul className="space-y-2">
            {externals.slice(0, 6).map((alt) => (
              <li key={alt.url}>
                <a
                  href={alt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border p-3 transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <p className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>{alt.title}</p>
                  {alt.snippet && (
                    <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                      {alt.snippet}
                    </p>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
