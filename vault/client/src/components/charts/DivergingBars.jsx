import React from 'react';
import { maxAbsOf, divergingBar, positionPct } from './chartMath.mjs';

// Bars centred on zero: up to the right in --chart-gain, down to the left in --chart-loss, an optional tick (--chart-ink) for a
// reference value such as the index move. Figures sit on the right with their own signs, so colour is never the only cue.
//   items: [{ key, label, sublabel?, value, tick?, tickLabel?, valueText, amountText?, note?, noteTone? ('gain'|'loss') }]
export default function DivergingBars({ items, ariaLabel }) {
  const maxAbs = maxAbsOf(items.flatMap((it) => [it.value, it.tick]));
  return (
    <ul role="img" aria-label={ariaLabel} className="space-y-3">
      {items.map((it) => {
        const bar = divergingBar(it.value, maxAbs);
        const up = Number(it.value) >= 0;
        return (
          <li key={it.key} className="grid grid-cols-[1fr_auto] sm:grid-cols-[6.5rem_1fr_11rem] items-center gap-x-3 gap-y-1.5">
            <span className="min-w-0 order-1">
              <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{it.label}</span>
              {it.sublabel && <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{it.sublabel}</span>}
            </span>
            <span className="relative h-3 rounded-full order-3 col-span-2 sm:order-2 sm:col-span-1" style={{ background: 'var(--color-bg)' }}>
              <span className="absolute top-0 bottom-0 w-px" style={{ left: '50%', background: 'var(--chart-grid)' }} />
              <span className="absolute top-0 h-3 rounded-full" style={{ left: `${bar.left}%`, width: `${bar.width}%`, background: up ? 'var(--chart-gain)' : 'var(--chart-loss)' }} />
              {it.tick != null && (
                <span className="absolute -top-1 h-5 w-0.5 rounded" title={it.tickLabel} style={{ left: `calc(${positionPct(it.tick, maxAbs)}% - 1px)`, background: 'var(--chart-ink)' }} />
              )}
            </span>
            <span className="text-right tabular-nums order-2 sm:order-3">
              <span className="block text-sm font-medium" style={{ color: up ? 'var(--chart-gain)' : 'var(--chart-loss)' }}>
                {it.valueText}{it.amountText && <span className="font-normal" style={{ color: 'var(--color-muted)' }}> · {it.amountText}</span>}
              </span>
              {it.note && <span className="block text-xs" style={{ color: it.noteTone === 'gain' ? 'var(--chart-gain)' : it.noteTone === 'loss' ? 'var(--chart-loss)' : 'var(--color-muted)' }}>{it.note}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
