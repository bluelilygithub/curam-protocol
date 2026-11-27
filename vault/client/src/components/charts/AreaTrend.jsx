import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartTooltip from './ChartTooltip';
import { xAxisProps, yAxisProps, gridProps, animationProps } from './chartTheme.mjs';

// One series as a soft-filled area. format(v) for the axis and tooltip; xFormat(x) for the dates.
export default function AreaTrend({ points, xKey, yKey, name, format = (v) => v, xFormat = (x) => x, height = 220, ariaLabel }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xKey} tickFormatter={xFormat} minTickGap={40} {...xAxisProps} />
          <YAxis tickFormatter={format} domain={['auto', 'auto']} {...yAxisProps} />
          <Tooltip content={<ChartTooltip format={format} labelFormat={xFormat} />} />
          <Area type="monotone" dataKey={yKey} name={name} stroke="var(--chart-1)" strokeWidth={2.5} fill="var(--chart-1)" fillOpacity={0.12} {...animationProps()} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
