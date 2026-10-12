import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { FIELD, SecondaryButton, PrimaryButton } from './ui';
import { DAY_NAMES, SLOTS } from './useWeek';

const BLOCK_LABELS = { warmup: 'Warm-up', main: 'Main', cooldown: 'Cool-down' };

/** Exercise list for a session, grouped warm-up / main / cool-down. Every exercise opens its library page. */
export function ExerciseList({ session, onOpenExercise }) {
  const blocks = ['warmup', 'main', 'cooldown'].map((b) => ({ b, list: session.exercises.filter((e) => e.block === b) })).filter((x) => x.list.length);
  return (
    <div className="space-y-3">
      {blocks.map(({ b, list }) => (
        <div key={b}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
            {BLOCK_LABELS[b]}{b !== 'main' ? ` (about ${b === 'warmup' ? session.warmupMin : session.cooldownMin} min)` : ''}
          </p>
          <ul className="space-y-1">
            {list.map((e) => (
              <li key={`${e.block}-${e.position}`} className="text-sm flex flex-wrap items-baseline gap-x-2">
                <button
                  type="button"
                  onClick={() => onOpenExercise?.(e.slug)}
                  className="underline text-left hover:opacity-60 transition-opacity duration-200"
                  style={{ color: 'var(--color-text)' }}
                >
                  {e.name}
                </button>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{e.prescription}</span>
              </li>
            ))}
          </ul>
        </div>
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
export default function SessionCard({ session, expanded = false, draggable = false, onMove, onOpenExercise, busy }) {
  const getIcon = useIcon();
  const [open, setOpen] = useState(expanded);
  const [moving, setMoving] = useState(false);
  const note = statusText(session);
  const rest = session.status === 'rest';

  return (
    <div
      draggable={draggable && !rest}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(session.id)); e.dataTransfer.effectAllowed = 'move'; }}
      className="rounded-xl border p-3 text-sm transition-all duration-200"
      style={{
        background: 'var(--color-bg)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
        opacity: rest ? 0.65 : 1,
        cursor: draggable && !rest ? 'grab' : 'default',
      }}
      data-session-id={session.id}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-snug">{session.title}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {session.plannedMinutes} min main · {session.totalMinutes} min with warm-up and cool-down
            {session.outdoor ? ' · outdoors' : ''}
          </p>
          {note && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{note}</p>}
        </div>
        {!rest && (
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
              <ExerciseList session={session} onOpenExercise={onOpenExercise} />
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
