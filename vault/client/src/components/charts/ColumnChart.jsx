import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip';
import { xAxisProps, yAxisProps, gridProps, animationProps } from './chartTheme.mjs';

// Vertical columns along a category axis (months, weeks), in --chart-1. format(v) for values; xFormat(x) for the labels.
export default function ColumnChart({ points, xKey, yKey, name, format = (v) => v, xFormat = (x) => x, height = 240, ariaLabel }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xKey} tickFormatter={xFormat} interval="preserveStartEnd" minTickGap={16} {...xAxisProps} />
          <YAxis tickFormatter={format} {...yAxisProps} />
          <Tooltip cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.4 }} content={<ChartTooltip format={format} labelFormat={xFormat} />} />
          <Bar dataKey={yKey} name={name} fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={36} {...animationProps()} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
