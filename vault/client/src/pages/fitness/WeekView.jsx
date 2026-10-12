import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { Card, InfoTip, Notice, SecondaryButton } from './ui';
import { TIPS } from './tips';
import SessionCard from './SessionCard';
import useWeek, { DAY_NAMES, DAY_SHORT, SLOTS, dayLabel } from './useWeek';

function Summary({ week, sessions }) {
  const minutes = sessions.filter((s) => s.status !== 'rest').flatMap((s) => s.components).filter((c) => c.domain === 'cardio').reduce((n, c) => n + c.minutes, 0);
  const days = (domain) => new Set(sessions.filter((s) => s.status !== 'rest' && s.components.some((c) => c.domain === domain)).map((s) => s.day)).size;
  const t = week.targets;
  return (
    <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
      Aerobic <strong>{minutes}</strong> of {t.aerobicMinutes} min · Strength <strong>{days('strength')}</strong> of {t.strengthDays} days ·
      Balance <strong>{days('balance')}</strong> of {t.balanceDays} · Mobility <strong>{days('flexibility')}</strong> of {t.mobilityDays}
    </p>
  );
}

/**
 * Seven days by three times of day. Sessions are suggestions: drag one to another slot, or use its move button.
 * Rest is a normal part of the week: planned rest days, plus a flexible rest budget that can be spent (or not) without any fuss.
 */
