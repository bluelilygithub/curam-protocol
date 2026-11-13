import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { formatRunDate } from '../utils/seoCampaignBrief';
import Tooltip from '../components/Tooltip';
import Dialog from '../components/Dialog';
import AiVisibilityTutorChat from './aiVisibility/AiVisibilityTutorChat';
import { GUIDE_TOOLS } from './aiVisibility/aiVisibilityTools.mjs';

const TOOL_HELP = {
  title: 'AI Visibility',
  description: 'Audits a public page for the way AI assistants find, read and quote it — not for Google rankings.',
  features: [
    'robots.txt read properly, per AI crawler: GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and the rest, with the exact rule that decides each one',
    'Readability without JavaScript: the raw HTML compared with the same page rendered in a real browser, so a JavaScript-only offer is visible as a finding',
    'JSON-LD checked entity by entity (Organization, LocalBusiness, Product, FAQPage, Article…), including the properties an answer engine needs',
    'Search ranking: each buyer question is searched live and the site\'s position in the top 10 is recorded',
    'Real AI assistants: each question is put to Claude (web search), Gemini (Google Search) and Perplexity where connected; each searches for itself, and the report says whether it named the business and whether it used the site as a source',
    'Key-fact accuracy: the numbers and distinctive terms you supply (with units) are checked against the assistants\' answers',
    'Runs in the background: you can leave the page and come back',
    'Copy the full report as Markdown, or download it as a PDF',
  ],
};

