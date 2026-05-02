import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString('en-AU', { weekday: 'short' });
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export default function ChatHistoryTile() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const getIcon = useIcon();

  useEffect(() => {
    api.get('/api/chat/all-history')
      .then(r => r.json())
      .then(data => { setSessions(Array.isArray(data) ? data.slice(0, 12) : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const goToSession = (s) => {
    if (s.projectId) {
      navigate(`/projects/${s.projectId}/chat`, { state: { sessionId: s.sessionId } });
    } else {
      navigate('/chat', { state: { sessionId: s.sessionId } });
    }
  };

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {getIcon('clock', { size: 16, style: { color: 'var(--color-text)' } })}
        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Chat History</span>
      </div>

      <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
        {loading && (
          <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted)' }}>No chat history</div>
        )}
        {sessions.map(s => (
          <button
            key={s.sessionId}
            onClick={() => goToSession(s)}
            className="w-full flex items-start gap-3 px-4 py-2.5 border-b hover:opacity-70 transition-opacity text-left"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
                {s.title || 'Untitled'}
              </div>
              {s.projectName && (
                <div className="text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {s.projectName}
                </div>
              )}
            </div>
            <span className="flex-shrink-0 text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {fmtDate(s.lastAt)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => navigate('/chat')}
          className="flex-1 px-3 py-2.5 text-sm flex items-center justify-center gap-1.5 border-r hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
        >
          {getIcon('plus', { size: 13 })} New Chat
        </button>
        <button
          onClick={() => navigate('/history')}
          className="flex-1 px-3 py-2.5 text-sm flex items-center justify-center gap-1.5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-muted)' }}
        >
          All history {getIcon('chevron-right', { size: 13 })}
        </button>
      </div>
    </div>
  );
}
