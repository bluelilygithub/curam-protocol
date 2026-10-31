import React from 'react';
import { useIcon } from '../providers/IconProvider';
import Dialog from './Dialog';

// Generic "How This Works" modal — same pattern as CrmInfoModal.jsx (which stays as-is since
// its content/wiring is CRM-specific), factored out so other tool pages (Video Tools, PDF
// Tools, Graphics) can reuse the shell with their own explainer content instead of each
// hand-rolling the same modal chrome. Auto-shows once per browser via the caller's localStorage
// key, always reachable via a header (i) button.
export default function ToolInfoModal({ title = 'How This Works', onClose, children }) {
  const getIcon = useIcon();

  return (
    <Dialog
      title={title}
      icon={getIcon('info', { size: 16 })}
      size="lg"
      onClose={onClose}
      footer={(
        <button
          onClick={onClose}
          className="text-sm px-4 py-1.5 rounded hover:opacity-70 transition-all duration-200"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          Got it
        </button>
      )}
    >
      <div className="space-y-4">{children}</div>
    </Dialog>
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
