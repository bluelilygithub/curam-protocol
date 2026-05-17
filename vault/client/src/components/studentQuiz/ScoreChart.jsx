import React from 'react';

/** Simple inline SVG line chart — no external libs. */
export default function ScoreChart({ points, width = 320, height = 120 }) {
  if (!points?.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        No attempt scores yet.
      </p>
    );
  }

  const pad = { l: 28, r: 8, t: 12, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const scores = points.map((p) => Number(p.score) || 0);
  const maxY = 100;
  const n = scores.length;

  const coords = scores.map((s, i) => {
    const x = pad.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const y = pad.t + h - (s / maxY) * h;
    return { x, y, s };
  });

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="max-w-full" style={{ display: 'block' }}>
      {[0, 25, 50, 75, 100].map((v) => {
        const y = pad.t + h - (v / maxY) * h;
        return (
          <g key={v}>
            <line x1={pad.l} y1={y} x2={width - pad.r} y2={y} stroke="var(--color-border)" strokeWidth="1" />
            <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="9" fill="var(--color-muted)">{v}</text>
          </g>
        );
      })}
      <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="3.5" fill="var(--color-primary)" />
      ))}
    </svg>
  );
}
