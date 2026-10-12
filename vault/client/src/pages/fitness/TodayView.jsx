import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { AdaptationNote, Card, InfoTip, Notice, SecondaryButton } from './ui';
import { TIPS } from './tips';
import SessionCard from './SessionCard';
import { WeighInTile } from './LogView';
import useWeek, { DAY_NAMES, dayLabel } from './useWeek';

/** Today's plan. A rest day is just as welcome as a session day. */
export default function TodayView({ onOpenExercise, goTo, meta, state, onPrefs, onWeighIn }) {
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
  const prefs = state?.prefs || {};
  const last = state?.weighIn || null;
  const daysSince = last ? Math.floor((Date.parse(`${state.today}T00:00:00Z`) - Date.parse(`${last.measuredOn}T00:00:00Z`)) / 86400000) : null;
  // One gentle prompt a week, only if there has been no weigh-in for a week, and never once switched off.
  const askWeight = prefs.weightPrompt !== false && (daysSince == null || daysSince >= 7) && prefs.weightPromptDismissedFor !== data.currentWeekStart;
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
        <AdaptationNote adaptation={week.adaptation} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <InfoTip tip={TIPS.move} trigger="text" />
          <InfoTip tip={TIPS.timeOfDay} trigger="text" />
          <InfoTip tip={TIPS.warmup} trigger="text" />
        </div>
      </Card>

      {w.error && <Notice>{w.error}</Notice>}

      {askWeight && (
        <WeighInTile
          compact
          last={last}
          onSaved={onWeighIn}
          onDismissWeek={() => onPrefs({ weightPromptDismissedFor: data.currentWeekStart })}
          onNever={() => onPrefs({ weightPrompt: false })}
        />
      )}

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
          {letGo.filter((x) => x.log).map((x) => (
            <SecondaryButton key={x.id} onClick={() => w.undoLog(x.id)} disabled={w.busy}>Put back: {x.title}</SecondaryButton>
          ))}
          {restInfo?.kind === 'budget' && (
            <SecondaryButton onClick={() => w.undoRest(todayIndex)} disabled={w.busy}>Put today back</SecondaryButton>
          )}
        </Card>
      ) : (
        <>
          {live.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              expanded
              logging
              meta={meta}
              prefs={prefs}
              onLog={w.logSession}
              onUndo={w.undoLog}
              onRememberDetail={(patch) => onPrefs({ logDetailOpen: patch })}
              onMove={w.move}
              onOpenExercise={onOpenExercise}
              busy={w.busy}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Rest is part of training. Today's session moves to a free slot later in the week if there is one, otherwise it is let go. Nothing is piled onto other days.">
              <span><SecondaryButton onClick={() => w.rest(todayIndex)} disabled={w.busy}>Take today as a rest day</SecondaryButton></span>
            </Tooltip>
            <SecondaryButton onClick={() => goTo('week')}>See the whole week</SecondaryButton>
          </div>
        </>
      )}
    </div>
  );
}
