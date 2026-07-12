import React from 'react';

export default function DrawdownBars({ rows = [], peakTrigger = -10, costTrigger = -4 }) {
  if (!rows.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        No alert data — add holdings with live quotes.
      </p>
    );
  }

  const sorted = [...rows].sort((a, b) => (a.pctOffPeak ?? 0) - (b.pctOffPeak ?? 0));

  return (
    <div>
      <div className="flex gap-4 text-[10px] mb-3" style={{ color: 'var(--color-muted)' }}>
        <span>Reference: {peakTrigger}% off peak</span>
        <span>{costTrigger}% off avg cost</span>
      </div>
      <ul className="space-y-3">
        {sorted.map((r) => {
          const peak = Number(r.pctOffPeak);
          const cost = Number(r.pctOffAvgCost);
          const peakVal = Number.isFinite(peak) ? peak : 0;
          const widthPct = Math.min(100, Math.max(4, (Math.abs(peakVal) / 15) * 100));
          const barColor = r.flag === '🔴' ? '#ef4444' : r.flag === '⚠️' ? '#f59e0b' : '#94a3b8';
          return (
            <li key={r.key || r.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-1.5">
                  {r.flag && <span>{r.flag}</span>}
                  <span className="font-medium" style={{ color: 'var(--color-text)' }}>{r.label}</span>
                  {r.exchange && r.exchange !== 'SPOT' && (
                    <span style={{ color: 'var(--color-muted)' }}>{r.exchange}</span>
                  )}
                </span>
                <span style={{ color: peakVal >= -4 ? 'var(--color-muted)' : '#dc2626' }}>
                  {Number.isFinite(peak) ? `${peak.toFixed(1)}%` : '—'} off peak
                  {Number.isFinite(cost) && (
                    <span className="ml-2" style={{ color: 'var(--color-muted)' }}>
                      · {cost.toFixed(1)}% vs cost
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden relative" style={{ background: 'var(--color-border)' }}>
                <div
                  className="h-2.5 rounded-full"
                  style={{ width: `${widthPct}%`, background: barColor }}
                />
                <div
                  className="absolute top-0 h-2.5 w-px"
                  style={{ left: `${(Math.abs(peakTrigger) / 15) * 100}%`, background: '#ef4444', opacity: 0.5 }}
                  title={`${peakTrigger}% trigger`}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
