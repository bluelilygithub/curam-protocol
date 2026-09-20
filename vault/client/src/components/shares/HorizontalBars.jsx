import React from 'react';

const AUD_FORMATTER = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

// format: 'pct' (default, existing behaviour — signed %, red/green by sign)
// or 'aud' (currency, always the positive/accent colour — for amounts that
// are never "bad", like dividend income, not a P&L figure).
export default function HorizontalBars({ items = [], valueKey = 'pnlPct', labelKey = 'symbol', format = 'pct' }) {
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
        const valueLabel = format === 'aud'
          ? AUD_FORMATTER.format(v)
          : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
        const barColor = format === 'aud' ? 'var(--color-primary)' : (positive ? '#22c55e' : '#ef4444');
        return (
          <li key={it.symbol ? `${it.symbol}-${it.exchange || ''}` : it[labelKey]}>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--color-text)' }}>{it[labelKey]}</span>
              <span style={{ color: format === 'aud' ? 'var(--color-text)' : (positive ? '#22c55e' : '#ef4444') }}>
                {valueLabel}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
              <div
                className="h-2 rounded-full transition-all duration-200"
                style={{
                  width: `${pct}%`,
                  background: barColor,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
