import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import { Card, Chip, Field, FIELD, inputCls, Notice, PrimaryButton, SecondaryButton, TimeOfDay, formatDate } from './ui';
import { TileGroup } from './ExerciseTile';
import { DOMAIN_ICON, sessionIcon } from './icons';
import EffortPicker from './EffortPicker';
import LogPanel, { STATUS_OPTIONS, StatusChip } from './LogPanel';
import { DAY_NAMES, addDays } from './useWeek';

const QUICK = [
  { status: 'done', label: 'Done as planned', primary: true },
  { status: 'partial', label: 'Partly' },
  { status: 'swapped', label: 'Something else', details: true },
  { status: 'rest', label: 'Rest' },
  { status: 'skipped', label: "Didn't do it" },
];
const EXTRA_IDEAS = ['Walk', 'Swim', 'Ride', 'Class', 'Gardening or active chores'];

/** Optional weigh-in. Saved to the shared weight table; no targets, no charts. */
export function WeighInTile({ last, onSaved, compact = false, onDismissWeek, onNever }) {
  const addToast = useToastStore((s) => s.addToast);
  const getIcon = useIcon();
  const [kg, setKg] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.post('/api/fitness/weight', { weightKg: kg });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save that');
      setKg('');
      addToast('Saved', 'success');
      onSaved?.(d.weights[0]);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="rounded-2xl border p-4 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        <span style={{ color: 'var(--color-muted)' }}>{getIcon('scale', { size: 16 })}</span>
        {compact ? 'Want to note your weight this week?' : 'Weigh-in (optional)'}
      </p>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        {last ? `Last: ${last.weightKg} kg on ${formatDate(last.measuredOn)}. ` : ''}Entirely optional. This app is about how you move, not the scales.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" inputMode="decimal" min="30" max="300" step="0.1" className={`${inputCls} max-w-[9rem]`} style={FIELD} value={kg} placeholder="kg" aria-label="Weight in kilograms" onChange={(e) => setKg(e.target.value)} />
        <PrimaryButton onClick={save} disabled={saving || !kg}>Save</PrimaryButton>
        {onDismissWeek && <SecondaryButton onClick={onDismissWeek}>Not this week</SecondaryButton>}
        {onNever && <button type="button" onClick={onNever} className="text-xs underline hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>Don't ask again</button>}
      </div>
    </div>
  );
}

