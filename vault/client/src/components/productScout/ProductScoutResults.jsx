import React from 'react';

function importanceStyle(level) {
  if (level === 'high') return { bg: 'rgba(204, 120, 92, 0.15)', color: 'var(--color-primary)' };
  return { bg: 'var(--color-bg)', color: 'var(--color-muted)' };
}

function ProductCard({ item }) {
  const features = item.key_features || item.feature_bullets || [];
  return (
    <article
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
              style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
            >
              #{item.rank}
            </span>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
              style={{ background: 'rgba(204, 120, 92, 0.15)', color: 'var(--color-primary)' }}
            >
              Value {item.value_score ?? '—'}
            </span>
          </div>
          <h3 className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)' }}>
            {item.title}
          </h3>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{item.price ?? '—'}</p>
          {item.rating != null && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {item.rating}★ · {item.review_count != null ? `${Number(item.review_count).toLocaleString()} reviews` : '—'}
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

      {item.value_rationale && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
          {item.value_rationale}
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

export default function ProductScoutResults({ result }) {
  const comp = result?.comparison || {};
  const top3 = comp.top3 || [];
  const priorityFeatures = comp.priority_features || [];
  const externals = result?.external_alternatives || [];

  return (
    <div className="space-y-6">
      {(comp.summary || comp.selection_summary) && (
        <section className="space-y-2">
          {comp.summary && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
              {comp.summary}
            </p>
          )}
          {comp.selection_summary && (
            <div
              className="rounded-xl border p-4 space-y-2"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Why these three?
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

      {top3.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Top 3 on Amazon
          </h2>
          <div className="space-y-3">
            {top3.map((item) => (
              <ProductCard key={item.asin || item.rank} item={item} />
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
