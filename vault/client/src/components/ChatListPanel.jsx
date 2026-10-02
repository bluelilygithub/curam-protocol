import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useToastStore from '../store/toastStore';
import { formatSessionLabel, formatSessionLocation, formatSessionWhen } from '../utils/sessionDisplay';
import { openNewChatModal } from '../utils/openNewChatModal';
import { openRecentSession } from '../utils/chatNavigation';
import useProjectStore from '../store/projectStore';
import { groupByDate, groupByProject, filterSessions, pinnedOnly } from '../utils/chatPanelGroups.mjs';

// A floating chat list in the style of ChatGPT's sidebar: New chat at the top, a search box,
// Recent / Pinned, chats grouped by date (or by project), click to open, click outside or press
// Esc to dismiss. "Pinned" is the existing starred flag on sessions (PATCH /sessions/:id/star),
// so nothing new is stored. Data comes from GET /api/chat/all-history (newest 300 chats), and
// search runs over what that returns — each chat's title, first question, last reply and
// project name — not over every message ever sent (use the main search, Cmd/Ctrl+K, for that).

export default function ChatListPanel({ open, onClose, onNavigate }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const setActive = useProjectStore((st) => st.setActive);
  const addToast = useToastStore((s) => s.addToast);

  const [sessions, setSessions] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('recent');       // 'recent' | 'pinned'
  const [groupMode, setGroupMode] = useState('date'); // 'date' | 'project'
  const [entered, setEntered] = useState(false);     // drives the 200ms slide-in
  const searchRef = useRef(null);

  // Fresh data every time the panel opens.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setSessions(null);
    setError('');
    setQuery('');
    api.get('/api/chat/all-history')
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(body)) throw new Error((body && body.error) || 'Could not load your chats');
        return body;
      })
      .then((rows) => { if (!cancelled) setSessions(rows.map((s) => ({ ...s, starred: Number(s.starred) || 0 }))); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not load your chats'); });
    return () => { cancelled = true; };
  }, [open]);

  // Slide in on open; Esc closes.
  useEffect(() => {
    if (!open) { setEntered(false); return undefined; }
    const raf = requestAnimationFrame(() => setEntered(true));
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  useEffect(() => { if (open && entered) searchRef.current?.focus(); }, [open, entered]);

  const pinnedCount = useMemo(() => (sessions ? pinnedOnly(sessions).length : 0), [sessions]);

  const groups = useMemo(() => {
    if (!sessions) return [];
    let list = view === 'pinned' ? pinnedOnly(sessions) : sessions;
    list = filterSessions(list, query);
    return groupMode === 'project' ? groupByProject(list) : groupByDate(list);
  }, [sessions, view, query, groupMode]);

  const openSession = useCallback((s) => {
    // shared hand-off: sets the project, routes to the chat page, then loads the chosen session
    openRecentSession(s, navigate, setActive);
    onNavigate?.();
    onClose();
  }, [navigate, setActive, onClose, onNavigate]);

  const togglePin = useCallback(async (s) => {
    const next = s.starred ? 0 : 1;
    const flip = (value) => setSessions((prev) => prev && prev.map((x) => (x.sessionId === s.sessionId ? { ...x, starred: value } : x)));
    flip(next); // optimistic
    try {
      const res = await api.patch(`/api/chat/sessions/${s.sessionId}/star`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not update the pin');
      flip(body.starred ? 1 : 0); // trust the server's answer
    } catch (e) {
      flip(s.starred); // put it back
      addToast(e.message || 'Could not update the pin', 'error');
    }
  }, [addToast]);

  const startNewChat = () => {
    openNewChatModal();
    onNavigate?.();
    onClose();
  };

  if (!open) return null;

  const segBtn = (id, label, active) => (
    <button
      key={id}
      type="button"
      onClick={() => (id === 'recent' || id === 'pinned' ? setView(id) : setGroupMode(id))}
      className="flex-1 px-2 py-1 text-xs font-medium transition-opacity duration-200 hover:opacity-70"
      style={{ background: active ? 'var(--color-primary)' : 'transparent', color: active ? '#fff' : 'var(--color-text)' }}
    >
      {label}
    </button>
  );

  const panel = (
    <>
      {/* click outside to dismiss */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.25)', opacity: entered ? 1 : 0, transition: 'opacity 200ms' }}
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed left-0 top-0 z-40 flex flex-col border-r shadow-2xl"
        style={{
          width: 'min(340px, 92vw)',
          height: '100vh',
          maxHeight: '100dvh',
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          transform: entered ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 200ms',
        }}
        role="dialog"
        aria-label="Your chats"
      >
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <button
            type="button"
            onClick={startNewChat}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 14 })}
            New chat
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-opacity duration-200 hover:opacity-60"
            style={{ color: 'var(--color-muted)' }}
            title="Close (Esc)"
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        <div className="px-3 pb-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }}>
              {getIcon('search', { size: 13 })}
            </span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="w-full pl-8 pr-8 py-2 text-sm rounded-xl border outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 hover:opacity-60 transition-opacity duration-200"
                style={{ color: 'var(--color-muted)' }}
                title="Clear search"
              >
                {getIcon('x', { size: 12 })}
              </button>
            )}
          </div>
        </div>

        <div className="px-3 pb-2 flex gap-2">
          <div className="flex-1 flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {segBtn('recent', 'Recent', view === 'recent')}
            {segBtn('pinned', `Pinned${pinnedCount ? ` (${pinnedCount})` : ''}`, view === 'pinned')}
          </div>
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            {segBtn('date', 'Date', groupMode === 'date')}
            {segBtn('project', 'Project', groupMode === 'project')}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {error && <p className="text-sm px-2 py-3" style={{ color: '#ef4444' }}>{error}</p>}
          {!error && sessions === null && <p className="text-sm px-2 py-3" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
          {!error && sessions !== null && groups.length === 0 && (
            <p className="text-sm px-2 py-3" style={{ color: 'var(--color-muted)' }}>
              {query
                ? `No chats match “${query}”.`
                : view === 'pinned'
                  ? 'Nothing pinned yet — use the pin beside any chat to keep it here.'
                  : 'No chats yet.'}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{g.label}</p>
              {g.items.map((s) => (
                <div
                  key={s.sessionId}
                  className="group flex items-center gap-1 rounded-lg transition-opacity duration-200 hover:opacity-70"
                >
                  <button
                    type="button"
                    onClick={() => openSession(s)}
                    className="flex-1 min-w-0 text-left px-2 py-2 rounded-lg"
                    title={formatSessionLabel(s)}
                  >
                    <span className="block text-sm truncate" style={{ color: 'var(--color-text)' }}>{formatSessionLabel(s)}</span>
                    <span className="block text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>
                      {groupMode === 'date' ? `${formatSessionLocation(s)} · ` : ''}{formatSessionWhen(s.lastAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin(s)}
                    className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md transition-opacity duration-200 ${s.starred ? '' : 'opacity-0 group-hover:opacity-60 focus:opacity-60'} hover:!opacity-100`}
                    style={{ color: s.starred ? 'var(--color-primary)' : 'var(--color-muted)' }}
                    title={s.starred ? 'Unpin' : 'Pin this chat'}
                    aria-label={s.starred ? 'Unpin chat' : 'Pin chat'}
                  >
                    {getIcon('pin', { size: 13, fill: s.starred ? 'currentColor' : 'none' })}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </>
  );

  return createPortal(panel, document.body);
}
