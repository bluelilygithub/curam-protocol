import React, { useEffect, useRef } from 'react';
import { useIcon } from '../providers/IconProvider';
import useProcessingStore from '../store/processingStore';

// Non-dismissable busy overlay. Normally rendered once in App.jsx and driven by
// useProcessingStore; explicit props still override the store for back-compat.
export default function ProcessingModal({ open, title, message }) {
  const getIcon = useIcon();
  const storeMessage = useProcessingStore((s) => s.message);
  const storeDetail = useProcessingStore((s) => s.detail);
  const steps = useProcessingStore((s) => s.steps);
  const cancellable = useProcessingStore((s) => s.cancellable);
  const cancelHandler = useProcessingStore((s) => s.cancelHandler);
  const stopProcessing = useProcessingStore((s) => s.stopProcessing);
  const logRef = useRef(null);

  const isOpen = open !== undefined ? open : !!storeMessage;
  const heading = title !== undefined ? title : (storeMessage || 'Working…');
  const body = message !== undefined ? message : (storeDetail ?? 'This can take a few moments.');
  const hasSteps = Array.isArray(steps) && steps.length > 0;
  const doneCount = hasSteps ? steps.filter((s) => s.status === 'done').length : 0;
  // Active step counts as half-progress so the bar still moves while it's running,
  // not just when a step flips to done.
  const activeBonus = hasSteps && steps.some((s) => s.status === 'active') ? 0.5 : 0;
  const progressPct = hasSteps ? Math.min(100, Math.round(((doneCount + activeBonus) / steps.length) * 100)) : 0;

  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  useEffect(() => {
    if (!hasSteps || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [steps, hasSteps]);

  if (!isOpen) return null;

  function handleCancel() {
    try {
      cancelHandler?.();
    } finally {
      stopProcessing();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-busy="true"
    >
      <div
        className={`w-full rounded-2xl shadow-2xl overflow-hidden ${hasSteps ? 'max-w-md' : 'max-w-xs'}`}
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className={`px-6 ${hasSteps ? 'pt-6 pb-4' : 'py-7'} flex flex-col ${hasSteps ? 'items-stretch' : 'items-center text-center'} gap-3`}>
          <div className={`flex ${hasSteps ? 'items-start gap-3' : 'flex-col items-center gap-3'}`}>
            <span className={`shrink-0 ${hasSteps ? 'mt-0.5' : ''} animate-spin`} style={{ color: 'var(--color-primary)' }}>
              {getIcon('loader', { size: hasSteps ? 22 : 28 })}
            </span>
            <div className={hasSteps ? 'min-w-0 flex-1' : ''}>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{heading}</div>
              {body && <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{body}</div>}
            </div>
          </div>

          {hasSteps && (
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--color-border)' }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${progressPct}%`, background: 'var(--color-primary)' }}
              />
            </div>
          )}

          {hasSteps && (
            <div
              ref={logRef}
              className="mt-1 max-h-56 overflow-y-auto rounded-xl border px-3 py-2 space-y-1.5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              aria-live="polite"
            >
              {steps.map((step) => {
                const done = step.status === 'done';
                const active = step.status === 'active';
                const errored = step.status === 'error';
                return (
                  <div key={step.id} className="flex items-start gap-2 py-0.5">
                    <span
                      className={`mt-0.5 shrink-0 ${active ? 'animate-spin' : ''}`}
                      style={{ color: done ? '#16a34a' : errored ? '#ef4444' : active ? 'var(--color-primary)' : 'var(--color-muted)' }}
                    >
                      {done
                        ? getIcon('check', { size: 14 })
                        : active
                          ? getIcon('loader', { size: 14 })
                          : getIcon('circle', { size: 14 })}
                    </span>
                    <span
                      className="text-xs leading-snug"
                      style={{
                        color: done || active ? 'var(--color-text)' : 'var(--color-muted)',
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-center" style={{ color: 'var(--color-muted)' }}>
            Please don’t navigate away
          </p>

          {cancellable && (
            <button
              type="button"
              onClick={handleCancel}
              className="mt-1 w-full px-3 py-2 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
