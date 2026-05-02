import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export default function NotesTile() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQuick, setShowQuick] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const getIcon = useIcon();

  const load = useCallback(() => {
    api.get('/api/notes')
      .then(r => r.json())
      .then(data => { setNotes(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setSaving(true);
    try {
      const res = await api.post('/api/notes', { title: quickTitle.trim(), body: '' });
      setQuickTitle('');
      setShowQuick(false);
      load();
    } catch {}
    setSaving(false);
  };

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          {getIcon('pen-line', { size: 16, style: { color: 'var(--color-text)' } })}
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Notes</span>
        </div>
        <button
          onClick={() => setShowQuick(v => !v)}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
          style={{ color: 'var(--color-primary)', background: 'var(--color-bg)' }}
          title="New note"
        >
          {getIcon('plus', { size: 16 })}
        </button>
      </div>

      {showQuick && (
        <form
          onSubmit={handleQuickAdd}
          className="flex gap-2 px-4 py-2.5 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
        >
          <input
            autoFocus
            value={quickTitle}
            onChange={e => setQuickTitle(e.target.value)}
            placeholder="Note title..."
            className="flex-1 text-sm bg-transparent outline-none"
            style={{ color: 'var(--color-text)' }}
          />
          <button
            type="submit"
            disabled={saving || !quickTitle.trim()}
            className="text-xs px-3 py-1 rounded-lg font-medium hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-primary)', color: 'white', opacity: (saving || !quickTitle.trim()) ? 0.5 : 1 }}
          >
            Create
          </button>
        </form>
      )}

      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
        {loading && (
          <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        )}
        {!loading && notes.length === 0 && (
          <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>No notes yet</div>
        )}
        {notes.slice(0, 12).map(note => (
          <button
            key={note.id}
            onClick={() => navigate('/notes')}
            className="w-full flex items-start justify-between gap-3 px-4 py-2.5 border-b hover:opacity-70 transition-opacity text-left"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                {note.title || 'Untitled'}
              </div>
              {note.body && (
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>
                  {note.body.replace(/[#*`[\]]/g, '').trim().slice(0, 60)}
                </div>
              )}
            </div>
            <span className="flex-shrink-0 text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {fmtDate(note.updated_at)}
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={() => navigate('/notes')}
        className="w-full px-4 py-2.5 text-sm flex items-center justify-between hover:opacity-70 transition-opacity border-t"
        style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
      >
        All notes
        {getIcon('chevron-right', { size: 14 })}
      </button>
    </div>
  );
}
