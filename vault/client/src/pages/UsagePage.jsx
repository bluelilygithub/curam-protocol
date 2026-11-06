import React, { useEffect, useState, useCallback } from 'react';
import api from '../utils/apiClient';
import Tooltip from '../components/Tooltip';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useIcon } from '../providers/IconProvider';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import UsageTutorChat from './usage/UsageTutorChat';
import { HOW_IT_WORKS, GUIDE_TOOLS } from './usage/usageTools.mjs';

const PERIODS = [
  { id: 'today',   label: 'Today',    tip: 'Since midnight (Sydney time).' },
  { id: 'week',    label: 'Week',     tip: 'Since the start of this week.' },
  { id: 'month',   label: 'Month',    tip: 'Since the start of this month.' },
  { id: 'quarter', label: 'Quarter',  tip: 'Since the start of this quarter.' },
  { id: 'year',    label: 'Year',     tip: 'Since the start of this year.' },
  { id: 'custom',  label: 'Custom',   tip: 'Pick your own dates.' },
  { id: 'all',     label: 'All time', tip: 'Everything ever recorded.' },
];

const TABS = [
  { id: 'overview', label: 'Overview', tip: 'Where the money and tokens went.' },
  { id: 'advice',   label: 'Advice',   tip: 'Where a different model, or a different way of calling it, would cost less or work better.' },
];

const KIND = {
  save:    { label: 'Save money',    icon: 'coins',     tip: 'A cheaper model would do this job as well.' },
  quality: { label: 'Check quality', icon: 'brain',     tip: 'A light model is doing work you act on. Worth checking the answers are good enough.' },
  tune:    { label: 'Tune',          icon: 'cpu',       tip: 'The way this is called could be more efficient.' },
  note:    { label: 'Good to know',  icon: 'lightbulb', tip: 'Something worth knowing, nothing to fix.' },
};

function fmt(n) {
  return n == null ? '0' : Number(n).toLocaleString();
}

function fmtCost(n) {
  if (n == null || n === 0) return '$0.00';
  if (Math.abs(n) < 0.0001) return `$${Number(n).toFixed(6)}`;
  if (Math.abs(n) < 1) return `$${Number(n).toFixed(4)}`;
  return `$${Number(n).toFixed(2)}`;
}

function fmtShort(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(v);
}

function shortModel(id) {
  if (!id) return '—';
  return id
    .replace('claude-', '')
    .replace('gemini-', 'gemini/')
    .replace('-20251001', '')
    .replace('-20241022', '');
}

function featureLabel(feature) {
  if (!feature) return 'Other';
  return String(feature)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// the theme has one accent colour, so models are told apart by how strong it is (and by the dot beside the name)
const SHADES = [1, 0.72, 0.5, 0.36, 0.26, 0.18];
const shade = (i) => SHADES[Math.min(i, SHADES.length - 1)];

const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };

function Bar({ value, max, opacity = 1 }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="w-full rounded-full h-2" style={{ background: 'var(--color-border)' }}>
      <div className="h-2 rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: 'var(--color-primary)', opacity }} />
    </div>
  );
}

function Stat({ icon, label, value, sub, tip }) {
  const getIcon = useIcon();
  return (
    <Tooltip text={tip}>
      <div className="rounded-2xl border p-4 flex flex-col gap-1" style={CARD}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
          <span className="rounded-lg p-1.5" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>{getIcon(icon, { size: 16 })}</span>
        </div>
        <span className="text-2xl font-bold tracking-tight tabular-nums" style={{ color: 'var(--color-text)' }}>{value}</span>
        {sub ? <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{sub}</span> : null}
      </div>
    </Tooltip>
  );
}

