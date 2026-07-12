import React from 'react';

export default function EarningsTimeline({ events = [] }) {
  if (!events.length) {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--color-muted)' }}>
        No upcoming US earnings in the next 90 days for your holdings.
      </p>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => String(e.date) >= today).slice(0, 12);

  return (
    <ul className="space-y-2">
      {upcoming.map((e, i) => {
        const daysUntil = Math.round((new Date(`${e.date}T12:00:00`) - new Date()) / 86400000);
        return (
          <li
            key={`${e.symbol}-${e.date}-${i}`}
            className="flex items-center gap-3 text-xs py-2 border-b last:border-b-0"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div
              className="w-14 text-center py-1 rounded-lg shrink-0"
              style={{ background: daysUntil <= 7 ? 'var(--color-primary)' : 'var(--color-bg)', color: daysUntil <= 7 ? '#fff' : 'var(--color-text)' }}
            >
              <div className="font-semibold">{String(e.date).slice(5)}</div>
              <div className="text-[9px] opacity-80">{daysUntil}d</div>
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{e.symbol}</span>
              {e.weightPct != null && (
                <span className="ml-2" style={{ color: 'var(--color-muted)' }}>{Number(e.weightPct).toFixed(1)}% wt</span>
              )}
              {e.quarter && (
                <span className="ml-2" style={{ color: 'var(--color-muted)' }}>
                  Q{e.quarter} {e.year}
                </span>
              )}
            </div>
            {e.epsEstimate != null && (
              <span style={{ color: 'var(--color-muted)' }}>EPS est {Number(e.epsEstimate).toFixed(2)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
