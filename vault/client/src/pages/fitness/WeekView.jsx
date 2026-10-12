import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { AdaptationNote, BackButton, Card, InfoTip, Notice, SecondaryButton, TimeOfDay } from './ui';
import { TIPS } from './tips';
import { DOMAIN_ICON } from './icons';
import { DayBadge, dayStyle } from './dayColors';
import SessionCard, { CompactSessionCard } from './SessionCard';
import ReflectionTile from './ReflectionTile';
import useWeek, { DAY_NAMES, SLOTS, dayLabel } from './useWeek';

/**
 * What the week asks for, and how much of it you have done. The big number is what you have logged so far; underneath is
 * what the plan asks for this week. Hover a tile for what it means.
 */
function Summary({ week, done }) {
  const getIcon = useIcon();
  const t = week.targets;
  const tiles = [
    { label: 'Aerobic', icon: DOMAIN_ICON.cardio, value: done.aerobicMinutes, of: t.aerobicMinutes, unit: 'minutes', tip: 'Aerobic is steady activity that lifts your breathing: walking, riding, swimming, an easy jog. The big number is the minutes you have logged this week; the plan asks for the number underneath.' },
    { label: 'Strength', icon: DOMAIN_ICON.strength, value: done.strengthDays, of: t.strengthDays, unit: 'days', tip: 'Days with strength work (squats, pushes, pulls). The plan counts days, not sessions: strength, balance and mobility can share one session.' },
    { label: 'Balance', icon: DOMAIN_ICON.balance, value: done.balanceDays, of: t.balanceDays, unit: 'days', tip: 'Days with balance work, such as standing on one leg. It often sits at the end of another session.' },
    { label: 'Mobility', icon: DOMAIN_ICON.flexibility, value: done.mobilityDays, of: t.mobilityDays, unit: 'days', tip: 'Days with stretching and joint-freeing movement. A partly done session counts as half.' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" role="list" aria-label="This week: done so far, and what the plan asks for">
      {tiles.map((t2) => (
        <Tooltip key={t2.label} text={t2.tip}>
          <div role="listitem" className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>{getIcon(t2.icon, { size: 13 })}{t2.label}</p>
            <p className="text-xl font-semibold leading-tight tabular-nums">{t2.value}</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>of {t2.of} {t2.unit} planned</p>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

/** The small rest control: hidden until you hover or focus the day (always visible on touch screens). */
function RestButton({ restInfo, hasSessions, onRest, onUndo, busy, always = false }) {
  const getIcon = useIcon();
  if (restInfo && restInfo.kind !== 'budget') return null; // a planned rest day is already rest
  const budget = restInfo?.kind === 'budget';
  const reveal = always ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100';
  return (
    <Tooltip text={budget ? 'Put this day back as a training day.' : "Rest is part of training. This day's session moves to a free slot later in the week if there is one, otherwise it is let go. Nothing is piled onto other days."}>
      <button
        type="button"
        disabled={busy}
        onClick={budget ? onUndo : onRest}
        aria-label={budget ? 'Put this day back' : hasSessions ? 'Take this as a rest day' : 'Mark this as a rest day'}
        className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border hover:opacity-70 transition-all duration-200 ${reveal}`}
        style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
      >
        {getIcon('moon', { size: 12 })}{budget ? 'Put back' : 'Rest'}
      </button>
    </Tooltip>
  );
}

function DayDetail({ w, day, week, sessions, restInfo, state, isToday, meta, prefs, onPrefs, onOpenExercise, onBack }) {
  const getIcon = useIcon();
  const mine = sessions.filter((s) => s.day === day);
  const live = mine.filter((s) => s.status !== 'rest');
  const letGo = mine.filter((s) => s.status === 'rest');
  const restDay = restInfo && !live.length;
  return (
    <div className="max-w-3xl mx-auto w-full space-y-4">
      <BackButton onClick={onBack}>Back to the week</BackButton>
      <section className="rounded-2xl border p-5 space-y-3" style={dayStyle(state)}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            <span style={{ color: 'var(--color-muted)' }}>{getIcon('calendar', { size: 17 })}</span>
            {DAY_NAMES[day]} {dayLabel(week.weekStart, day)}{isToday ? ' (today)' : ''}
          </h2>
          <DayBadge state={state} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {restDay && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text)' }}>
              {getIcon('moon', { size: 15 })}Rest day{restInfo.kind === 'budget' ? ' (your flexible rest)' : ''}
            </span>
          )}
          {!live.length && !restDay && <span className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing planned.</span>}
          <RestButton restInfo={restInfo} hasSessions={live.length > 0} busy={w.busy} always onRest={() => w.rest(day)} onUndo={() => w.undoRest(day)} />
        </div>
        {letGo.length > 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Let go for the day: {letGo.map((s) => s.title).join(', ')}. Nothing is added to other days.</p>}
      </section>
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
          onRememberDetail={(patch) => onPrefs?.({ logDetailOpen: patch })}
          onMove={w.move}
          onOpenExercise={onOpenExercise}
          busy={w.busy}
        />
      ))}
    </div>
  );
}

/**
 * The week at a glance, at the same comfortable width as Today: one block per day, with a small card for each session.
 * A day's colour shows how it went once logged (always with an icon and a word). Click a day, a card or its pencil to open
 * the day. Drag a card to move it; the places to drop appear while you drag. Rest controls appear when you hover a day.
 */
export default function WeekView({ onOpenExercise, offset: offsetProp, onOffsetChange, meta, prefs, onPrefs, startDay, onStartDayUsed }) {
  const getIcon = useIcon();
  const [localOffset, setLocalOffset] = useState(0);
  const [openDay, setOpenDay] = useState(() => (startDay != null ? startDay : null));
  const [dragId, setDragId] = useState(null);
  const [overSlot, setOverSlot] = useState(null);
  // The page can own the offset so coming back from an exercise or the month returns to the same week.
  const offset = offsetProp ?? localOffset;
  const setOffset = (fn) => {
    const next = typeof fn === 'function' ? fn(offset) : fn;
    (onOffsetChange || setLocalOffset)(next);
    setOpenDay(null);
  };
  const w = useWeek(offset);
  const { data } = w;
  React.useEffect(() => { if (startDay != null) onStartDayUsed?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const { week, sessions, softNotes, todayIndex, currentWeekStart, days, done } = data;
  const isCurrent = week.weekStart === currentWeekStart;
  const restByDay = new Map(week.restDays.map((r) => [r.day, r]));
  const stateOf = (d) => days?.find((x) => x.day === d)?.state || 'none';
  const budgetLeft = Math.max(0, week.restBudget - week.restBudgetUsed);
  const acted = sessions.some((s) => !['planned', 'moved'].includes(s.status));

  if (openDay != null) {
    return (
      <DayDetail
        w={w}
        day={openDay}
        week={week}
        sessions={sessions}
        restInfo={restByDay.get(openDay)}
        state={stateOf(openDay)}
        isToday={isCurrent && openDay === todayIndex}
        meta={meta}
        prefs={prefs}
        onPrefs={onPrefs}
        onOpenExercise={onOpenExercise}
        onBack={() => setOpenDay(null)}
      />
    );
  }

  const onDrop = (e, day, slot) => {
    e.preventDefault();
    setOverSlot(null);
    setDragId(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) w.move(id, day, slot);
  };

  const renderDay = (day) => {
    const daySessions = sessions.filter((s) => s.day === day);
    const live = daySessions.filter((s) => s.status !== 'rest');
    const restInfo = restByDay.get(day);
    const isToday = isCurrent && day === todayIndex;
    const state = stateOf(day);
    const restDay = restInfo && !live.length;
    return (
      <section
        key={day}
        aria-label={DAY_NAMES[day]}
        className="group rounded-2xl border p-3 transition-all duration-200"
        style={{ ...dayStyle(state), ...(isToday ? { borderColor: 'var(--color-text)' } : {}) }}
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
          <button
            type="button"
            onClick={() => setOpenDay(day)}
            aria-label={`Open ${DAY_NAMES[day]}`}
            className="text-left hover:opacity-60 transition-opacity duration-200"
            style={{ color: 'var(--color-text)' }}
          >
            <span className="text-sm font-semibold">{DAY_NAMES[day]}</span>
            <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{dayLabel(week.weekStart, day)}</span>
            {isToday && <span className="ml-2 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>today</span>}
          </button>
          <DayBadge state={state} />
          <div className="flex-1" />
          {!acted && <RestButton restInfo={restInfo} hasSessions={live.length > 0} busy={w.busy} onRest={() => w.rest(day)} onUndo={() => w.undoRest(day)} />}
        </header>
        {dragId != null ? (
          // while dragging: three clear places to drop
          <div className="grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => {
              const key = `${day}-${slot.id}`;
              const hot = overSlot === key;
              return (
                <div
                  key={slot.id}
                  onDragOver={(e) => { e.preventDefault(); setOverSlot(key); }}
                  onDragLeave={() => setOverSlot((k) => (k === key ? null : k))}
                  onDrop={(e) => onDrop(e, day, slot.id)}
                  className="rounded-xl border border-dashed p-3 text-xs text-center transition-all duration-200"
                  style={{ borderColor: hot ? 'var(--color-text)' : 'var(--color-border)', background: hot ? 'var(--color-bg)' : 'transparent', color: 'var(--color-muted)' }}
                  aria-label={`${DAY_NAMES[day]} ${slot.label}`}
                >
                  <TimeOfDay slot={slot.id} size={12} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {daySessions.map((s) => (
              <CompactSessionCard
                key={s.id}
                session={s}
                draggable
                onOpen={() => setOpenDay(day)}
                onDragStart={setDragId}
                onDragEnd={() => { setDragId(null); setOverSlot(null); }}
              />
            ))}
            {!daySessions.length && (
              <p className="flex items-center gap-1.5 text-xs sm:col-span-2" style={{ color: 'var(--color-muted)' }}>
                {restDay ? <>{getIcon('moon', { size: 12 })}Rest day. Nothing to do.</> : 'Nothing planned'}
              </p>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="max-w-3xl mx-auto w-full space-y-4" data-tour="fitness-week-grid">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous week" onClick={() => setOffset((o) => Math.max(-26, o - 1))} disabled={offset <= -26} className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30" style={{ color: 'var(--color-muted)' }}>{getIcon('chevron-left', { size: 18 })}</button>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {dayLabel(week.weekStart, 0)} to {dayLabel(week.weekStart, 6)}
          </h2>
          <button type="button" aria-label="Next week" onClick={() => setOffset((o) => Math.min(1, o + 1))} disabled={offset >= 1} className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30" style={{ color: 'var(--color-muted)' }}>{getIcon('chevron-right', { size: 18 })}</button>
          {!isCurrent && <SecondaryButton onClick={() => setOffset(0)}>This week</SecondaryButton>}
          <div className="flex-1" />
          <InfoTip tip={TIPS.weekGuide} icon="circle-help" />
        </div>
        <Tooltip text="Your plan moves through phases (here: rebuilding a base, then building, consolidating and maintaining). Every phase works in blocks of five weeks: four that build, then one lighter week on purpose.">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Phase: {week.phase.label} · week {week.blockWeek} of {week.blockWeeks} in this block{week.isDeload ? ' (a lighter week)' : ''}{week.eased ? ' · a gentler week' : ''}
          </p>
        </Tooltip>
        {week.weekNote && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{week.weekNote}</p>}
        <AdaptationNote adaptation={week.adaptation} />
        <Summary week={week} done={done} />
        <p className="text-xs" style={{ color: 'var(--color-muted)' }} data-tour="fitness-rest">
          Rest: {week.restDays.filter((r) => r.kind === 'planned').length} planned days, plus {week.restBudget} flexible
          {' '}({budgetLeft > 0 ? `${budgetLeft} left to spend` : 'used'}). Taking a rest day is a normal part of the week.
        </p>
      </Card>

      {offset < 0 && <ReflectionTile weekStart={week.weekStart} title="Looking back at this week" />}

      {w.error && <Notice>{w.error}</Notice>}
      {w.data?.aiNote && <Notice>{w.data.aiNote}</Notice>}
      {week.notes.map((n) => <Notice key={n}>{n}</Notice>)}
      {softNotes.map((n) => <Notice key={n}>{n}</Notice>)}

      <div className="space-y-2.5" role="list" aria-label="The week">
        {DAY_NAMES.map((_, day) => <div key={day} role="listitem">{renderDay(day)}</div>)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton onClick={w.regenerate} disabled={w.busy || acted}>Make a different version of this week</SecondaryButton>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {acted ? 'Locked: some of this week has already been logged.' : 'Same targets, different exercises.'}
        </span>
      </div>
    </div>
  );
}
