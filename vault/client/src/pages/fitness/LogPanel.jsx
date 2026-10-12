import React, { useMemo, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import { FIELD, inputCls, Field, PrimaryButton, SecondaryButton, Voice, selectedStyle } from './ui';
import EffortPicker from './EffortPicker';

export const STATUS_OPTIONS = [
  { id: 'done', label: 'Done', icon: 'check' },
  { id: 'partial', label: 'Partly done', icon: 'circle-dot' },
  { id: 'swapped', label: 'Did something else', icon: 'repeat' },
  { id: 'rest', label: 'Rest', icon: 'moon' },
  { id: 'skipped', label: "Didn't do it", icon: 'circle-dashed' },
];

/** Neutral wording for a stored status. Nothing here is a verdict. */
export function StatusChip({ status }) {
  const getIcon = useIcon();
  const o = STATUS_OPTIONS.find((s) => s.id === status);
  if (!o) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
      {getIcon(o.icon, { size: 13 })}{o.label}
    </span>
  );
}

const num = (v) => (v === '' || v == null ? '' : v);

function ExerciseRow({ ex, row, onChange }) {
  const kind = ex.prefill?.kind || 'rounds';
  const set = (k, v) => onChange({ ...row, [k]: v });
  const small = 'w-full px-2 py-2 rounded-lg border text-sm outline-none transition-all duration-200 focus:border-[var(--color-text)]';
  const f = (key, label, placeholder, step) => (
    <label className="block">
      <span className="block text-[11px] mb-0.5" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <input type="number" inputMode="decimal" min="0" step={step || 1} className={small} style={FIELD} value={num(row[key])} placeholder={placeholder || ''} onChange={(e) => set(key, e.target.value)} />
    </label>
  );
  return (
    <div className="rounded-xl border p-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--color-text)' }}>{ex.name}</p>
      <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Plan: {ex.prescription}</p>
      <div className="grid grid-cols-3 gap-2">
        {kind === 'cardio' && f('distanceKm', 'Distance (km)', '', 0.1)}
        {kind === 'hold' && <>{f('sets', 'Sets')}{f('seconds', 'Seconds each')}</>}
        {(kind === 'reps' || kind === 'rounds') && <>
          {f('sets', 'Sets')}
          {f('reps', 'Reps')}
          {f('weightKg', 'Weight (kg)', ex.lastWeightKg != null ? `last ${ex.lastWeightKg}` : '', 0.5)}
        </>}
      </div>
    </div>
  );
}

/**
 * Log a session. Everything is pre-filled from the plan, so only differences need editing. Exercise details are collapsed
 * unless the person has opened them before (remembered per kind of session), so "Done as planned" stays one tap elsewhere.
 */
export default function LogPanel({ session, meta, prefs, initialStatus, onSave, onCancel, onRememberDetail, saving }) {
  const getIcon = useIcon();
  const existing = session.log;
  const strength = session.components.some((c) => c.domain === 'strength');
  const kindKey = strength ? 'strength' : 'other';
  const [status, setStatus] = useState(initialStatus || existing?.status || 'done');
  const [minutes, setMinutes] = useState(existing?.actualMinutes ?? session.totalMinutes);
  const [effort, setEffort] = useState(existing?.effort ?? null);
  const [note, setNote] = useState(existing?.note || '');
  const [activity, setActivity] = useState(existing?.activity || '');
  const [open, setOpen] = useState(!!prefs?.logDetailOpen?.[kindKey]);

  const main = useMemo(() => session.exercises.filter((e) => e.block === 'main'), [session]);
  const initialRows = useMemo(() => {
    const byPos = new Map((existing?.exercises || []).map((r) => [r.position, r]));
    return Object.fromEntries(main.map((e) => {
      const old = byPos.get(e.position);
      return [e.position, old
        ? { position: e.position, sets: old.sets, reps: old.reps, weightKg: old.weightKg, distanceKm: old.distanceKm, seconds: old.seconds }
        : { position: e.position, sets: e.prefill?.sets ?? '', reps: e.prefill?.reps ?? '', weightKg: '', distanceKm: '', seconds: e.prefill?.seconds ?? '' }];
    }));
  }, [existing, main]);
  const [rows, setRows] = useState(initialRows);

  const nothingDone = status === 'rest' || status === 'skipped';

  const toggleDetail = () => {
    const next = !open;
    setOpen(next);
    onRememberDetail?.({ [kindKey]: next });
  };

  const submit = () => {
    onSave({
      status,
      actualMinutes: nothingDone ? null : minutes,
      effort: nothingDone ? null : effort,
      note,
      activity: status === 'swapped' ? activity : null,
      exercises: !nothingDone && open ? Object.values(rows) : [],
    });
  };

  return (
    <div className="space-y-4 rounded-xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div>
        <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>How did it go?</p>
        <div role="radiogroup" aria-label="How did it go?" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {STATUS_OPTIONS.map((o) => {
            const active = status === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStatus(o.id)}
                className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl border text-sm hover:opacity-70 transition-all duration-200"
                style={selectedStyle(active)}
              >
                {getIcon(o.icon, { size: 15 })}{o.label}
              </button>
            );
          })}
        </div>
        {status === 'rest' && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Rest is part of training. This is recorded as rest, not as a missed session.</p>}
        {status === 'skipped' && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>That is fine. It is noted, nothing is added to later days.</p>}
      </div>

      {status === 'swapped' && (
        <Field label="What did you do instead?">
          <input className={inputCls} style={FIELD} value={activity} maxLength={120} placeholder="For example: swam instead of running" onChange={(e) => setActivity(e.target.value)} />
        </Field>
      )}

      {!nothingDone && (
        <>
          <div className="max-w-xs">
            <Field label="How long did you spend (minutes)?">
              <input type="number" inputMode="numeric" min="0" max="600" className={inputCls} style={FIELD} value={num(minutes)} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          </div>
          <EffortPicker value={effort} onChange={setEffort} scale={meta.effortScale} />

          {main.length > 0 && (
            <div>
              <button
                type="button"
                onClick={toggleDetail}
                aria-expanded={open}
                className="flex items-center gap-1.5 text-sm hover:opacity-60 transition-opacity duration-200"
                style={{ color: 'var(--color-text)' }}
              >
                {getIcon(open ? 'chevron-down' : 'chevron-right', { size: 15 })}
                Exercise details <span className="text-xs" style={{ color: 'var(--color-muted)' }}>(optional: sets, reps, kilograms)</span>
              </button>
              {open && (
                <div className="grid gap-2.5 sm:grid-cols-2 mt-3">
                  {main.map((e) => (
                    <ExerciseRow key={e.position} ex={e} row={rows[e.position]} onChange={(r) => setRows((cur) => ({ ...cur, [e.position]: r }))} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Field label="A note (optional)">
        <Voice label="note" value={note} onChange={setNote} placeholder="For example: knees felt good" rows={2} />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={submit} disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Save'}</PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={saving}>Cancel</SecondaryButton>
      </div>
    </div>
  );
}