export default function UsagePage() {
  const getIcon = useIcon();
  const [tab, setTab]             = useState('overview');
  const [period, setPeriod]       = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  const [summary, setSummary]     = useState(null);
  const [insights, setInsights]   = useState(null);
  const [log, setLog]             = useState([]);
  const [logTotal, setLogTotal]   = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [logLoading, setLogLoading] = useState(false);
  const [allFeatures, setAllFeatures] = useState(false);
  const [error, setError]         = useState(null);
  const info = useToolInfoModal('vault_usage_info_seen');

  const query = useCallback(() => {
    let q = `period=${period}`;
    if (period === 'custom' && customFrom && customTo) q += `&from=${customFrom}&to=${customTo}`;
    return q;
  }, [period, customFrom, customTo]);

  const fetchSummary = useCallback(async () => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    setLoading(true);
    setError(null);
    try {
      const [s, i] = await Promise.all([api.get(`/api/usage/summary?${query()}`), api.get(`/api/usage/insights?${query()}`)]);
      setSummary(await s.json());
      setInsights(i.ok ? await i.json() : null);
    } catch {
      setError('Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [query, period, customFrom, customTo]);

  const fetchLog = useCallback(async (p) => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    setLogLoading(true);
    try {
      const r = await api.get(`/api/usage/log?${query()}&page=${p}&limit=50`);
      const data = await r.json();
      setLog(data.logs || []);
      setLogTotal(data.total || 0);
    } catch {}
    setLogLoading(false);
  }, [query, period, customFrom, customTo]);

  useEffect(() => {
    setPage(1);
    setAllFeatures(false);
    fetchSummary();
  }, [period, customFrom, customTo]); // eslint-disable-line

  useEffect(() => {
    fetchLog(page);
  }, [page, period, customFrom, customTo]); // eslint-disable-line

  const byModel = summary?.byModel || [];
  const byFeature = summary?.byFeature || [];
  const modelCostTotal = byModel.reduce((n, m) => n + (m.cost || 0), 0) || 0.000001;
  const maxFeatureCost = Math.max(...byFeature.map(f => f.cost || 0), 0.000001);
  const shownFeatures = allFeatures ? byFeature : byFeature.slice(0, 8);
  const totalPages = Math.ceil(logTotal / 50);
  const obs = insights?.observations || [];
  const adviceCount = obs.filter(o => o.kind !== 'note').length;
  const potential = obs.reduce((n, o) => n + (o.kind === 'save' && o.saving > 0 ? o.saving : 0), 0);
  const avgCall = summary?.calls ? summary.cost / summary.calls : 0;

  // The guide's Open buttons: show the tab (and Custom dates when asked), then scroll to the part of the page.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (!target) return;
    setTab(target.tool);
    if (id === 'custom-dates') setPeriod('custom');
    setTimeout(() => {
      const el = document.querySelector('[data-guide="' + id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 hover:opacity-70';

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
      <div className="space-y-6 mx-auto w-full" style={{ maxWidth: '1700px' }}>

        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text)' }}>Usage &amp; Cost</h1>
              <Tooltip text="How Usage & Cost works, and what it cannot do.">
                <button
                  type="button"
                  onClick={info.open}
                  aria-label="How Usage and Cost works"
                  className="transition-opacity duration-200 hover:opacity-60"
                  style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  {getIcon('info', { size: 16 })}
                </button>
              </Tooltip>
            </div>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>Estimated AI spend across every feature, and where to spend less.</p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period" data-guide="period">
            {PERIODS.map(p => (
              <Tooltip key={p.id} text={p.tip}>
                <button
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  aria-pressed={period === p.id}
                  className={btn}
                  style={{
                    background:  period === p.id ? 'var(--color-primary)' : 'var(--color-surface)',
                    color:       period === p.id ? '#fff' : 'var(--color-muted)',
                    borderColor: period === p.id ? 'var(--color-primary)' : 'var(--color-border)',
                  }}
                >
                  {p.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-3 flex-wrap" data-guide="custom-dates">
            {[['From', customFrom, setCustomFrom, 'First day to include.'], ['To', customTo, setCustomTo, 'Last day to include.']].map(([label, value, set, tip]) => (
              <div key={label} className="flex items-center gap-2">
                <label className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</label>
                <Tooltip text={tip}>
                  <input
                    type="date"
                    value={value}
                    onChange={e => set(e.target.value)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }} role="tablist" data-guide="overview">
          {TABS.map(t => (
            <Tooltip key={t.id} text={t.tip}>
              <button
                type="button"
                role="tab"
                data-guide={t.id === 'advice' ? 'advice' : undefined}
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className="px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-all duration-200 hover:opacity-70 flex items-center gap-2"
                style={{ borderColor: tab === t.id ? 'var(--color-primary)' : 'transparent', color: tab === t.id ? 'var(--color-text)' : 'var(--color-muted)' }}
              >
                {t.label}
                {t.id === 'advice' && adviceCount > 0 ? (
                  <span className="rounded-full px-1.5 text-xs font-semibold" style={{ background: 'var(--color-primary)', color: '#fff' }}>{adviceCount}</span>
                ) : null}
              </button>
            </Tooltip>
          ))}
        </div>

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" label="Loading usage" />)}</div>
            <Skeleton className="h-48 rounded-2xl" label="Loading usage" />
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm" style={{ color: '#ef4444' }}>{error}</div>
        ) : summary && tab === 'overview' ? (
          <>
            {/* Headline numbers */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" data-guide="numbers">
              <Stat icon="coins" label="Estimated cost" value={fmtCost(summary.cost)} sub={summary.calls ? `${fmtCost(avgCall)} per call` : 'No calls yet'} tip="What the AI calls cost, worked out from token counts and published prices. Not an invoice." />
              <Stat icon="usage" label="Total tokens" value={fmtShort(summary.totalTokens)} sub={`${fmt(summary.totalTokens)} in all`} tip="Input plus output tokens. A token is about three quarters of a word." />
              <Stat icon="inbox" label="Input tokens" value={fmtShort(summary.inputTokens)} sub={`${fmtShort(summary.outputTokens)} written back`} tip="What was sent to the models. Output (the answers) is shown underneath and costs more per token." />
              <Stat icon="cpu" label="API calls" value={fmt(summary.calls)} sub={`${byFeature.length} feature${byFeature.length === 1 ? '' : 's'} · ${byModel.length} model${byModel.length === 1 ? '' : 's'}`} tip="How many times a model was asked something." />
            </div>

            {/* Advice teaser: the thing worth acting on, one click from here */}
            {adviceCount > 0 && (
              <Tooltip text="Open the Advice tab.">
                <button
                  type="button"
                  onClick={() => setTab('advice')}
                  className="w-full text-left rounded-2xl border p-4 flex items-center gap-3 transition-opacity duration-200 hover:opacity-70"
                  style={{ ...CARD, borderColor: 'var(--color-primary)' }}
                >
                  <span style={{ color: 'var(--color-primary)' }}>{getIcon('sparkles', { size: 20 })}</span>
                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                    <strong>{adviceCount} suggestion{adviceCount === 1 ? '' : 's'}</strong> on which models to use
                    {potential > 0 ? <> — about <strong>{fmtCost(potential)}</strong> could be saved over this period</> : null}.
                  </span>
                  <span className="ml-auto text-xs font-medium" style={{ color: 'var(--color-primary)' }}>See advice →</span>
                </button>
              </Tooltip>
            )}

            {summary.calls === 0 ? (
              <div className="rounded-2xl border" style={CARD}>
                <EmptyState icon="usage" title="No usage in this period" body="Pick a longer period, or use an AI feature and come back." />
              </div>
            ) : (
              <>
                {/* Over time */}
                {summary.daily?.length > 1 && (
                  <div className="rounded-2xl border p-5" style={CARD} data-guide="over-time">
                    <div className="flex items-baseline justify-between mb-4">
                      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Over time</h2>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        Busiest: {(() => { const t = [...summary.daily].sort((a, b) => b.cost - a.cost)[0]; return `${t.bucket} (${fmtCost(t.cost)})`; })()}
                      </span>
                    </div>
                    <div className="flex items-end gap-1" style={{ height: '120px' }}>
                      {(() => {
                        const maxCost = Math.max(...summary.daily.map(d => d.cost), 0.000001);
                        return summary.daily.map((d, i) => (
                          <Tooltip key={i} text={`${d.bucket}: ${fmtCost(d.cost)} · ${fmt(d.tokens)} tokens · ${fmt(d.calls)} calls`}>
                            <div
                              className="flex-1 rounded-t-md transition-opacity duration-200 hover:opacity-60 max-w-[64px]"
                              style={{ height: `${Math.max(3, (d.cost / maxCost) * 100)}%`, background: 'var(--color-primary)', opacity: 0.85 }}
                            />
                          </Tooltip>
                        ));
                      })()}
                    </div>
                    <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                      <span>{summary.daily[0]?.bucket}</span>
                      <span>{summary.daily[summary.daily.length - 1]?.bucket}</span>
                    </div>
                  </div>
                )}

                <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-6">
                  {/* By model */}
                  {byModel.length > 0 && (
                    <div className="rounded-2xl border p-5 space-y-4" style={CARD} data-guide="by-model">
                      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>By model</h2>
                      <div className="flex w-full h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }} aria-hidden="true">
                        {byModel.map((m, i) => (
                          <div key={m.model_id} style={{ width: `${((m.cost || 0) / modelCostTotal) * 100}%`, background: 'var(--color-primary)', opacity: shade(i), borderRight: '1px solid var(--color-surface)' }} />
                        ))}
                      </div>
                      <div className="space-y-3">
                        {byModel.map((m, i) => (
                          <div key={m.model_id} className="flex items-center gap-3">
                            <span className="inline-block rounded-full shrink-0" style={{ width: 10, height: 10, background: 'var(--color-primary)', opacity: shade(i) }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{shortModel(m.model_id)}</span>
                                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtCost(m.cost)}</span>
                              </div>
                              <div className="flex justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
                                <span>{fmt(m.calls)} call{m.calls === 1 ? '' : 's'} · {fmtShort(m.total_tokens)} tokens</span>
                                <span>{Math.round(((m.cost || 0) / modelCostTotal) * 100)}% of cost</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* By feature */}
                  {byFeature.length > 0 && (
                    <div className="rounded-2xl border p-5 space-y-4" style={CARD} data-guide="by-feature">
                      <div className="flex items-baseline justify-between">
                        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>By feature</h2>
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>most expensive first</span>
                      </div>
                      <div className="space-y-3">
                        {shownFeatures.map((f, i) => (
                          <div key={f.feature || 'other'} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                                <span className="text-xs mr-2 tabular-nums" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>{featureLabel(f.feature)}
                              </span>
                              <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtCost(f.cost)}</span>
                            </div>
                            <Bar value={f.cost} max={maxFeatureCost} />
                            <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmt(f.calls)} call{f.calls === 1 ? '' : 's'} · {fmtShort(f.total_tokens)} tokens</div>
                          </div>
                        ))}
                      </div>
                      {byFeature.length > 8 && (
                        <Tooltip text={allFeatures ? 'Show only the eight most expensive features.' : 'Show every feature.'}>
                          <button type="button" onClick={() => setAllFeatures(v => !v)} className={btn} style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>
                            {allFeatures ? 'Show fewer' : `Show all ${byFeature.length}`}
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>

                {/* Calls */}
                <div className="rounded-2xl border overflow-hidden" style={CARD} data-guide="calls">
                  <div className="flex items-baseline justify-between px-5 py-4">
                    <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Calls</h2>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{fmt(logTotal)} total</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                          {[['Time', 'left'], ['Model', 'left'], ['Feature', 'left'], ['In', 'right'], ['Out', 'right'], ['Cost', 'right']].map(([h, a]) => (
                            <th key={h} className={`px-4 py-2 font-semibold uppercase tracking-wider text-${a}`} style={{ color: 'var(--color-muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {logLoading ? (
                          <tr><td colSpan={6} className="px-4 py-6"><Skeleton lines={3} label="Loading calls" /></td></tr>
                        ) : log.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-6 text-center" style={{ color: 'var(--color-muted)' }}>No calls recorded for this period.</td></tr>
                        ) : log.map(row => (
                          <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                              {new Date(row.created_at).toLocaleString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="rounded-md px-2 py-0.5 font-medium" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>{shortModel(row.model_id)}</span>
                            </td>
                            <td className="px-4 py-2.5" style={{ color: 'var(--color-muted)' }}>{featureLabel(row.feature)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: 'var(--color-muted)' }}>{fmt(row.input_tokens)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: 'var(--color-muted)' }}>{fmt(row.output_tokens)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium" style={{ color: 'var(--color-text)' }}>{fmtCost(row.estimated_cost_usd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-5 py-3">
                      <Tooltip text="Newer calls."><button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className={btn + ' disabled:opacity-40'} style={{ background: 'transparent', color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>← Prev</button></Tooltip>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Page {page} of {totalPages}</span>
                      <Tooltip text="Older calls."><button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={btn + ' disabled:opacity-40'} style={{ background: 'transparent', color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}>Next →</button></Tooltip>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : summary && tab === 'advice' ? (
          <div className="space-y-5">
            <div className="rounded-2xl border p-5 flex flex-wrap items-center gap-x-8 gap-y-3" style={CARD}>
              <div className="flex items-center gap-3">
                <span className="rounded-xl p-2.5" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>{getIcon('sparkles', { size: 22 })}</span>
                <div>
                  <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                    {adviceCount > 0 ? `${adviceCount} suggestion${adviceCount === 1 ? '' : 's'} for this period` : 'Nothing to change'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Based on {fmt(insights?.calls)} call{insights?.calls === 1 ? '' : 's'} and {fmtCost(insights?.cost)} of spend.
                    {insights?.calls < 30 ? ' This is a small sample: try Month or Quarter for firmer advice.' : ''}
                  </p>
                </div>
              </div>
              {potential > 0 && (
                <div className="sm:ml-auto text-right">
                  <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtCost(potential)}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>could be saved over this period</p>
                </div>
              )}
            </div>

            {insights && (insights.models.light || insights.models.standard) ? (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Advice names your own models from Settings: light is <strong>{insights.models.light || 'not set'}</strong>, standard is <strong>{insights.models.standard || 'not set'}</strong>. It is worked out by rules from the usage log, not by an AI, so the same numbers always give the same advice. Savings are estimates; check the result before you switch.
              </p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No light or standard model is set in Settings, so model-switch advice is off. The other suggestions still apply.</p>
            )}

            {obs.length === 0 ? (
              <div className="rounded-2xl border" style={CARD}>
                <EmptyState icon="check" title="Nothing to flag" body="Every feature is on a sensible model for its job, and nothing is being called wastefully. Check again after more use." />
              </div>
            ) : (
              <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
                {obs.map(o => {
                  const k = KIND[o.kind] || KIND.note;
                  return (
                    <div key={o.id} className="rounded-2xl border p-5 space-y-3" style={CARD} data-guide={'advice-' + o.kind}>
                      <div className="flex items-center justify-between gap-3">
                        <Tooltip text={k.tip}>
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--color-bg)', color: o.kind === 'quality' ? '#b45309' : 'var(--color-primary)' }}>
                            {getIcon(k.icon, { size: 13 })}{k.label}
                          </span>
                        </Tooltip>
                        {o.saving != null && Math.abs(o.saving) >= 0.0001 ? (
                          <Tooltip text={o.saving > 0 ? 'Estimated saving over this period.' : 'Estimated extra cost over this period if you switch.'}>
                            <span className="text-sm font-bold tabular-nums" style={{ color: o.saving > 0 ? '#166534' : '#b45309' }}>
                              {o.saving > 0 ? '−' : '+'}{fmtCost(Math.abs(o.saving))}
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{o.title}</p>
                        <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{o.detail}</p>
                      </div>
                      {o.action ? (
                        <p className="text-sm rounded-xl p-3 leading-relaxed" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                          <strong>Try: </strong>{o.action}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {info.show && (
        <ToolInfoModal title="How Usage & Cost Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            See what your AI use costs and where it goes, and get suggestions on using the right model for each job. Pick a period at the top right, then use the Overview and Advice tabs. Hover anything for a plain explanation. Not sure where to look? Press the round button at the bottom right and tell the guide what you want to know.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <UsageTutorChat currentTool={tab} onOpenTool={openToolById} />
    </div>
  );
}
