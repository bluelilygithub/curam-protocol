import React from 'react';

export default function QuizPurposePanel({ open, onToggle, title, summary, points = [], guidance = [], caveat }) {
  return (
    <section className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:opacity-80 transition-opacity"
      >
        <div>
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>About this quiz</p>
          <h2 className="text-sm font-semibold mt-0.5" style={{ color: 'var(--color-text)' }}>{title}</h2>
        </div>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{summary}</p>
          {points.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text)' }}>What it is trying to show</h3>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--color-muted)' }}>
                {points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </div>
          )}
          {guidance.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text)' }}>How to answer</h3>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--color-muted)' }}>
                {guidance.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {caveat && (
            <p className="rounded-xl border p-3 text-xs leading-relaxed" style={{ borderColor: '#fde68a', background: '#fffbeb', color: '#78350f' }}>
              {caveat}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
