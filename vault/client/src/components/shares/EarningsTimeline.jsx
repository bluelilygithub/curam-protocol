import React from 'react';
import { weekStart } from '../charts/chartMath.mjs';

// Upcoming earnings as date chips, grouped by week (Monday start). Chips within 7 days are filled with the primary colour.
const fmtDay = (ymd, opts) => { try { return new Date(`${ymd}T12:00:00`).toLocaleDateString('en-AU', opts); } catch { return ymd; } };

export default function EarningsTimeline({ events = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => String(e.date) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 20);
  if (!upcoming.length) {
    return <p className="text-xs py-4 text-center" style={{ color: 'var(--color-muted)' }}>No upcoming US earnings in the next 90 days for your holdings.</p>;
  }
  const weeks = new Map();
  for (const e of upcoming) {
    const w = weekStart(e.date) || e.date;
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(e);
  }
  return (
    <div className="space-y-4" role="list" aria-label="Upcoming earnings dates by week">
      {[...weeks.entries()].map(([w, list]) => (
        <div key={w} role="listitem">
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Week of {fmtDay(w, { day: 'numeric', month: 'short' })}</p>
          <div className="flex flex-wrap gap-2">
            {list.map((e, i) => {
              const daysUntil = Math.max(0, Math.round((new Date(`${e.date}T12:00:00`) - new Date()) / 86400000));
              const soon = daysUntil <= 7;
              return (
                <div
                  key={`${e.symbol}-${e.date}-${i}`}
                  className="rounded-xl border px-3 py-2 min-w-[8.5rem]"
                  style={soon
                    ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }
                    : { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <p className="text-xs" style={{ opacity: 0.85 }}>{fmtDay(e.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {daysUntil === 0 ? 'today' : `in ${daysUntil}d`}</p>
                  <p className="text-sm font-semibold">{e.symbol}{e.quarter ? <span className="font-normal text-xs"> Q{e.quarter} {e.year}</span> : null}</p>
                  <p className="text-xs" style={{ opacity: 0.85 }}>
                    {e.weightPct != null ? `${Number(e.weightPct).toFixed(1)}% of holdings` : ''}
                    {e.epsEstimate != null ? `${e.weightPct != null ? ' · ' : ''}EPS est US$${Number(e.epsEstimate).toFixed(2)}` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
