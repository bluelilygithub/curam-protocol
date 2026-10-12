import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceArea, Tooltip as RTooltip } from 'recharts';
import { InfoTip } from './ui';
import { DAY_STATES, LEGEND, DayBadge, dayStyle } from './dayColors';


const WHO_LOW = 150;
const WHO_HIGH = 300;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const shortDate = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const TOOLTIP_STYLE = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-text)' };

/** A chart's heading with its explanation, in one place so every chart looks the same. */
export function ChartHeading({ title, tip }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <h3 className="text-sm font-medium m-0" style={{ color: 'var(--color-text)' }}>{title}</h3>
      {tip && <InfoTip tip={tip} />}
    </div>
  );
}

/** This week so far, in the same units as the targets. Rest and unlogged sessions are never shown as a shortfall. */
export function GlanceTile({ week }) {
  if (!week) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>There is no program for this week yet. Open Today and it will be made for you.</p>;
  }
  const rows = [
    { label: 'Aerobic', done: week.done.aerobicMinutes, target: week.targets.aerobicMinutes, unit: 'min' },
    { label: 'Sessions', done: week.sessionsDone, target: week.sessionsPlanned, unit: '' },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between text-sm">
            <span style={{ color: 'var(--color-muted)' }}>{r.label}</span>
            <span style={{ color: 'var(--color-text)' }}><strong>{r.done}</strong> of {r.target}{r.unit ? ` ${r.unit}` : ''}</span>
          </div>
          <Bar1 share={r.target ? r.done / r.target : 0} label={`${r.label}: ${r.done} of ${r.target}`} />
        </div>
      ))}
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        So far this week{week.isDeload ? ' (a lighter week on purpose)' : ''}. Partly done counts as half; rest days are never counted against you.
      </p>
    </div>
  );
}

/** A plain progress bar in neutral colours. */
function Bar1({ share, label }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div role="img" aria-label={`${label} (${Math.round(share * 100)}%)`} className="h-2.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <div className="h-full transition-all duration-200" style={{ width: `${pct}%`, background: 'var(--color-text)', opacity: 0.8 }} />
    </div>
  );
}

/** Done against the plan for each week, with the WHO band behind. */
export function ActivityChart({ weeks }) {
  if (!weeks.length) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Charts fill in as your weeks are made and logged.</p>;
  const data = weeks.map((w) => ({
    label: shortDate(w.weekStart),
    planned: w.targets.aerobicMinutes,
    done: w.done.aerobicMinutes,
    note: [w.current ? 'so far' : null, w.isDeload ? 'lighter week' : null, !w.current && w.coverage < 0.5 ? 'little logged' : null].filter(Boolean).join(', '),
  }));
  const top = Math.max(WHO_HIGH + 30, ...data.map((d) => Math.max(d.planned, d.done) + 20));
  const yMax = Math.ceil(top / 50) * 50;
  const summary = data.map((d) => `week of ${d.label}: ${d.done} of ${d.planned} minutes${d.note ? ` (${d.note})` : ''}`).join('; ');
  return (
    <div>
      <div style={{ width: '100%', height: 230 }} role="img" aria-label={`Weekly aerobic minutes done against planned, with the WHO range of ${WHO_LOW} to ${WHO_HIGH}. ${summary}.`}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <ReferenceArea y1={WHO_LOW} y2={WHO_HIGH} fill="var(--color-muted)" fillOpacity={0.14} stroke="none" ifOverflow="visible"
              label={{ value: 'WHO range', position: 'insideTopRight', fill: 'var(--color-muted)', fontSize: 11 }} />
            <XAxis dataKey="label" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} stroke="var(--color-border)" interval="preserveStartEnd" />
            <YAxis domain={[0, yMax]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} stroke="var(--color-border)" width={40} />
            <RTooltip
              cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.1 }}
              contentStyle={TOOLTIP_STYLE}
              formatter={(v, name, item) => [`${v} min`, name === 'planned' ? 'Planned' : `Done${item?.payload?.note ? ` (${item.payload.note})` : ''}`]}
              labelFormatter={(l) => `Week of ${l}`}
            />
            <Bar dataKey="planned" fill="var(--color-muted)" fillOpacity={0.4} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="done" fill="var(--color-text)" fillOpacity={0.85} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
        Light bars are the plan, dark bars are what you did. Weeks with little logged show low because nothing was recorded, not because nothing happened.
      </p>
    </div>
  );
}

/** Done against target for each kind of work over the last few finished weeks. */
export function BalanceChart({ balance }) {
  if (!balance || balance.status !== 'ok') {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Once a finished week has been logged, you will see how cardio, strength, balance and mobility are going here.</p>;
  }
  return (
    <div className="space-y-3">
      {balance.domains.map((d) => (
        <div key={d.id}>
          <div className="flex items-baseline justify-between text-sm">
            <span style={{ color: 'var(--color-text)' }}>{d.label}</span>
            <span style={{ color: 'var(--color-muted)' }}>
              {d.done} of {d.target} {d.unit} <span aria-hidden="true">·</span> {Math.round(d.share * 100)}%
            </span>
          </div>
          <Bar1 share={d.share} label={`${d.label}: ${d.done} of ${d.target} ${d.unit}`} />
        </div>
      ))}
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        The last {balance.weeks} logged week{balance.weeks === 1 ? '' : 's'}. Cardio is in minutes, the others in days.
      </p>
    </div>
  );
}

/** Week by week, a coloured square for every day. Colour is never alone: hover or focus a day to read it. */
export function ConsistencyCalendar({ calendar }) {
  if (!calendar.length) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Your days will appear here as the weeks go by.</p>;
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `auto repeat(${calendar.length}, minmax(18px, 1fr))`, minWidth: '100%' }} role="table" aria-label="Each day of each week, coloured by what happened">
          <span aria-hidden="true" />
          {calendar.map((w, i) => (
            // on a phone the columns are narrow, so only every other week gets a date (it can run over its neighbour)
            <span key={w.weekStart} className={`text-[10px] whitespace-nowrap sm:text-center sm:truncate ${i % 2 ? 'max-sm:invisible' : ''}`} style={{ color: 'var(--color-muted)' }}>{shortDate(w.weekStart)}{w.isDeload ? '*' : ''}</span>
          ))}
          {DAY_LETTERS.map((letter, day) => (
            <React.Fragment key={day}>
              <span className="text-[10px] pr-1 text-right self-center" style={{ color: 'var(--color-muted)' }}>{letter}</span>
              {calendar.map((w) => {
                const d = w.days[day];
                const label = DAY_STATES[d.state]?.label;
                const hidden = d.future || d.state === 'none';
                return (
                  <span
                    key={`${w.weekStart}-${day}`}
                    role="cell"
                    tabIndex={hidden ? -1 : 0}
                    title={hidden ? undefined : `${shortDate(d.date)}: ${label}`}
                    aria-label={hidden ? undefined : `${shortDate(d.date)}: ${label}`}
                    className="h-[18px] rounded border"
                    style={hidden ? { borderColor: 'var(--color-border)', borderStyle: 'dashed', opacity: 0.5 } : dayStyle(d.state)}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {LEGEND.map((s) => <DayBadge key={s} state={s} size={12} />)}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
        * a lighter week on purpose. There is no streak to keep or lose: rest and quiet days are part of the pattern.
      </p>
    </div>
  );
}

