import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function QuizBuildingModal({ title }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-building-title"
      aria-busy="true"
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 shadow-2xl text-center space-y-4"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      >
        <div
          className="w-10 h-10 mx-auto rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
        />
        <div>
          <h2 id="quiz-building-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            Building your quiz
          </h2>
          {title ? (
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{title}</p>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
          AI is generating your question pool. This can take up to two minutes.
        </p>
        <p className="text-xs font-medium" style={{ color: '#f59e0b' }}>
          Please stay on this page until building finishes. Leaving may interrupt generation.
        </p>
      </div>
    </div>,
    document.body,
  );
}
