import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import { thresholdBar } from './chartMath.mjs';

// How far each item has fallen against a trigger: a bar, a dashed trigger line, and a status badge with an icon and a word.
//   items: [{ key, label, sublabel?, size (positive, e.g. 8 = 8% off), status ('within'|'near'|'past'), valueText, subText? }]
//   trigger: where the line goes (same units as size). labels: words for the badge.
const LOOK = {
  within: { icon: 'check-circle', color: 'var(--color-muted)', bar: 'var(--chart-neutral)' },
  near: { icon: 'alert-triangle', color: 'var(--chart-warn)', bar: 'var(--chart-warn)' },
  past: { icon: 'alert-circle', color: 'var(--chart-loss)', bar: 'var(--chart-loss)' },
};

export default function ThresholdBars({ items, trigger, triggerLabel, labels = { within: 'Within', near: 'Near', past: 'Past' }, ariaLabel }) {
  const getIcon = useIcon();
  const scaleMax = Math.max(0, ...items.map((it) => Number(it.size) || 0));
  const line = thresholdBar(0, trigger, scaleMax).triggerAt;
  return (
    <div role="img" aria-label={ariaLabel} className="space-y-3">
      <ul className="space-y-3">
        {items.map((it) => {
          const look = LOOK[it.status] || LOOK.within;
          const { width } = thresholdBar(it.size, trigger, scaleMax);
          return (
            <li key={it.key} className="grid grid-cols-[1fr_auto] sm:grid-cols-[6.5rem_1fr_11rem] items-center gap-x-3 gap-y-1.5">
              <span className="min-w-0 order-1">
                <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{it.label}</span>
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: look.color }}>
                  {getIcon(look.icon, { size: 12 })}{labels[it.status] || labels.within}
                </span>
              </span>
              <span className="relative h-3 rounded-full order-3 col-span-2 sm:order-2 sm:col-span-1" style={{ background: 'var(--color-bg)' }}>
                <span className="absolute top-0 left-0 h-3 rounded-full" style={{ width: `${width}%`, background: look.bar }} />
                <span className="absolute -top-1 h-5 border-l-2 border-dashed" style={{ left: `${line}%`, borderColor: 'var(--chart-ink)' }} />
              </span>
              <span className="text-right tabular-nums order-2 sm:order-3">
                <span className="block text-sm font-medium" style={{ color: it.status === 'within' ? 'var(--color-text)' : look.color }}>{it.valueText}</span>
                {it.subText && <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{it.subText}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {triggerLabel && (
        <p className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span className="inline-block h-3 border-l-2 border-dashed" style={{ borderColor: 'var(--chart-ink)' }} aria-hidden="true" />{triggerLabel}
        </p>
      )}
    </div>
  );
}
