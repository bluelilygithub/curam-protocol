import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { BackButton, Card, InfoTip, Notice, SecondaryButton, TimeOfDay } from './ui';
import { TIPS } from './tips';
import { DOMAIN_ICON } from './icons';
import SessionCard, { CompactSessionCard } from './SessionCard';
import useNarrow from './useNarrow';
import useWeek, { DAY_NAMES, DAY_SHORT, SLOTS, dayLabel } from './useWeek';

/** The week's targets as four tiles: what is planned against what the week asks for. */
function Summary({ week, sessions }) {
  const getIcon = useIcon();
  const live = sessions.filter((s) => s.status !== 'rest');
  const minutes = live.flatMap((s) => s.components).filter((c) => c.domain === 'cardio').reduce((n, c) => n + c.minutes, 0);
  const days = (domain) => new Set(live.filter((s) => s.components.some((c) => c.domain === domain)).map((s) => s.day)).size;
  const t = week.targets;
  const tiles = [
    { label: 'Aerobic', icon: DOMAIN_ICON.cardio, value: minutes, of: t.aerobicMinutes, unit: 'min' },
    { label: 'Strength', icon: DOMAIN_ICON.strength, value: days('strength'), of: t.strengthDays, unit: 'days' },
    { label: 'Balance', icon: DOMAIN_ICON.balance, value: days('balance'), of: t.balanceDays, unit: 'days' },
    { label: 'Mobility', icon: DOMAIN_ICON.flexibility, value: days('flexibility'), of: t.mobilityDays, unit: 'days' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" role="list" aria-label="This week's targets">
      {tiles.map((t2) => (
        <div key={t2.label} role="listitem" className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
          <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>{getIcon(t2.icon, { size: 13 })}{t2.label}</p>
          <p className="text-lg font-semibold leading-tight tabular-nums">{t2.value}<span className="text-sm font-normal" style={{ color: 'var(--color-muted)' }}> of {t2.of} {t2.unit}</span></p>
        </div>
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
        className={`inline-flex items-center gap-1 text-xs hover:opacity-60 transition-all duration-200 ${reveal}`}
        style={{ color: 'var(--color-muted)' }}
      >
        {getIcon('moon', { size: 12 })}{budget ? 'Put back' : 'Rest'}
      </button>
    </Tooltip>
  );
}

function DayDetail({ w, day, week, sessions, restInfo, isToday, meta, prefs, onPrefs, onOpenExercise, onBack }) {
  const getIcon = useIcon();
  const mine = sessions.filter((s) => s.day === day);
  const live = mine.filter((s) => s.status !== 'rest');
  const letGo = mine.filter((s) => s.status === 'rest');
  const restDay = restInfo && !live.length;
  return (
    <div className="w-full space-y-4">
      <BackButton onClick={onBack}>Back to the week</BackButton>
      <Card
        title={`${DAY_NAMES[day]} ${dayLabel(week.weekStart, day)}${isToday ? ' (today)' : ''}`}
        icon="calendar"
      >
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
      </Card>
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
 * The week at a glance: compact cards, one column per day on a wide screen and a plain list on a narrow one.
 * Click a day (or a card) to open it. Drag a card to move it; rest controls appear when you hover a day.
 */
export default function WeekView({ onOpenExercise, offset: offsetProp, onOffsetChange, meta, prefs, onPrefs }) {
  const getIcon = useIcon();
  const narrow = useNarrow(900);
  const [localOffset, setLocalOffset] = useState(0);
  const [openDay, setOpenDay] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overSlot, setOverSlot] = useState(null);
  // The page can own the offset so coming back from an exercise page returns to the same week.
  const offset = offsetProp ?? localOffset;
  const setOffset = (fn) => {
    const next = typeof fn === 'function' ? fn(offset) : fn;
    (onOffsetChange || setLocalOffset)(next);
    setOpenDay(null);
  };
  const w = useWeek(offset);
  const { data } = w;

  if (w.loading && !data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Putting your week together…</p>;
  if (!data) return <Notice>{w.error || 'Could not load your week.'}</Notice>;
  if (!data.exists) {
    return (
      <div className="w-full space-y-4">
        <Notice>This week has not been made, and past weeks are only shown if they were.</Notice>
        <SecondaryButton onClick={() => setOffset(0)}>Back to this week</SecondaryButton>
      </div>
    );
  }

  const { week, sessions, softNotes, todayIndex, currentWeekStart } = data;
  const isCurrent = week.weekStart === currentWeekStart;
  const restByDay = new Map(week.restDays.map((r) => [r.day, r]));
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
    const restDay = restInfo && !live.length;
    return (
      <section
        key={day}
        aria-label={DAY_NAMES[day]}
        className="group rounded-2xl border p-2.5 min-h-[6rem]"
        style={{ background: 'var(--color-surface)', borderColor: isToday ? 'var(--color-text)' : 'var(--color-border)' }}
      >
        <header className="flex items-center gap-1 mb-2">
          <button
            type="button"
            onClick={() => setOpenDay(day)}
            aria-label={`Open ${DAY_NAMES[day]}`}
            className="flex-1 text-left hover:opacity-60 transition-opacity duration-200"
            style={{ color: 'var(--color-text)' }}
          >
            <span className="block text-sm font-semibold">
              {narrow ? DAY_NAMES[day] : DAY_SHORT[day]}
              {isToday && <span className="ml-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>today</span>}
            </span>
            <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{dayLabel(week.weekStart, day)}</span>
          </button>
          {restDay && <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-muted)' }}>{getIcon('moon', { size: 12 })}Rest</span>}
          {!acted && <RestButton restInfo={restInfo} hasSessions={live.length > 0} busy={w.busy} onRest={() => w.rest(day)} onUndo={() => w.undoRest(day)} />}
        </header>
        {dragId != null && !narrow ? (
          // while dragging: three clear places to drop
          <div className="space-y-1.5">
            {SLOTS.map((slot) => {
              const key = `${day}-${slot.id}`;
              const hot = overSlot === key;
              return (
                <div
                  key={slot.id}
                  onDragOver={(e) => { e.preventDefault(); setOverSlot(key); }}
                  onDragLeave={() => setOverSlot((k) => (k === key ? null : k))}
                  onDrop={(e) => onDrop(e, day, slot.id)}
                  className="rounded-xl border border-dashed p-2 text-xs transition-all duration-200"
                  style={{ borderColor: hot ? 'var(--color-text)' : 'var(--color-border)', background: hot ? 'var(--color-bg)' : 'transparent', color: 'var(--color-muted)' }}
                  aria-label={`${DAY_NAMES[day]} ${slot.label}`}
                >
                  <TimeOfDay slot={slot.id} size={12} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {daySessions.map((s) => (
              <CompactSessionCard
                key={s.id}
                session={s}
                draggable={!narrow}
                onOpen={() => setOpenDay(day)}
                onDragStart={setDragId}
                onDragEnd={() => { setDragId(null); setOverSlot(null); }}
              />
            ))}
            {!daySessions.length && !restDay && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing planned</p>}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="w-full space-y-4" data-tour="fitness-week-grid">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous week" onClick={() => setOffset((o) => Math.max(-1, o - 1))} disabled={offset <= -1} className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30" style={{ color: 'var(--color-muted)' }}>{getIcon('chevron-left', { size: 18 })}</button>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {dayLabel(week.weekStart, 0)} to {dayLabel(week.weekStart, 6)}
          </h2>
          <button type="button" aria-label="Next week" onClick={() => setOffset((o) => Math.min(1, o + 1))} disabled={offset >= 1} className="hover:opacity-60 transition-opacity duration-200 disabled:opacity-30" style={{ color: 'var(--color-muted)' }}>{getIcon('chevron-right', { size: 18 })}</button>
          {!isCurrent && <SecondaryButton onClick={() => setOffset(0)}>This week</SecondaryButton>}
          <div className="flex-1" />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {week.phase.label} · week {week.blockWeek} of {week.blockWeeks}{week.isDeload ? ' · a lighter week' : ''}{week.eased ? ' · gentle start' : ''}
          </span>
          <InfoTip tip={TIPS.weekGuide} icon="circle-help" />
        </div>
        {week.weekNote && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{week.weekNote}</p>}
        <Summary week={week} sessions={sessions} />
        <p className="text-xs" style={{ color: 'var(--color-muted)' }} data-tour="fitness-rest">
          Rest: {week.restDays.filter((r) => r.kind === 'planned').length} planned days, plus {week.restBudget} flexible
          {' '}({budgetLeft > 0 ? `${budgetLeft} left to spend` : 'used'}). Taking a rest day is a normal part of the week.
        </p>
      </Card>

      {w.error && <Notice>{w.error}</Notice>}
      {w.data?.aiNote && <Notice>{w.data.aiNote}</Notice>}
      {week.notes.map((n) => <Notice key={n}>{n}</Notice>)}
      {softNotes.map((n) => <Notice key={n}>{n}</Notice>)}

      {narrow ? (
        <div className="space-y-2.5" role="list" aria-label="The week">
          {DAY_NAMES.map((_, day) => <div key={day} role="listitem">{renderDay(day)}</div>)}
        </div>
      ) : (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {DAY_NAMES.map((_, day) => renderDay(day))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton onClick={w.regenerate} disabled={w.busy || acted}>Make a different version of this week</SecondaryButton>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {acted ? 'Locked: some of this week has already been logged.' : 'Same targets, different exercises.'}
        </span>
      </div>
    </div>
  );
}