function HelpModal({ onClose }) {
  return (
    <Dialog raw onClose={onClose}
      overlayClassName="fixed inset-0 flex items-center justify-center z-50"
      overlayStyle={{ background: 'rgba(0,0,0,0.4)' }}
      panelClassName="rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
      panelStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
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
    </Dialog>
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

const SCORE_AREAS = [
  { key: 'technical', label: 'Technical access', tip: 'HTTP status, indexability, titles/description/language and robots.txt blocks.' },
  { key: 'readability', label: 'No-JS readability', tip: 'How much of the page an AI crawler sees without running JavaScript.' },
  { key: 'schema', label: 'Structured data', tip: 'JSON-LD entities and the properties answer engines need.' },
  { key: 'discoverability', label: 'Search ranking', tip: 'Where the site ranks in a live web search for each question (top 10).' },
  { key: 'assistants', label: 'Named by AI assistants', tip: 'How often real AI assistants named the business and used the site as a source.' },
  { key: 'accuracy', label: 'Key-fact accuracy', tip: 'Whether the assistants\' answers state the facts you supplied.' },
];

// Audits saved before 2026-11-13 (report version 1) had one simulated "citation" area.
const LEGACY_SCORE_AREAS = [
  ...SCORE_AREAS.slice(0, 3),
  { key: 'citation', label: 'Citation in answers', tip: 'Earlier version: a model answered from the top five search results only.' },
  SCORE_AREAS[5],
];

const POLL_MS = 3000;

function YesNo({ ok, label, extra }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full border"
      style={{ borderColor: 'var(--color-border)', color: ok ? '#166534' : '#b45309', background: 'var(--color-surface)' }}
    >
      {label}: {ok ? 'yes' : 'no'}{extra ? ` (${extra})` : ''}
    </span>
  );
}

// One buyer question in a version 2 report: the ranking search, then each assistant.
function QuestionResult({ q, index }) {
  const search = q.search || {};
  return (
    <li className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{index + 1}. {q.query}</p>
        <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {q.source === 'generated' ? 'generated from the page' : q.source === 'template' ? 'template question' : 'supplied'}
        </span>
      </div>

      {search.error ? (
        <p className="text-xs" style={{ color: '#b45309' }}>Search ranking not measured: {search.error}</p>
      ) : (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Search ranking ({search.provider || 'search'}, top {(search.results || []).length}):{' '}
          <span style={{ color: q.rank ? '#166534' : '#b45309' }}>{q.rank ? `position ${q.rank}` : 'not in these results'}</span>
        </p>
      )}

      <div className="grid xl:grid-cols-2 gap-3" data-guide={index === 0 ? 'citation' : undefined}>
        {(q.assistants || []).map((a) => (
          <div key={a.id} className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
              {a.label}{a.model ? <span style={{ color: 'var(--color-muted)' }}> · {a.model}</span> : null}
            </p>
            {a.score == null ? (
              <p className="text-xs" style={{ color: '#b45309' }}>Could not answer: {String(a.error || 'no answer').replace(/[.\s]+$/, '')}. Left out of the score.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <YesNo ok={a.named} label="Named the business" extra={a.named ? a.namedAs : ''} />
                  <YesNo ok={a.cited} label="Used the site as a source" />
                </div>
                {(a.facts || []).length > 0 && (
                  <ul className="space-y-0.5 text-[11px]">
                    {a.facts.map((f, fi) => (
                      <li key={`${f.statement}-${fi}`} style={{ color: f.present ? '#166534' : '#b45309' }}>
                        {f.present ? 'Present' : 'Missing'}: {f.statement}
                      </li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary className="text-[11px] cursor-pointer select-none" style={{ color: 'var(--color-muted)' }}>
                    Answer and {(a.sources || []).length} source{(a.sources || []).length === 1 ? '' : 's'}
                  </summary>
                  <blockquote className="mt-2 text-xs leading-relaxed whitespace-pre-wrap border-l-2 pl-3" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}>
                    {a.answer}
                  </blockquote>
                  {(a.sources || []).length > 0 && (
                    <ul className="mt-2 space-y-1 text-[11px]">
                      {a.sources.map((s) => (
                        <li key={s.url || s.title} className="truncate">
                          <a href={s.url} target="_blank" rel="noreferrer" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
                            {s.title || s.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </>
            )}
          </div>
        ))}
        {(q.assistants || []).length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No AI assistants were asked.</p>
        )}
      </div>

      {(search.results || []).length > 0 && (
        <details>
          <summary className="text-[11px] cursor-pointer select-none" style={{ color: 'var(--color-muted)' }}>
            Top search results
          </summary>
          <ol className="mt-1 space-y-1 text-[11px] list-decimal pl-5">
            {search.results.map((r) => (
              <li key={r.url} className="truncate">
                <a href={r.url} target="_blank" rel="noreferrer" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
                  {r.title || r.url}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); }
}

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

function severityColor(sev) {
  if (sev === 'fail') return '#ef4444';
  if (sev === 'warn') return '#b45309';
  if (sev === 'pass') return '#166534';
  return 'var(--color-muted)';
}

function severityLabel(sev) {
  if (sev === 'fail') return 'Fix';
  if (sev === 'warn') return 'Improve';
  if (sev === 'pass') return 'Pass';
  return 'Consider';
}

function scoreColor(score) {
  if (score == null) return 'var(--color-muted)';
  return score >= 80 ? '#166534' : score >= 55 ? '#b45309' : '#ef4444';
}

function Card({ title, subtitle, children }) {
  return (
    <section
      className="rounded-2xl border p-5 space-y-3"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
        {subtitle ? <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function isTextModel(entry) {
  const provider = String(entry?.provider || '').toLowerCase();
  const id = String(entry?.id || '').toLowerCase();
  if (['fal', 'replicate', 'search', 'image', 'video'].includes(provider)) return false;
  if (/^fal-ai\//.test(id) || /^fal\//.test(id)) return false;
  if (/minimax\/|hailuo|video-01|image-to-video|\/flux/.test(id)) return false;
  return !!id;
}

export default function AiVisibilityPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.aiVisibility !== false;

  const [audits, setAudits] = useState([]);
  const [audit, setAudit] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem('vault:aiVisibilityListSort');
      if (SORT_OPTIONS.some((o) => o.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'newest';
  });

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [modelId, setModelId] = useState('');
  const [queriesText, setQueriesText] = useState('');
  const [factsText, setFactsText] = useState('');
  const [models, setModels] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [assistantOptions, setAssistantOptions] = useState([]);
  const [chosenAssistants, setChosenAssistants] = useState([]);
  const [starting, setStarting] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const loadList = useCallback(async () => {
    const res = await api.get('/api/ai-visibility/audits');
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
    if (!canUse) return;
    api.get('/api/settings/effective-models')
      .then((r) => r.json())
      .then((d) => {
        const list = (Array.isArray(d?.models) ? d.models : []).filter(isTextModel);
        setModels(list);
        setDefaultModel(String(d?.defaultModel || ''));
      })
      .catch(() => {});
  }, [canUse]);

  useEffect(() => {
    if (!canUse) return;
    api.get('/api/ai-visibility/assistants')
      .then((r) => r.json())
      .then((list) => {
        const rows = Array.isArray(list) ? list : [];
        setAssistantOptions(rows);
        setChosenAssistants(rows.filter((a) => a.available).map((a) => a.id));
      })
      .catch(() => {});
  }, [canUse]);

  // Load the open audit; while it is running, poll until it is done or failed.
  useEffect(() => {
    if (!canUse || !id) {
      setAudit(null);
      return undefined;
    }
    let cancelled = false;
    let timer = null;
    let misses = 0;
    let wasRunning = false;
    const load = () => {
      api.get(`/api/ai-visibility/audits/${id}`)
        .then(async (res) => {
          const data = await res.json();
          if (res.status === 404) throw Object.assign(new Error(data.error || 'Not found'), { fatal: true });
          if (!res.ok) throw new Error(data.error || 'Could not load the audit');
          if (cancelled) return;
          misses = 0;
          setAudit(data);
          if (data.status === 'running') {
            wasRunning = true;
            timer = setTimeout(load, POLL_MS);
          } else if (wasRunning) {
            loadList().catch(() => {});
            if (data.status === 'done') addToast(`Audit finished: ${data.score}/100`, 'success');
            else addToast('The audit failed. The reason is shown on the page.', 'error');
          }
        })
        .catch((err) => {
          if (cancelled) return;
          if (err.fatal) {
            addToast(err.message, 'error');
            navigate('/ai-visibility');
            return;
          }
          // A missed check while running is not fatal: try again a few times.
          misses += 1;
          if (wasRunning && misses < 10) timer = setTimeout(load, POLL_MS * 2);
          else addToast(err.message, 'error');
        });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [canUse, id, addToast, navigate, loadList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? audits.filter((a) => `${a.name} ${a.url} ${a.hostname || ''}`.toLowerCase().includes(q))
      : audits;
    return sortAudits(rows, sort);
  }, [audits, search, sort]);

  // Starts the audit on the server and opens it; the report page shows progress while it runs.
  const startAudit = async (body) => {
    setStarting(true);
    try {
      const res = await api.post('/api/ai-visibility/audits', body);
      const data = await res.json();
      if (res.status === 409 && data.auditId) {
        addToast(data.error, 'info');
        navigate(`/ai-visibility/${data.auditId}`);
        return false;
      }
      if (!res.ok) throw new Error(data.error || 'Could not start the audit');
      await loadList().catch(() => {});
      navigate(`/ai-visibility/${data.id}`);
      return true;
    } catch (err) {
      addToast(err.message, 'error');
      return false;
    } finally {
      setStarting(false);
    }
  };

  const handleCreate = async () => {
    if (!url.trim()) {
      addToast('Paste a website URL', 'error');
      return;
    }
    const ok = await startAudit({
      url: url.trim(),
      name: name.trim() || undefined,
      brand: brand.trim() || undefined,
      modelId: modelId || undefined,
      queries: queriesText,
      facts: factsText,
      assistants: chosenAssistants,
    });
    if (ok) {
      setUrl('');
      setName('');
      setBrand('');
      setQueriesText('');
      setFactsText('');
    }
  };

  const runAgain = () => {
    const input = audit?.report?.input;
    if (!input?.url) {
      navigate('/ai-visibility');
      return;
    }
    startAudit({ ...input, url: input.url });
  };

  const toggleAssistant = (aid) => {
    setChosenAssistants((prev) => (prev.includes(aid) ? prev.filter((x) => x !== aid) : [...prev, aid]));
  };

  const handleDelete = async (auditId) => {
    const target = Number(auditId);
    if (!target) return;
    try {
      const res = await api.delete(`/api/ai-visibility/audits/${target}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setDeleteConfirm(false);
      setPendingDeleteId(null);
      await loadList();
      addToast('Audit deleted', 'success');
      if (String(id) === String(target)) navigate('/ai-visibility');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const copyMarkdown = async () => {
    try {
      const res = await api.get(`/api/ai-visibility/audits/${id}/markdown`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not build the report');
      await navigator.clipboard.writeText(data.markdown || '');
      addToast('Report copied as Markdown', 'success');
    } catch (err) {
      addToast(err.message || 'Could not copy', 'error');
    }
  };

  const downloadPdf = async () => {
    try {
      await api.download(`/api/ai-visibility/audits/${id}/pdf`, `${hostOf(audit?.url)}-ai-visibility.pdf`);
      addToast('PDF downloaded', 'success');
    } catch (err) {
      addToast(err.message || 'Could not download', 'error');
    }
  };

  const report = audit?.report || {};
  const scores = report.scores || {};
  const technical = report.technical || {};
  const meta = technical.meta || {};
  const robots = technical.robots || {};
  const js = technical.js || null;
  const schema = report.schema || null;
  const queries = report.queries || [];
  const facts = report.facts || [];
  const suggestions = report.suggestions || [];
  const score = audit ? Number(audit.score) : null;
  const isV2 = Number(report.version) >= 2;
  const scoreAreas = isV2 ? SCORE_AREAS : LEGACY_SCORE_AREAS;
  const status = audit?.status || 'done';

  // The guide's Open buttons: go to the right screen, then scroll to the part marked data-guide="<id>".
  const openToolById = (guideId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === guideId);
    if (!target) return;
    if (target.tool === 'new-audit') {
      if (id) navigate('/ai-visibility');
    } else if (target.tool !== 'saved-audits' && !id) {
      addToast('Open a saved audit from the list on the left first (or run a new audit).', 'info');
      return;
    }
    setTimeout(() => {
      const el = document.querySelector(`[data-guide="${guideId}"]`)
        || document.querySelector(`[data-guide="${target.tool}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('radar', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold flex-1" style={{ color: 'var(--color-text)' }}>AI Visibility</h1>
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
              try { localStorage.setItem('vault:aiVisibilityListSort', next); } catch { /* ignore */ }
            }}
            className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
            style={FIELD}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>Sort: {o.label}</option>
            ))}
          </select>
        </Tooltip>

        <Tooltip text="Start a new AI visibility audit.">
          <button
            type="button"
            onClick={() => navigate('/ai-visibility')}
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

        <ul className="space-y-0.5" data-guide="saved-audits">
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
                      onClick={() => navigate(`/ai-visibility/${a.id}`)}
                      className="min-w-0 flex-1 text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                      style={{
                        background: String(id) === String(a.id) ? 'var(--color-bg)' : 'transparent',
                        color: String(id) === String(a.id) ? 'var(--color-text)' : 'var(--color-muted)',
                      }}
                    >
                      <span className="block truncate">{a.name}</span>
                      <span className="block truncate" style={{ color: 'var(--color-muted)' }}>
                        {[
                          a.status === 'running' ? 'running…' : a.status === 'failed' ? 'failed' : (a.score != null ? String(a.score) : null),
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

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-[1700px]">
        {id && !audit && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading audit…</p>
        )}

        {!id && (
          <section className="space-y-4" data-guide="new-audit">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New AI visibility audit</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Checks whether an AI assistant can reach, read and quote this page. Speed is in <span className="font-medium" style={{ color: 'var(--color-text)' }}>Page speed</span>; organic Google search is in <span className="font-medium" style={{ color: 'var(--color-text)' }}>SEO</span>.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Page URL</span>
              <Tooltip text="The public page to audit, usually the homepage or a key product/service page.">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.example.com.au"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={FIELD}
                />
              </Tooltip>
            </label>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Name (optional)</span>
                <Tooltip text="Label for this audit in the list. Defaults to the page title.">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Defaults to the page title"
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                    style={FIELD}
                  />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Brand (optional)</span>
                <Tooltip text="How customers name the business. Used to check whether an AI assistant's answer names it. Short forms and the web address are checked too.">
                  <input
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Defaults to the title, or the web address"
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                    style={FIELD}
                  />
                </Tooltip>
              </label>
            </div>

            <fieldset className="space-y-1" data-guide="assistants">
              <legend className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>AI assistants to ask</legend>
              <div className="flex flex-wrap gap-2">
                {assistantOptions.map((a) => (
                  <Tooltip key={a.id} text={a.available ? `Put each question to ${a.label}${a.model ? ` (${a.model})` : ''}. It searches the web itself, like a real user's assistant.` : a.reason}>
                    <label
                      className="flex items-center gap-2 px-3 py-2 rounded-xl border text-sm"
                      style={{ ...FIELD, opacity: a.available ? 1 : 0.55, cursor: a.available ? 'pointer' : 'not-allowed' }}
                    >
                      <input
                        type="checkbox"
                        disabled={!a.available}
                        checked={a.available && chosenAssistants.includes(a.id)}
                        onChange={() => toggleAssistant(a.id)}
                      />
                      <span>{a.label}</span>
                      {a.model ? <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{a.model}</span> : null}
                    </label>
                  </Tooltip>
                ))}
              </div>
              <span className="block text-[11px]" style={{ color: 'var(--color-muted)' }}>
                {assistantOptions.some((a) => !a.available)
                  ? `Not connected: ${assistantOptions.filter((a) => !a.available).map((a) => `${a.label.split(' ')[0]} (${a.reason})`).join(' ')}`
                  : 'Each ticked assistant answers every question with its own web search.'}
              </span>
            </fieldset>

            <label className="block space-y-1" data-guide="model">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Model that writes the questions</span>
              <Tooltip text="Used only to write buyer questions from the page when you leave the questions box blank. The workspace default is used if left blank.">
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={FIELD}
                >
                  <option value="">Workspace default{defaultModel ? ` (${defaultModel})` : ''}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}{m.provider ? ` · ${m.provider}` : ''}</option>
                  ))}
                </select>
              </Tooltip>
              {models.length === 0 && (
                <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  No connected text model was found in Settings → Models. Questions will be made from simple templates; write your own below for a better result.
                </span>
              )}
            </label>

            <label className="block space-y-1" data-guide="buyer-questions">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Buyer questions (optional)</span>
              <Tooltip text="One realistic question per line, up to 6. Leave blank to generate four from the page title, description and headings.">
                <textarea
                  value={queriesText}
                  onChange={(e) => setQueriesText(e.target.value)}
                  rows={4}
                  placeholder={'e.g. best temperature-controlled wine fridge for a home cellar\nwho sells cellar cooling units in Australia'}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                  style={FIELD}
                />
              </Tooltip>
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>One per line, up to 6. Blank = four generated from the page.</span>
            </label>

            <label className="block space-y-1" data-guide="facts-input">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Key facts to check (optional)</span>
              <Tooltip text="Facts an answer should state accurately. Include units, because the check compares numbers with their units.">
                <textarea
                  value={factsText}
                  onChange={(e) => setFactsText(e.target.value)}
                  rows={4}
                  placeholder={'e.g. ±0.5°C temperature stability\n10A standard plug\n6–9 week lead time'}
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                  style={FIELD}
                />
              </Tooltip>
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>One per line, up to 12. Include units (numbers are matched with them).</span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Tooltip text="Fetch the page, run the technical checks, then search each question and put it to the ticked AI assistants. Runs in the background.">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={starting}
                  data-guide="run-audit"
                  className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-50"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
                >
                  {starting ? 'Starting…' : 'Run audit'}
                </button>
              </Tooltip>
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                Takes one to four minutes and runs in the background, so you can leave this page. Each question uses one search plus one paid call per ticked assistant.
              </span>
            </div>
          </section>
        )}

        {id && audit && status !== 'done' && (
          <section className="space-y-4" data-guide="scores">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{audit.name}</h2>
              <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>{audit.url}</p>
            </div>
            {status === 'running' ? (
              <div className="rounded-2xl border p-5 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} role="status" aria-live="polite">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-4 h-4 rounded-full border-2 animate-spin motion-reduce:animate-none" style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Audit running</p>
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{audit.progress || 'Working…'}</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  This usually takes one to four minutes. It runs on the server, so you can leave this page and come back: the report opens here when it is ready.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-sm font-medium" style={{ color: '#ef4444' }}>The audit did not finish</p>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{audit.error || 'Unknown error.'}</p>
                <div className="flex flex-wrap gap-2">
                  <Tooltip text="Start the same audit again with the same address, questions, facts and assistants.">
                    <button
                      type="button"
                      onClick={runAgain}
                      disabled={starting}
                      className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-50"
                      style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
                    >
                      Run again
                    </button>
                  </Tooltip>
                  {deleteConfirm ? (
                    <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                      Delete?
                      <button type="button" onClick={() => handleDelete(id)} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                      <button type="button" onClick={() => setDeleteConfirm(false)} className="transition-opacity hover:opacity-70">No</button>
                    </span>
                  ) : (
                    <Tooltip text="Delete this failed audit.">
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
            )}
          </section>
        )}

        {id && audit && status === 'done' && (
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
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{audit.summary}</p>
              </div>
              <div className="flex items-center gap-3">
                <Tooltip text="Weighted overall score across the areas that could be measured.">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-semibold tabular-nums"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: scoreColor(score) }}
                  >
                    {score}
                  </div>
                </Tooltip>
                <Tooltip text="Copy the full report as Markdown.">
                  <button
                    type="button"
                    onClick={copyMarkdown}
                    data-guide="copy"
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Copy for AI
                  </button>
                </Tooltip>
                <Tooltip text="Download the full report as a PDF.">
                  <button
                    type="button"
                    onClick={downloadPdf}
                    data-guide="pdf"
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Download PDF
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

            <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${isV2 ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`} data-guide="scores">
              {scoreAreas.map((area) => {
                const value = scores[area.key];
                return (
                  <Tooltip key={area.key} text={area.tip}>
                    <div
                      className="rounded-xl border p-3 text-center"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                    >
                      <p className="text-lg font-semibold tabular-nums" style={{ color: scoreColor(value) }}>
                        {value == null ? '—' : value}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{area.label}</p>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed" data-guide="score-areas" style={{ color: 'var(--color-muted)' }}>
              {(scores.measured || []).length
                ? `Measured: ${(scores.measured || []).map((k) => scoreAreas.find((a) => a.key === k)?.label || k).join(', ')}. Areas that could not be measured are left out of the overall score rather than scored zero.`
                : 'No area could be measured.'}
            </p>

            {suggestions.length > 0 && (
              <div data-guide="suggestions">
              <Card
                title="Suggestions"
                subtitle="Ordered by severity: fixes first, then improvements, then optional ideas."
              >
                <ul className="space-y-3">
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.area}-${s.title}-${i}`}
                      className="rounded-xl border p-4 space-y-1"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: severityColor(s.severity) }}>
                          {severityLabel(s.severity)}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                          {s.area}
                        </span>
                      </div>
                      <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--color-text)' }}>{s.title}</p>
                      {s.detail ? <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{s.detail}</p> : null}
                      {s.recommendation ? (
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
                          <span className="font-medium">What to do:</span> {s.recommendation}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
              </div>
            )}

            <div data-guide="technical">
            <Card
              title="Technical access"
              subtitle="What a crawler gets before any JavaScript runs, and which AI crawlers robots.txt allows."
            >
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {[
                  ['HTTP status', technical.http?.status || '—'],
                  ['Final URL', technical.http?.finalUrl || audit.url],
                  ['Title', meta.title || 'missing'],
                  ['Meta description', meta.description || 'missing'],
                  ['Robots meta', meta.robots || 'none'],
                  ['Language', meta.lang || 'missing'],
                  ['Canonical', meta.canonical || 'none'],
                  ['robots.txt', robots.found
                    ? `${robots.statusCode || 200} · ${robots.url}`
                    : !robots.statusCode && robots.error
                      ? `could not be read (${robots.error}); the crawler table assumes no rules`
                      : `not found${robots.statusCode ? ` (HTTP ${robots.statusCode})` : ''}`],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</dt>
                    <dd className="break-words" style={{ color: 'var(--color-text)' }}>{String(value)}</dd>
                  </div>
                ))}
              </dl>

              <div className="overflow-x-auto pt-1" data-guide="robots">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{ color: 'var(--color-muted)' }}>
                      <th className="text-left font-medium py-1.5 pr-3">Crawler</th>
                      <th className="text-left font-medium py-1.5 pr-3">Verdict</th>
                      <th className="text-left font-medium py-1.5 pr-3">Rule</th>
                      <th className="text-left font-medium py-1.5">What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(robots.bots || []).map((bot) => (
                      <tr key={bot.bot} className="align-top border-t" style={{ borderColor: 'var(--color-border)' }}>
                        <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{bot.bot}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap font-medium" style={{ color: bot.allowed ? '#166534' : '#ef4444' }}>
                          {bot.allowed ? 'Allowed' : 'Blocked'}
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{bot.rule || '—'}</td>
                        <td className="py-1.5" style={{ color: 'var(--color-muted)' }}>{bot.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Google-Extended controls Gemini/Vertex training, not Google Search. Blocking GPTBot does not remove a page from Google search results.
                {(robots.sitemaps || []).length ? ` Sitemaps in robots.txt: ${robots.sitemaps.join(', ')}.` : ''}
              </p>
            </Card>
            </div>

            <div data-guide="readability">
            <Card
              title="Readability without JavaScript"
              subtitle="The same page fetched as a crawler (raw HTML) and rendered in a real browser, compared word for word."
            >
              {!js ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Not measured.</p>
              ) : js.renderError ? (
                <div className="space-y-1 text-xs">
                  <p style={{ color: 'var(--color-text)' }}>The JavaScript-rendered version could not be read: {js.renderError}</p>
                  <p style={{ color: 'var(--color-muted)' }}>Raw HTML: {js.raw?.words || 0} words, {js.raw?.headings || 0} headings.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Raw HTML', value: js.raw?.words || 0, tip: 'Words in the HTML a crawler receives without running scripts.' },
                      { label: 'Rendered', value: js.rendered?.words || 0, tip: 'Words after the page has run its JavaScript in Chromium.' },
                      { label: 'Readable without JS', value: `${Math.round((js.ratio || 0) * 100)}%`, tip: 'Raw HTML words as a share of the rendered page.' },
                    ].map((s) => (
                      <Tooltip key={s.label} text={s.tip}>
                        <div
                          className="rounded-xl border p-3 text-center"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                        >
                          <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{s.value}</p>
                          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    {js.ratio >= 0.85
                      ? 'The page is readable without JavaScript: an AI crawler that does not run scripts still sees the offer.'
                      : js.ratio >= 0.6
                        ? 'Most of the page is in the HTML, but some content is added by JavaScript. Move the offer, prices and specifications into the initial HTML.'
                        : 'Most of the page only exists after JavaScript runs. A crawler that does not run scripts sees little or none of the offer.'}
                  </p>
                </div>
              )}
            </Card>
            </div>

            <div data-guide="schema">
            <Card
              title="Structured data"
              subtitle="JSON-LD entities checked one by one against the properties an answer engine needs."
            >
              {!schema ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Not measured.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs" style={{ color: 'var(--color-text)' }}>
                    {schema.blockCount} JSON-LD block{schema.blockCount === 1 ? '' : 's'} found.
                    {' '}Types: {schema.types.length ? schema.types.join(', ') : 'none'}.
                  </p>
                  {(schema.errors || []).length > 0 && (
                    <ul className="space-y-1 text-xs" style={{ color: '#ef4444' }}>
                      {schema.errors.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                  )}
                  {(schema.entities || []).length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr style={{ color: 'var(--color-muted)' }}>
                            <th className="text-left font-medium py-1.5 pr-3">Entity</th>
                            <th className="text-left font-medium py-1.5 pr-3">Required</th>
                            <th className="text-left font-medium py-1.5">Useful properties missing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {schema.entities.map((e, i) => (
                            <tr key={`${e.label}-${i}`} className="align-top border-t" style={{ borderColor: 'var(--color-border)' }}>
                              <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                                {e.label}{Number(e.count) > 1 ? <span style={{ color: 'var(--color-muted)' }}> ×{e.count}</span> : null}
                              </td>
                              <td className="py-1.5 pr-3" style={{ color: e.missingRequired?.length ? '#ef4444' : e.addressChoice ? '#b45309' : 'var(--color-muted)' }}>
                                {!e.checked
                                  ? 'Not checked'
                                  : [
                                    e.missingRequired?.length ? `Missing: ${e.missingRequired.join(', ')}` : null,
                                    e.addressChoice ? 'No address or area served' : null,
                                  ].filter(Boolean).join('; ') || (e.serviceArea ? 'Complete (area served, no street address)' : 'Complete')}
                              </td>
                              <td className="py-1.5" style={{ color: 'var(--color-muted)' }}>
                                {e.missingRecommended?.length ? e.missingRecommended.join(', ') : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(schema.findings || []).map((f, i) => (
                    <p key={`${f.title}-${i}`} className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                      <span className="font-semibold" style={{ color: severityColor(f.severity) }}>{severityLabel(f.severity)}</span>
                      {' '}{f.title} — {f.detail} <span style={{ color: 'var(--color-text)' }}>{f.recommendation}</span>
                    </p>
                  ))}
                </div>
              )}
            </Card>
            </div>

            <div data-guide="questions">
            {isV2 ? (
              <Card
                title="Buyer questions and AI assistants"
                subtitle="Each question is searched once for ranking, then put to real AI assistants that search the web themselves. For each assistant: did it name the business, and did it use the site as a source? Answers vary between runs, so treat this as a sample."
              >
                {queries.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No questions were run.</p>
                ) : (
                  <ul className="space-y-4">
                    {queries.map((q, i) => <QuestionResult key={`${q.query}-${i}`} q={q} index={i} />)}
                  </ul>
                )}
              </Card>
            ) : (
            <Card
              title="Simulated questions (earlier version)"
              subtitle="This audit was run with the earlier version: a model answered each question from the top five search results only. Run the audit again for checks against real AI assistants."
            >
              {queries.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No questions were run.</p>
              ) : (
                <ul className="space-y-4">
                  {queries.map((q, i) => (
                    <li
                      key={`${q.query}-${i}`}
                      className="rounded-xl border p-4 space-y-2"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{i + 1}. {q.query}</p>
                        <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                          {q.source === 'generated' ? 'generated from the page' : 'supplied'}{q.model ? ` · ${q.model}` : ''}
                        </span>
                      </div>

                      {q.search?.error ? (
                        <p className="text-xs" style={{ color: '#b45309' }}>Search unavailable: {q.search.error}</p>
                      ) : (
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          Search ({q.search?.provider || 'provider'}): {q.search?.results?.length || 0} result{(q.search?.results?.length || 0) === 1 ? '' : 's'}.
                          {q.citation?.inSearchResults
                            ? ` Site found at position ${q.citation.domainRank}.`
                            : q.search?.results?.length ? ' Site did not appear in those results.' : ''}
                        </p>
                      )}

                      {q.citation && (
                        <div className="flex flex-wrap gap-2 text-[11px]" data-guide={i === 0 ? 'citation' : undefined}>
                          {[
                            { label: 'Named in answer', ok: q.citation.mentioned, extra: q.citation.brandMentioned ? 'brand' : q.citation.domainMentioned ? 'domain' : '' },
                            { label: 'Linked in answer', ok: q.citation.citedInAnswer, extra: (q.citation.urlsCited || []).join(', ') },
                          ].map((row) => (
                            <span
                              key={row.label}
                              className="px-2 py-0.5 rounded-full border"
                              style={{
                                borderColor: 'var(--color-border)',
                                color: row.ok ? '#166534' : '#b45309',
                                background: 'var(--color-surface)',
                              }}
                            >
                              {row.label}: {row.ok ? 'yes' : 'no'}{row.extra ? ` (${row.extra})` : ''}
                            </span>
                          ))}
                          <span className="px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                            Citation score: {q.citation.score}/100
                          </span>
                        </div>
                      )}

                      {(q.facts || []).length > 0 && (
                        <ul className="space-y-0.5 text-[11px]">
                          {q.facts.map((f, fi) => (
                            <li key={`${f.statement}-${fi}`} style={{ color: f.present ? '#166534' : '#b45309' }}>
                              {f.present ? 'Present' : 'Missing'}: {f.statement}
                              {f.present ? ` (${Math.round((f.confidence || 0) * 100)}% match)` : ''}
                            </li>
                          ))}
                        </ul>
                      )}

                      {q.answer ? (
                        <blockquote
                          className="text-xs leading-relaxed whitespace-pre-wrap border-l-2 pl-3"
                          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}
                        >
                          {q.answer}
                        </blockquote>
                      ) : q.error ? (
                        <p className="text-xs" style={{ color: '#b45309' }}>{q.error}</p>
                      ) : null}

                      {(q.search?.results || []).length > 0 && (
                        <details>
                          <summary className="text-[11px] cursor-pointer select-none" style={{ color: 'var(--color-muted)' }}>
                            Results given to the model
                          </summary>
                          <ul className="mt-1 space-y-1 text-[11px]">
                            {q.search.results.map((r) => (
                              <li key={r.url} className="truncate">
                                <a href={r.url} target="_blank" rel="noreferrer" className="hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                                  {r.title || r.url}
                                </a>
                                {r.snippet ? <span style={{ color: 'var(--color-muted)' }}> — {r.snippet}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            )}
            </div>

            <div data-guide="facts">
            {facts.length > 0 && (
              <Card
                title={isV2 ? "Key facts across the assistants' answers" : 'Key facts across all answers'}
                subtitle="Fact matching is a heuristic: numbers (with their units) and distinctive words, not meaning. Use it to re-read the answer, not as proof."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr style={{ color: 'var(--color-muted)' }}>
                        <th className="text-left font-medium py-1.5 pr-3">Fact</th>
                        <th className="text-left font-medium py-1.5 pr-3">Present</th>
                        <th className="text-left font-medium py-1.5">Answers containing it</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facts.map((f, i) => (
                        <tr key={`${f.statement}-${i}`} className="align-top border-t" style={{ borderColor: 'var(--color-border)' }}>
                          <td className="py-1.5 pr-3" style={{ color: 'var(--color-text)' }}>{f.statement}</td>
                          <td className="py-1.5 pr-3 font-medium" style={{ color: f.present ? '#166534' : '#b45309' }}>{f.present ? 'Yes' : 'No'}</td>
                          <td className="py-1.5" style={{ color: 'var(--color-muted)' }}>{f.answersFound || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
            </div>
          </section>
        )}
      </main>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <AiVisibilityTutorChat currentTool={id ? 'scores' : 'new-audit'} onOpenTool={openToolById} />
    </div>
  );
}
