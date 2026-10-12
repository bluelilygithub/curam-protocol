import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { Card, Notice } from './ui';
import { DAY_SHORT } from './useWeek';
import { DAY_STATES, DayBadge, LEGEND, dayStyle } from './dayColors';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const monthTitle = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** One day in the calendar: the date, its state (colour + icon), and the minutes planned. */
function Cell({ d, isToday, onOpen }) {
  const getIcon = useIcon();
  const planned = d.sessions.filter((s) => s.status !== 'rest').reduce((n, s) => n + s.totalMinutes, 0);
  const extra = d.extras.reduce((n, x) => n + (x.minutes || 0), 0);
  const s = DAY_STATES[d.state];
  const tip = [
    s?.label || (d.hasWeek ? 'Nothing planned' : 'No plan for this day'),
    d.sessions.length ? d.sessions.map((x) => x.title).join(', ') : null,
    d.extras.length ? `Extra: ${d.extras.map((x) => x.title).join(', ')}` : null,
  ].filter(Boolean).join(' · ');
  const clickable = d.hasWeek;
  return (
    <Tooltip text={tip}>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => onOpen(d)}
        aria-label={`${d.date}. ${tip}`}
        className={`rounded-xl border p-1.5 min-h-[4.25rem] text-left flex flex-col transition-all duration-200 ${clickable ? 'hover:opacity-70' : 'cursor-default'}`}
        style={{
          ...dayStyle(d.state, d.inMonth ? 'var(--color-surface)' : 'var(--color-bg)'),
          ...(isToday ? { borderColor: 'var(--color-text)', borderWidth: 2 } : {}),
          opacity: d.inMonth ? 1 : 0.5,
          color: 'var(--color-text)',
        }}
      >
        <span className="flex items-start justify-between">
          <span className="text-xs font-semibold">{Number(d.date.slice(8))}</span>
          {s?.icon && <span style={{ color: s.color || 'var(--color-muted)' }}>{getIcon(s.icon, { size: 12 })}</span>}
        </span>
        <span className="mt-auto text-[11px] leading-tight" style={{ color: 'var(--color-muted)' }}>
          {planned > 0 ? `${planned} min` : d.state === 'rest' ? 'Rest' : ''}
          {extra > 0 ? `${planned > 0 ? ' + ' : ''}${extra} extra` : ''}
        </span>
      </button>
    </Tooltip>
  );
}

/**
 * A calendar month. Each day is coloured by how it went (with an icon too), the same colours as the week.
 * Click a day to open it in the Week view.
 */
export default function MonthView({ onOpenDay }) {
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (m) => {
    setError('');
    try {
      const r = await api.get(`/api/fitness/month${m ? `?month=${m}` : ''}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the month');
      setData(d);
      setMonth(d.month);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(null); }, [load]);

  if (!data) return error ? <Notice>{error}</Notice> : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  const thisMonth = data.today.slice(0, 7);
  const canPrev = month > shiftMonth(thisMonth, -12);
  const canNext = month < shiftMonth(thisMonth, 1);

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4" data-tour="fitness-month">
      <Card>
        <div className="flex items-center gap-2">
          <NavButton label="Previous month" icon="chevron-left" disabled={!canPrev} onClick={() => load(shiftMonth(month, -1))} />
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{monthTitle(month)}</h2>
          <NavButton label="Next month" icon="chevron-right" disabled={!canNext} onClick={() => load(shiftMonth(month, 1))} />
          <div className="flex-1" />
          {month !== thisMonth && (
            <button type="button" onClick={() => load(thisMonth)} className="text-sm underline hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>This month</button>
          )}
        </div>
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          {data.totals.sessionsDone} session{data.totals.sessionsDone === 1 ? '' : 's'} done · {data.totals.minutesDone} minutes
          <span style={{ color: 'var(--color-muted)' }}> (what you have logged this month)</span>
        </p>
      </Card>

      {error && <Notice>{error}</Notice>}

      <div className="grid grid-cols-7 gap-1.5" role="grid" aria-label={monthTitle(month)}>
        {DAY_SHORT.map((n) => <div key={n} role="columnheader" className="text-center text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{n}</div>)}
        {data.days.map((d) => <Cell key={d.date} d={d} isToday={d.date === data.today} onOpen={onOpenDay} />)}
      </div>

      <Card title="What the colours mean">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGEND.map((k) => (
            <span key={k} className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <span className="w-4 h-4 rounded-md border inline-block" style={dayStyle(k)} aria-hidden="true" />
              <DayBadge state={k} />
            </span>
          ))}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          A day with no colour has nothing logged yet, or nothing planned. Click a day to open it. Days without a plan (weeks that were never made) cannot be opened.
        </p>
      </Card>
    </div>
  );
}

function NavButton({ label, icon, disabled, onClick }) {
  const getIcon = useIcon();
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30" style={{ color: 'var(--color-muted)' }}>
      {getIcon(icon, { size: 18 })}
    </button>
  );
}
