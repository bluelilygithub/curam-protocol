import React from 'react';

export default function DayMoversChart({ movers = [] }) {
  const items = movers.filter((m) => m.dayChangePct != null).slice(0, 12);
  if (!items.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        No priced holdings for today&apos;s move chart.
      </p>
    );
  }

  const maxAbs = Math.max(
    ...items.flatMap((m) => [Math.abs(m.dayChangePct || 0), Math.abs(m.vsSectorPct || 0)]),
    1
  );

  return (
    <ul className="space-y-4">
      {items.map((m) => {
        const day = Number(m.dayChangePct) || 0;
        const vs = Number(m.vsSectorPct) || 0;
        const rel = m.relativeToSector || 'unknown';
        const relColor = rel === 'beat' ? '#16a34a' : rel === 'lagged' ? '#dc2626' : 'var(--color-muted)';
        return (
          <li key={m.key || `${m.symbol}-${m.exchange}`}>
            <div className="flex justify-between items-baseline text-xs mb-1.5">
              <span>
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{m.symbol}</span>
                <span className="ml-1.5" style={{ color: 'var(--color-muted)' }}>{m.sectorBenchmark}</span>
              </span>
              <span style={{ color: relColor, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {rel}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[10px] mb-0.5" style={{ color: 'var(--color-muted)' }}>
                  <span>Day</span>
                  <span style={{ color: day >= 0 ? '#16a34a' : '#dc2626' }}>{day >= 0 ? '+' : ''}{day.toFixed(2)}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.max(4, (Math.abs(day) / maxAbs) * 100)}%`,
                      background: day >= 0 ? '#22c55e' : '#ef4444',
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] mb-0.5" style={{ color: 'var(--color-muted)' }}>
                  <span>vs sector</span>
                  <span style={{ color: vs >= 0 ? '#16a34a' : '#dc2626' }}>{vs >= 0 ? '+' : ''}{vs.toFixed(2)}pp</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.max(4, (Math.abs(vs) / maxAbs) * 100)}%`,
                      background: vs >= 0 ? '#6B9E70' : '#A85C5C',
                    }}
                  />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
