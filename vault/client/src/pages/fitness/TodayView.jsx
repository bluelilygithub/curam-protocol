import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import { Card, Notice, SecondaryButton } from './ui';
import SessionCard from './SessionCard';
import useWeek, { DAY_NAMES, dayLabel } from './useWeek';

/** Today's plan. A rest day is just as welcome as a session day. */
export default function TodayView({ onOpenExercise, goTo }) {
  const getIcon = useIcon();
  const w = useWeek(0);
  const { data } = w;

  if (w.loading && !data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Putting your week together…</p>;
  if (!data || !data.exists) return <Notice>{w.error || 'Could not load today.'}</Notice>;

  const { week, sessions, todayIndex } = data;
  const mine = sessions.filter((s) => s.day === todayIndex);
  const live = mine.filter((s) => s.status !== 'rest');
  const letGo = mine.filter((s) => s.status === 'rest');
  const restInfo = week.restDays.find((r) => r.day === todayIndex);
  const isRest = !live.length;
  const next = !live.length ? sessions.filter((s) => s.day > todayIndex && s.status !== 'rest').sort((a, b) => a.day - b.day)[0] : null;

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4" data-tour="fitness-today">
      <Card>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          {DAY_NAMES[todayIndex]} {dayLabel(week.weekStart, todayIndex)}
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {week.phase.label} · week {week.blockWeek} of {week.blockWeeks}{week.isDeload ? ' · a lighter week' : ''}
        </p>
        {week.weekNote && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{week.weekNote}</p>}
      </Card>

      {w.error && <Notice>{w.error}</Notice>}

      {isRest ? (
        <Card>
          <p className="flex items-center gap-2 text-base font-medium" style={{ color: 'var(--color-text)' }}>
            {getIcon('moon', { size: 18 })}
            Rest day, enjoy it.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            {restInfo?.kind === 'budget' ? 'You chose this as a rest day. That is exactly what the flexible rest is for.' : 'Rest is part of the plan. Your body does its building while you do nothing.'}
            {letGo.length > 0 && ' Anything planned for today has been let go; nothing is added to later days.'}
          </p>
          {next && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Next up: {DAY_NAMES[next.day]}, {next.title.toLowerCase()}.</p>}
          {restInfo?.kind === 'budget' && (
            <SecondaryButton onClick={() => w.undoRest(todayIndex)} disabled={w.busy}>Put today back</SecondaryButton>
          )}
        </Card>
      ) : (
        <>
          {live.map((s) => (
            <SessionCard key={s.id} session={s} expanded onMove={w.move} onOpenExercise={onOpenExercise} busy={w.busy} />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => w.rest(todayIndex)} disabled={w.busy}>Take today as a rest day</SecondaryButton>
            <SecondaryButton onClick={() => goTo('week')}>See the whole week</SecondaryButton>
          </div>
        </>
      )}
    </div>
  );
}
