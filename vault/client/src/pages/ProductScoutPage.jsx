import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const EXAMPLE_QUERIES = [
  'wireless noise cancelling earbuds under $150',
  'standing desk converter 2024',
  'robot vacuum pet hair',
];

export default function ProductScoutPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.productScout !== false;

  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [runs, setRuns] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      const res = await api.post('/api/product-scout/run', { query: q });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scout failed');
      setResult(data);
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
      setResult(data.result);
      setQuery(data.query || '');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
        >
          {getIcon('productScout', { size: 18 })}
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Product Scout</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Unbiased Amazon comparison — value scoring plus non-Amazon alternatives.
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
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setQuery(ex)}
              className="text-[10px] px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {ex}
            </button>
          ))}
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

      {result?.markdown && (
        <section
          className="rounded-2xl border p-6 prose prose-sm max-w-none"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <ReactMarkdown>{result.markdown}</ReactMarkdown>
        </section>
      )}

      {!loading && runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Recent scouts</h2>
          <ul className="space-y-1">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => loadRun(r.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <span className="font-medium">{r.query}</span>
                  <span className="ml-2" style={{ color: 'var(--color-muted)' }}>
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
        CLI: <code className="font-mono">product-scout/main.py</code> — see product-scout/README.md
      </p>
    </div>
  );
}
