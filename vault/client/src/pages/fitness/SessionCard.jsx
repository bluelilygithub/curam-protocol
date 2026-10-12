import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { FIELD, Notice, SecondaryButton, PrimaryButton, TimeOfDay } from './ui';
import EffortPicker from './EffortPicker';
import LogPanel, { StatusChip } from './LogPanel';
import { ExerciseTile, TileGroup, PATTERN_LABELS, LEVEL_LABELS, BLOCK_LABELS } from './ExerciseTile';
import { BLOCK_ICON, DOMAIN_ICON, DOMAIN_NAME, PATTERN_ICON, sessionIcon } from './icons';
import { DAY_NAMES, SLOTS } from './useWeek';

/** Exercises for a session as tiles, grouped warm-up / main work / cool-down. Every tile opens its exercise page. */
export function ExerciseList({ session, onOpenExercise, compact = false }) {
  const blocks = ['warmup', 'main', 'cooldown'].map((b) => ({ b, list: session.exercises.filter((e) => e.block === b) })).filter((x) => x.list.length);
  return (
    <div className="space-y-4">
      {blocks.map(({ b, list }) => (
        <TileGroup
          key={b}
          title={BLOCK_LABELS[b]}
          icon={BLOCK_ICON[b]}
          hint={b !== 'main' ? `about ${b === 'warmup' ? session.warmupMin : session.cooldownMin} min` : `${session.plannedMinutes} min`}
          columns={compact ? '' : 'sm:grid-cols-2 lg:grid-cols-3'}
        >
          {list.map((e) => (
            <ExerciseTile
              key={`${e.block}-${e.position}`}
              name={e.name}
              detail={e.prescription}
              meta={[PATTERN_LABELS[e.movement], LEVEL_LABELS[e.level]].filter(Boolean).join(' · ')}
              compact={compact}
              icon={PATTERN_ICON[e.movement]}
              onOpen={() => onOpenExercise?.(e.slug)}
            />
          ))}
        </TileGroup>
      ))}
    </div>
  );
}

function statusText(session) {
  if (session.status === 'rest') return 'Rest taken';
  if (session.status === 'moved' && session.movedFrom) return `Moved from ${DAY_NAMES[session.movedFrom.day]}`;
  return null;
}

