import React, { useEffect, useState, useCallback } from 'react';
import api from '../utils/apiClient';

const PERIODS = [
  { id: 'today',   label: 'Today' },
  { id: 'week',    label: 'Week' },
  { id: 'month',   label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year',    label: 'Year' },
  { id: 'custom',  label: 'Custom' },
  { id: 'all',     label: 'All Time' },
];

function fmt(n) {
  return n == null ? '0' : Number(n).toLocaleString();
}

function fmtCost(n) {
  if (n == null || n === 0) return '$0.00';
  if (n < 0.0001) return `$${Number(n).toFixed(6)}`;
  if (n < 0.01)   return `$${Number(n).toFixed(4)}`;
  return `$${Number(n).toFixed(4)}`;
}

function shortModel(id) {
  if (!id) return '—';
  return id
    .replace('claude-', '')
    .replace('gemini-', 'gemini/')
    .replace('-20251001', '')
    .replace('-20241022', '');
}

function MiniBar({ value, max }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="w-full rounded-full h-1.5" style={{ background: 'var(--color-border)' }}>
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: 'var(--color-primary)' }} />
    </div>
  );
}

export default function UsagePage() {
  const [period, setPeriod]       = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  const [summary, setSummary]     = useState(null);
  const [log, setLog]             = useState([]);
  const [logTotal, setLogTotal]   = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [logLoading, setLogLoading] = useState(false);
  const [error, setError]         = useState(null);

  const summaryUrl = useCallback(() => {
    let url = `/api/usage/summary?period=${period}`;
    if (period === 'custom' && customFrom && customTo) {
      url += `&from=${customFrom}&to=${customTo}`;
    }
    return url;
  }, [period, customFrom, customTo]);

  const logUrl = useCallback((p) => {
    let url = `/api/usage/log?period=${period}&page=${p}&limit=50`;
    if (period === 'custom' && customFrom && customTo) {
      url += `&from=${customFrom}&to=${customTo}`;
    }
    return url;
  }, [period, customFrom, customTo]);

  const fetchSummary = useCallback(async () => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(summaryUrl());
      setSummary(await r.json());
    } catch {
      setError('Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, [summaryUrl, period, customFrom, customTo]);

  const fetchLog = useCallback(async (p) => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    setLogLoading(true);
    try {
      const r = await api.get(logUrl(p));
      const data = await r.json();
      setLog(data.logs || []);
      setLogTotal(data.total || 0);
    } catch {}
    setLogLoading(false);
  }, [logUrl, period, customFrom, customTo]);

  // Re-fetch when period changes (reset to page 1)
  useEffect(() => {
    setPage(1);
    fetchSummary();
  }, [period, customFrom, customTo]); // eslint-disable-line

  useEffect(() => {
    fetchLog(page);
  }, [page, period, customFrom, customTo]); // eslint-disable-line

  const maxModelCost = Math.max(...(summary?.byModel || []).map(m => m.cost || 0), 0.000001);
  const totalPages   = Math.ceil(logTotal / 50);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6" style={{ maxWidth: '860px', margin: '0 auto', width: '100%' }}>
      <div className="space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>Usage &amp; Cost</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Estimated token spend across all AI features.
          </p>
        </div>

        {/* Period selector */}
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background:   period === p.id ? 'var(--color-primary)' : 'var(--color-surface)',
                color:        period === p.id ? '#fff' : 'var(--color-muted)',
                borderColor:  period === p.id ? 'var(--color-primary)' : 'var(--color-border)',
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date range */}
        {period === 'custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: 'var(--color-muted)' }}>From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-lg border"
                style={{
                  background: 'var(--color-surface)', borderColor: 'var(--color-border)',
                  color: 'var(--color-text)', outline: 'none',
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: 'var(--color-muted)' }}>To</label>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-lg border"
                style={{
                  background: 'var(--color-surface)', borderColor: 'var(--color-border)',
                  color: 'var(--color-text)', outline: 'none',
                }}
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</div>
        ) : error ? (
          <div className="py-12 text-center text-sm" style={{ color: '#ef4444' }}>{error}</div>
        ) : summary && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Est. Cost',     value: fmtCost(summary.cost) },
                { label: 'Total Tokens',  value: fmt(summary.totalTokens) },
                { label: 'Input Tokens',  value: fmt(summary.inputTokens) },
                { label: 'API Calls',     value: fmt(summary.calls) },
              ].map(s => (
                <div
                  key={s.label}
                  className="rounded-xl border p-3 flex flex-col gap-0.5"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{s.label}</span>
                  <span className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Per-model breakdown */}
            {summary.byModel?.length > 0 && (
              <div
                className="rounded-xl border p-4 space-y-3"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>By Model</h2>
                {summary.byModel.map(m => (
                  <div key={m.model_id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium truncate max-w-[55%]" style={{ color: 'var(--color-text)' }}>
                        {shortModel(m.model_id)}
                      </span>
                      <span style={{ color: 'var(--color-muted)' }}>
                        {fmt(m.total_tokens)} tok · {fmt(m.calls)} calls · {fmtCost(m.cost)}
                      </span>
                    </div>
                    <MiniBar value={m.cost} max={maxModelCost} />
                  </div>
                ))}
              </div>
            )}

            {/* Daily breakdown */}
            {summary.daily?.length > 1 && (
              <div
                className="rounded-xl border p-4"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Over Time</h2>
                <div className="flex items-end gap-1" style={{ height: '60px' }}>
                  {(() => {
                    const maxCost = Math.max(...summary.daily.map(d => d.cost), 0.000001);
                    return summary.daily.map((d, i) => {
                      const h = Math.max(4, (d.cost / maxCost) * 56);
                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-sm cursor-default"
                          style={{ height: `${h}px`, background: 'var(--color-primary)', opacity: 0.75 }}
                          title={`${d.bucket}: ${fmtCost(d.cost)} (${fmt(d.tokens)} tokens)`}
                        />
                      );
                    });
                  })()}
                </div>
                <div className="flex justify-between mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                  <span>{summary.daily[0]?.bucket}</span>
                  <span>{summary.daily[summary.daily.length - 1]?.bucket}</span>
                </div>
              </div>
            )}

            {/* Recent calls log */}
            <div>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
                Calls
                <span className="ml-2 font-normal text-xs" style={{ color: 'var(--color-muted)' }}>
                  ({fmt(logTotal)} total)
                </span>
              </h2>

              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                      {['Time', 'Model', 'Feature', 'In', 'Out', 'Cost'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--color-muted)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logLoading ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center" style={{ color: 'var(--color-muted)' }}>
                          Loading…
                        </td>
                      </tr>
                    ) : log.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center" style={{ color: 'var(--color-muted)' }}>
                          No usage recorded for this period.
                        </td>
                      </tr>
                    ) : log.map(row => (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                          {new Date(row.created_at).toLocaleString('en-AU', {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>
                          {shortModel(row.model_id)}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>
                          {row.feature}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-muted)' }}>
                          {fmt(row.input_tokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-muted)' }}>
                          {fmt(row.output_tokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: 'var(--color-text)' }}>
                          {fmtCost(row.estimated_cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: page === 1 ? 'default' : 'pointer' }}
                  >
                    ← Prev
                  </button>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent', cursor: page === totalPages ? 'default' : 'pointer' }}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
