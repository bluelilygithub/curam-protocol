import React from 'react';

const SERIES_COLORS = {
  portfolio: 'var(--color-primary)',
  totalValueAud: 'var(--color-primary)',
  holdingsValueAud: '#6B9E70',
  cashAud: '#5B6FAD',
  pnlPct: '#C9A84C',
  nasdaq: '#5B6FAD',
  sox: '#8A5C8A',
  asx: '#6B97B5',
  audPerOz: '#C9A84C',
  priceAud: 'var(--color-primary)',
};

function fmtTime(iso, short = false) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (short) {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    return String(iso).slice(0, 10);
  }
}

function fmtDateLabel(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
  } catch {
    return dateStr;
  }
}

export default function MultiLineChart({
  points = [],
  series = [{ key: 'totalValueAud', label: 'Value' }],
  width = 520,
  height = 180,
  emptyMessage = 'No snapshot data for this period — use Refresh or wait for the next poll.',
  valueFormatter,
  dateKey = 'recordedAt',
}) {
  if (!points.length) {
    return (
      <p className="text-xs py-8 text-center" style={{ color: 'var(--color-muted)' }}>{emptyMessage}</p>
    );
  }

  const allVals = [];
  for (const p of points) {
    for (const s of series) {
      const v = Number(p[s.key]);
      if (Number.isFinite(v)) allVals.push(v);
    }
  }
  if (!allVals.length) {
    return (
      <p className="text-xs py-8 text-center" style={{ color: 'var(--color-muted)' }}>{emptyMessage}</p>
    );
  }

  const minY = Math.min(...allVals);
  const maxY = Math.max(...allVals);
  const range = maxY - minY || 1;
  const pad = { l: 52, r: 12, t: 18, b: 36 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const n = points.length;

  const xAt = (i) => pad.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const yAt = (v) => pad.t + h - ((v - minY) / range) * h;

  const defaultFmt = (v) => {
    if (Math.abs(v) >= 1000 && Math.abs(v) < 1000000) {
      return `$${(v / 1000).toFixed(1)}k`;
    }
    if (Math.abs(v) >= 100 && Math.abs(v) < 1000) return v.toFixed(0);
    if (Math.abs(v) < 200) return `${v.toFixed(1)}%`;
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v);
  };
  const fmt = valueFormatter || defaultFmt;

  const xLabels = [
    { i: 0, label: points[0].date ? fmtDateLabel(points[0].date) : fmtTime(points[0][dateKey], n > 8) },
    ...(n > 2 ? [{ i: Math.floor(n / 2), label: points[Math.floor(n / 2)].date ? fmtDateLabel(points[Math.floor(n / 2)].date) : fmtTime(points[Math.floor(n / 2)][dateKey], n > 8) }] : []),
    ...(n > 1 ? [{ i: n - 1, label: points[n - 1].date ? fmtDateLabel(points[n - 1].date) : fmtTime(points[n - 1][dateKey], n > 8) }] : []),
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-muted)' }}>
            <span className="w-3 h-0.5 rounded" style={{ background: SERIES_COLORS[s.key] || s.color || 'var(--color-primary)' }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="max-w-full" style={{ display: 'block' }}>
        <line x1={pad.l} y1={pad.t + h} x2={width - pad.r} y2={pad.t + h} stroke="var(--color-border)" />
        <text x={pad.l - 4} y={pad.t + 10} textAnchor="end" fontSize="9" fill="var(--color-muted)">{fmt(maxY)}</text>
        <text x={pad.l - 4} y={pad.t + h} textAnchor="end" fontSize="9" fill="var(--color-muted)">{fmt(minY)}</text>
        {series.map((s) => {
          const coords = points.map((p, i) => {
            const v = Number(p[s.key]);
            if (!Number.isFinite(v)) return null;
            return { x: xAt(i), y: yAt(v) };
          }).filter(Boolean);
          if (coords.length < 2) return null;
          const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
          const color = s.color || SERIES_COLORS[s.key] || 'var(--color-primary)';
          return (
            <g key={s.key}>
              <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
              {coords.map((c, i) => (
                <circle key={i} cx={c.x} cy={c.y} r="2.5" fill={color} />
              ))}
            </g>
          );
        })}
        {xLabels.map(({ i, label }) => (
          <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize="9" fill="var(--color-muted)">{label}</text>
        ))}
      </svg>
    </div>
  );
}
