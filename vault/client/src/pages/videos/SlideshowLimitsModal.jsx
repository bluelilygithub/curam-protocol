import React, { useEffect, useRef } from 'react';
import { SLIDESHOW_CAN, orderedLimits } from './slideshowLimits.mjs';

// Shown when "Plan my video" is pressed, BEFORE anything is sent to the planner. Explains what the
// Slideshow tool can't do (flagging the points the user's own description runs into) and how to get
// the same result with other Video Tools. Nothing proceeds until the user confirms; Cancel / Esc
// leaves everything as it was. Deliberately no click-outside dismiss — the choice must be explicit.

export default function SlideshowLimitsModal({ description, onConfirm, onCancel }) {
  const limits = orderedLimits(description);
  const flagged = limits.filter((l) => l.triggered);
  const cancelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    cancelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="slideshow-limits-title"
    >
      <div
        className="w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden max-h-[88vh] flex flex-col"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <h2 id="slideshow-limits-title" className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Before you plan: what the Slideshow can and can't do
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {flagged.length
              ? `Your description asks for ${flagged.length} thing${flagged.length === 1 ? '' : 's'} this tool can't produce. They're listed first, with ways around each.`
              : 'Nothing in your description looks out of reach, but here is what to keep in mind.'}
          </p>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>What it can do</p>
            <ul className="text-xs space-y-1 list-disc pl-4" style={{ color: 'var(--color-muted)' }}>
              {SLIDESHOW_CAN.map((c) => <li key={c}>{c}</li>)}
              <li>It only sees your description and the file names — not the pictures themselves.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>What it can't do — and how to get around it</p>
            {limits.map((l) => (
              <div
                key={l.id}
                className="rounded-xl border p-3 space-y-1"
                style={{ borderColor: l.triggered ? '#f59e0b' : 'var(--color-border)', background: l.triggered ? 'rgba(245,158,11,0.08)' : 'transparent' }}
              >
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                  {l.title}
                  {l.triggered && <span className="ml-2 text-[10px] font-medium" style={{ color: '#b45309' }}>in your description</span>}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{l.why}</p>
                <p className="text-xs" style={{ color: 'var(--color-text)' }}><strong>Way around it:</strong> {l.workaround}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="text-sm px-4 py-1.5 rounded-xl border transition-opacity duration-200 hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-sm px-4 py-1.5 rounded-xl transition-opacity duration-200 hover:opacity-80"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            Continue — plan what's possible
          </button>
        </div>
      </div>
    </div>
  );
}
