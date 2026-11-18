import React from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTip, XAxis, YAxis } from 'recharts';
import Skeleton from '../../components/Skeleton';
import { money, compact, pct, shortDay } from './ponytailFormat.mjs';

const ink = { fill: 'var(--color-muted)', fontSize: 11 };
const tipStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-text)' };
const CARD = 'rounded-2xl border p-5 space-y-3';
const cardStyle = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };

function ChartCard({ title, note, label, children, loading, footer }) {
  return (
    <section className={CARD} style={cardStyle}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
        {note && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{note}</p>}
      </div>
      {loading ? <Skeleton lines={4} label={`Loading ${title}`} /> : <div role="img" aria-label={label} style={{ width: '100%', height: 220 }}><ResponsiveContainer>{children}</ResponsiveContainer></div>}
      {!loading && footer}
    </section>
  );
}

const axes = (yFormat) => [
  <CartesianGrid key="g" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />,
  <XAxis key="x" dataKey="day" tickFormatter={shortDay} tick={ink} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} minTickGap={24} />,
  <YAxis key="y" tickFormatter={yFormat} tick={ink} tickLine={false} axisLine={false} width={48} />,
];

// Cost, reuse and tokens per Brisbane day. `days` is already filled so every day in the range is there.
export default function PonytailCharts({ days, loading }) {
  const data = days || [];
  const totalCost = data.reduce((s, d) => s + (d.cost || 0), 0);
  return (
    <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
      <ChartCard title="Cost per day" note="Each task counts on the day it started." loading={loading} label={`Cost per day, ${money(totalCost)} in all over ${data.length} days.`}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          {axes((v) => `$${v}`)}
          <ChartTip contentStyle={tipStyle} labelFormatter={shortDay} formatter={(v) => [money(v), 'Cost']} />
          <Bar dataKey="cost" name="Cost" fill="var(--color-primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartCard>
      <ChartCard title="Reuse per day" note="Average reuse share of that day's tasks. Gaps are days with no task that had a share." loading={loading} label="Average reuse share per day, as a percentage.">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          {axes((v) => `${v}%`)}
          <ChartTip contentStyle={tipStyle} labelFormatter={shortDay} formatter={(v) => [pct(v), 'Reuse']} />
          <Line type="monotone" dataKey="reuse" name="Reuse" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ChartCard>
      <div className="xl:col-span-2">
        <ChartCard
          title="Tokens per day"
          note="Cache is cache reads plus cache writes. Rows imported from the CSV count everything that is not output as input."
          loading={loading}
          label="Tokens per day, split into input, output and cache."
          footer={(
            // Recharts' own legend ignores the cache bars' opacity, so it would show Cache in the Input colour.
            <div className="flex justify-center gap-4 text-xs" style={{ color: 'var(--color-text)' }} aria-hidden="true">
              {[['Input', 1, 'var(--color-primary)'], ['Output', 1, 'var(--color-muted)'], ['Cache', 0.3, 'var(--color-primary)']].map(([name, opacity, colour]) => (
                <span key={name} className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: colour, opacity }} />{name}</span>
              ))}
            </div>
          )}
        >
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            {axes(compact)}
            <ChartTip contentStyle={tipStyle} labelFormatter={shortDay} formatter={(v, name) => [compact(v), name]} />
            <Bar dataKey="input" name="Input" stackId="t" fill="var(--color-primary)" isAnimationActive={false} />
            <Bar dataKey="output" name="Output" stackId="t" fill="var(--color-muted)" isAnimationActive={false} />
            <Bar dataKey="cache" name="Cache" stackId="t" fill="var(--color-primary)" fillOpacity={0.3} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  );
}
