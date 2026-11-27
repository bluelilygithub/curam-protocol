import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts';
import ChartTooltip from './ChartTooltip';
import { xAxisProps, yAxisProps, gridProps, animationProps, seriesColor } from './chartTheme.mjs';

// Two or more series side by side along a category axis (quarters, months), above and below a zero line. Series take the kit's
// series colours, not gain/loss, so the sign is carried by the zero line and the signed figures in the tooltip.
//   points: [{ [xKey]: label, [series.key]: number | null }], series: [{ key, name, color? }] (color: a --chart-* var)
export default function GroupedColumns({ points, xKey, series, format = (v) => v, height = 240, ariaLabel }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xKey} interval={0} {...xAxisProps} />
          <YAxis tickFormatter={format} {...yAxisProps} />
          <ReferenceLine y={0} stroke="var(--chart-ink)" strokeWidth={1} />
          <Tooltip cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }} content={<ChartTooltip format={format} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--color-muted)' }} iconType="square" iconSize={10} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color || seriesColor(i)} radius={[4, 4, 4, 4]} maxBarSize={28} {...animationProps()} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
