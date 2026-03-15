import React, { useState, useEffect, useCallback } from 'react';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';

const PERIODS = [
  { label: 'Today',       key: 'today' },
  { label: 'This week',   key: 'week' },
  { label: 'This month',  key: 'month' },
  { label: 'Last month',  key: 'last-month' },
  { label: '6 months',    key: '6m' },
  { label: '12 months',   key: '12m' },
  { label: 'Custom',      key: 'custom' },
];

function getPeriodDates(key) {
  const now = new Date();
  switch (key) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from: start.toISOString(), to: now.toISOString() };
    }
    case 'week': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case 'month': {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case 'last-month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { from: first.toISOString(), to: last.toISOString() };
    }
    case '6m': {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    case '12m': {
      const d = new Date(now); d.setMonth(d.getMonth() - 12);
      return { from: d.toISOString(), to: now.toISOString() };
    }
    default: return null;
  }
}

function StatCard({ iconName, label, value, sub, color }) {
  const getIcon = useIcon();
  return (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-3"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
          {label}
        </span>
        <span style={{ color: color || 'var(--color-primary)' }}>
          {getIcon(iconName, { size: 15 })}
        </span>
      </div>
      <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>
        {value != null ? value.toLocaleString() : '—'}
      </div>
      {sub && <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{sub}</div>}
    </div>
  );
}

function AdminPage() {
  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadStats = useCallback(async (overrideFrom, overrideTo) => {
    let from, to;
    if (overrideFrom) {
      from = overrideFrom; to = overrideTo;
    } else if (period === 'custom') {
      if (!customFrom) return;
      from = new Date(customFrom).toISOString();
      to = customTo ? new Date(customTo + 'T23:59:59').toISOString() : new Date().toISOString();
    } else {
      const dates = getPeriodDates(period);
      if (!dates) return;
      ({ from, to } = dates);
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/api/admin/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load stats');
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => {
    if (period !== 'custom') loadStats();
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const CARDS = stats ? [
    { iconName: 'folder',     label: 'Projects',       value: stats.projects,      sub: stats.archivedProjects > 0 ? `${stats.archivedProjects} archived` : undefined, color: '#f59e0b' },
    { iconName: 'chat',       label: 'Chat Sessions',  value: stats.sessions,      color: '#10b981' },
    { iconName: 'send',       label: 'Messages',       value: stats.messages,      color: '#3b82f6' },
    { iconName: 'search',     label: 'Searches',       value: stats.searches,      color: '#8b5cf6' },
    { iconName: 'debate',     label: 'Debates',        value: stats.debates,       color: '#ef4444' },
    { iconName: 'compare',    label: 'Comparisons',    value: stats.comparisons,   color: '#06b6d4' },
    { iconName: 'coins',      label: 'Input Tokens',   value: stats.inputTokens,   sub: 'sent to model',     color: '#64748b' },
    { iconName: 'coins',      label: 'Output Tokens',  value: stats.outputTokens,  sub: 'received from model', color: '#7c3aed' },
    { iconName: 'sparkles',   label: 'Total Tokens',   value: stats.totalTokens,   sub: 'combined',          color: '#2563eb' },
  ] : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Dashboard</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Usage statistics across your workspace.
        </p>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
            style={{
              borderColor: period === p.key ? 'var(--color-primary)' : 'var(--color-border)',
              background: period === p.key ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))' : 'var(--color-surface)',
              color: period === p.key ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date pickers */}
      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>From</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>To</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>
          <button
            onClick={() => loadStats()}
            disabled={!customFrom}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Apply
          </button>
        </div>
      )}

      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-2xl border p-5 h-28 animate-pulse" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {CARDS.map((c) => (
            <StatCard key={c.label} iconName={c.iconName} label={c.label} value={c.value} sub={c.sub} color={c.color} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default AdminPage;
