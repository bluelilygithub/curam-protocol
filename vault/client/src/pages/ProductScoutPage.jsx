import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import ProductScoutResults from '../components/productScout/ProductScoutResults';
import ProductScoutUrlCompare from '../components/productScout/ProductScoutUrlCompare';
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

  const [scoutResult, setScoutResult] = useState(null);
  const [guideResult, setGuideResult] = useState(null);
  const [runs, setRuns] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoutError, setScoutError] = useState(null);
  const [quickScoutOpen, setQuickScoutOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  const handleQuickScout = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      addToast('Enter a product search query', 'error');
      return;
    }
    startProcessing('Scouting products…', 'Single-budget comparison — skip the guide if you already know your max price.');
    setScoutError(null);
    try {
      const res = await api.post('/api/product-scout/run', {
        query: q,
        ...(maxPrice.trim() ? { maxPrice: Number(maxPrice) } : {}),
        freeDelivery,
        within2Days,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scout failed');
      setScoutResult(data);
      setGuideResult(null);
      setLoadedRunId(data.runId ?? null);
      setQuickScoutOpen(true);
      await loadMeta();
      addToast('Comparison ready', 'success');
    } catch (err) {
      const msg = err.message || 'Scout failed';
      setScoutError(msg);
      addToast(msg, 'error');
      setScoutResult(null);
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
        setGuideResult({ ...runResult, runId: data.id });
        setScoutResult(null);
        setQuickScoutOpen(false);
      } else {
        setScoutResult(runResult);
        setGuideResult(null);
        setQuickScoutOpen(true);
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
        setScoutResult(null);
        setGuideResult(null);
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

  const handleGuideSaved = async (data) => {
    if (!data) {
      setGuideResult(null);
      setLoadedRunId(null);
      return;
    }
    setGuideResult(data);
    setScoutResult(null);
    setLoadedRunId(data.runId ?? null);
    await loadMeta();
  };

  if (!canUse) return <Navigate to="/" replace />;

  const hasSelection = selectedRunIds.size > 0;
  const countryLabel = config?.amazonCountry ? `Amazon ${config.amazonCountry}` : 'Amazon';
  const activeResult = guideResult || scoutResult;
  const runId = activeResult?.runId ?? loadedRunId;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
        >
          {getIcon('productScout', { size: 18 })}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Product Scout</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {countryLabel} — start with a buying guide, then scout the best products at each price tier.
          </p>
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

      <section
        className="rounded-2xl border p-6"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <ProductScoutGuidePanel
          onRunSaved={handleGuideSaved}
          loadedResult={guideResult}
          loadedRunId={loadedRunId}
        />
      </section>

      {guideResult && (
        <section
          className="rounded-2xl border p-6 space-y-4"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <ProductScoutUrlCompare
            runId={runId}
            comparisons={guideResult.url_comparisons || []}
            onCompared={(entry) => {
              setGuideResult((prev) => ({
                ...prev,
                url_comparisons: [...(prev?.url_comparisons || []), entry],
              }));
            }}
          />
        </section>
      )}

      <section className="space-y-2 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
        <button
          type="button"
          onClick={() => setQuickScoutOpen((v) => !v)}
          className="text-xs font-medium transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-muted)' }}
        >
          {quickScoutOpen ? '▼' : '▶'} Quick scout — single budget, skip the guide
        </button>

        {quickScoutOpen && (
          <div className="space-y-4 pt-2">
            <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
              Already know your max price? Run one comparison without the tier guide.
            </p>
            <form onSubmit={handleQuickScout} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Search query</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. wireless noise cancelling earbuds"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Max price (optional)</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--color-muted)' }}>$</span>
                  <input
                    type="number"
                    min="1"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="150"
                    className="w-32 px-3 py-2.5 rounded-xl border text-sm outline-none"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>
              </label>
              <div className="flex flex-wrap gap-2">
                <FilterToggle label="Free delivery" checked={freeDelivery} onChange={setFreeDelivery} />
                <FilterToggle label="Within 2 days" checked={within2Days} onChange={setWithin2Days} />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
              >
                Scout at this budget
              </button>
            </form>

            {scoutError && (
              <div className="rounded-xl border p-4 text-xs" style={{ borderColor: '#ef4444', color: 'var(--color-text)' }}>
                {scoutError}
              </div>
            )}

            {scoutResult?.comparison && (
              <section
                className="rounded-2xl border p-6"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <ProductScoutResults result={scoutResult} />
                <ProductScoutUrlCompare
                  runId={scoutResult.runId ?? loadedRunId}
                  comparisons={scoutResult.url_comparisons || []}
                  onCompared={(entry) => {
                    setScoutResult((prev) => ({
                      ...prev,
                      url_comparisons: [...(prev?.url_comparisons || []), entry],
                    }));
                  }}
                />
              </section>
            )}
          </div>
        )}
      </section>

      {!loading && runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Recent runs</h2>

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
                    Delete {selectedRunIds.size} run{selectedRunIds.size !== 1 ? 's' : ''}?
                  </span>
                  <button
                    type="button"
                    disabled={deletingRuns}
                    onClick={handleBulkDelete}
                    className="text-xs px-2.5 py-1 rounded-lg bg-red-500 text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                  >
                    Confirm
                  </button>
                  <button type="button" onClick={() => setBulkDeleteConfirm(false)} className="text-xs" style={{ color: 'var(--color-muted)' }}>
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
              const scoutedCount = Array.isArray(r.scoutedTiers) ? r.scoutedTiers.length : 0;
              const tierLabel = isGuide && scoutedCount > 0
                ? `Guide · ${scoutedCount}/4`
                : isGuide
                  ? 'Guide'
                  : 'Scout';
              return (
                <li key={r.id} className="group flex items-stretch gap-2">
                  <label
                    className={`flex items-center px-2 shrink-0 cursor-pointer transition-opacity ${
                      selected || hasSelection ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    style={{ color: 'var(--color-muted)' }}
                  >
                    <input type="checkbox" checked={selected} onChange={() => toggleRunSelection(r.id)} className="rounded" />
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
                      {tierLabel}
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
    </div>
  );
}
