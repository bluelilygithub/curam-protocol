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
