import React, { useEffect } from 'react';
import { useIcon } from '../providers/IconProvider';

// Generic "How This Works" modal — same pattern as CrmInfoModal.jsx (which stays as-is since
// its content/wiring is CRM-specific), factored out so other tool pages (Video Tools, PDF
// Tools, Graphics) can reuse the shell with their own explainer content instead of each
// hand-rolling the same modal chrome. Auto-shows once per browser via the caller's localStorage
// key, always reachable via a header (i) button.
export default function ToolInfoModal({ title = 'How This Works', onClose, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const getIcon = useIcon();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            {getIcon('info', { size: 16 })}
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {children}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded hover:opacity-70 transition-all duration-200"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// One localStorage key per page — export a small helper so each caller doesn't hand-roll the
// try/catch localStorage dance from ClientDetailPage.jsx.
export function useToolInfoModal(storageKey) {
  const [show, setShow] = React.useState(() => {
    try { return !localStorage.getItem(storageKey); } catch { return false; }
  });
  const close = () => {
    setShow(false);
    try { localStorage.setItem(storageKey, '1'); } catch { /* private window — just won't remember */ }
  };
  const open = () => setShow(true);
  return { show, open, close };
}
