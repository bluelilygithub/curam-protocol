import React from 'react';

// A headline figure: label, big value, a signed sub-line. `primary` fills it with the theme primary (text in --color-on-primary).
// `tone` colours the sub-line ('gain' | 'loss' | undefined); the sub-line must carry its own sign, never colour alone.
export default function StatTile({ label, value, sub, tone, primary = false, className = '' }) {
  const fg = primary ? 'var(--color-on-primary)' : 'var(--color-text)';
  const subColor = primary ? 'var(--color-on-primary)' : tone === 'gain' ? 'var(--chart-gain)' : tone === 'loss' ? 'var(--chart-loss)' : 'var(--color-muted)';
  return (
    <div
      className={`rounded-xl border p-4 min-w-0 ${className}`}
      style={primary
        ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }
        : { background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      <p className="text-xs truncate" style={{ color: primary ? 'var(--color-on-primary)' : 'var(--color-muted)', opacity: primary ? 0.9 : 1 }}>{label}</p>
      <p className="text-2xl xl:text-3xl font-bold mt-1 tabular-nums" style={{ color: fg }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: subColor }}>{sub}</p>}
    </div>
  );
}
