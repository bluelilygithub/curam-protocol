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

function viewsOf(report) {
  if (report?.mobile || report?.desktop) {
    return { mobile: report.mobile || null, desktop: report.desktop || null };
  }
  if (report?.categories) {
    const key = report.strategy === 'desktop' ? 'desktop' : 'mobile';
    return { mobile: key === 'mobile' ? report : null, desktop: key === 'desktop' ? report : null };
  }
  return { mobile: null, desktop: null };
}

function formatSave(item) {
  if (item.displayValue) return item.displayValue;
  const bits = [];
  if (item.savingsMs) bits.push(`${item.savingsMs} ms`);
  if (item.savingsBytes) bits.push(`${Math.round(item.savingsBytes / 1024)} KiB`);
  return bits.join(' · ');
}

function itemText(it) {
  const bits = [];
  if (it.selector) bits.push(it.selector);
  if (it.url) bits.push(it.url);
  if (it.subpart) bits.push(it.duration != null ? `${it.subpart}: ${it.duration} ms` : it.subpart);
  else if (it.label && it.label !== it.selector && it.label !== it.url) bits.push(it.label);
  if (it.fg && it.bg) {
    const ratio = it.contrastRatio != null ? ` ratio ${Number(it.contrastRatio).toFixed(2)} (need ≥ 4.5)` : '';
    bits.push(`text ${it.fg} on ${it.bg}${ratio}`);
  }
  if (it.fontSize) bits.push(String(it.fontSize));
  if (it.wastedMs != null) bits.push(`${it.wastedMs} ms wasted`);
  if (it.wastedBytes != null) bits.push(`${it.wastedBytes} bytes unused`);
  if (it.explanation) bits.push(it.explanation);
  if (!bits.length && it.snippet) bits.push(it.snippet);
  return bits.join(' · ');
}

