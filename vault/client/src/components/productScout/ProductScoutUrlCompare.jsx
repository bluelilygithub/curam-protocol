import React, { useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { formatListingRatings } from '../../utils/productScoutCompareTable';

function AnalysisBlock({ title, children }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
        {title}
      </h3>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
        {children}
      </p>
    </div>
  );
}

function UrlComparisonCard({ entry }) {
  const { product, analysis, comparedAt } = entry;
  const budgetNote = analysis.recommended_budget_min != null && analysis.recommended_budget_max != null
    ? `$${analysis.recommended_budget_min}–$${analysis.recommended_budget_max}`
    : null;

  return (
    <article className="space-y-4">
      <div
        className="rounded-xl border p-4 space-y-2"
        style={{ borderColor: 'var(--color-primary)', background: 'var(--color-bg)' }}
      >
        <p className="text-[10px] uppercase tracking-wide font-medium" style={{ color: 'var(--color-primary)' }}>
          Compared product
        </p>
        <h3 className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)' }}>
          {product?.title}
        </h3>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
            {product?.price_display || 'Price unavailable'}
          </span>
          {product?.rating != null && (
            <span>{product.rating}★ · {formatListingRatings(product.review_count)}</span>
          )}
          {product?.availability && <span>{product.availability}</span>}
        </div>
        {product?.link && (
          <a
            href={product.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-primary)' }}
          >
            View on Amazon →
          </a>
        )}
        {comparedAt && (
          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
            Compared {new Date(comparedAt).toLocaleString()}
          </p>
        )}
      </div>

      {analysis.worth_stretching != null && (
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {analysis.budget_already_adequate
            ? 'Your budget picks likely meet expectations for this search.'
            : analysis.worth_stretching
              ? 'Worth considering if you can stretch the budget.'
              : 'Upgrade may not justify the extra cost for this use case.'}
        </p>
      )}

      {(analysis.ranking_fallback || analysis.diagnostics?.compareFallback) && (
        <p className="text-[10px]" style={{ color: '#b45309' }}>
          AI write-up unavailable — this comparison used listing price and bullets only. Check model in Settings or retry.
        </p>
      )}

      <AnalysisBlock title="Why consider this over your picks?">
        {analysis.upgrade_benefits}
      </AnalysisBlock>

      <AnalysisBlock title="What you miss on budget picks & suggested budget">
        {analysis.budget_guidance}
        {budgetNote && !analysis.budget_already_adequate && (
          <span
            className="block mt-2 text-xs font-medium"
            style={{ color: 'var(--color-primary)' }}
          >
            Suggested range: {budgetNote}
            {analysis.recommended_budget_note ? ` · ${analysis.recommended_budget_note}` : ''}
          </span>
        )}
      </AnalysisBlock>

      {analysis.feature_gaps?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Feature gaps on budget picks</p>
          <ul className="text-xs space-y-1 pl-4 list-disc" style={{ color: 'var(--color-muted)' }}>
            {analysis.feature_gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default function ProductScoutUrlCompare({ runId, comparisons = [], onCompared }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);

  const handleCompare = async (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      addToast('Paste an Amazon product URL', 'error');
      return;
    }
    if (!runId) {
      addToast('Run a search first', 'error');
      return;
    }

    startProcessing('Comparing product…', 'Fetching the Amazon listing and analysing it against your budget picks.');
    setError(null);
    try {
      const res = await api.post('/api/product-scout/compare-url', { url: trimmed, runId });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Compare failed');
      setUrl('');
      onCompared?.(data);
      addToast('URL comparison ready', 'success');
    } catch (err) {
      const msg = err.message || 'Compare failed';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      stopProcessing();
    }
  };

  return (
    <section className="space-y-4 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Compare an Amazon link
        </h2>
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
          Paste a product URL (e.g. a premium pair you found while browsing) to see how it stacks up against your budget picks and whether stretching the budget is worth it.
        </p>
      </div>

      <form onSubmit={handleCompare} className="flex flex-col sm:flex-row gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.amazon.com.au/dp/…"
          className="flex-1 px-3 py-2.5 rounded-xl border text-sm outline-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70 shrink-0"
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
        >
          Compare URL
        </button>
      </form>

      {error && (
        <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>
      )}

      {comparisons.length > 0 && (
        <div className="space-y-6">
          {[...comparisons].reverse().map((entry) => (
            <UrlComparisonCard key={`${entry.asin}-${entry.comparedAt}`} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}
