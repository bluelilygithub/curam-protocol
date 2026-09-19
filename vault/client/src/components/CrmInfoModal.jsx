import React, { useEffect } from 'react';
import { useIcon } from '../providers/IconProvider';

export const INFO_SEEN_KEY = 'vault_crm_client_info_seen';

// Mirrors client/src/pages/fonts/FontTutorialModal.jsx's pattern (info icon
// instead of sparkles, since Summarize already uses sparkles on this page) —
// auto-shows once per browser, always reachable via the header (i) button.
export default function CrmInfoModal({ onClose }) {
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
        className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            {getIcon('info', { size: 16 })}
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>How This Works</h2>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Touchpoints, follow-ups, and tasks are three separate things that connect one specific way —
            worth knowing up front so nothing feels hidden:
          </p>

          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>Touchpoints are a past-tense log.</strong> "I called them," "they emailed," "we met" —
              logged after it happens. Filter the list by channel (the chips above it) using the same
              type you picked when logging.
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>"+ Follow up" turns one into a Task.</strong> Hover a touchpoint row, click it, add a
              due date and a note, save. That's the only way a touchpoint becomes something scheduled —
              touchpoints themselves never carry a due date.
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>Tasks (below) show every open task for this client</strong> — whether linked through a
              project or directly (like a follow-up). Open one from here or from the main Tasks page to add
              a due date, attach a file, or export it to your calendar (.ics).
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>Attachments</strong> live on individual touchpoints (📎 on hover) or on a task itself —
              not on the client as a whole.
            </p>
          </div>

          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            One direction only: touchpoint → task. A task never turns back into a touchpoint.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
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