function FindingList({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
      <ul className="space-y-3">
        {items.map((o) => (
          <li
            key={o.id}
            className="rounded-xl border p-4 space-y-1"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{o.title}</p>
              {formatSave(o) ? (
                <span className="text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>{formatSave(o)}</span>
              ) : null}
            </div>
            {o.description ? (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{o.description}</p>
            ) : null}
            {o.docsUrl ? (
              <a
                href={o.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}
              >
                Developer docs
              </a>
            ) : null}
            {(o.items || []).length > 0 && (
              <ul className="pt-1 space-y-0.5">
                {o.items.map((it, i) => (
                  <li key={`${o.id}-${i}`} className="text-xs leading-relaxed break-all" style={{ color: 'var(--color-text)' }}>
                    {itemText(it)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'score', label: 'Score' },
];

function runStamp(a) {
  const raw = a?.createdAt || a?.updatedAt;
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
}

function sortAudits(list, sort) {
  const rows = [...list];
  if (sort === 'oldest') return rows.sort((a, b) => runStamp(a) - runStamp(b));
  if (sort === 'name') return rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  if (sort === 'score') return rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return rows.sort((a, b) => runStamp(b) - runStamp(a));
}
  const raw = audit?.createdAt || audit?.report?.mobile?.fetchTime || audit?.report?.desktop?.fetchTime || audit?.report?.fetchTime;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
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
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem('vault:htmlListSort');
      if (SORT_OPTIONS.some((o) => o.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'newest';
  });
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [view, setView] = useState('mobile');
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
        if (!cancelled) {
          setAudit(data);
          const v = viewsOf(data.report);
          setView(v.mobile ? 'mobile' : 'desktop');
        }
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
    const rows = q
      ? audits.filter((a) => `${a.name} ${a.url} ${a.hostname || ''}`.toLowerCase().includes(q))
      : audits;
    return sortAudits(rows, sort);
  }, [audits, search, sort]);

  const handleCreate = async () => {
    if (!url.trim()) {
      addToast('Paste a website URL', 'error');
      return;
    }
    startProcessing(
      'Running Lighthouse on mobile and desktop…',
      'Two PageSpeed runs in parallel. This often takes about a minute.',
    );
    try {
      const res = await api.post('/api/html/audits', {
        url: url.trim(),
        name: name.trim() || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lighthouse run failed');
      setUrl('');
      setName('');
      await loadList();
      addToast(data.summary || `Performance ${data.score}`, 'success');
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

  const copyBrief = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('Developer brief copied', 'success');
    } catch {
      addToast('Could not copy', 'error');
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  const pair = viewsOf(audit?.report);
  const active = view === 'desktop' ? (pair.desktop || pair.mobile) : (pair.mobile || pair.desktop);
  const cats = active?.categories || {};
  const score = active ? Number(active.score) : (audit ? Number(audit.score) : null);
  const runError = audit?.report?.errors?.[view];

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

        <select
          aria-label="Sort runs"
          value={sort}
          onChange={(e) => {
            const next = e.target.value;
            setSort(next);
            try { localStorage.setItem('vault:htmlListSort', next); } catch { /* ignore */ }
          }}
          className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
          style={FIELD}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>Sort: {o.label}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => navigate('/html')}
          className="w-full px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70"
          style={
            !id
              ? { background: 'var(--color-primary)', color: '#fff' }
              : { background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
          }
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
                      {[
                        a.score != null ? String(a.score) : null,
                        formatRunDate(a) || null,
                        a.hostname || hostOf(a.url),
                      ].filter(Boolean).join(' · ')}
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
        {id && !audit && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading audit…</p>
        )}

        {!id && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>HTML · Lighthouse</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Runs Google Lighthouse on a public URL for <span className="font-medium" style={{ color: 'var(--color-text)' }}>mobile and desktop</span>, then stores a developer brief (opportunities, files, failed checks, docs links). This is lab performance, not the SEO crawl.
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
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  {audit.name}{formatRunDate(audit) ? ` (${formatRunDate(audit)})` : ''}
                </h2>
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
                  {score ?? '—'}
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

            <div className="flex flex-wrap items-center gap-2">
              {['mobile', 'desktop'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setView(s)}
                  className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
                  style={view === s
                    ? { background: 'var(--color-primary)', color: '#fff' }
                    : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {s === 'mobile' ? 'Mobile' : 'Desktop'}
                  {pair[s]?.score != null ? ` ${pair[s].score}` : ''}
                </button>
              ))}
              {active?.developerBrief ? (
                <button
                  type="button"
                  onClick={() => copyBrief(active.developerBrief)}
                  className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  Copy this report
                </button>
              ) : null}
              {audit?.report?.developerBrief ? (
                <button
                  type="button"
                  onClick={() => copyBrief(audit.report.developerBrief)}
                  className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  Copy mobile + desktop
                </button>
              ) : null}
            </div>

            {runError && !active ? (
              <p className="text-sm leading-relaxed" style={{ color: '#ef4444' }}>{runError}</p>
            ) : null}

            {active && (
              <>
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

                {active.environment?.lighthouseVersion ? (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Lighthouse {active.environment.lighthouseVersion}
                    {active.environment.formFactor ? ` · ${active.environment.formFactor}` : ''}
                    {active.environment.throttlingMethod ? ` · ${active.environment.throttlingMethod} throttling` : ''}
                    {active.fetchTime ? ` · ${active.fetchTime}` : ''}
                  </p>
                ) : null}

                {(active.workOrder || []).length > 0 && (
                  <div className="rounded-2xl border p-6 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Work order</p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                      Ranked tickets for a developer. Copy this report to paste the same list.
                    </p>
                    <ul className="space-y-3">
                      {active.workOrder.map((t) => (
                        <li
                          key={`${t.priority}-${t.title}`}
                          className="rounded-xl border p-4 space-y-1"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>{t.priority}</p>
                          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t.title}</p>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{t.action}</p>
                          {(t.evidence || []).length > 0 && (
                            <ul className="pt-1 space-y-0.5">
                              {t.evidence.map((ev) => (
                                <li key={ev} className="text-xs leading-relaxed break-all" style={{ color: 'var(--color-text)' }}>{ev}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(active.fieldData || []).length > 0 && (
                  <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Field data (Chrome UX Report)</p>
                    <ul className="space-y-1">
                      {active.fieldData.map((m) => (
                        <li key={m.id} className="flex justify-between gap-3 text-xs">
                          <span style={{ color: 'var(--color-text)' }}>{m.id.replace(/_/g, ' ')}</span>
                          <span style={{ color: 'var(--color-muted)' }}>{m.category || '—'}{m.percentile != null ? ` · ${m.percentile}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(active.metrics || []).length > 0 && (
                  <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Lab metrics</p>
                    <ul className="space-y-1">
                      {active.metrics.map((m) => (
                        <li key={m.id} className="flex justify-between gap-3 text-xs">
                          <span style={{ color: 'var(--color-text)' }}>{m.title}</span>
                          <span className="tabular-nums shrink-0" style={{ color: scoreTint(m.score == null ? null : Math.round(m.score * 100)) }}>{m.displayValue || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <FindingList title="Opportunities" items={active.opportunities} />
                <FindingList title="Diagnostics" items={active.diagnostics} />
                <FindingList title="Failed checks" items={active.failedAudits} />
                <FindingList title="Warnings" items={active.warnings} />
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
