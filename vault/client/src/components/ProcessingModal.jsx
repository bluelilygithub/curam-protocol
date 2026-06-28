import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import useProcessingStore from '../store/processingStore';

// Non-dismissable busy overlay. Normally rendered once in App.jsx and driven by
// useProcessingStore; explicit props still override the store for back-compat.
export default function ProcessingModal({ open, title, message }) {
  const storeMessage = useProcessingStore((s) => s.message);
  const storeDetail = useProcessingStore((s) => s.detail);

  const isOpen = open !== undefined ? open : !!storeMessage;
  const heading = title !== undefined ? title : (storeMessage || 'Working…');
  const body = message !== undefined ? message : (storeDetail ?? 'This can take a few moments.');

  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  if (!isOpen) return null;

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
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{heading}</div>
            {body && <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{body}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
