import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import useToastStore from '../store/toastStore';

export default function StudentSavedDecksPage() {
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUseStudent = isAdmin || featureAccess.student !== false;
  const [rows, setRows] = useState([]);
  const [load, setLoad] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((data) => {
        if (data?.flags && typeof data.flags === 'object') {
          setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
        }
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setLoad(true);
    try {
      const res = await api.get('/api/study-decks');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => {
    if (!canUseStudent) return;
    refresh();
  }, [canUseStudent, refresh]);

  const persistOrder = useCallback(async (ordered) => {
    try {
      const res = await api.post('/api/study-decks/reorder', { ids: ordered.map((r) => r.id) });
      if (!res.ok) throw new Error('reorder failed');
    } catch {
      useToastStore.getState().addToast('Could not save order', 'error');
      refresh();
    }
  }, [refresh]);

  const onDragStart = useCallback((e, id) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  }, []);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e, targetId) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    const fromId = Number(raw);
    setDraggingId(null);
    if (!Number.isFinite(fromId) || fromId <= 0 || fromId === targetId) return;
    setRows((prev) => {
      const fromIx = prev.findIndex((r) => r.id === fromId);
      const toIx = prev.findIndex((r) => r.id === targetId);
      if (fromIx === -1 || toIx === -1) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIx, 1);
      next.splice(toIx, 0, removed);
      persistOrder(next);
      return next;
    });
  }, [persistOrder]);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  if (!canUseStudent) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12" style={{ background: 'var(--color-bg)' }}>
        <p className="text-sm text-center max-w-sm" style={{ color: 'var(--color-muted)' }}>
          Student workspace is turned off for member accounts in this workspace. Ask an admin to enable it under Settings → Feature Access.
        </p>
      </div>
    );
  }

  const handleDelete = async (id) => {
    try {
      const res = await api.delete(`/api/study-decks/${id}`);
      if (res.ok) {
        setRows((r) => r.filter((x) => x.id !== id));
        setDeleteId(null);
      }
    } catch {
      setDeleteId(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 py-8" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-xl mx-auto w-full">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Saved study decks</h1>
          <Link
            to="/student/cards"
            className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Back to Cards
          </Link>
        </div>
        <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
          Bookmark this page to return to your saved sets. Drag the handle to reorder. Open a deck in Cards to study, export PDF, or email.
        </p>
        {load ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No saved decks yet. In Cards, after the assistant builds a deck, use Save deck in the top bar or under Current deck.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                draggable
                onDragStart={(e) => onDragStart(e, row.id)}
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, row.id)}
                onDragEnd={onDragEnd}
                className="rounded-xl border px-2 py-2 sm:px-4 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3 transition-opacity hover:opacity-95"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-surface)',
                  opacity: draggingId === row.id ? 0.55 : 1,
                  cursor: 'grab',
                }}
              >
                <span
                  className="flex-shrink-0 px-1 cursor-grab active:cursor-grabbing"
                  style={{ color: 'var(--color-muted)' }}
                  title="Drag to reorder"
                  aria-hidden
                >
                  {getIcon('grip-vertical', { size: 16 })}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{row.title || 'Untitled deck'}</div>
                  <div className="text-[10px] mt-1 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                    {row.kind || 'mixed'}
                    {row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => navigate(`/student/cards?deck=${row.id}`)}
                    className="text-xs px-3 py-2 rounded-lg text-white transition-opacity hover:opacity-90 flex items-center gap-1"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {getIcon('layers', { size: 12, color: '#fff' })}
                    Open
                  </button>
                  {deleteId === row.id ? (
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                      <button type="button" className="underline hover:opacity-70" onClick={() => handleDelete(row.id)}>Yes, delete</button>
                      <span>·</span>
                      <button type="button" className="underline hover:opacity-70" onClick={() => setDeleteId(null)}>No</button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteId(row.id)}
                      className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
