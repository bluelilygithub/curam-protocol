import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { formatRunDate, formatSeoCampaignBrief, seoBriefFilename } from '../utils/seoCampaignBrief';
import Tooltip from '../components/Tooltip';

const TOOL_HELP = {
  title: 'SEO',
  description: 'Crawls a site\'s same-origin HTML for a real organic SEO campaign — built for a professional audit, not just an on-page checklist.',
  features: [
    'Weighted scoring — indexability-blocking issues (noindex, robots.txt blocks, 4xx/5xx, X-Robots-Tag) cost far more than a missing OG tag or a slightly-long meta description',
    'Indexability breakdown — Indexable / Noindexed / Blocked-by-robots / Error counts at a glance',
    'Near-duplicate content detection across crawled pages, plus duplicate titles, descriptions, and H1s',
    'noindex-vs-sitemap conflict detection, redirect-loop detection, hreflang self-reference/x-default checks',
    'html lang and viewport presence checks, alongside titles, descriptions, canonicals, schema, and internal links',
    'Site-wide updates fold repeated per-page gaps into one theme/CMS/hosting fix instead of page-by-page edits',
    'Copyable or downloadable campaign brief',
  ],
};

function HelpModal({ onClose }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold text-base" style={{ color: 'var(--color-text)' }}>{TOOL_HELP.title}</h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }} className="hover:opacity-60 transition-opacity flex-shrink-0">✕</button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{TOOL_HELP.description}</p>
        <ul className="space-y-1.5">
          {TOOL_HELP.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
              <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>•</span>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

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
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem('vault:seoListSort');
      if (SORT_OPTIONS.some((o) => o.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'newest';
  });
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [pageLimit, setPageLimit] = useState(25);
  const [openPages, setOpenPages] = useState(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

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
      `Crawling up to ${pageLimit} pages…`,
      'Same-origin HTML for organic campaigns: indexation, SERP copy, thin pages, internal links.',
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
      setPageLimit(25);
      await loadList();
      addToast(`Audit scored ${data.score}`, 'success');
      navigate(`/seo/${data.id}`);
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
      const res = await api.delete(`/api/seo/audits/${target}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setDeleteConfirm(false);
      setPendingDeleteId(null);
      await loadList();
      addToast('Audit deleted', 'success');
      if (String(id) === String(target)) navigate('/seo');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(formatSeoCampaignBrief(audit));
      addToast('Campaign brief copied', 'success');
    } catch {
      addToast('Could not copy', 'error');
    }
  };

  const downloadBrief = () => {
    try {
      const text = formatSeoCampaignBrief(audit);
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = seoBriefFilename(audit);
      a.click();
      URL.revokeObjectURL(href);
      addToast('Brief downloaded', 'success');
    } catch {
      addToast('Could not download', 'error');
    }
  };

  const findings = audit?.report?.findings || [];
  const pages = audit?.report?.pages || [];
  const globalUpdates = audit?.report?.globalUpdates || [];
  const indexability = audit?.report?.indexability || null;
  const score = audit ? Number(audit.score) : null;
  const scoreColor = score == null ? 'var(--color-muted)' : score >= 80 ? '#166534' : score >= 55 ? '#b45309' : '#ef4444';
  const notCovered = audit?.report?.notCovered || [];
  const crawled = Number(audit?.report?.crawled) || pages.length;
  const discovered = Number(audit?.report?.discovered) || pages.length;

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
          <h1 className="text-sm font-semibold flex-1" style={{ color: 'var(--color-text)' }}>SEO</h1>
          <Tooltip text="What this tool does and its full feature list.">
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="text-xs w-5 h-5 flex items-center justify-center rounded-full border hover:opacity-60 transition-opacity flex-shrink-0"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              ?
            </button>
          </Tooltip>
        </div>

        <Tooltip text="Filter audits by name, URL, or host.">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search audits…"
            className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
            style={FIELD}
          />
        </Tooltip>

        <Tooltip text="Change the order audits are listed in.">
          <select
            aria-label="Sort audits"
            value={sort}
            onChange={(e) => {
              const next = e.target.value;
              setSort(next);
              try { localStorage.setItem('vault:seoListSort', next); } catch { /* ignore */ }
            }}
            className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
            style={FIELD}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>Sort: {o.label}</option>
            ))}
          </select>
        </Tooltip>

        <Tooltip text="Start a new crawl and audit.">
          <button
            type="button"
            onClick={() => navigate('/seo')}
            className="w-full px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70"
            style={
              !id
                ? { background: 'var(--color-primary)', color: '#fff' }
                : { background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
            }
          >
            New audit
          </button>
        </Tooltip>

        <ul className="space-y-0.5">
          {filtered.length === 0 && (
            <li className="px-2 py-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>No audits yet</li>
          )}
          {filtered.map((a) => (
            <li key={a.id}>
              {String(pendingDeleteId) === String(a.id) ? (
                <div className="px-2 py-1.5 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
                  <span className="block truncate" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                  <span className="flex items-center gap-2">
                    Delete?
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="transition-opacity hover:opacity-70"
                      style={{ color: '#ef4444' }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(null)}
                      className="transition-opacity hover:opacity-70"
                    >
                      No
                    </button>
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-0.5">
                  <Tooltip text={`Open ${a.name}`}>
                    <button
                      type="button"
                      onClick={() => navigate(`/seo/${a.id}`)}
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
                          formatRunDate(a.createdAt) || null,
                          a.hostname || hostOf(a.url),
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </Tooltip>
                  <Tooltip text="Delete this audit.">
                    <button
                      type="button"
                      aria-label={`Delete ${a.name}`}
                      onClick={() => setPendingDeleteId(a.id)}
                      className="shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {getIcon('trash', { size: 14 })}
                    </button>
                  </Tooltip>
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
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New SEO audit</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Crawl the site for an organic campaign: which URLs can be indexed, how titles and descriptions look in search, thin or duplicate pages, and internal links. Speed and Core Web Vitals are in <span className="font-medium" style={{ color: 'var(--color-text)' }}>HTML</span>. Paid keywords are in <span className="font-medium" style={{ color: 'var(--color-text)' }}>Adwords</span>.
              </p>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Website URL</span>
              <Tooltip text="The public website to crawl, starting from this page.">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.example.com.au"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={FIELD}
                />
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Name (optional)</span>
              <Tooltip text="Label for this audit in the list. Defaults to the page title if left blank.">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Defaults to the page title"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={FIELD}
                />
              </Tooltip>
            </label>
            <label className="block space-y-1 max-w-xs">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Pages to crawl</span>
              <Tooltip text="How many same-origin pages to crawl (1–40). Homepage first, then hubs, then other pages, query-string URLs last.">
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={pageLimit}
                  onChange={(e) => setPageLimit(Number(e.target.value) || 25)}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={FIELD}
                />
              </Tooltip>
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>1–40. Homepage first, then hubs like /products, then other pages. Query-string URLs last. Default 25.</span>
            </label>
            <Tooltip text="Crawl the site and generate the audit.">
              <button
                type="button"
                onClick={handleCreate}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                Run audit
              </button>
            </Tooltip>
          </section>
        )}

        {id && audit && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  {audit.name}{formatRunDate(audit.createdAt) ? ` (${formatRunDate(audit.createdAt)})` : ''}
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
                <Tooltip text="Copy the campaign brief as markdown.">
                  <button
                    type="button"
                    onClick={copyBrief}
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Copy
                  </button>
                </Tooltip>
                <Tooltip text="Download the campaign brief as a markdown file.">
                  <button
                    type="button"
                    onClick={downloadBrief}
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Download
                  </button>
                </Tooltip>
                {deleteConfirm ? (
                  <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    Delete?
                    <button type="button" onClick={() => handleDelete(id)} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                    <button type="button" onClick={() => setDeleteConfirm(false)} className="transition-opacity hover:opacity-70">No</button>
                  </span>
                ) : (
                  <Tooltip text="Delete this audit.">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(true)}
                      className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Delete
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>

            {indexability && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { key: 'indexable', label: 'Indexable', value: indexability.indexable, color: '#166534', tip: 'Crawled pages that returned 200 and are not noindex.' },
                  { key: 'noindexed', label: 'Noindexed', value: indexability.noindexed, color: '#b45309', tip: 'Crawled pages with noindex in meta robots or the X-Robots-Tag header.' },
                  { key: 'blockedByRobots', label: 'Blocked by robots', value: indexability.blockedByRobots, color: '#b45309', tip: 'Sitemap URLs robots.txt disallows. Robots-blocked URLs are skipped before fetch, so this is derived from the sitemap, not from pages actually crawled.' },
                  { key: 'error', label: 'Error', value: indexability.error, color: '#ef4444', tip: 'Crawled URLs that returned 4xx/5xx or could not be fetched.' },
                ].map((s) => (
                  <Tooltip key={s.key} text={s.tip}>
                    <div
                      className="rounded-xl border p-3 text-center"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                    >
                      <p className="text-lg font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
                    </div>
                  </Tooltip>
                ))}
              </div>
            )}

            {globalUpdates.length > 0 && (
              <div
                className="rounded-2xl border p-6 space-y-4"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <div>
                  <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Site-wide updates</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    Fix these once in the theme, SEO plugin, or hosting. They cover the crawled pages instead of editing URLs one by one.
                  </p>
                </div>
                <ul className="space-y-3">
                  {globalUpdates.map((u) => (
                    <li
                      key={u.id}
                      className="rounded-xl border p-4 space-y-1"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: severityColor(u.severity) }}>
                          {severityLabel(u.severity)}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                          {u.applyIn}
                        </span>
                        {u.pagesAffected > 0 && u.totalPages > 0 ? (
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            {u.pagesAffected} of {u.totalPages} page{u.totalPages === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{u.action}</p>
                      {u.why ? (
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{u.why}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
                      <Tooltip text={open ? 'Collapse this page\'s checks and recommendations.' : 'Expand to see this page\'s checks and recommendations.'}>
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
                              {p.depth != null ? ` · depth ${p.depth}` : ''}
                              {p.titleChars ? ` · title ${p.titleChars} ch` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: p.score >= 80 ? '#166534' : p.score >= 55 ? '#b45309' : '#ef4444' }}>
                            {p.score}
                          </span>
                        </button>
                      </Tooltip>
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

            {notCovered.length > 0 && (
              <div
                className="rounded-2xl border p-4 space-y-2"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Not in this audit</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  Use HTML for Lighthouse (speed, CWV, contrast). Use Adwords for paid keywords. This crawl does not track rankings or backlinks.
                </p>
                <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-muted)' }}>
                  {notCovered.map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </main>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
