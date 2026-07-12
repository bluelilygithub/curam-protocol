import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import ProductScoutResults from '../components/productScout/ProductScoutResults';
import ProductScoutUrlCompare from '../components/productScout/ProductScoutUrlCompare';
import ProductScoutModeToggle from '../components/productScout/ProductScoutModeToggle';
import ProductScoutGuidePanel from '../components/productScout/ProductScoutGuidePanel';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

function FilterToggle({ label, checked, onChange }) {
  return (
    <label
      className="flex items-center gap-2 text-xs cursor-pointer select-none px-3 py-2 rounded-xl border transition-opacity hover:opacity-70"
      style={{
        borderColor: checked ? 'var(--color-primary)' : 'var(--color-border)',
        background: checked ? 'var(--color-bg)' : 'transparent',
        color: 'var(--color-text)',
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  );
}

export default function ProductScoutPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.productScout !== false;

  const [mode, setMode] = useState('scout');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [guideLoadedResult, setGuideLoadedResult] = useState(null);
  const [runs, setRuns] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [maxPrice, setMaxPrice] = useState('');
  const [freeDelivery, setFreeDelivery] = useState(false);
  const [within2Days, setWithin2Days] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState(new Set());
  const [loadedRunId, setLoadedRunId] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [deletingRuns, setDeletingRuns] = useState(false);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  const loadMeta = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, runsRes] = await Promise.all([
        api.get('/api/product-scout/config-check'),
        api.get('/api/product-scout/runs'),
      ]);
      setConfig(await cfgRes.json());
      const runsData = await runsRes.json();
      setRuns(Array.isArray(runsData) ? runsData : []);
    } catch {
      /* optional */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canUse) loadMeta();
  }, [canUse, loadMeta]);

  const handleRun = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      addToast('Enter a product search query', 'error');
      return;
    }
    startProcessing('Scouting products…', 'Fetching Amazon results, scoring with AI, and checking external alternatives.');
    setError(null);
    try {
      const res = await api.post('/api/product-scout/run', {
        query: q,
        ...(maxPrice.trim() ? { maxPrice: Number(maxPrice) } : {}),
        freeDelivery,
        within2Days,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scout failed');
      setResult(data);
      setGuideLoadedResult(null);
      setLoadedRunId(data.runId ?? null);
      await loadMeta();
      addToast('Comparison ready', 'success');
    } catch (err) {
      const msg = err.message || 'Scout failed';
      setError(msg);
      addToast(msg, 'error');
      setResult(null);
    } finally {
      stopProcessing();
    }
  };

  const loadRun = async (id) => {
    try {
      const res = await api.get(`/api/product-scout/runs/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load run');
      const runResult = data.result;
      setQuery(data.query || '');
      setLoadedRunId(data.id);

      if (runResult?.mode === 'guide') {
        setMode('guide');
        setGuideLoadedResult(runResult);
        setResult(null);
      } else {
        setMode('scout');
        setResult(runResult);
        setGuideLoadedResult(null);
        if (runResult?.filters) {
          setFreeDelivery(Boolean(runResult.filters.freeDelivery));
          setWithin2Days(Boolean(runResult.filters.within2Days));
        }
      }
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const toggleRunSelection = (id) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkDeleteConfirm(false);
  };

  const clearSelection = () => {
    setSelectedRunIds(new Set());
    setBulkDeleteConfirm(false);
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedRunIds];
    if (!ids.length) return;
    setDeletingRuns(true);
    try {
      const res = await api.post('/api/product-scout/runs/delete', { ids });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      if (loadedRunId && ids.includes(loadedRunId)) {
        setResult(null);
        setGuideLoadedResult(null);
        setLoadedRunId(null);
      }
      clearSelection();
      await loadMeta();
      addToast(`Deleted ${data.deleted ?? ids.length} scout${ids.length === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      addToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeletingRuns(false);
      setBulkDeleteConfirm(false);
    }
  };

  const handleModeChange = (next) => {
    setMode(next);
    setError(null);
  };

  const handleGuideSaved = async (data) => {
    setGuideLoadedResult(data);
    setLoadedRunId(data.runId ?? null);
    await loadMeta();
  };

  if (!canUse) return <Navigate to="/" replace />;

  const hasSelection = selectedRunIds.size > 0;
  const countryLabel = config?.amazonCountry ? `Amazon ${config.amazonCountry}` : 'Amazon';

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
        >
          {getIcon('productScout', { size: 18 })}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Product Scout</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {mode === 'guide'
                ? `${countryLabel} — feature-led buying guide with four price tiers.`
                : `${countryLabel} — value scoring plus non-Amazon alternatives.`}
            </p>
          </div>
          <ProductScoutModeToggle mode={mode} onChange={handleModeChange} />
        </div>
      </div>

      {config && (!config.rainforest || !config.llm) && (
        <div
          className="rounded-xl border p-4 text-xs space-y-1"
          style={{ borderColor: '#f59e0b', background: 'var(--color-bg)', color: 'var(--color-muted)' }}
        >
          <p className="font-medium" style={{ color: 'var(--color-text)' }}>Setup required</p>
          {!config.rainforest && <p>· Add <strong>RAINFOREST_API_KEY</strong> in Railway variables</p>}
          {!config.llm && <p>· Configure <strong>ANTHROPIC_API_KEY</strong> (or Gemini via vault_models)</p>}
          {!config.search && <p>· <strong>SEARCH_API_KEY</strong> optional — enables external alternative links</p>}
        </div>
      )}

      {mode === 'scout' ? (
        <>
          <form onSubmit={handleRun} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What are you shopping for?</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. wireless noise cancelling earbuds under $150"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                Max price (optional)
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: 'var(--color-muted)' }}>$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="e.g. 150"
                  className="w-32 px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                {config?.priceVariancePct != null && (
                  <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                    Stretch variance: {config.priceVariancePct}% above max
                  </span>
                )}
              </div>
            </label>
            <div className="flex flex-wrap gap-2">
              <FilterToggle label="Free delivery" checked={freeDelivery} onChange={setFreeDelivery} />
              <FilterToggle label="Within 2 days" checked={within2Days} onChange={setWithin2Days} />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Scout products
            </button>
          </form>

          {error && (
            <div
              className="rounded-xl border p-4 text-xs"
              style={{ borderColor: '#ef4444', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            >
              {error}
            </div>
          )}

          {result?.comparison && (
            <section
              className="rounded-2xl border p-6"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <ProductScoutResults result={result} />
              <ProductScoutUrlCompare
                runId={result.runId ?? loadedRunId}
                comparisons={result.url_comparisons || []}
                onCompared={(entry) => {
                  setResult((prev) => ({
                    ...prev,
                    url_comparisons: [...(prev?.url_comparisons || []), entry],
                  }));
                }}
              />
            </section>
          )}
        </>
      ) : (
        <section
          className="rounded-2xl border p-6"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <ProductScoutGuidePanel
            onRunSaved={handleGuideSaved}
            loadedResult={guideLoadedResult}
            loadedRunId={loadedRunId}
          />
        </section>
      )}

      {!loading && runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Recent scouts</h2>

          {hasSelection && (
            <div
              className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {selectedRunIds.size} selected
              </span>
              <div className="flex-1" />
              {bulkDeleteConfirm ? (
                <>
                  <span className="text-xs" style={{ color: '#ef4444' }}>
                    Delete {selectedRunIds.size} scout{selectedRunIds.size !== 1 ? 's' : ''}?
                  </span>
                  <button
                    type="button"
                    disabled={deletingRuns}
                    onClick={handleBulkDelete}
                    className="text-xs px-2.5 py-1 rounded-lg bg-red-500 text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkDeleteConfirm(false)}
                    className="text-xs"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setBulkDeleteConfirm(true)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-red-400"
                  style={{ color: '#ef4444' }}
                >
                  Delete
                </button>
              )}
              <button type="button" onClick={clearSelection} className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Clear
              </button>
            </div>
          )}

          <ul className="space-y-1">
            {runs.map((r) => {
              const selected = selectedRunIds.has(r.id);
              const isLoaded = loadedRunId === r.id;
              const isGuide = r.mode === 'guide';
              return (
                <li key={r.id} className="group flex items-stretch gap-2">
                  <label
                    className={`flex items-center px-2 shrink-0 cursor-pointer transition-opacity ${
                      selected || hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    style={{ color: 'var(--color-muted)' }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRunSelection(r.id)}
                      className="rounded"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => loadRun(r.id)}
                    className="flex-1 text-left px-3 py-2 rounded-lg text-xs border transition-opacity hover:opacity-70"
                    style={{
                      borderColor: isLoaded ? 'var(--color-primary)' : 'var(--color-border)',
                      color: 'var(--color-text)',
                      background: isLoaded ? 'var(--color-bg)' : 'transparent',
                    }}
                  >
                    <span
                      className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded mr-1.5"
                      style={{
                        background: isGuide ? 'rgba(204, 120, 92, 0.15)' : 'var(--color-surface)',
                        color: isGuide ? 'var(--color-primary)' : 'var(--color-muted)',
                      }}
                    >
                      {isGuide ? 'Guide' : 'Scout'}
                    </span>
                    <span className="font-medium">{r.query}</span>
                    <span className="ml-2" style={{ color: 'var(--color-muted)' }}>
                      {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
        CLI: <code className="font-mono">product-scout/main.py</code> — see product-scout/README.md
      </p>
    </div>
  );
}
