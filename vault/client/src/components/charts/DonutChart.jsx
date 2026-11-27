import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { seriesColor, animationProps } from './chartTheme.mjs';

// A donut with a label in the middle and a legend listing each slice's % and detail (for example the symbols in a bucket).
//   slices: [{ key, label, pct, detail? }]
export default function DonutChart({ slices, centreValue, centreLabel, ariaLabel, colorFor = (i) => (i < 4 ? seriesColor(i) : 'var(--chart-neutral)') }) {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0" style={{ width: 200, height: 200 }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="pct" nameKey="label" innerRadius={62} outerRadius={94} paddingAngle={2} stroke="var(--color-surface)" strokeWidth={2} {...animationProps()}>
              {slices.map((s, i) => <Cell key={s.key} fill={colorFor(i)} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{centreValue}</span>
          {centreLabel && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{centreLabel}</span>}
        </div>
      </div>
      <ul className="space-y-2.5 min-w-0 w-full">
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-start gap-3">
            <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ background: colorFor(i) }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-3 text-sm">
                <span className="font-medium truncate" style={{ color: 'var(--color-text)' }}>{s.label}</span>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{Number(s.pct).toFixed(1)}%</span>
              </span>
              {s.detail && <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{s.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
