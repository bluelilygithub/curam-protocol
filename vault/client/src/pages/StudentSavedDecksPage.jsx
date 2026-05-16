import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

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
          Bookmark this page to return to your saved sets. Open a deck in Cards to study, export PDF, or email.
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
                className="rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 transition-opacity hover:opacity-90"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{row.title || 'Untitled deck'}</div>
                  <div className="text-[10px] mt-1 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                    {row.kind || 'mixed'}
                    {row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
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
