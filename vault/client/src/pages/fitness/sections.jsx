import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { Card, Field, FIELD, inputCls, Chip, Segmented, ScaleStrip, Voice, Notice, selectedStyle } from './ui';

const DOMAIN_ORDER = ['cardio', 'strength', 'flexibility', 'balance'];

export function emptyDraft() {
  return {
    dob: '', sex: '', heightCm: '', weightKg: '', timezone: '',
    scores: { cardio: 3, strength: 3, flexibility: 3, balance: 3 },
    previousScores: { cardio: 3, strength: 3, flexibility: 3, balance: 3 },
    previousLabel: '5 years ago',
    weeklyMinutes: '',
    equipment: [], smoking: 'none', alcohol: 'light', dietQuality: 3,
    timeFlexibility: { mode: 'flexible', twiceDaily: false, notes: '' },
    workAround: '', otherNotes: '', easeRequested: false, dumbbellKg: '',
  };
}

export function draftFromState(state) {
  const d = emptyDraft();
  if (state.profile) {
    d.dob = state.profile.dob || '';
    d.sex = state.profile.sex || '';
    d.heightCm = state.profile.heightCm ?? '';
    d.weightKg = state.profile.weightKg ?? '';
  }
  d.timezone = state.timezone?.source === 'user' ? state.timezone.timezone : '';
  if (state.lifestyle) {
    const l = state.lifestyle;
    d.weeklyMinutes = l.weeklyMinutes ?? '';
    d.equipment = l.equipment || [];
    d.smoking = l.smoking || 'none';
    d.alcohol = l.alcohol || 'none';
    d.dietQuality = l.dietQuality || 3;
    d.timeFlexibility = { mode: 'flexible', twiceDaily: false, notes: '', ...(l.timeFlexibility || {}) };
    d.workAround = l.workAround || '';
    d.otherNotes = l.otherNotes || '';
    d.easeRequested = !!l.easeRequested;
    d.dumbbellKg = (l.dumbbellKg || []).join(', ');
  }
  if (state.rating) {
    d.scores = { ...state.rating.scores };
    d.previousScores = state.rating.previousScores ? { ...state.rating.previousScores } : { ...state.rating.scores };
    d.previousLabel = state.rating.previousLabel || '5 years ago';
  }
  return d;
}

export function profilePayload(d) {
  return {
    dob: d.dob, sex: d.sex, heightCm: Number(d.heightCm), weightKg: Number(d.weightKg),
    weeklyMinutes: d.weeklyMinutes === '' ? null : Number(d.weeklyMinutes),
    equipment: d.equipment, smoking: d.smoking, alcohol: d.alcohol, dietQuality: d.dietQuality,
    timeFlexibility: d.timeFlexibility, workAround: d.workAround, otherNotes: d.otherNotes,
    easeRequested: d.easeRequested, timezone: d.timezone || '',
    dumbbellKg: String(d.dumbbellKg || '').split(/[,;\s]+/).filter(Boolean),
  };
}

export function ratingsPayload(d, kind) {
  return { kind, scores: d.scores, previousScores: d.previousScores, previousLabel: d.previousLabel, note: d.otherNotes };
}

/** Suggested answers for an age band. `touched` = fields the person has already set, which are left alone. */
export function applyTemplate(draft, template, touched) {
  const next = { ...draft };
  const t = template;
  if (!touched.has('scores')) next.scores = { ...t.ratings };
  if (!touched.has('previousScores')) next.previousScores = { ...t.previous };
  if (!touched.has('previousLabel')) next.previousLabel = t.previousLabel;
  if (!touched.has('equipment')) next.equipment = [...t.equipment];
  if (!touched.has('smoking')) next.smoking = t.smoking;
  if (!touched.has('alcohol')) next.alcohol = t.alcohol;
  if (!touched.has('dietQuality')) next.dietQuality = t.dietQuality;
  if (!touched.has('timeFlexibility')) next.timeFlexibility = { ...next.timeFlexibility, ...t.timeFlexibility };
  return next;
}

