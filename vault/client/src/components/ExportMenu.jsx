import React, { useState, useRef, useEffect } from 'react';
import { useIcon } from '../providers/IconProvider';
import { exportChatJson, exportChatPdf, exportProject } from '../utils/exportHelpers';
import EmailModal from './EmailModal';

function ExportMenu({ sessionId, projectId }) {
  const [open, setOpen] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const menuRef = useRef(null);
  const getIcon = useIcon();

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
          {getIcon('download', { size: 13 })}
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
    </>
  );
}

export default ExportMenu;
