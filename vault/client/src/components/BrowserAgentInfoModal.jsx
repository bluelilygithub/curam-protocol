import { useEffect } from 'react';
import { useIcon } from '../providers/IconProvider';

export const INFO_SEEN_KEY = 'vault_browser_agent_info_seen';

// Mirrors CrmInfoModal.jsx's pattern (info icon in the header, auto-shows once
// per browser, always reachable again via that icon).
export default function BrowserAgentInfoModal({ onClose }) {
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

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            A real headless Chromium browser, streamed live, filling in a form for you — but it never presses send.
          </p>

          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>It never submits.</strong> Every submit/send/pay/sign-in button is blocked in code (not just told not to), and while the agent is driving, any form POST is blocked at the network level too. It fills the form, then hands the browser to you with a summary of what it entered — you review and press the site's own button.
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>Your details</strong> (name, city, phone, email, address) come from its own Settings page, not the site — never invented. A missing required field is asked for live, mid-run.
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>Saved logins</strong> fill a username/password for sites you control, without the password ever reaching the AI model — it's decrypted and typed in server-side only.
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>Pause / Take over / Clear session</strong> are three different levels: Pause halts before the next step (resume to continue); Take over stops the run and gives you the mouse/keyboard; Clear session wipes what it remembers and blanks the page, for a genuinely fresh start.
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>Presets</strong> save a typed (or spoken) instruction as a one-click button for next time. <strong>Archive</strong> keeps every past run's steps, outcome and duration, searchable later.
            </p>
            <p style={{ color: 'var(--color-text)' }}>
              <strong>New tabs stay open</strong> (OAuth popups, payment redirects) instead of vanishing — the agent can list and switch between them.
            </p>
          </div>
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