/** Looks up the age-band template when date of birth + sex are both set. */
export function useAgeTemplate(draft, setDraft, touchedRef, enabled = true) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled || !/^\d{4}-\d{2}-\d{2}$/.test(draft.dob) || !draft.sex) { setInfo(null); return undefined; }
    let live = true;
    api.get(`/api/fitness/template?dob=${encodeURIComponent(draft.dob)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!live) return;
        if (!r.ok) { setError(data.error || 'Could not load suggestions'); setInfo(null); return; }
        setError('');
        setInfo(data);
        setDraft((d) => applyTemplate(d, data.template, touchedRef.current));
      })
      .catch(() => { if (live) setError('Could not load suggestions'); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.dob, draft.sex, enabled]);
  return { info, error };
}

export function AboutSection({ meta, draft, set, templateInfo, templateError, timezoneInfo }) {
  const zones = useMemo(() => {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Adelaide']; }
  }, []);
  return (
    <Card title="About you" hint="Metric throughout. This stays private to your account.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of birth" hint="We use it to work out your age band.">
          <input type="date" className={inputCls} style={FIELD} value={draft.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('dob', e.target.value)} />
        </Field>
        <Field label="Sex">
          <select className={inputCls} style={FIELD} value={draft.sex} onChange={(e) => set('sex', e.target.value)}>
            <option value="">Select…</option>
            {meta.sex.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Height (cm)">
          <input type="number" inputMode="decimal" className={inputCls} style={FIELD} value={draft.heightCm} min="100" max="230" onChange={(e) => set('heightCm', e.target.value)} />
        </Field>
        <Field label="Weight (kg)">
          <input type="number" inputMode="decimal" className={inputCls} style={FIELD} value={draft.weightKg} min="30" max="300" onChange={(e) => set('weightKg', e.target.value)} />
        </Field>
        <Field
          label="Time zone"
          hint={draft.timezone ? 'Your own setting.' : `Using ${timezoneInfo?.timezone || 'the workspace default'} from Vault Settings. Pick one here to override it.`}
        >
          <input list="fitness-zones" className={inputCls} style={FIELD} value={draft.timezone} placeholder={timezoneInfo?.timezone || 'Australia/Brisbane'} onChange={(e) => set('timezone', e.target.value)} />
          <datalist id="fitness-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </Field>
      </div>
      {templateError && <Notice>{templateError}</Notice>}
      {templateInfo && (
        <Notice>
          Age band <strong>{templateInfo.band.label}</strong>. The next steps are pre-filled with typical answers for that age. They are only suggestions: change anything that is not you.
        </Notice>
      )}
    </Card>
  );
}

/**
 * Current weekly activity. Feeds the "Now" row of the goal. Never pre-filled: the age-band figure is only a hint, and a
 * blank answer makes the plan estimate it from the cardio rating.
 */
export function ActivitySection({ draft, set, typical }) {
  return (
    <Card title="How active are you right now?">
      <div className="max-w-xs">
        <Field
          label="Exercise in a typical week (minutes)"
          hint={`${typical != null ? `Typical for your age: ${typical}. ` : ''}Walking, cycling, swimming, gym, anything that gets you moving. Leave it blank if you are not sure and we will estimate it from your cardio rating.`}
        >
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="2000"
            className={inputCls}
            style={FIELD}
            value={draft.weeklyMinutes}
            placeholder={typical != null ? String(typical) : ''}
            onChange={(e) => set('weeklyMinutes', e.target.value)}
          />
        </Field>
      </div>
    </Card>
  );
}

function DomainRow({ domain, draft, set, ratings }) {
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{domain.label}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>Now</p>
          <ScaleStrip label={`${domain.label} now`} levels={domain.levels} value={draft.scores[domain.id]} onChange={(n) => set('scores', { ...draft.scores, [domain.id]: n })} />
        </div>
        {ratings !== 'now-only' && (
          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>{draft.previousLabel || 'Before'}</p>
            <ScaleStrip label={`${domain.label} ${draft.previousLabel}`} levels={domain.levels} value={draft.previousScores[domain.id]} onChange={(n) => set('previousScores', { ...draft.previousScores, [domain.id]: n })} />
          </div>
        )}
      </div>
    </div>
  );
}

export function RatingsSection({ meta, draft, set, fromTemplate, title = 'Your fitness', hint, showNotes = true }) {
  return (
    <Card
      title={title}
      hint={hint || 'Rate yourself honestly from 1 to 5. Nobody checks these. They are there to help the plan fit you. Hover a number to see what it means.'}
    >
      {fromTemplate && <Notice>These start at typical answers for your age band. Move them to where you really are.</Notice>}
      <div className="max-w-sm">
        <Field label="Compare with how fit you were…" hint="For example “5 years ago” or “at my peak”.">
          <input className={inputCls} style={FIELD} value={draft.previousLabel} maxLength={60} onChange={(e) => set('previousLabel', e.target.value)} />
        </Field>
      </div>
      <div className="space-y-3">
        {DOMAIN_ORDER.map((id) => <DomainRow key={id} domain={meta.domains.find((d) => d.id === id)} draft={draft} set={set} />)}
      </div>
      {showNotes && (
        <Field label="Anything else?" hint="For example “very fit until 50, sedentary the last 2 years”.">
          <Voice label="anything else" value={draft.otherNotes} onChange={(v) => set('otherNotes', v)} placeholder="Anything that helps us understand where you are" rows={2} />
        </Field>
      )}
    </Card>
  );
}

export function LifestyleSection({ meta, draft, set }) {
  const toggleEquip = (id) => set('equipment', draft.equipment.includes(id) ? draft.equipment.filter((e) => e !== id) : [...draft.equipment, id]);
  const tf = draft.timeFlexibility;
  return (
    <Card title="Lifestyle and access" hint="What you have to work with, and how your days run.">
      <Field label="Equipment and places available">
        <div className="flex flex-wrap gap-2 mt-1">
          {meta.equipment.map((e) => <Chip key={e.id} active={draft.equipment.includes(e.id)} onClick={() => toggleEquip(e.id)}>{e.label}</Chip>)}
        </div>
      </Field>
      <Field label="My dumbbell weights, in kg (optional)">
        <input className={inputCls} value={draft.dumbbellKg || ''} onChange={(e) => set('dumbbellKg', e.target.value)} placeholder="For example: 2, 4, 6, 8, 10" aria-label="My dumbbell weights in kilograms" />
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>If you list them, tips can name the next weight up. If not, they just say "the next weight up".</p>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Smoking"><Segmented label="Smoking" options={meta.smoking} value={draft.smoking} onChange={(v) => set('smoking', v)} /></Field>
        <Field label="Alcohol"><Segmented label="Alcohol" options={meta.alcohol} value={draft.alcohol} onChange={(v) => set('alcohol', v)} /></Field>
      </div>
      <Field label="General diet quality (1-5)" hint={meta.dietScale[draft.dietQuality - 1]}>
        <div className="flex gap-1.5 mt-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={draft.dietQuality === n}
              onClick={() => set('dietQuality', n)}
              className="w-10 h-10 rounded-xl border text-sm font-medium hover:opacity-70 transition-all duration-200"
              style={selectedStyle(draft.dietQuality === n)}
            >{n}</button>
          ))}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your time">
          <Segmented
            label="Time flexibility"
            options={[{ id: 'flexible', label: 'Flexible' }, { id: 'fixed', label: 'Fixed times' }]}
            value={tf.mode}
            onChange={(v) => set('timeFlexibility', { ...tf, mode: v })}
          />
        </Field>
        <Field label="Short sessions twice a day?">
          <Segmented
            label="Twice a day"
            options={[{ id: 'yes', label: 'Happy to' }, { id: 'no', label: 'Prefer once' }]}
            value={tf.twiceDaily ? 'yes' : 'no'}
            onChange={(v) => set('timeFlexibility', { ...tf, twiceDaily: v === 'yes' })}
          />
        </Field>
      </div>
      {tf.mode === 'fixed' && (
        <Field label="Which times work?" hint="For example “weekdays before 8am and after 5pm”.">
          <input className={inputCls} style={FIELD} value={tf.notes || ''} maxLength={300} onChange={(e) => set('timeFlexibility', { ...tf, notes: e.target.value })} />
        </Field>
      )}
    </Card>
  );
}

/** Optional. Runs the notes through the server's safety check when you leave the box. */
export function WorkAroundSection({ draft, set }) {
  const [safety, setSafety] = useState(null);
  const timer = useRef(null);

  const check = (workAround, otherNotes) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.post('/api/fitness/safety-check', { workAround, otherNotes })
        .then((r) => r.json()).then(setSafety).catch(() => {});
    }, 350);
  };
  useEffect(() => { check(draft.workAround, draft.otherNotes); return () => clearTimeout(timer.current); }, [draft.workAround, draft.otherNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Anything to work around? (optional)" hint="An old injury or a condition the program should avoid. Skip it if there is nothing. This is not a medical check.">
      <Voice label="things to work around" value={draft.workAround} onChange={(v) => set('workAround', v)} placeholder="For example: sore left knee on stairs, avoid deep lunges" rows={2} />
      {safety?.message && (
        <Notice tone="care">
          <p>{safety.message}</p>
          {safety.offerEase && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={draft.easeRequested} onChange={(e) => set('easeRequested', e.target.checked)} />
              <span>Yes, keep my first weeks gentle</span>
            </label>
          )}
        </Notice>
      )}
    </Card>
  );
}
