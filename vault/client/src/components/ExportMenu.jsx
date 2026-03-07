import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import { exportChatJson, exportChatPdf, exportProject } from '../utils/exportHelpers';
import EmailModal from './EmailModal';
import api from '../utils/apiClient';

function ExportMenu({ sessionId, projectId }) {
  const [open, setOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [toast, setToast] = useState(null);
  const menuRef = useRef(null);
  const getIcon = useIcon();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!sessionId && !projectId) return null;

  const items = [
    sessionId && {
      label: 'Export Chat PDF',
      icon: 'download',
      action: () => exportChatPdf(sessionId),
    },
    sessionId && {
      label: 'Export Chat JSON',
      icon: 'download',
      action: () => exportChatJson(sessionId),
    },
    projectId && {
      label: 'Export Project',
      icon: 'download',
      action: () => exportProject(projectId),
    },
    sessionId && {
      label: 'Email Thread',
      icon: 'mail',
      action: () => { setShowEmail(true); setOpen(false); },
    },
    sessionId && {
      label: 'Extract Tasks',
      icon: 'list-checks',
      action: async () => {
        setOpen(false);
        setExtracting(true);
        try {
          const res = await api.post('/api/tasks/extract', { sessionId, projectId });
          const data = await res.json();
          setToast({ count: data.count });
          setTimeout(() => setToast(null), 5000);
        } catch (err) {
          console.error('Extract tasks error:', err);
        } finally {
          setExtracting(false);
        }
      },
    },
  ].filter(Boolean);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          title="Export / Share"
        >
          {extracting ? getIcon('loader', { size: 13 }) : getIcon('download', { size: 13 })}
          <span className="hidden sm:inline">Export</span>
          {getIcon('chevron-down', { size: 12 })}
        </button>

        {open && (
          <div
            className="absolute right-0 top-full mt-1 w-48 rounded-lg border shadow-lg py-1 z-40"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            {items.map((item, i) => (
              <button
                key={i}
                onClick={() => { item.action(); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:opacity-70 transition-opacity"
                style={{ color: 'var(--color-text)' }}
              >
                {getIcon(item.icon, { size: 14 })}
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {showEmail && (
        <EmailModal sessionId={sessionId} onClose={() => setShowEmail(false)} />
      )}

      {toast && (
        <div
          className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '260px' }}
        >
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>
            {toast.count} task{toast.count !== 1 ? 's' : ''} extracted
          </span>
          <button
            onClick={() => { setToast(null); navigate('/tasks'); }}
            className="text-xs font-medium ml-auto"
            style={{ color: 'var(--color-primary)' }}
          >
            View Tasks
          </button>
          <button onClick={() => setToast(null)} style={{ color: 'var(--color-muted)' }}>✕</button>
        </div>
      )}
    </>
  );
}

export default ExportMenu;
