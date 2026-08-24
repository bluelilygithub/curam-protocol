import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function scoreTint(n) {
  if (n == null) return 'var(--color-muted)';
  if (n >= 90) return '#166534';
  if (n >= 50) return '#b45309';
  return '#ef4444';
}

export default function HtmlAuditPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.html !== false;

  const [audits, setAudits] = useState([]);
  const [audit, setAudit] = useState(null);
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState('mobile');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const loadList = useCallback(async () => {
    const res = await api.get('/api/html/audits');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load audits');
    setAudits(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    loadList().catch((err) => addToast(err.message, 'error'));
  }, [canUse, loadList, addToast]);

  useEffect(() => {
    if (!canUse || !id) {
      setAudit(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/api/html/audits/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Not found');
        if (!cancelled) setAudit(data);
      })
      .catch((err) => {
        if (!cancelled) {
          addToast(err.message, 'error');
          navigate('/html');
        }
      });
    return () => { cancelled = true; };
  }, [canUse, id, addToast, navigate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return audits;
    return audits.filter((a) => `${a.name} ${a.url} ${a.hostname || ''}`.toLowerCase().includes(q));
  }, [audits, search]);

  const handleCreate = async () => {
    if (!url.trim()) {
      addToast('Paste a website URL', 'error');
      return;
    }
    startProcessing(
      `Running Lighthouse (${strategy})…`,
      'Google PageSpeed fetches the live page. This often takes 30–60 seconds.',
    );
    try {
      const res = await api.post('/api/html/audits', {
        url: url.trim(),
        name: name.trim() || undefined,
        strategy,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lighthouse run failed');
      setUrl('');
      setName('');
      await loadList();
      addToast(`Performance ${data.score}`, 'success');
      navigate(`/html/${data.id}`);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleDelete = async (auditId) => {
    const target = Number(auditId);
    if (!target) return;
    try {
      const res = await api.delete(`/api/html/audits/${target}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setDeleteConfirm(false);
      setPendingDeleteId(null);
      await loadList();
      addToast('Audit deleted', 'success');
      if (String(id) === String(target)) navigate('/html');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  const report = audit?.report || {};
  const cats = report.categories || {};
  const score = audit ? Number(audit.score) : null;

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('gauge', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>HTML</h1>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search runs…"
          className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
          style={FIELD}
        />

        <button
          type="button"
          onClick={() => navigate('/html')}
          className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
          style={{
            background: !id ? 'var(--color-bg)' : 'transparent',
            color: !id ? 'var(--color-text)' : 'var(--color-muted)',
          }}
        >
          New Lighthouse run
        </button>

        <ul className="space-y-0.5">
          {filtered.length === 0 && (
            <li className="px-2 py-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>No runs yet</li>
          )}
          {filtered.map((a) => (
            <li key={a.id}>
              {String(pendingDeleteId) === String(a.id) ? (
                <div className="px-2 py-1.5 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
                  <span className="block truncate" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                  <span className="flex items-center gap-2">
                    Delete?
                    <button type="button" onClick={() => handleDelete(a.id)} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                    <button type="button" onClick={() => setPendingDeleteId(null)} className="transition-opacity hover:opacity-70">No</button>
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-0.5">
                  <button
                    type="button"
                    onClick={() => navigate(`/html/${a.id}`)}
                    className="min-w-0 flex-1 text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                    style={{
                      background: String(id) === String(a.id) ? 'var(--color-bg)' : 'transparent',
                      color: String(id) === String(a.id) ? 'var(--color-text)' : 'var(--color-muted)',
                    }}
                  >
                    <span className="block truncate">{a.name}</span>
                    <span className="block truncate" style={{ color: 'var(--color-muted)' }}>
                      {a.score != null ? `${a.score} · ` : ''}{a.strategy || 'mobile'} · {a.hostname || hostOf(a.url)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${a.name}`}
                    onClick={() => setPendingDeleteId(a.id)}
                    className="shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {getIcon('trash', { size: 14 })}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl">
        {!id && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>HTML · Lighthouse</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Run Google Lighthouse via PageSpeed Insights on a public URL. This measures performance, accessibility, best practices, and Lighthouse SEO — not the Vault on-page crawl. Set <span className="font-medium" style={{ color: 'var(--color-text)' }}>PAGESPEED_API_KEY</span> on Railway. Create a key in Google Cloud: enable PageSpeed Insights API, then Credentials → API key.
              </p>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Website URL</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.example.com.au"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to the hostname"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
            </label>
            <div className="flex gap-2">
              {['mobile', 'desktop'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStrategy(s)}
                  className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
                  style={strategy === s
                    ? { background: 'var(--color-primary)', color: '#fff' }
                    : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {s === 'mobile' ? 'Mobile' : 'Desktop'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCreate}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Run Lighthouse
            </button>
          </section>
        )}

        {id && audit && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{audit.name}</h2>
                <a
                  href={audit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs transition-opacity hover:opacity-70 break-all"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {audit.url}
                </a>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  {audit.summary}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-semibold tabular-nums"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: scoreTint(score) }}
                >
                  {score}
                </div>
                {deleteConfirm ? (
                  <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    Delete?
                    <button type="button" onClick={() => handleDelete(id)} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                    <button type="button" onClick={() => setDeleteConfirm(false)} className="transition-opacity hover:opacity-70">No</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(true)}
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Performance', cats.performance],
                ['Accessibility', cats.accessibility],
                ['Best practices', cats.bestPractices],
                ['Lighthouse SEO', cats.seo],
              ].map(([label, n]) => (
                <div
                  key={label}
                  className="rounded-2xl border p-4"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
                  <p className="text-xl font-semibold tabular-nums mt-1" style={{ color: scoreTint(n) }}>{n ?? '—'}</p>
                </div>
              ))}
            </div>

            {(report.metrics || []).length > 0 && (
              <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Lab metrics</p>
                <ul className="space-y-1">
                  {report.metrics.map((m) => (
                    <li key={m.id} className="flex justify-between gap-3 text-xs">
                      <span style={{ color: 'var(--color-text)' }}>{m.title}</span>
                      <span className="tabular-nums shrink-0" style={{ color: scoreTint(m.score == null ? null : Math.round(m.score * 100)) }}>{m.displayValue || '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(report.opportunities || []).length > 0 && (
              <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Opportunities</p>
                <ul className="space-y-2">
                  {report.opportunities.map((o) => (
                    <li key={o.id} className="text-xs leading-relaxed">
                      <p style={{ color: 'var(--color-text)' }}>{o.title}</p>
                      {o.displayValue ? <p style={{ color: 'var(--color-muted)' }}>{o.displayValue}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(report.failedAudits || []).length > 0 && (
              <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Failed checks</p>
                <ul className="space-y-2">
                  {report.failedAudits.map((a) => (
                    <li key={a.id} className="text-xs leading-relaxed">
                      <p style={{ color: 'var(--color-text)' }}>{a.title}</p>
                      {a.description ? <p style={{ color: 'var(--color-muted)' }}>{a.description}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
