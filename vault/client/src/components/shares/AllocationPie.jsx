import React from 'react';

const COLORS = ['#CC785C', '#6B9E70', '#5B6FAD', '#C9A84C', '#6B97B5', '#8A5C8A', '#A85C5C', '#507A60'];

export default function AllocationPie({ slices = [], size = 200 }) {
  if (!slices.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        Add holdings with live quotes to see allocation.
      </p>
    );
  }

  const total = slices.reduce((s, x) => s + (Number(x.pct) || 0), 0) || 1;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  let angle = -Math.PI / 2;

  const arcs = slices.map((sl, i) => {
    const pct = (Number(sl.pct) || 0) / total;
    const sweep = pct * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return { d, color: COLORS[i % COLORS.length], symbol: sl.symbol, pct: sl.pct };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} opacity={0.9} />
        ))}
      </svg>
      <ul className="text-xs space-y-1.5">
        {arcs.map((a, i) => (
          <li key={i} className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: a.color }} />
            <span className="font-medium">{a.symbol}</span>
            <span style={{ color: 'var(--color-muted)' }}>{Number(a.pct).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
