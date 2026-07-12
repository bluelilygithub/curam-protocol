import React from 'react';

export default function BenchmarkBarChart({ items = [] }) {
  if (!items.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        Benchmark data unavailable — check quote API keys.
      </p>
    );
  }

  const maxAbs = Math.max(...items.map((it) => Math.abs(Number(it.pct) || 0)), 1);

  return (
    <div className="space-y-3">
      {items.map((it) => {
        const v = Number(it.pct) || 0;
        const positive = v >= 0;
        const widthPct = Math.max(6, (Math.abs(v) / maxAbs) * 100);
        const isPortfolio = it.kind === 'portfolio';
        return (
          <div key={it.label}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium" style={{ color: isPortfolio ? 'var(--color-text)' : 'var(--color-muted)' }}>
                {it.label}
              </span>
              <span style={{ color: positive ? '#16a34a' : '#dc2626', fontWeight: isPortfolio ? 600 : 400 }}>
                {v >= 0 ? '+' : ''}{v.toFixed(2)}%
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden relative" style={{ background: 'var(--color-border)' }}>
              <div
                className="h-3 rounded-full transition-all duration-200 absolute top-0"
                style={{
                  width: `${widthPct}%`,
                  left: positive ? '50%' : `${50 - widthPct}%`,
                  background: isPortfolio ? 'var(--color-primary)' : positive ? '#22c55e' : '#ef4444',
                  opacity: isPortfolio ? 1 : 0.75,
                }}
              />
              <div className="absolute top-0 left-1/2 w-px h-3" style={{ background: 'var(--color-muted)', opacity: 0.4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
