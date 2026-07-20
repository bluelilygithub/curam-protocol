import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import MoodDot from '../components/mood/MoodDot';
import useProjectStore from '../store/projectStore';
import { formatSessionLabel, formatSessionLocation } from '../utils/sessionDisplay';

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
  const [searchParams] = useSearchParams();
  const projectFilterId = searchParams.get('projectId');
  const getIcon = useIcon();
  const { projects, fetchProjects } = useProjectStore();

  const [tab, setTab] = useState('history');
  const [folders, setFolders] = useState([]);
  const [moveSessionTarget, setMoveSessionTarget] = useState(null);
  const [moveSessionProjectId, setMoveSessionProjectId] = useState('');
  const [moveSessionSaving, setMoveSessionSaving] = useState(false);

  // ── History ──────────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [deletedSessions, setDeletedSessions] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [restoringSid, setRestoringSid] = useState(null);

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      let from, to;
      if (period === 'custom') {
        from = customFrom || '2000-01-01';
        to = customTo ? customTo + 'T23:59:59' : '2099-12-31';
      } else if (period === 'all') {
        from = '2000-01-01'; to = '2099-12-31';
      } else {
        ({ from, to } = getPeriodDates(period));
      }
      const res = await api.get(`/api/chat/all-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setSessions(list);
    } catch (_) {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  const loadDeletedHistory = useCallback(async () => {
    setDeletedLoading(true);
    try {
      let from, to;
      if (period === 'custom') {
        from = customFrom || '2000-01-01';
        to = customTo ? customTo + 'T23:59:59' : '2099-12-31';
      } else if (period === 'all') {
        from = '2000-01-01'; to = '2099-12-31';
      } else {
        ({ from, to } = getPeriodDates(period));
      }
      const res = await api.get(`/api/chat/deleted-history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await res.json();
      setDeletedSessions(Array.isArray(data) ? data : []);
    } catch (_) {
      setDeletedSessions([]);
    } finally {
      setDeletedLoading(false);
    }
  }, [period, customFrom, customTo]);

  const [moodMap, setMoodMap] = useState(null);
  useEffect(() => {
    if (sessions.length === 0) { setMoodMap({}); return; }
    const entities = sessions.map(s => ({ entityType: 'session', entityId: String(s.sessionId) }));
    api.post('/api/mood/dominant/batch', { entities })
      .then(r => r.json())
      .then(batch => {
        const map = {};
        for (const s of sessions) map[`session:${s.sessionId}`] = batch[`session:${s.sessionId}`] || null;
        setMoodMap(map);
      })
      .catch(() => setMoodMap({}));
  }, [sessions]);

  const loadBookmarks = useCallback(async () => {
    setBookmarksLoading(true);
    try {
      const res = await api.get('/api/bookmarks');
      const data = await res.json();
      setBookmarks(Array.isArray(data) ? data : []);
    } catch (_) {
      setBookmarks([]);
    } finally {
      setBookmarksLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    fetchProjects();
    api.get('/api/folders').then(r => r.json()).then(setFolders).catch(() => {});
  }, [fetchProjects]);

  useEffect(() => {
    if (tab === 'bookmarks') loadBookmarks();
  }, [tab, loadBookmarks]);

  useEffect(() => {
    if (tab === 'deleted') loadDeletedHistory();
  }, [tab, loadDeletedHistory]);

  useEffect(() => {
    const handler = () => { if (tab === 'bookmarks') loadBookmarks(); };
    window.addEventListener('vault:bookmark-changed', handler);
    return () => window.removeEventListener('vault:bookmark-changed', handler);
  }, [tab, loadBookmarks]);

  // ── Navigation ────────────────────────────────────────────────────────────
  function goToSession(sessionId, projectId) {
    const target = projectId ? `/projects/${projectId}/chat` : '/chat';
    navigate(target);
    setTimeout(() => document.dispatchEvent(new CustomEvent('vault:load-session', { detail: sessionId })), 80);
  }

  async function restoreSession(sessionId) {
    setRestoringSid(sessionId);
    try {
      const res = await api.post(`/api/chat/sessions/${sessionId}/restore`);
      if (!res.ok) throw new Error('Restore failed');
      await Promise.all([loadHistory(), loadDeletedHistory()]);
      document.dispatchEvent(new CustomEvent('vault:sessions-changed'));
    } catch (_) {
      // Keep the row visible so the user can retry.
    } finally {
      setRestoringSid(null);
    }
  }

  function openMoveSessionModal(session) {
    setMoveSessionTarget(session);
    setMoveSessionProjectId(projects[0]?.id ? String(projects[0].id) : '');
  }

  async function confirmMoveSession() {
    if (!moveSessionTarget || !moveSessionProjectId) return;
    setMoveSessionSaving(true);
    try {
      await api.patch(`/api/chat/sessions/${moveSessionTarget.sessionId}/project`, {
        projectId: Number(moveSessionProjectId),
      });
      setMoveSessionTarget(null);
      setMoveSessionProjectId('');
      await Promise.all([loadHistory(), fetchProjects()]);
      document.dispatchEvent(new CustomEvent('vault:sessions-changed'));
    } catch (_) {
      // Keep the modal open so the user can retry.
    } finally {
      setMoveSessionSaving(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const filteredSessions = (search.trim()
    ? sessions.filter(s =>
        (s.title || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.projectName || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.lastMsg || '').toLowerCase().includes(search.toLowerCase())
      )
    : sessions
  ).filter((s) => !projectFilterId || String(s.projectId || '') === String(projectFilterId));
  const filteredDeletedSessions = search.trim()
    ? deletedSessions.filter(s =>
        (s.title || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.projectName || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.lastMsg || '').toLowerCase().includes(search.toLowerCase())
      )
    : deletedSessions;

  // Group bookmarks by sessionId preserving order of first occurrence
  const bookmarkGroups = bookmarks.reduce((groups, bm) => {
    const existing = groups.find(g => g.sessionId === bm.sessionId);
    if (existing) {
      existing.messages.push(bm);
    } else {
      groups.push({
        sessionId: bm.sessionId,
        sessionTitle: bm.sessionTitle,
        projectId: bm.projectId,
        projectName: bm.projectName,
        messages: [bm],
      });
    }
    return groups;
  }, []);

  const projectFilterName = projectFilterId
    ? projects.find((p) => String(p.id) === String(projectFilterId))?.name
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">

      {projectFilterId && (
        <div
          className="rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 text-sm"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <span>
            Showing chats for <strong>{projectFilterName || `project #${projectFilterId}`}</strong>
          </span>
          <button
            type="button"
            onClick={() => navigate('/history')}
            className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity flex-shrink-0"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Header + tab switcher */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Chat History</h1>
        <div className="flex rounded-xl border overflow-hidden flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={() => setTab('history')}
            className="px-4 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: tab === 'history' ? 'var(--color-primary)' : 'var(--color-surface)',
              color: tab === 'history' ? '#fff' : 'var(--color-text)',
            }}
          >
            History
          </button>
          <button
            onClick={() => setTab('deleted')}
            className="px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5"
            style={{
              background: tab === 'deleted' ? 'var(--color-primary)' : 'var(--color-surface)',
              color: tab === 'deleted' ? '#fff' : 'var(--color-text)',
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            Deleted
            {deletedSessions.length > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-full text-xs font-bold leading-none"
                style={{
                  background: tab === 'deleted' ? 'rgba(255,255,255,0.3)' : '#ef4444',
                  color: '#fff',
                }}
              >
                {deletedSessions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('bookmarks')}
            className="px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5"
            style={{
              background: tab === 'bookmarks' ? 'var(--color-primary)' : 'var(--color-surface)',
              color: tab === 'bookmarks' ? '#fff' : 'var(--color-text)',
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            ★ Bookmarks
            {bookmarks.length > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-full text-xs font-bold leading-none"
                style={{
                  background: tab === 'bookmarks' ? 'rgba(255,255,255,0.3)' : '#f59e0b',
                  color: '#fff',
                }}
              >
                {bookmarks.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── HISTORY TAB ─────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <>
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

          {period === 'custom' && (
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-xs outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-xs outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          )}

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
            ) : filteredSessions.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
                No chat sessions found for this period.
              </div>
            ) : (
              filteredSessions.map((s, i) => (
                <div
                  key={s.sessionId}
                  className="w-full text-left px-4 py-3 flex items-start gap-4 hover:opacity-80 transition-opacity border-b last:border-b-0 cursor-pointer"
                  style={{
                    background: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                  }}
                  onClick={() => goToSession(s.sessionId, s.projectId)}
                >
                  <div className="flex-shrink-0 w-28 text-right">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--color-primary)' }}>
                      {formatSessionLocation(s)}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {s.lastAt ? new Date(s.lastAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {formatSessionLabel(s)}
                    </div>
                    {s.lastMsg && (
                      <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                        {s.lastMsg.substring(0, 160)}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 self-center flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
                    {moodMap !== null && <MoodDot entityType="session" entityId={s.sessionId} entityTitle={s.title} dominantEmotion={moodMap[`session:${s.sessionId}`]} />}
                    {!s.projectId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openMoveSessionModal(s); }}
                        className="px-2 py-1 rounded-md border text-xs hover:opacity-70 transition-opacity"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
                        title="Move quick chat to a project"
                      >
                        Move
                      </button>
                    )}
                    {getIcon('chevron-right', { size: 14 })}
                  </div>
                </div>
              ))
            )}
          </div>

          {!loading && filteredSessions.length > 0 && (
            <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>
              {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </p>
          )}
        </>
      )}

      {/* ── DELETED TAB ─────────────────────────────────────────────────── */}
      {tab === 'deleted' && (
        <>
          <div className="rounded-2xl border px-4 py-3 text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Deleted chats are hidden from projects, folders, search, and chat context. Restore a chat to put it back where it was.
          </div>

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

          {period === 'custom' && (
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-xs outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="px-3 py-1.5 rounded-lg border text-xs outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          )}

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }}>
              {getIcon('search', { size: 14 })}
            </span>
            <input
              type="text"
              placeholder="Filter deleted chats…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {deletedLoading ? (
              <div className="space-y-px">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="px-4 py-3 animate-pulse flex gap-3 items-start" style={{ background: 'var(--color-surface)' }}>
                    <div className="rounded w-24 h-3 mt-1" style={{ background: 'var(--color-border)' }} />
                    <div className="flex-1 space-y-2">
                      <div className="rounded w-1/2 h-3" style={{ background: 'var(--color-border)' }} />
                      <div className="rounded w-3/4 h-2.5" style={{ background: 'var(--color-border)' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredDeletedSessions.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
                No deleted chats found for this period.
              </div>
            ) : (
              filteredDeletedSessions.map((s, i) => (
                <div
                  key={s.sessionId}
                  className="w-full text-left px-4 py-3 flex items-start gap-4 border-b last:border-b-0"
                  style={{
                    background: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                  }}
                >
                  <div className="flex-shrink-0 w-28 text-right">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--color-primary)' }}>
                      {formatSessionLocation(s)}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {s.deletedAt ? `Deleted ${new Date(s.deletedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {formatSessionLabel(s)}
                    </div>
                    {s.lastMsg && (
                      <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                        {s.lastMsg.substring(0, 160)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => restoreSession(s.sessionId)}
                    disabled={restoringSid === s.sessionId}
                    className="flex-shrink-0 self-center px-3 py-1.5 rounded-lg border text-xs font-medium hover:opacity-70 disabled:opacity-50"
                    style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
                  >
                    {restoringSid === s.sessionId ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              ))
            )}
          </div>

          {!deletedLoading && filteredDeletedSessions.length > 0 && (
            <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>
              {filteredDeletedSessions.length} deleted chat{filteredDeletedSessions.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </p>
          )}
        </>
      )}

      {/* ── BOOKMARKS TAB ───────────────────────────────────────────────── */}
      {tab === 'bookmarks' && (
        <>
          {bookmarksLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-2xl border p-4 animate-pulse space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                  <div className="rounded w-1/3 h-3" style={{ background: 'var(--color-border)' }} />
                  <div className="rounded w-full h-2.5" style={{ background: 'var(--color-border)' }} />
                  <div className="rounded w-2/3 h-2.5" style={{ background: 'var(--color-border)' }} />
                </div>
              ))}
            </div>
          ) : bookmarkGroups.length === 0 ? (
            <div
              className="py-16 text-center rounded-2xl border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              <div className="text-4xl mb-3 opacity-30">★</div>
              <p className="text-sm font-medium">No bookmarked messages yet</p>
              <p className="text-xs mt-1">Hover any message in a chat and click the ★ to save it here.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {bookmarkGroups.map(group => (
                <div
                  key={group.sessionId}
                  className="rounded-2xl border overflow-hidden"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {/* Session header — click to open that chat */}
                  <button
                    onClick={() => goToSession(group.sessionId, group.projectId)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80 transition-opacity"
                    style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
                  >
                    <span style={{ color: '#f59e0b', fontSize: '14px' }}>★</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold block truncate" style={{ color: 'var(--color-text)' }}>
                        {formatSessionLabel({ title: group.sessionTitle, firstUserMsg: group.preview })}
                      </span>
                      {group.projectName && (
                        <span className="text-xs" style={{ color: 'var(--color-primary)' }}>
                          {group.projectName}
                        </span>
                      )}
                    </div>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                      {group.messages.length} bookmark{group.messages.length !== 1 ? 's' : ''} →
                    </span>
                  </button>

                  {/* Bookmarked messages */}
                  {group.messages.map((bm, i) => (
                    <button
                      key={bm.id}
                      onClick={() => goToSession(group.sessionId, group.projectId)}
                      className="w-full text-left px-4 py-3 hover:opacity-80 transition-opacity border-b last:border-b-0"
                      style={{
                        background: i % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="text-xs font-medium px-1.5 py-0.5 rounded"
                          style={{
                            background: bm.role === 'user' ? 'var(--color-primary)' : 'transparent',
                            color: bm.role === 'user' ? '#fff' : 'var(--color-muted)',
                            border: bm.role === 'assistant' ? '1px solid var(--color-border)' : 'none',
                          }}
                        >
                          {bm.role === 'user' ? 'You' : 'AI'}
                        </span>
                        {bm.messageCreatedAt && (
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            {new Date(bm.messageCreatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
                        {bm.content.substring(0, 100)}{bm.content.length > 100 ? '…' : ''}
                      </p>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {moveSessionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-xl p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Move chat to project</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
              Move "{formatSessionLabel(moveSessionTarget)}" into a project.
            </p>
            <select
              value={moveSessionProjectId}
              onChange={e => setMoveSessionProjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none mb-5"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {folders.map(folder => {
                const folderProjects = projects.filter(p => p.folderId === folder.id);
                if (folderProjects.length === 0) return null;
                return (
                  <optgroup key={folder.id} label={folder.name}>
                    {folderProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                );
              })}
              <optgroup label="Unassigned">
                {projects.filter(p => !p.folderId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setMoveSessionTarget(null)} className="px-4 py-2 rounded-xl text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              <button
                onClick={confirmMoveSession}
                disabled={!moveSessionProjectId || moveSessionSaving}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {moveSessionSaving ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
