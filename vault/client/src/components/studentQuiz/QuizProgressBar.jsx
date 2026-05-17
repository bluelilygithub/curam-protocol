import React from 'react';

export default function QuizProgressBar({ completed, total, label, sublabel }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((completed / total) * 100))) : 0;
  const fillPct = pct > 0 ? Math.max(pct, 4) : 0;

  return (
    <div
      className="mb-4 rounded-xl border p-3"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      {label ? (
        <div className="flex justify-between items-baseline gap-2 text-xs mb-2" style={{ color: 'var(--color-text)' }}>
          <span className="font-medium">{label}</span>
          <span className="tabular-nums font-semibold" style={{ color: 'var(--color-primary)' }}>{pct}%</span>
        </div>
      ) : null}
      {sublabel ? (
        <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>{sublabel}</p>
      ) : null}
      <div
        className="h-3 rounded-full overflow-hidden"
        style={{ background: 'var(--color-border)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Quiz progress'}
      >
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{ width: `${fillPct}%`, background: 'var(--color-primary)' }}
        />
      </div>
    </div>
  );
}
