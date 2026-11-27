import React from 'react';

// A stepped meter (e.g. Weak / Moderate / Strong): segments filled up to `index`, in `color`, with the level written beside it so the
// level is never shown by colour alone. Generic: the caller picks the labels and the colour (a --chart-* var).
export default function LevelMeter({ labels, index, color = 'var(--chart-1)', label }) {
  if (index < 0 || index >= labels.length) return null;
  return (
    <span className="inline-flex items-center gap-2 shrink-0" role="img" aria-label={label || `${labels[index]} (${index + 1} of ${labels.length})`}>
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {labels.map((l, i) => (
          <span key={l} className="h-2 w-5 rounded-sm" style={{ background: i <= index ? color : 'var(--chart-grid)' }} />
        ))}
      </span>
      <span className="text-xs w-16" style={{ color: 'var(--color-text)' }} aria-hidden="true">{labels[index]}</span>
    </span>
  );
}
