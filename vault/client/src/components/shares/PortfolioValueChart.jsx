import React from 'react';
import { ResponsiveContainer, AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartTooltip from '../charts/ChartTooltip';
import { xAxisProps, yAxisProps, gridProps, animationProps } from '../charts/chartTheme.mjs';
import { fmtAud } from '../charts/chartFormat.mjs';

// Portfolio value over the range: one soft-filled area for the total, or holdings (area) plus a dashed cash line.
const when = (iso, intraday) => {
  try {
    const d = new Date(iso);
    return intraday
      ? d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  } catch { return String(iso).slice(0, 10); }
};
const compact = (v) => (Math.abs(v) >= 1000 ? `A$${(v / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1)}k` : `A$${Math.round(v)}`);

export default function PortfolioValueChart({ points, split, intraday }) {
  const aud = (v) => fmtAud(v, { signed: false });
  const mainKey = split ? 'holdingsValueAud' : 'totalValueAud';
  return (
    <div role="img" aria-label={split ? 'Area chart of holdings value with a dashed line for cash' : 'Area chart of total portfolio value'} style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="recordedAt" tickFormatter={(v) => when(v, intraday)} minTickGap={40} {...xAxisProps} />
          <YAxis tickFormatter={compact} domain={['auto', 'auto']} {...yAxisProps} />
          <Tooltip content={<ChartTooltip format={aud} labelFormat={(l) => when(l, intraday)} />} />
          <Area type="monotone" dataKey={mainKey} name={split ? 'Holdings' : 'Total'} stroke="var(--chart-1)" strokeWidth={2.5} fill="var(--chart-1)" fillOpacity={0.12} {...animationProps()} />
          {split && <Line type="monotone" dataKey="cashAud" name="Cash" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="6 4" dot={false} {...animationProps()} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
