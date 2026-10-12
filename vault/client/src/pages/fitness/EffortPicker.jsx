import React from 'react';
import { selectedStyle } from './ui';

function rowFor(scale, value) {
  if (!value) return null;
  return (scale || []).find((r) => {
    const [lo, hi] = r.score.split('-').map(Number);
    return value >= lo && value <= (hi || lo);
  }) || null;
}

/**
 * "How hard did it feel?" as ten tiles. The line underneath puts the number next to the talk test, so the two always line up.
 * Optional everywhere: tapping the chosen tile again clears it.
 */
export default function EffortPicker({ value, onChange, scale, label = 'How hard did it feel?' }) {
  const row = rowFor(scale, value);
  return (
    <div>
      <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>{label} <span>(optional, 1 is very light, 10 is as hard as it gets)</span></p>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(active ? null : n)}
              className="h-10 rounded-xl border text-sm font-medium hover:opacity-70 transition-all duration-200"
              style={selectedStyle(active)}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed mt-1.5 min-h-[2.5em]" style={{ color: 'var(--color-muted)' }}>
        {row ? `${row.feel}. Talk test: ${row.talk.charAt(0).toLowerCase()}${row.talk.slice(1)}.` : 'Skip this if you are not sure.'}
      </p>
    </div>
  );
}
