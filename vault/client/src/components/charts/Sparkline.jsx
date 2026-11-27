import React from 'react';
import { ResponsiveContainer, LineChart, Line, YAxis } from 'recharts';
import { animationProps } from './chartTheme.mjs';

// A small line with no axes, coloured by direction (first to last point). points: [{ [dataKey]: number }].
export default function Sparkline({ points, dataKey, up, height = 48, ariaLabel }) {
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey={dataKey} stroke={up ? 'var(--chart-gain)' : 'var(--chart-loss)'} strokeWidth={2} dot={false} {...animationProps()} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
