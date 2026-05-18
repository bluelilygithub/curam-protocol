import React, { useEffect } from 'react';
import useProcessingStore from '../store/processingStore';
import { getIcon } from '../providers/IconProvider';

/**
 * Global processing overlay.
 *
 * Renders when useProcessingStore has an active message. Blocks all interaction
 * and warns the user not to navigate away. Triggered via:
 *   useProcessingStore.getState().startProcessing('Your message here');
 *   useProcessingStore.getState().stopProcessing();
 *
 * Or destructured from the hook:
 *   const { startProcessing, stopProcessing } = useProcessingStore();
 */
export default function ProcessingModal() {
  const { message, detail } = useProcessingStore();

  // Warn browser-level navigation (reload / tab close) while processing
  useEffect(() => {
    if (!message) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [message]);

  if (!message) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', zIndex: 9998 }}
      // Swallow all pointer events so nothing behind is clickable
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-xl p-8 flex flex-col items-center gap-5 max-w-sm w-full mx-4 shadow-2xl"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {/* Spinning loader */}
        <div className="animate-spin" style={{ color: 'var(--color-primary)' }}>
          {getIcon('loader', { size: 40 })}
        </div>

        {/* Message */}
        <div className="text-center space-y-1.5">
          <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {message}
          </p>
          {detail && (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{detail}</p>
          )}
        </div>

        {/* Warning */}
        <p
          className="text-xs text-center px-2 py-2 rounded-lg w-full"
          style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
        >
          Please don't navigate away or close this tab until it finishes.
        </p>
      </div>
    </div>
  );
}
