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

function severityColor(sev) {
  if (sev === 'fail') return '#ef4444';
  if (sev === 'warn') return '#b45309';
  return '#166534';
}

function severityLabel(sev) {
  if (sev === 'fail') return 'Fail';
  if (sev === 'warn') return 'Warn';
  return 'Pass';
}

export default function SeoAuditPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.seo !== false;

  const [audits, setAudits] = useState([]);
  const [audit, setAudit] = useState(null);
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [pageLimit, setPageLimit] = useState(15);
  const [openPages, setOpenPages] = useState(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const loadList = useCallback(async () => {
    const res = await api.get('/api/seo/audits');
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
    api.get(`/api/seo/audits/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Not found');
        if (data.redirectTo) {
          navigate(data.redirectTo, { replace: true });
          return;
        }
        if (!cancelled) {
          setAudit(data);
          const recPages = (data.report?.pages || [])
            .filter((p) => (p.recommendations || []).length)
            .map((p) => p.url);
          setOpenPages(new Set(recPages.slice(0, 8)));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          addToast(err.message, 'error');
          navigate('/seo');
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
      `Crawling up to ${pageLimit} pages…`,
      'Same-origin HTML only. Then each page gets checks and recommendations.',
    );
    try {
      const res = await api.post('/api/seo/audits', {
        url: url.trim(),
        name: name.trim() || undefined,
        pageLimit,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Audit failed');
      setUrl('');
      setName('');
      setPageLimit(15);
      await loadList();
      addToast(`Audit scored ${data.score}`, 'success');
      navigate(`/seo/${data.id}`);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      const res = await api.delete(`/api/seo/audits/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setDeleteConfirm(false);
      await loadList();
      addToast('Audit deleted', 'success');
      navigate('/seo');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  const findings = audit?.report?.findings || [];
  const pages = audit?.report?.pages || [];
  const score = audit ? Number(audit.score) : null;
  const scoreColor = score == null ? 'var(--color-muted)' : score >= 80 ? '#166534' : score >= 55 ? '#b45309' : '#ef4444';
  const crawled = audit?.report?.crawled || pages.length;
  const discovered = audit?.report?.discovered || pages.length;

  const togglePage = (pageUrl) => {
    setOpenPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageUrl)) next.delete(pageUrl);
      else next.add(pageUrl);
      return next;
    });
  };

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('scan-search', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>SEO</h1>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search audits…"
          className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
          style={FIELD}
        />

        <button
          type="button"
          onClick={() => navigate('/seo')}
          className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
          style={{
            background: !id ? 'var(--color-bg)' : 'transparent',
            color: !id ? 'var(--color-text)' : 'var(--color-muted)',
          }}
        >
          New audit
        </button>

        <ul className="space-y-0.5">
          {filtered.length === 0 && (
            <li className="px-2 py-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>No audits yet</li>
          )}
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => navigate(`/seo/${a.id}`)}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                style={{
                  background: String(id) === String(a.id) ? 'var(--color-bg)' : 'transparent',
                  color: String(id) === String(a.id) ? 'var(--color-text)' : 'var(--color-muted)',
                }}
              >
                <span className="block truncate">{a.name}</span>
                <span className="block truncate" style={{ color: 'var(--color-muted)' }}>
                  {a.score != null ? `${a.score} · ` : ''}{a.hostname || hostOf(a.url)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl">
        {!id && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New SEO audit</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Paste a public URL and how many pages to crawl. Vault follows same-origin HTML links (no JavaScript), then scores every fetched page and lists what to fix on each one.
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
                placeholder="Defaults to the page title"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
            </label>
            <label className="block space-y-1 max-w-xs">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Pages to crawl</span>
              <input
                type="number"
                min={1}
                max={40}
                value={pageLimit}
                onChange={(e) => setPageLimit(Number(e.target.value) || 15)}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>1–40. Homepage first, then other pages on the same site. Default 15.</span>
            </label>
            <button
              type="button"
              onClick={handleCreate}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Run audit
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
                  {crawled ? ` · crawled ${crawled}${discovered > crawled ? ` of ${discovered} found` : ''}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-semibold tabular-nums"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: scoreColor }}
                >
                  {score}
                </div>
                {deleteConfirm ? (
                  <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    Delete?
                    <button type="button" onClick={handleDelete} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
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

            <div className="space-y-2">
              {findings.map((f) => (
                <div
                  key={f.id}
                  className="rounded-2xl border p-4 space-y-1"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: severityColor(f.severity) }}>
                      {severityLabel(f.severity)}
                    </span>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{f.title}</p>
                  </div>
                  {f.detail ? (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>{f.detail}</p>
                  ) : null}
                </div>
              ))}
            </div>

            {pages.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                  Pages ({pages.length})
                </p>
                {pages.map((p) => {
                  const open = openPages.has(p.url);
                  const recs = p.recommendations || [];
                  return (
                    <div
                      key={p.url}
                      className="rounded-2xl border overflow-hidden"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                    >
                      <button
                        type="button"
                        onClick={() => togglePage(p.url)}
                        className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 transition-opacity hover:opacity-70"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                            {p.title || hostOf(p.url)}
                            {p.isHome ? ' · Home' : ''}
                          </span>
                          <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{p.url}</span>
                          <span className="block text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                            {recs.length} recommendation{recs.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: p.score >= 80 ? '#166534' : p.score >= 55 ? '#b45309' : '#ef4444' }}>
                          {p.score}
                        </span>
                      </button>
                      {open && (
                        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                          {recs.length === 0 ? (
                            <p className="text-xs pt-3" style={{ color: 'var(--color-muted)' }}>No fixes suggested for this page.</p>
                          ) : (
                            <ul className="pt-3 space-y-2">
                              {recs.map((r) => (
                                <li key={`${p.url}-${r.id}`} className="text-xs leading-relaxed">
                                  <span className="font-semibold uppercase tracking-wider text-[10px]" style={{ color: severityColor(r.severity) }}>{severityLabel(r.severity)}</span>
                                  <p className="mt-0.5" style={{ color: 'var(--color-text)' }}>{r.action}</p>
                                  {r.why ? <p style={{ color: 'var(--color-muted)' }}>{r.why}</p> : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(p.findings || []).length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Checks</p>
                              {(p.findings || []).map((f) => (
                                <p key={`${p.url}-${f.id}`} className="text-xs leading-relaxed">
                                  <span style={{ color: severityColor(f.severity) }}>{severityLabel(f.severity)}</span>
                                  {' · '}
                                  <span style={{ color: 'var(--color-text)' }}>{f.title}</span>
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
