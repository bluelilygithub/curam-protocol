import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

// Non-dismissable busy overlay shown while a Graphics operation runs.
export default function ProcessingModal({ open, title = 'Working…', message = 'This can take a few moments.' }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-busy="true"
    >
      <div
        className="w-full max-w-xs rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="px-6 py-7 flex flex-col items-center text-center gap-3">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</div>
            {message && <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{message}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