/** Day + time-of-day picker: the keyboard and touch way to move a session (dragging is the shortcut). */
function MovePicker({ session, onMove, onClose }) {
  const [day, setDay] = useState(session.day);
  const [slot, setSlot] = useState(session.slot);
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <label className="sr-only" htmlFor={`mv-day-${session.id}`}>Day</label>
      <select id={`mv-day-${session.id}`} value={day} onChange={(e) => setDay(Number(e.target.value))} className="px-2 py-1.5 rounded-lg border text-xs outline-none" style={FIELD}>
        {DAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
      </select>
      <label className="sr-only" htmlFor={`mv-slot-${session.id}`}>Time of day</label>
      <select id={`mv-slot-${session.id}`} value={slot} onChange={(e) => setSlot(e.target.value)} className="px-2 py-1.5 rounded-lg border text-xs outline-none" style={FIELD}>
        {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <PrimaryButton onClick={() => { onMove(session.id, day, slot); onClose(); }}>Move</PrimaryButton>
      <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
      <p className="basis-full text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Time of day is only a suggestion; choose what you will keep. Leave about 48 hours between strength sessions.
      </p>
    </div>
  );
}

/**
 * One planned session. In the week grid it is compact and draggable; on Today it opens out with its exercises.
 * Rest sessions (a rest day was taken) are shown plainly and kept, never struck through or coloured as a failure.
 */
/** What was logged, in plain words. */
function logSummary(log) {
  const bits = [];
  if (log.actualMinutes != null) bits.push(`${log.actualMinutes} min`);
  if (log.effort != null) bits.push(`effort ${log.effort} of 10`);
  if (log.activity) bits.push(log.activity);
  return bits.join(' · ');
}

export default function SessionCard({
  session, expanded = false, draggable = false, onMove, onOpenExercise, busy, showDay = false,
  logging = false, meta, prefs, onLog, onUndo, onRememberDetail,
}) {
  const getIcon = useIcon();
  const [open, setOpen] = useState(expanded);
  const [moving, setMoving] = useState(false);
  const [form, setForm] = useState(null); // null | initial status for the log form
  const [askEffort, setAskEffort] = useState(false);
  const [effort, setEffort] = useState(null);
  const [saving, setSaving] = useState(false);
  const note = statusText(session);
  const rest = session.status === 'rest';
  const log = session.log;
  const canMove = session.status === 'planned' || session.status === 'moved';

  const save = async (body) => {
    setSaving(true);
    const out = await onLog?.(session.id, body);
    setSaving(false);
    if (out) setForm(null);
    return out;
  };
  const doneAsPlanned = async () => {
    const out = await save({ status: 'done', actualMinutes: session.totalMinutes });
    if (out) { setAskEffort(true); setEffort(null); }
  };
  const saveEffort = async () => {
    if (effort != null) await save({ status: 'done', actualMinutes: log?.actualMinutes ?? session.totalMinutes, effort });
    setAskEffort(false);
  };

  return (
    <div
      draggable={draggable && canMove}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(session.id)); e.dataTransfer.effectAllowed = 'move'; }}
      className="rounded-xl border p-3 text-sm transition-all duration-200"
      style={{
        background: 'var(--color-bg)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
        opacity: rest ? 0.65 : 1,
        cursor: draggable && canMove ? 'grab' : 'default',
      }}
      data-session-id={session.id}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}
          aria-hidden="true"
        >
          {getIcon(sessionIcon(session), { size: 16 })}
        </span>
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 text-xs mb-0.5" style={{ color: 'var(--color-muted)' }}>
            <TimeOfDay slot={session.slot} />
            {showDay && <span>· {DAY_NAMES[session.day]}</span>}
          </p>
          <p className="font-medium leading-snug">{session.title}</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs" style={{ color: 'var(--color-text)' }} aria-label="What is in this session">
            {session.components.map((c) => (
              <li key={c.domain} className="inline-flex items-center gap-1">
                {getIcon(DOMAIN_ICON[c.domain], { size: 12 })}
                {DOMAIN_NAME[c.domain]} {c.minutes} min
              </li>
            ))}
          </ul>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {session.plannedMinutes} min main · {session.totalMinutes} min with warm-up and cool-down
            {session.outdoor ? ' · outdoors' : ''}
          </p>
          {note && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{note}</p>}
        </div>
        {canMove && (
          <Tooltip text="Sessions are suggestions. Move this one to a day or time that suits you, or drag it. The week's targets stay the same.">
            <button
              type="button"
              aria-label={`Move ${session.title} to another day or time`}
              onClick={() => setMoving((v) => !v)}
              className="flex-shrink-0 flex items-center gap-1 text-xs hover:opacity-60 transition-opacity duration-200"
              style={{ color: 'var(--color-muted)' }}
            >
              {getIcon('move', { size: 12 })}Move
            </button>
          </Tooltip>
        )}
      </div>
      {log && !form && (
        <div className="mt-2 pt-2 border-t space-y-1.5" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusChip status={log.status} />
            {logSummary(log) && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{logSummary(log)}</span>}
            {logging && (
              <>
                <button type="button" onClick={() => setForm(log.status)} className="text-xs underline hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>Edit</button>
                <button type="button" onClick={() => onUndo?.(session.id)} className="text-xs underline hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>Clear this log</button>
              </>
            )}
          </div>
          {log.note && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>“{log.note}”</p>}
          {log.safety?.message && <Notice tone="care">{log.safety.message}</Notice>}
          {logging && askEffort && log.status === 'done' && (
            <div className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <EffortPicker value={effort} onChange={setEffort} scale={meta?.effortScale} />
              <div className="flex gap-2">
                <PrimaryButton onClick={saveEffort} disabled={saving || effort == null}>Save</PrimaryButton>
                <SecondaryButton onClick={() => setAskEffort(false)}>Skip</SecondaryButton>
              </div>
            </div>
          )}
        </div>
      )}
      {logging && !log && session.loggable && canMove && !form && (
        <div className="flex flex-wrap gap-2 mt-3">
          <PrimaryButton onClick={doneAsPlanned} disabled={saving || busy}>Done as planned</PrimaryButton>
          <SecondaryButton onClick={() => setForm('done')}>Log details</SecondaryButton>
        </div>
      )}
      {logging && form && (
        <div className="mt-3">
          <LogPanel
            session={session}
            meta={meta}
            prefs={prefs}
            initialStatus={form}
            saving={saving}
            onSave={save}
            onCancel={() => setForm(null)}
            onRememberDetail={onRememberDetail}
          />
        </div>
      )}
      {moving && <MovePicker session={session} onMove={(id, d, s) => onMove?.(id, d, s)} onClose={() => setMoving(false)} />}
      {busy && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Updating…</p>}
      {session.exercises.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-xs mt-2 underline hover:opacity-60 transition-opacity duration-200"
            style={{ color: 'var(--color-muted)' }}
          >
            {open ? 'Hide exercises' : `Show ${session.exercises.length} exercises`}
          </button>
          {open && (
            <div className="mt-2 space-y-3">
              <ExerciseList session={session} onOpenExercise={onOpenExercise} compact={!expanded} />
              {session.safety?.length > 0 && (
                <ul className="space-y-0.5 text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }} aria-label="Safety">
                  {session.safety.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The small version used in the week: icon, title, when, how long, and its state. Click (or Enter) opens the day.
 * A marker shows when a session has been moved. Dragging moves it.
 */
export function CompactSessionCard({ session, draggable = false, onOpen, onDragStart, onDragEnd }) {
  const getIcon = useIcon();
  const rest = session.status === 'rest';
  const moved = session.status === 'moved' && session.movedFrom;
  const canDrag = draggable && (session.status === 'planned' || session.status === 'moved');
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={canDrag}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(session.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(session.id); }}
      onDragEnd={() => onDragEnd?.()}
      aria-label={`${session.title}, ${session.slot}, ${session.totalMinutes} minutes. Open this day.`}
      className="rounded-xl border p-2.5 text-left hover:opacity-70 transition-all duration-200 cursor-pointer"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', opacity: rest ? 0.6 : 1 }}
    >
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }} aria-hidden="true">
          {getIcon(sessionIcon(session), { size: 13 })}
        </span>
        <p className="flex-1 min-w-0 text-sm font-medium leading-snug truncate">{session.title}</p>
        {moved && (
          <Tooltip text={`Moved from ${DAY_NAMES[session.movedFrom.day]} ${session.movedFrom.slot}`}>
            <span className="flex-shrink-0" style={{ color: 'var(--color-muted)' }} aria-label={`Moved from ${DAY_NAMES[session.movedFrom.day]}`}>{getIcon('move', { size: 12 })}</span>
          </Tooltip>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
        <TimeOfDay slot={session.slot} size={11} />
        <span>{session.totalMinutes} min</span>
      </p>
      {(session.log || rest) && <p className="mt-1"><StatusChip status={session.log?.status || session.status} /></p>}
    </div>
  );
}
