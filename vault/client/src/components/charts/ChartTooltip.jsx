import React from 'react';

// Content for a Recharts <Tooltip content={<ChartTooltip … />} />, themed from the vars.
//   format(value, entry) formats each figure; labelFormat(label) formats the heading (usually a date).
export default function ChartTooltip({ active, payload, label, format = (v) => v, labelFormat = (l) => l }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border px-3 py-2 text-xs shadow-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
      {label != null && label !== '' && <p className="mb-1" style={{ color: 'var(--color-muted)' }}>{labelFormat(label)}</p>}
      {payload.map((p) => (
        <p key={p.dataKey || p.name} className="flex items-center gap-2 tabular-nums">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color || p.stroke || p.fill }} aria-hidden="true" />
          <span style={{ color: 'var(--color-muted)' }}>{p.name}</span>
          <span className="font-medium ml-auto">{format(p.value, p)}</span>
        </p>
      ))}
    </div>
  );
}
