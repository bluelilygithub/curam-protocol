import React from 'react';
import { fmtAud } from '../charts/chartFormat.mjs';

// Amounts that are never "bad" (dividend income): one bar per item in --chart-1, the amount on the right.
export default function HorizontalBars({ items = [], valueKey = 'totalAud', labelKey = 'symbol', ariaLabel }) {
  if (!items.length) return <p className="text-xs py-4 text-center" style={{ color: 'var(--color-muted)' }}>Nothing to chart yet.</p>;
  const max = Math.max(...items.map((it) => Number(it[valueKey]) || 0), 1);
  return (
    <ul className="space-y-3" role="img" aria-label={ariaLabel}>
      {items.map((it) => {
        const v = Number(it[valueKey]) || 0;
        return (
          <li key={`${it[labelKey]}-${it.exchange || ''}`} className="grid grid-cols-[4.5rem_1fr_6.5rem] sm:grid-cols-[6.5rem_1fr_8rem] items-center gap-3">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{it[labelKey]}</span>
            <span className="h-3 rounded-full" style={{ background: 'var(--color-bg)' }}>
              <span className="block h-3 rounded-full" style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: 'var(--chart-1)' }} />
            </span>
            <span className="text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtAud(v, { signed: false, digits: 2 })}</span>
          </li>
        );
      })}
    </ul>
  );
}
