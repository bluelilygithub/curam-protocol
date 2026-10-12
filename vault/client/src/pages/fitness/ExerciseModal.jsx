import React, { useEffect, useRef } from 'react';
import { useIcon } from '../../providers/IconProvider';
import { ExerciseDetail } from './LibraryView';

/**
 * An exercise explained in a window over whatever you were looking at, so closing it puts you straight back where you were.
 * Escape, the close button or a click outside all close it. Easier and harder versions swap the content in place.
 */
export default function ExerciseModal({ slug, onClose, onOpen, onHiddenChange }) {
  const getIcon = useIcon();
  const close = useRef(null);
  const panel = useRef(null);

  useEffect(() => {
    close.current?.focus();
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  // a new exercise inside the window starts at the top
  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [slug]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Exercise"
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="sticky top-0 z-10 flex justify-end p-2" style={{ background: 'linear-gradient(var(--color-bg) 70%, transparent)' }}>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:opacity-70 transition-all duration-200"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            {getIcon('x', { size: 15 })}Close
          </button>
        </div>
        <div className="px-3 pb-4 sm:px-5 sm:pb-6 -mt-1">
          <ExerciseDetail slug={slug} onOpen={onOpen} onHiddenChange={onHiddenChange} />
        </div>
      </div>
    </div>
  );
}
