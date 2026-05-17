import React from 'react';

export default function HorizontalBars({ items = [], valueKey = 'pnlPct', labelKey = 'symbol' }) {
  if (!items.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        No holdings to chart.
      </p>
    );
  }

  const vals = items.map((it) => Number(it[valueKey]) || 0);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);

  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const v = Number(it[valueKey]) || 0;
        const pct = Math.max(4, (Math.abs(v) / maxAbs) * 100);
        const positive = v >= 0;
        return (
          <li key={`${it.symbol}-${it.exchange || ''}`}>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--color-text)' }}>{it[labelKey]}</span>
              <span style={{ color: positive ? '#22c55e' : '#ef4444' }}>
                {v >= 0 ? '+' : ''}{v.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
              <div
                className="h-2 rounded-full transition-all duration-200"
                style={{
                  width: `${pct}%`,
                  background: positive ? '#22c55e' : '#ef4444',
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