function CatchUpTile({ s, meta, prefs, onRememberDetail, onSaved }) {
  const addToast = useToastStore((x) => x.addToast);
  const getIcon = useIcon();
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null); // { session, status } once loaded
  const [safety, setSafety] = useState(null);

  const post = async (id, body) => {
    setBusy(true);
    try {
      const r = await api.post(`/api/fitness/sessions/${id}/log`, body);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save that');
      if (d.safety?.message) setSafety(d.safety);
      else onSaved();
      return true;
    } catch (err) {
      addToast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (status) => {
    setBusy(true);
    try {
      const r = await api.get(`/api/fitness/week?start=${s.weekStart}`);
      const d = await r.json();
      const full = d.sessions?.find((x) => x.id === s.id);
      if (!full) throw new Error('Could not open that session');
      setDetail({ session: full, status });
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const quick = (q) => {
    if (q.details) return openDetail(q.status);
    return post(s.id, { status: q.status, actualMinutes: q.status === 'done' ? s.totalMinutes : null });
  };

  if (safety) {
    return (
      <div className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{s.title}: saved</p>
        <Notice tone="care">{safety.message}</Notice>
        <SecondaryButton onClick={() => onSaved(true)}>OK</SecondaryButton>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-3 space-y-2.5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
      <div className="flex items-start gap-2.5">
        <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }} aria-hidden="true">
          {getIcon(sessionIcon(s), { size: 16 })}
        </span>
        <div className="min-w-0">
          <p className="text-xs flex flex-wrap items-center gap-x-2" style={{ color: 'var(--color-muted)' }}>
            <span>{DAY_NAMES[s.day]} {formatDate(s.date)}</span>
            <TimeOfDay slot={s.slot} size={12} />
          </p>
          <p className="text-sm font-medium leading-snug">{s.title}</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{s.totalMinutes} min planned</p>
        </div>
      </div>
      {detail ? (
        <LogPanel
          session={detail.session}
          meta={meta}
          prefs={prefs}
          initialStatus={detail.status}
          saving={busy}
          onSave={async (body) => { const ok = await post(s.id, body); if (ok) setDetail(null); }}
          onCancel={() => setDetail(null)}
          onRememberDetail={onRememberDetail}
        />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => {
            const o = STATUS_OPTIONS.find((x) => x.id === q.status);
            return (
              <button
                key={q.status}
                type="button"
                disabled={busy}
                onClick={() => quick(q)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs hover:opacity-70 transition-all duration-200 disabled:opacity-40"
                style={q.primary ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
              >
                {getIcon(o.icon, { size: 13 })}{q.label}
              </button>
            );
          })}
          <button type="button" disabled={busy} onClick={() => openDetail('done')} className="px-2.5 py-1.5 text-xs underline hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>Add details</button>
        </div>
      )}
    </div>
  );
}

function ExtraForm({ meta, today, onSaved }) {
  const addToast = useToastStore((s) => s.addToast);
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [effort, setEffort] = useState(null);
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const oldest = addDays(today, -(meta.backfillDays || 28));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.post('/api/fitness/logs/extra', { title, actualMinutes: minutes, effort, date });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save that');
      setTitle(''); setMinutes(''); setEffort(null); setDate(today);
      addToast('Added. Thanks for noting it.', 'success');
      onSaved();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap gap-2">
        {EXTRA_IDEAS.map((i) => <Chip key={i} active={title === i} onClick={() => setTitle(i)}>{i}</Chip>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What did you do?"><input className={inputCls} style={FIELD} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Minutes"><input type="number" inputMode="numeric" min="1" max="600" className={inputCls} style={FIELD} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
        <Field label="Date"><input type="date" className={inputCls} style={FIELD} value={date} min={oldest} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <EffortPicker value={effort} onChange={setEffort} scale={meta.effortScale} />
      <PrimaryButton onClick={save} disabled={saving || !title.trim() || !minutes}>Add it</PrimaryButton>
    </div>
  );
}

export default function LogView({ meta, state, prefs, onPrefs, onWeighIn }) {
  const addToast = useToastStore((s) => s.addToast);
  const getIcon = useIcon();
  const [catchUp, setCatchUp] = useState(null);
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([api.get('/api/fitness/catchup'), api.get('/api/fitness/logs?limit=20')]);
      const cd = await c.json();
      const ld = await l.json();
      if (!c.ok) throw new Error(cd.error || 'Could not load');
      setCatchUp(cd);
      setLogs(ld.logs || []);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const doneAll = async () => {
    setBulk(false);
    let ok = 0;
    for (const s of catchUp.sessions) {
      const r = await api.post(`/api/fitness/sessions/${s.id}/log`, { status: 'done', actualMinutes: s.totalMinutes });
      if (r.ok) ok += 1;
    }
    addToast(`${ok} session${ok === 1 ? '' : 's'} marked done as planned.`, 'success');
    load();
  };

  const removeExtra = async (id) => {
    setConfirmDelete(null);
    const r = await api.delete(`/api/fitness/logs/${id}`);
    if (!r.ok) addToast('Could not remove that', 'error');
    load();
  };

  const today = state.today;
  return (
    <div className="max-w-3xl mx-auto w-full space-y-6" data-tour="fitness-log">
      {error && <Notice>{error}</Notice>}

      <WeighInTile last={state.weighIn} onSaved={onWeighIn} />

      <TileGroup title="Catch up" icon="clipboard-list" hint={catchUp ? `${catchUp.sessions.length} waiting` : ''} columns="">
        {!catchUp && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        {catchUp && !catchUp.sessions.length && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing waiting. Sessions from the last {meta.backfillDays} days show up here until you note them, and it is fine to leave some unlogged.</p>
        )}
        {catchUp?.sessions.map((s) => (
          <CatchUpTile key={s.id} s={s} meta={meta} prefs={prefs} onRememberDetail={(patch) => onPrefs({ logDetailOpen: patch })} onSaved={() => load()} />
        ))}
      </TileGroup>
      {catchUp?.sessions.length > 1 && (
        <div className="-mt-3">
          {bulk ? (
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>
              Mark all {catchUp.sessions.length} as done as planned?{' '}
              <button type="button" onClick={doneAll} className="underline font-medium">Yes</button>{' / '}
              <button type="button" onClick={() => setBulk(false)} className="underline">No</button>
            </span>
          ) : (
            <SecondaryButton onClick={() => setBulk(true)}>Mark all as done as planned</SecondaryButton>
          )}
        </div>
      )}

      <section>
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: 'var(--color-muted)' }}>{getIcon('plus', { size: 15 })}</span>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Something else I did</h3>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>a walk, a swim, a class</span>
        </div>
        <ExtraForm meta={meta} today={today} onSaved={load} />
      </section>

      <TileGroup title="Recent" icon="clock" columns="">
        {logs && !logs.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing logged yet.</p>}
        {logs?.map((l) => (
          <div key={l.id} className="rounded-xl border p-3 flex items-start gap-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <span className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }} aria-hidden="true">
              {getIcon(l.extra ? DOMAIN_ICON[l.domain] || 'heart-pulse' : 'check', { size: 16 })}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{l.extra ? l.title : l.title || 'Session'}{l.extra && <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}> · extra</span>}</p>
              <p className="text-xs flex flex-wrap items-center gap-x-2" style={{ color: 'var(--color-muted)' }}>
                <span>{formatDate(l.loggedOn)}</span>
                <StatusChip status={l.status} />
                {l.actualMinutes != null && <span>{l.actualMinutes} min</span>}
                {l.effort != null && <span>effort {l.effort} of 10</span>}
              </p>
              {l.activity && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{l.activity}</p>}
            </div>
            {l.extra && (confirmDelete === l.id ? (
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Remove? <button type="button" className="underline" onClick={() => removeExtra(l.id)}>Yes</button> / <button type="button" className="underline" onClick={() => setConfirmDelete(null)}>No</button></span>
            ) : (
              <button type="button" aria-label={`Remove ${l.title}`} className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }} onClick={() => setConfirmDelete(l.id)}>{getIcon('trash', { size: 14 })}</button>
            ))}
          </div>
        ))}
      </TileGroup>
    </div>
  );
}