export default function WeekView({ onOpenExercise, offset: offsetProp, onOffsetChange }) {
  const getIcon = useIcon();
  const [localOffset, setLocalOffset] = useState(0);
  // The page can own the offset so coming back from an exercise page returns to the same week.
  const offset = offsetProp ?? localOffset;
  const setOffset = (fn) => { const next = typeof fn === 'function' ? fn(offset) : fn; (onOffsetChange || setLocalOffset)(next); };
  const w = useWeek(offset);
  const [overSlot, setOverSlot] = useState(null);
  const { data } = w;

  if (w.loading && !data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Putting your week together…</p>;
  if (!data) return <Notice>{w.error || 'Could not load your week.'}</Notice>;
  if (!data.exists) {
    return (
      <div className="max-w-3xl mx-auto w-full space-y-4">
        <Notice>This week has not been made, and past weeks are only shown if they were.</Notice>
        <SecondaryButton onClick={() => setOffset(0)}>Back to this week</SecondaryButton>
      </div>
    );
  }

  const { week, sessions, softNotes, todayIndex, currentWeekStart } = data;
  const isCurrent = week.weekStart === currentWeekStart;
  const restByDay = new Map(week.restDays.map((r) => [r.day, r]));
  const budgetLeft = Math.max(0, week.restBudget - week.restBudgetUsed);
  const acted = sessions.some((s) => !['planned', 'moved', 'rest'].includes(s.status));

  const onDrop = (e, day, slot) => {
    e.preventDefault();
    setOverSlot(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) w.move(id, day, slot);
  };

  return (
    <div className="max-w-6xl mx-auto w-full space-y-4" data-tour="fitness-week-grid">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous week" onClick={() => setOffset((o) => Math.max(-1, o - 1))} disabled={offset <= -1} className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30" style={{ color: 'var(--color-muted)' }}>{getIcon('chevron-left', { size: 18 })}</button>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {dayLabel(week.weekStart, 0)} to {dayLabel(week.weekStart, 6)}
          </h2>
          <button type="button" aria-label="Next week" onClick={() => setOffset((o) => Math.min(1, o + 1))} disabled={offset >= 1} className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30" style={{ color: 'var(--color-muted)' }}>{getIcon('chevron-right', { size: 18 })}</button>
          {!isCurrent && <SecondaryButton onClick={() => setOffset(0)}>This week</SecondaryButton>}
          <div className="flex-1" />
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>
            {week.phase.label} · week {week.blockWeek} of {week.blockWeeks}{week.isDeload ? ' · a lighter week' : ''}{week.eased ? ' · gentle start' : ''}
            <InfoTip tip={TIPS.block} />
          </span>
        </div>
        {week.weekNote && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{week.weekNote}</p>}
        <Summary week={week} sessions={sessions} />
        <p className="text-xs" style={{ color: 'var(--color-muted)' }} data-tour="fitness-rest">
          Rest: {week.restDays.filter((r) => r.kind === 'planned').length} planned days, plus {week.restBudget} flexible
          {' '}({budgetLeft > 0 ? `${budgetLeft} left to spend` : 'used'}). Taking a rest day is a normal part of the week.
          {' '}<InfoTip tip={TIPS.restBudget} />
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1" aria-label="How this page works">
          <InfoTip tip={TIPS.move} trigger="text" />
          <InfoTip tip={TIPS.timeOfDay} trigger="text" />
          <InfoTip tip={TIPS.rest} trigger="text" />
        </div>
      </Card>

      {w.error && <Notice>{w.error}</Notice>}
      {w.data?.aiNote && <Notice>{w.data.aiNote}</Notice>}
      {week.notes.map((n) => <Notice key={n}>{n}</Notice>)}
      {softNotes.map((n) => <Notice key={n}>{n}</Notice>)}

      {/* wide screens: a 7-column grid of three time-of-day lanes; narrow screens: one list per day */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-7">
        {DAY_NAMES.map((name, day) => {
          const daySessions = sessions.filter((s) => s.day === day);
          const live = daySessions.filter((s) => s.status !== 'rest');
          const restInfo = restByDay.get(day);
          const isToday = isCurrent && day === todayIndex;
          const restDay = restInfo && !live.length;
          return (
            <section
              key={name}
              aria-label={name}
              className="rounded-2xl border p-2.5 space-y-2 min-h-[8rem]"
              style={{ background: 'var(--color-surface)', borderColor: isToday ? 'var(--color-text)' : 'var(--color-border)' }}
            >
              <header className="flex items-center gap-1">
                <div className="flex-1">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    <span className="lg:hidden">{name}</span><span className="hidden lg:inline">{DAY_SHORT[day]}</span>
                    {isToday && <span className="ml-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>today</span>}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{dayLabel(week.weekStart, day)}</p>
                </div>
                {restDay && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>{getIcon('moon', { size: 12 })}Rest</span>
                )}
              </header>

              {SLOTS.map((slot) => {
                const here = daySessions.filter((s) => s.slot === slot.id);
                const key = `${day}-${slot.id}`;
                const hot = overSlot === key;
                return (
                  <div
                    key={slot.id}
                    onDragOver={(e) => { e.preventDefault(); setOverSlot(key); }}
                    onDragLeave={() => setOverSlot((k) => (k === key ? null : k))}
                    onDrop={(e) => onDrop(e, day, slot.id)}
                    className={`rounded-xl border border-dashed p-1.5 transition-all duration-200 ${here.length ? '' : 'min-h-[2.25rem]'}`}
                    style={{ borderColor: hot ? 'var(--color-text)' : 'transparent', background: hot ? 'var(--color-bg)' : 'transparent' }}
                    aria-label={`${name} ${slot.label}`}
                  >
                    {(here.length > 0 || hot) && <p className="text-[10px] mb-1 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{slot.label}</p>}
                    <div className="space-y-2">
                      {here.map((s) => (
                        <SessionCard key={s.id} session={s} draggable onMove={w.move} onOpenExercise={onOpenExercise} busy={w.busy} />
                      ))}
                    </div>
                  </div>
                );
              })}

              {!acted && (
                <div className="pt-1">
                  {restInfo?.kind === 'budget' ? (
                    <button type="button" onClick={() => w.undoRest(day)} disabled={w.busy} className="text-xs underline hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>Put this day back</button>
                  ) : (!restInfo && (
                    <Tooltip text="Rest is part of training. This day's session moves to a free slot later in the week if there is one, otherwise it is let go. Nothing is piled onto other days.">
                      <button type="button" onClick={() => w.rest(day)} disabled={w.busy} className="text-xs underline hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>Take this as a rest day</button>
                    </Tooltip>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton onClick={w.regenerate} disabled={w.busy || acted}>Make a different version of this week</SecondaryButton>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {acted ? 'Locked: some of this week has already been done.' : 'Same targets, different exercises.'}
        </span>
        <InfoTip tip={TIPS.regenerate} />
      </div>
    </div>
  );
}
