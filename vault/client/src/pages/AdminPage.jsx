import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';

// ── Stats helpers ─────────────────────────────────────────────────────────────

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

// ── Backup helpers ────────────────────────────────────────────────────────────

const WEEK_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS    = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatBackupDate(iso) {
  if (!iso) return null;
  const d    = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const label = `${WEEK_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const ago   = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  const color = days <= 7 ? '#22c55e' : days <= 14 ? '#f59e0b' : '#ef4444';
  return { label, ago, days, color };
}

function formatBackupItem(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${WEEK_DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function totalRecords(recordCounts) {
  return Object.values(recordCounts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

async function readSSEStream(res, onEvent) {
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { reader.cancel(); return; }
          try { onEvent(JSON.parse(raw)); } catch (_) {}
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ── Claude window monitor helpers ─────────────────────────────────────────────

const SESSION_MINS  = 5 * 60;
const WINDOW_DAYS   = 7;

function parseHHMM(str) {
  const [h, m] = (str ?? '06:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function fmt12(date) {
  const h    = date.getHours();
  const m    = date.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function fmtDuration(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function computeWindows(cfg) {
  const timeStr  = cfg?.daily_start ?? '06:00';
  const startDay = Number(cfg?.weekly_start_day ?? 1);
  const now      = new Date();
  const { h, m } = parseHHMM(timeStr);
  const windowMs = SESSION_MINS * 60_000;

  const firstStart = new Date(now);
  firstStart.setHours(h, m, 0, 0);

  let pct5h, sessionLabel, sessionSub;
  if (now < firstStart) {
    const minsUntil = Math.ceil((firstStart - now) / 60_000);
    pct5h        = 0;
    sessionLabel = `Starts in ${fmtDuration(minsUntil)}`;
    sessionSub   = `First session begins at ${fmt12(firstStart)}`;
  } else {
    const elapsed      = now - firstStart;
    const winIdx       = Math.floor(elapsed / windowMs);
    const winStart     = new Date(firstStart.getTime() + winIdx * windowMs);
    const winEnd       = new Date(winStart.getTime() + windowMs);
    const elapsedInWin = now - winStart;
    pct5h              = elapsedInWin / windowMs;
    const minsLeft     = Math.ceil((winEnd - now) / 60_000);
    sessionLabel       = `${fmtDuration(minsLeft)} remaining`;
    sessionSub         = `Window ${winIdx + 1} · Resets at ${fmt12(winEnd)}`;
  }

  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dow       = (now.getDay() - startDay + 7) % 7;
  const dayFrac   = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
  const pctWeek   = (dow + dayFrac) / WINDOW_DAYS;
  const daysLeft  = WINDOW_DAYS - dow - 1;
  const weekLabel = daysLeft > 0 ? `${daysLeft}d remaining` : 'Last day of week';
  const weekSub   = `${DAY_NAMES[now.getDay()]} · day ${dow + 1} of 7 · resets ${DAY_NAMES[startDay]}`;

  return { pct5h, sessionLabel, sessionSub, pctWeek, weekLabel, weekSub };
}

function gaugeColor(pct) {
  if (pct >= 0.85) return '#ef4444';
  if (pct >= 0.65) return '#f59e0b';
  return '#22c55e';
}

function DonutGauge({ title, pct, label, sublabel, size = 160 }) {
  const r     = 46;
  const circ  = 2 * Math.PI * r;
  const fill  = Math.min(Math.max(pct || 0, 0), 1);
  const color = gaugeColor(fill);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>{title}</div>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" stroke="var(--color-border)" />
        <circle
          cx="50" cy="50" r={r}
          fill="none" strokeWidth="10"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - fill)}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
        />
        <text x="50" y="47" textAnchor="middle" fontSize="16" fontWeight="700" fill={color}>
          {Math.round(fill * 100)}%
        </text>
        <text x="50" y="60" textAnchor="middle" fontSize="7" fill="var(--color-muted)">used</text>
      </svg>
      <div style={{ textAlign: 'center' }}>
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{sublabel}</div>
      </div>
    </div>
  );
}

const DAY_OPTIONS = [
  { label: 'Sun', value: 0 }, { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

function ClaudeWindowMonitor() {
  const getIcon = useIcon();
  const [cfg, setCfg]           = useState({ daily_start: '06:00', weekly_start_day: 1 });
  const [windows, setWindows]   = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [draft, setDraft]       = useState({ daily_start: '06:00', weekly_start_day: 1 });
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    api.get('/api/settings').then(r => r.json()).then(data => {
      const loaded = {
        daily_start:      data.claude_daily_start      ?? '06:00',
        weekly_start_day: Number(data.claude_weekly_start_day ?? 1),
      };
      setCfg(loaded);
      setDraft(loaded);
      setWindows(computeWindows(loaded));
    }).catch(() => {
      setWindows(computeWindows({ daily_start: '06:00', weekly_start_day: 1 }));
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    const id = setInterval(() => setWindows(w => w ? computeWindows(cfg) : w), 30_000);
    return () => clearInterval(id);
  }, [cfg]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await Promise.all([
        api.post('/api/settings', { key: 'claude_daily_start',      value: draft.daily_start }),
        api.post('/api/settings', { key: 'claude_weekly_start_day', value: String(draft.weekly_start_day) }),
      ]);
      setCfg(draft);
      setWindows(computeWindows(draft));
      setShowConfig(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Claude Windows</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            5-hour session window · 7-day weekly cap · time-based estimates.
          </p>
        </div>
        <button
          onClick={() => { setDraft(cfg); setShowConfig(v => !v); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all hover:opacity-70"
          style={{
            borderColor: showConfig ? 'var(--color-primary)' : 'var(--color-border)',
            background:  showConfig ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))' : 'var(--color-surface)',
            color:       showConfig ? 'var(--color-primary)' : 'var(--color-muted)',
          }}
        >
          {getIcon('settings', { size: 12 })}
          Configure
        </button>
      </div>

      {showConfig && (
        <div className="rounded-2xl border p-4 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
                Daily start time
              </label>
              <input
                type="time"
                value={draft.daily_start}
                onChange={e => setDraft(d => ({ ...d, daily_start: e.target.value }))}
                className="px-3 py-1.5 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>When you typically start your first Claude Code session</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
                Week starts on
              </label>
              <div className="flex gap-1 flex-wrap">
                {DAY_OPTIONS.map(d => (
                  <button
                    key={d.value}
                    onClick={() => setDraft(v => ({ ...v, weekly_start_day: d.value }))}
                    className="px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all hover:opacity-70"
                    style={{
                      borderColor: draft.weekly_start_day === d.value ? 'var(--color-primary)' : 'var(--color-border)',
                      background:  draft.weekly_start_day === d.value ? 'color-mix(in srgb, var(--color-primary) 15%, var(--color-surface))' : 'var(--color-bg)',
                      color:       draft.weekly_start_day === d.value ? 'var(--color-primary)' : 'var(--color-muted)',
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50 hover:opacity-80 transition-opacity"
              style={{ background: 'var(--color-primary)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setShowConfig(false)}
              className="px-4 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {windows ? (
        <div className="rounded-2xl border p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex justify-around gap-8 flex-wrap">
            <DonutGauge title="5-Hour Window"  pct={windows.pct5h}   label={windows.sessionLabel} sublabel={windows.sessionSub} />
            <DonutGauge title="Weekly Cap"     pct={windows.pctWeek} label={windows.weekLabel}    sublabel={windows.weekSub} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-center text-sm animate-pulse"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
          Loading…
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function ProgressBar({ percent, complete, stage }) {
  const barColor = stage === 'error' ? '#ef4444' : complete ? '#22c55e' : 'var(--color-primary)';
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, background: barColor }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function shortModel(id) {
  if (!id) return '—';
  return id
    .replace('claude-', '')
    .replace('gemini-', 'gemini/')
    .replace(/-20251001$/, '')
    .replace(/-20241022$/, '');
}

function fmtCost(n) {
  if (!n || n === 0) return '$0.00';
  if (n < 0.0001) return `$${Number(n).toFixed(6)}`;
  if (n < 0.01)   return `$${Number(n).toFixed(4)}`;
  return `$${Number(n).toFixed(2)}`;
}

function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Session Monitor sub-component ─────────────────────────────────────────

function SessionMonitor() {
  const getIcon = useIcon();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    try {
      const res  = await api.get('/api/admin/monitor');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setData(json);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const { summary, sessions } = data || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Session Monitor</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Recent Claude sessions with cache and cost data.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all"
            style={{
              borderColor: autoRefresh ? 'var(--color-primary)' : 'var(--color-border)',
              background:  autoRefresh ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))' : 'var(--color-surface)',
              color:       autoRefresh ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
          >
            {getIcon('loader', { size: 12, style: autoRefresh ? { animation: 'spin 2s linear infinite' } : undefined })}
            Auto-refresh
          </button>
          <button
            onClick={() => { setLoading(true); load(); }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}
          >
            {getIcon('refresh-cw', { size: 12 })}
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {/* Summary chips */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Sessions today',  value: summary.sessionsToday,            sub: null },
            { label: 'Cache hit rate',  value: `${summary.cacheHitPct}%`,        sub: `${(summary.cacheReadTokens || 0).toLocaleString()} tokens read from cache` },
            { label: 'Cache created',   value: (summary.cacheCreationTokens || 0).toLocaleString(), sub: 'new cache entries today' },
            { label: 'Cost today',      value: fmtCost(summary.costToday),       sub: null },
          ].map(c => (
            <div key={c.label} className="rounded-2xl border p-4 space-y-1"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>{c.label}</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{c.value}</div>
              {c.sub && <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Sessions table */}
      {loading && !data ? (
        <div className="rounded-2xl border p-8 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
          Loading…
        </div>
      ) : sessions?.length > 0 ? (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                {['When', 'Session', 'Model', 'Msgs', 'Tokens', 'Cache', 'Cost'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => {
                const totalIn = (s.inputTokens || 0) + (s.cacheReadTokens || 0) + (s.cacheCreationTokens || 0);
                const cachePct = totalIn > 0 ? Math.round((s.cacheReadTokens / totalIn) * 100) : 0;
                const model = s.models?.filter(Boolean)?.[0];
                return (
                  <tr key={s.sessionId}
                      style={{ borderBottom: i < sessions.length - 1 ? '1px solid var(--color-border)' : undefined, background: 'var(--color-surface)' }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {relativeTime(s.updatedAt)}
                    </td>
                    <td className="px-3 py-2.5 max-w-[180px]">
                      <div className="truncate font-medium" style={{ color: 'var(--color-text)' }}>
                        {s.title || 'Untitled'}
                      </div>
                      {s.projectName && (
                        <div className="truncate text-xs" style={{ color: 'var(--color-muted)' }}>{s.projectName}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                      {model ? shortModel(model) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--color-muted)' }}>
                      {(s.messageCount || 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {((s.inputTokens || 0) + (s.outputTokens || 0)).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      <span style={{ color: cachePct >= 50 ? '#22c55e' : cachePct >= 20 ? '#f59e0b' : 'var(--color-muted)' }}>
                        {cachePct > 0 ? `${cachePct}%` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium" style={{ color: 'var(--color-text)' }}>
                      {fmtCost(s.cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
          No sessions yet.
        </div>
      )}
    </div>
  );
}

function AdminPage() {
  const navigate = useNavigate();
  const { token } = useAuthStore();

  // ── Stats state ───────────────────────────────────────────────────────────
  const [period, setPeriod]         = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [stats, setStats]           = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  // ── Backup state ──────────────────────────────────────────────────────────
  const [backupStatus,       setBackupStatus]       = useState(null);
  const [backupList,         setBackupList]         = useState([]);
  const [envVars,            setEnvVars]            = useState(null);
  const [backupProgress,     setBackupProgress]     = useState(null);
  const [backupError,        setBackupError]        = useState('');
  const [backupRunning,      setBackupRunning]      = useState(false);
  const [restoreTarget,      setRestoreTarget]      = useState(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoreProgress,    setRestoreProgress]    = useState(null);
  const [restoreError,       setRestoreError]       = useState('');
  const [restoreRunning,     setRestoreRunning]     = useState(false);
  const [showHowItWorks,     setShowHowItWorks]     = useState(false);
  const [showEnvVars,        setShowEnvVars]        = useState(false);

  // ── Load stats ────────────────────────────────────────────────────────────
  const loadStats = useCallback(async (overrideFrom, overrideTo) => {
    let from, to;
    if (overrideFrom) {
      from = overrideFrom; to = overrideTo;
    } else if (period === 'custom') {
      if (!customFrom) return;
      from = new Date(customFrom).toISOString();
      to   = customTo ? new Date(customTo + 'T23:59:59').toISOString() : new Date().toISOString();
    } else {
      const dates = getPeriodDates(period);
      if (!dates) return;
      ({ from, to } = dates);
    }
    setLoading(true);
    setError('');
    try {
      const res  = await api.get(`/api/admin/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
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

  // ── Load backup data ──────────────────────────────────────────────────────
  const loadBackupData = useCallback(async () => {
    try {
      const [statusRes, listRes, varsRes] = await Promise.all([
        api.get('/api/backup/status'),
        api.get('/api/backup/list'),
        api.get('/api/backup/variables'),
      ]);
      const [statusData, listData, varsData] = await Promise.all([
        statusRes.json(),
        listRes.json(),
        varsRes.json(),
      ]);
      setBackupStatus(statusData);
      setBackupList(listData.backups || []);
      setEnvVars(varsData);
    } catch (err) {
      setBackupError(err.message || 'Failed to load backup data');
    }
  }, []);

  useEffect(() => {
    loadBackupData();
  }, [loadBackupData]);

  // ── Handle backup now ─────────────────────────────────────────────────────
  const handleBackupNow = async () => {
    setBackupRunning(true);
    setBackupError('');
    setBackupProgress({ stage: 'starting', message: 'Starting backup…', percent: 0 });
    try {
      const res = await fetch('/api/backup/create', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Backup failed');
      }
      await readSSEStream(res, (event) => {
        setBackupProgress(event);
        if (event.stage === 'complete') {
          loadBackupData();
        }
      });
    } catch (err) {
      setBackupProgress(null);
      setBackupError(err.message || 'Backup failed');
    } finally {
      setBackupRunning(false);
    }
  };

  // ── Handle restore ────────────────────────────────────────────────────────
  const handleRestore = async () => {
    if (!restoreTarget) return;
    setRestoreRunning(true);
    setRestoreError('');
    setRestoreProgress({ stage: 'starting', message: 'Starting restore…', percent: 0 });
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: restoreTarget.folderId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Restore failed');
      }
      await readSSEStream(res, (event) => {
        setRestoreProgress(event);
        if (event.stage === 'complete') {
          setTimeout(() => window.location.reload(), 1500);
        }
      });
    } catch (err) {
      setRestoreProgress(null);
      setRestoreError(err.message || 'Restore failed');
    } finally {
      setRestoreRunning(false);
    }
  };

  // ── Cards config ──────────────────────────────────────────────────────────
  const CARDS = stats ? [
    { iconName: 'folder',   label: 'Projects',      value: stats.projects,     sub: stats.archivedProjects > 0 ? `${stats.archivedProjects} archived` : undefined, color: '#f59e0b' },
    { iconName: 'chat',     label: 'Chat Sessions', value: stats.sessions,     color: '#10b981' },
    { iconName: 'send',     label: 'Messages',      value: stats.messages,     color: '#3b82f6' },
    { iconName: 'search',   label: 'Searches',      value: stats.searches,     color: '#8b5cf6' },
    { iconName: 'debate',   label: 'Debates',       value: stats.debates,      color: '#ef4444' },
    { iconName: 'compare',  label: 'Comparisons',   value: stats.comparisons,  color: '#06b6d4' },
    { iconName: 'coins',    label: 'Input Tokens',  value: stats.inputTokens,  sub: 'sent to model',       color: '#64748b' },
    { iconName: 'coins',    label: 'Output Tokens', value: stats.outputTokens, sub: 'received from model', color: '#7c3aed' },
    { iconName: 'sparkles', label: 'Total Tokens',  value: stats.totalTokens,  sub: 'combined',            color: '#2563eb' },
  ] : [];

  const lastBackup     = formatBackupDate(backupStatus?.lastBackupAt);
  const backupComplete = backupProgress?.stage === 'complete';

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-10">

      {/* ── Dashboard ─────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Usage statistics across your workspace.</p>
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
                background:  period === p.key ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))' : 'var(--color-surface)',
                color:       period === p.key ? 'var(--color-primary)' : 'var(--color-muted)',
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
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>To</label>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
            </div>
            <button onClick={() => loadStats()} disabled={!customFrom}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}>
              Apply
            </button>
          </div>
        )}

        {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="rounded-2xl border p-5 h-28 animate-pulse"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} />
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

      {/* ── Claude Window Monitor ─────────────────────────────────────────── */}
      <ClaudeWindowMonitor />

      {/* ── Session Monitor ───────────────────────────────────────────────── */}
      <SessionMonitor />

      {/* ── Backups ────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Backups</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>Back up your database and files to Google Drive.</p>
        </div>

        {/* Status card */}
        <div className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Last backup</p>
              {lastBackup ? (
                <p className="text-xs mt-0.5" style={{ color: lastBackup.color }}>
                  {lastBackup.label} · {lastBackup.ago}
                </p>
              ) : (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>No backups yet</p>
              )}
            </div>
            <button
              onClick={handleBackupNow}
              disabled={backupRunning || !backupStatus?.driveConnected}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              {backupRunning ? 'Backing up…' : 'Back Up Now'}
            </button>
          </div>

          {!backupStatus?.driveConnected && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Connect Google Drive in{' '}
              <button onClick={() => navigate('/settings')} className="underline" style={{ color: 'var(--color-primary)' }}>
                Settings → Integrations
              </button>{' '}
              to enable backups.
            </p>
          )}

          {backupProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs" style={{ color: backupProgress.stage === 'error' ? '#ef4444' : 'var(--color-muted)' }}>
                  {backupProgress.message}
                </p>
                {backupComplete && <span className="text-xs font-medium" style={{ color: '#22c55e' }}>Complete</span>}
              </div>
              <ProgressBar percent={backupProgress.percent || 0} complete={backupComplete} stage={backupProgress.stage} />
            </div>
          )}

          {backupError && <p className="text-xs" style={{ color: '#ef4444' }}>{backupError}</p>}
        </div>

        {/* Backup history */}
        {backupList.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Backup History</p>
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              {backupList.map((b, i) => (
                <div
                  key={b.folderId}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{
                    background: 'var(--color-surface)',
                    borderBottom: i < backupList.length - 1 ? '1px solid var(--color-border)' : undefined,
                  }}
                >
                  <div>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>{formatBackupItem(b.createdAt)}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {totalRecords(b.recordCounts).toLocaleString()} records · {b.fileCount ?? 0} files
                    </p>
                  </div>
                  <button
                    onClick={() => { setRestoreTarget(b); setRestoreConfirmText(''); setRestoreError(''); setRestoreProgress(null); }}
                    className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Environment variables */}
        {envVars && (
          <div className="space-y-2">
            <button
              onClick={() => setShowEnvVars((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              <span>Environment Variables</span>
              <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>{showEnvVars ? 'hide' : 'show'}</span>
            </button>
            {showEnvVars && (
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {Object.entries(envVars).map(([key, present], i, arr) => (
                  <div
                    key={key}
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{
                      background: 'var(--color-surface)',
                      borderBottom: i < arr.length - 1 ? '1px solid var(--color-border)' : undefined,
                    }}
                  >
                    <code className="text-xs" style={{ color: 'var(--color-text)' }}>{key}</code>
                    <span className="text-sm" style={{ color: present ? '#22c55e' : '#ef4444' }}>{present ? '✓' : '✗'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div>
          <button
            onClick={() => setShowHowItWorks((v) => !v)}
            className="text-sm"
            style={{ color: 'var(--color-primary)' }}
          >
            {showHowItWorks ? 'Hide' : 'How does backup work?'}
          </button>
          {showHowItWorks && (
            <div className="mt-3 rounded-2xl border p-4 space-y-2 text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
              <p>Backups are stored in a <strong>Curam Vault Backups</strong> folder in your Google Drive. Each backup is a timestamped subfolder containing a <code>data.json</code> export of all database tables and a <code>files/</code> directory of your uploaded files.</p>
              <p>Only the <strong>4 most recent</strong> backups are kept — older ones are deleted automatically after each new backup.</p>
              <p>The backup uses the <code>drive.file</code> OAuth scope, which only grants access to files the app creates itself — it cannot see any other files in your Drive.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Restore modal ──────────────────────────────────────────────────── */}
      {restoreTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget && !restoreRunning) setRestoreTarget(null); }}
        >
          <div className="w-full max-w-md rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div>
              <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Restore from backup</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                {formatBackupItem(restoreTarget.createdAt)} · {totalRecords(restoreTarget.recordCounts).toLocaleString()} records
              </p>
            </div>

            <div className="rounded-lg p-3 text-xs" style={{ background: 'color-mix(in srgb, #ef4444 10%, var(--color-surface))', color: '#ef4444', border: '1px solid #ef444440' }}>
              This will replace ALL current data with the selected backup. This action cannot be undone.
            </div>

            {restoreProgress ? (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: restoreProgress.stage === 'error' ? '#ef4444' : 'var(--color-muted)' }}>
                  {restoreProgress.message}
                </p>
                <ProgressBar percent={restoreProgress.percent || 0} complete={restoreProgress.stage === 'complete'} stage={restoreProgress.stage} />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                    Type RESTORE to confirm
                  </label>
                  <input
                    type="text"
                    value={restoreConfirmText}
                    onChange={(e) => setRestoreConfirmText(e.target.value)}
                    placeholder="RESTORE"
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                  />
                </div>
                {restoreError && <p className="text-xs" style={{ color: '#ef4444' }}>{restoreError}</p>}
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setRestoreTarget(null)}
                    disabled={restoreRunning}
                    className="px-4 py-2 rounded-lg text-sm border"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRestore}
                    disabled={restoreConfirmText !== 'RESTORE' || restoreRunning}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                    style={{ background: '#ef4444' }}
                  >
                    {restoreRunning ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default AdminPage;
