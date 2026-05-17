import React from 'react';

export default function QuizProgressBar({ completed, total, label }) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <div className="mb-4">
      {label ? (
        <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>
          <span>{label}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
      ) : null}
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--color-border)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: 'var(--color-primary)' }} />
      </div>
    </div>
  );
}
