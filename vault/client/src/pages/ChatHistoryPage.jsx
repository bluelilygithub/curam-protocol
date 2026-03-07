import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

function getPeriodDates(key) {
  const now = new Date();
  const startOfDay = (d) => { const c = new Date(d); c.setHours(0,0,0,0); return c; };
  const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  switch (key) {
    case 'today':
      return { from: iso(startOfDay(now)), to: iso(new Date(now.getTime() + 86400000)) };
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { from: iso(startOfDay(y)), to: iso(startOfDay(now)) };
    }
    case 'this-week': {
      const w = new Date(now); w.setDate(w.getDate() - w.getDay());
      return { from: iso(startOfDay(w)), to: iso(new Date(now.getTime() + 86400000)) };
    }
    case 'last-7': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { from: iso(startOfDay(d)), to: iso(new Date(now.getTime() + 86400000)) };
    }
    case 'this-month': {
      const m = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: iso(m), to: iso(new Date(now.getTime() + 86400000)) };
    }
    case 'last-month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: iso(start), to: iso(end) };
    }
    case 'last-30': {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { from: iso(startOfDay(d)), to: iso(new Date(now.getTime() + 86400000)) };
    }
    default:
      return { from: '2000-01-01', to: '2099-12-31' };
  }
}

const PERIODS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this-week', label: 'This week' },
  { key: 'last-7', label: 'Last 7 days' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-30', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom' },
];

export default function ChatHistoryPage() {
  const navigate = useNavigate();
  const getIcon = useIcon();
  const [period, setPeriod] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let from, to;
      if (period === 'custom') {
        from = customFrom || '2000-01-01';
        to = customTo ? customTo + 'T23:59:59' : '2099-12-31';
      } else if (period === 'all') {
        from = '2000-01-01';
        to = '2099-12-31';
      } else {
        ({ from, to } = getPeriodDates(period));
      }
      const res = await api.get(`/api/chat/all-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (e) {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  function handleRowClick(s) {
    if (s.projectId) {
      navigate(`/projects/${s.projectId}/chat`);
      setTimeout(() => document.dispatchEvent(new CustomEvent('vault:load-session', { detail: s.sessionId })), 80);
    } else {
      navigate('/chat');
      setTimeout(() => document.dispatchEvent(new CustomEvent('vault:load-session', { detail: s.sessionId })), 80);
    }
  }

  const filtered = search.trim()
    ? sessions.filter(s =>
        (s.title || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.projectName || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.lastMsg || '').toLowerCase().includes(search.toLowerCase())
      )
    : sessions;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Chat History</h1>

      {/* Period filter chips */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
            style={{
              background: period === p.key ? 'var(--color-primary)' : 'var(--color-surface)',
              borderColor: period === p.key ? 'var(--color-primary)' : 'var(--color-border)',
              color: period === p.key ? '#fff' : 'var(--color-text)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date pickers */}
      {period === 'custom' && (
        <div className="flex items-center gap-3 text-sm">
          <input
            type="date"
            value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <span style={{ color: 'var(--color-muted)' }}>to</span>
          <input
            type="date"
            value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>
          {getIcon('search', { size: 14 })}
        </span>
        <input
          type="text"
          placeholder="Filter by title, project, or content…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-xl border text-sm outline-none"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>

      {/* Results */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="space-y-px">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="px-4 py-3 animate-pulse flex gap-3 items-start" style={{ background: 'var(--color-surface)' }}>
                <div className="rounded w-24 h-3 mt-1" style={{ background: 'var(--color-border)' }} />
                <div className="flex-1 space-y-2">
                  <div className="rounded w-1/2 h-3" style={{ background: 'var(--color-border)' }} />
                  <div className="rounded w-3/4 h-2.5" style={{ background: 'var(--color-border)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
            No chat sessions found for this period.
          </div>
        ) : (
          filtered.map((s, i) => (
            <button
              key={s.sessionId}
              onClick={() => handleRowClick(s)}
              className="w-full text-left px-4 py-3 flex items-start gap-4 hover:opacity-80 transition-opacity border-b last:border-b-0"
              style={{
                background: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-bg)',
                borderColor: 'var(--color-border)',
              }}
            >
              <div className="flex-shrink-0 w-28 text-right">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--color-primary)' }}>
                  {s.projectName || 'General'}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {s.lastAt ? new Date(s.lastAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {s.title || `Session ${s.sessionId.slice(-8)}`}
                </div>
                {s.lastMsg && (
                  <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                    {s.lastMsg.substring(0, 160)}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 self-center" style={{ color: 'var(--color-muted)' }}>
                {getIcon('chevron-right', { size: 14 })}
              </div>
            </button>
          ))
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>
          {filtered.length} session{filtered.length !== 1 ? 's' : ''}
          {search ? ` matching "${search}"` : ''}
        </p>
      )}
    </div>
  );
}
