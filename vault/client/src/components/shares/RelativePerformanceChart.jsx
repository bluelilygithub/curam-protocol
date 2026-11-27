import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import ChartTooltip from '../charts/ChartTooltip';
import { xAxisProps, yAxisProps, gridProps, animationProps, seriesColor } from '../charts/chartTheme.mjs';

// Portfolio vs the index proxies, rebased to 100. Dashed 100 baseline; the portfolio line is thicker; the legend shows each end value.
const SERIES = [
  { key: 'portfolio', label: 'Your holdings', width: 3.5 },
  { key: 'nasdaq', label: 'Nasdaq', width: 2 },
  { key: 'sox', label: 'SOX', width: 2 },
  { key: 'asx', label: 'ASX 200', width: 2 },
];
const day = (d) => { try { return new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); } catch { return d; } };

export default function RelativePerformanceChart({ points }) {
  const last = (key) => { for (let i = points.length - 1; i >= 0; i--) if (Number.isFinite(Number(points[i][key]))) return Number(points[i][key]); return null; };
  const shown = SERIES.map((s, i) => ({ ...s, color: seriesColor(i), end: last(s.key) })).filter((s) => s.end != null);
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {shown.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
            <span className="inline-block w-4 rounded" style={{ height: s.width, background: s.color }} aria-hidden="true" />
            {s.label}
            <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{s.end.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <div role="img" aria-label={`Line chart rebased to 100: ${shown.map((s) => `${s.label} ends at ${s.end.toFixed(1)}`).join(', ')}`} style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={day} minTickGap={40} {...xAxisProps} />
            <YAxis domain={['auto', 'auto']} tickFormatter={(v) => Number(v).toFixed(0)} {...yAxisProps} width={40} />
            <ReferenceLine y={100} stroke="var(--chart-ink)" strokeDasharray="4 4" strokeOpacity={0.6} />
            <Tooltip content={<ChartTooltip format={(v) => Number(v).toFixed(1)} labelFormat={day} />} />
            {shown.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={s.width} dot={false} connectNulls {...animationProps()} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
