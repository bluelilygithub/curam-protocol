import React from 'react';

export default function SimpleLineChart({
  points = [],
  valueKey = 'totalValueAud',
  width = 480,
  height = 160,
  label = 'Value',
}) {
  if (!points.length) {
    return (
      <p className="text-xs py-8 text-center" style={{ color: 'var(--color-muted)' }}>
        No snapshots yet today — use Refresh or wait for the next poll.
      </p>
    );
  }

  const values = points.map((p) => Number(p[valueKey]) || 0);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const range = maxY - minY || 1;
  const pad = { l: 48, r: 12, t: 14, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const n = values.length;

  const coords = values.map((v, i) => {
    const x = pad.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const y = pad.t + h - ((v - minY) / range) * h;
    return { x, y, v };
  });

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  const fmt = (v) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v);

  return (
    <div>
      <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="max-w-full" style={{ display: 'block' }}>
        <line x1={pad.l} y1={pad.t + h} x2={width - pad.r} y2={pad.t + h} stroke="var(--color-border)" />
        <text x={pad.l - 4} y={pad.t + 10} textAnchor="end" fontSize="9" fill="var(--color-muted)">{fmt(maxY)}</text>
        <text x={pad.l - 4} y={pad.t + h} textAnchor="end" fontSize="9" fill="var(--color-muted)">{fmt(minY)}</text>
        <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="3" fill="var(--color-primary)" />
        ))}
      </svg>
    </div>
  );
}

