import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceArea, Tooltip as RTooltip } from 'recharts';

const WHO_LOW = 150;
const WHO_HIGH = 300;

/**
 * Weekly aerobic minutes (moderate-equivalent) from today across the five years, with the WHO 150-300 band shaded.
 * Neutral colours on purpose: it is a picture of a plan, not a status.
 */
export default function AerobicChart({ plan, projection = null }) {
  // The dotted line is where your recent logged weeks are heading (only with enough logged weeks, see dashboard.js).
  const proj = projection && projection.status === 'ok' ? projection : null;
  const projAt = (year) => proj?.points.find((p) => p.year === year)?.minutes ?? null;
  const data = [
    { label: 'Now', minutes: plan.now.aerobicModerateMin, projected: proj ? proj.level : null }, // minutes null when not entered: the line then starts at Year 1
    ...plan.milestones.map((m) => ({ label: `Year ${m.year}`, minutes: m.weekly.aerobicModerateMin, projected: projAt(m.year) })),
  ];
  const top = Math.max(WHO_HIGH + 30, ...data.map((d) => Math.max(d.minutes ?? 0, d.projected ?? 0) + 20));
  const yMax = Math.ceil(top / 50) * 50;
  const summary = data.map((d) => `${d.label} ${d.minutes == null ? 'not entered' : `${d.minutes} minutes`}${d.projected != null ? `, at your recent pace ${d.projected}` : ''}`).join(', ');

  return (
    <figure className="m-0" data-tour="fitness-chart">
      <figcaption className="text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>Weekly aerobic minutes</figcaption>
      <div style={{ width: '100%', height: 220 }} role="img" aria-label={`Weekly aerobic minutes over five years against the WHO range of ${WHO_LOW} to ${WHO_HIGH}: ${summary}.`}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <ReferenceArea
              y1={WHO_LOW}
              y2={WHO_HIGH}
              fill="var(--color-muted)"
              fillOpacity={0.16}
              stroke="none"
              ifOverflow="visible"
              label={{ value: 'WHO range 150-300', position: 'insideTopRight', fill: 'var(--color-muted)', fontSize: 11 }}
            />
            <XAxis dataKey="label" tick={{ fill: 'var(--color-muted)', fontSize: 12 }} stroke="var(--color-border)" />
            <YAxis
              domain={[0, yMax]}
              tick={{ fill: 'var(--color-muted)', fontSize: 12 }}
              stroke="var(--color-border)"
              width={44}
              label={{ value: 'min / week', angle: -90, position: 'insideLeft', fill: 'var(--color-muted)', fontSize: 11 }}
            />
            <RTooltip
              formatter={(v, name) => [`${v} min`, name === 'projected' ? 'At your recent pace' : 'Planned']}
              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-text)' }}
            />
            <Line type="monotone" dataKey="minutes" connectNulls={false} stroke="var(--color-text)" strokeWidth={2} dot={{ r: 4, fill: 'var(--color-text)' }} isAnimationActive={false} />
            {proj && <Line type="monotone" dataKey="projected" connectNulls stroke="var(--color-muted)" strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" dot={{ r: 3, fill: 'var(--color-muted)' }} isAnimationActive={false} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {projection && (
        <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--color-text)' }} data-testid="projection-sentence">
          {proj && <span className="text-xs mr-1.5" style={{ color: 'var(--color-muted)' }}>Dotted line:</span>}{projection.sentence}
        </p>
      )}
      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
        Moderate-intensity equivalents. Hard effort counts double, so 75-150 vigorous minutes sit in the same band. {plan.now.minutesSource === 'entered' ? '"Now" is what you told us.' : 'Your current minutes are not entered, so the chart starts at Year 1.'}
      </p>
    </figure>
  );
}
