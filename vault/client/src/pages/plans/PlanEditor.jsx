import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import Dialog from '../../components/Dialog';
import TaskTimeline from '../../components/tasks/TaskTimeline';
import PlanClientPicker from './PlanClientPicker';
import { fmtDay, fitMessage, orderedRows, timelineTasks, timelineRange, waitOptions, dragToStepChange, workDaysInclusive } from './planLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const SMALL = 'inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const FIELD = 'px-2 py-1.5 rounded-lg border text-sm';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const LABEL_STYLE = { color: 'var(--color-muted)' };
const TONE = { ok: '#22c55e', warn: '#f59e0b', info: 'var(--color-muted)' };
const STATUS_LABEL = { todo: 'To do', 'in-progress': 'In progress', done: 'Done' };
const GRID = 'grid items-center gap-4 grid-cols-[minmax(220px,3fr)_130px_160px_150px_90px]';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_PILL = { draft: { bg: 'var(--color-border)', color: 'var(--color-muted)', label: 'Draft' }, active: { bg: '#d1fae5', color: '#065f46', label: 'Active' }, done: { bg: '#dbeafe', color: '#1e40af', label: 'Done' }, archived: { bg: 'var(--color-border)', color: 'var(--color-muted)', label: 'Archived' } };
// bar colours by status, drawn from the theme so the timeline matches the page: outline, half, solid
const BAR_STYLE = {
  todo: { bg: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', border: 'color-mix(in srgb, var(--color-primary) 60%, transparent)' },
  'in-progress': { bg: 'color-mix(in srgb, var(--color-primary) 50%, transparent)', border: 'color-mix(in srgb, var(--color-primary) 85%, transparent)' },
  done: { bg: 'var(--color-primary)', border: 'var(--color-primary)' },
};
const ZOOM_PPD = { week: 80, month: 28, quarter: 10 };
/** '2026-11-02' -> '02/11/2026'. */
const fmtNumeric = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');
/** '2026-11-01','2026-11-30' -> '1 Nov – 30 Nov 2026'. */
const rangeText = (a, b) => { if (!a || !b) return ''; const [ya, ma, da] = a.split('-').map(Number); const [yb, mb, db] = b.split('-').map(Number); return `${da} ${MONTHS[ma - 1]}${ya !== yb ? ` ${ya}` : ''} – ${db} ${MONTHS[mb - 1]} ${yb}`; };

/** A name that saves when you leave the box, not on every key. */
function NameBox({ value, onSave, label, disabled }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <VoiceInput value={text} onChange={setText} label={label} disabled={disabled}
      onBlur={() => { const t = text.trim(); if (t && t !== value) onSave(t); else setText(value); }} />
  );
}

/** Add a step (or a sub-step when parentStepId is given). */
function AddStep({ onAdd, busy, parentStepId = null, onCancel, closeAfter = true, cancelLabel = 'Cancel' }) {
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('1');
  const [milestone, setMilestone] = useState(false);
  const submit = async () => {
    if (!title.trim() || busy) return;
    const ok = await onAdd({ title: title.trim(), durationDays: milestone ? 0 : Number(days) || 1, isMilestone: milestone, parentStepId });
    if (ok) { setTitle(''); setDays('1'); setMilestone(false); if (closeAfter) onCancel?.(); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip text={parentStepId ? 'The name of the sub-step. It is added inside this step, which then spans its sub-steps. The microphone lets you say it.' : 'The name of the next step. The microphone lets you say it.'}>
        <div className="w-72 max-w-full">
          <VoiceInput value={title} onChange={setTitle} placeholder={parentStepId ? 'Sub-step name' : 'Step name'} label="New step name" disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        </div>
      </Tooltip>
      <Tooltip text="How many working days it takes. A milestone takes none.">
        <input type="number" min="1" max="3650" value={milestone ? '' : days} onChange={(e) => setDays(e.target.value)} disabled={milestone || busy}
          aria-label="Days for the new step" className={`${FIELD} w-20`} style={FIELD_STYLE} placeholder={milestone ? '—' : 'days'} />
      </Tooltip>
      <Tooltip text="A milestone is a point in time with no length, such as a sign-off. It shows as a diamond.">
        <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} disabled={busy} /> Milestone
        </label>
      </Tooltip>
      <Tooltip text="Add it to the plan.">
        <button type="button" onClick={submit} disabled={busy || !title.trim()} className={BTN} style={BTN_STYLE}>Add</button>
      </Tooltip>
      {onCancel && <Tooltip text="Close this without adding another."><button type="button" onClick={onCancel} className={BTN} style={BTN_STYLE}>{cancelLabel}</button></Tooltip>}
    </div>
  );
}

/** One plan: its settings, the steps as a table, and the timeline. */
export default function PlanEditor({ id }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [data, setData] = useState(null); // { plan, steps, deps, links, schedule, error }
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [addingUnder, setAddingUnder] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [zoom, setZoom] = useState('month');
  const scrollRef = useRef(null);
  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/plans/${id}`);
      const body = await res.json().catch(() => ({}));
      if (res.status === 404) { setLoadError('That plan was not found. It may have been deleted.'); return; }
      if (!res.ok) throw new Error(body.error || 'Could not load this plan.');
      setData(body);
      setDescription(body.plan.description || '');
      setLoadError('');
    } catch (err) { setLoadError(err.message || 'Could not load this plan.'); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Every change goes to the server, which answers with the truth; the page then reloads so dates always come from the one set of rules.
  const send = async (method, path, body) => {
    setBusy(true);
    try {
      const res = await api[method](`/api/plans/${id}${path}`, body);
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'That did not work. Try again.');
      await load();
      return true;
    } catch (err) { addToast(err.message, 'error'); await load(); return false; } finally { setBusy(false); }
  };
  const savePlan = (fields) => send('put', '', fields);
  const saveStep = (stepId, fields) => send('put', `/steps/${stepId}`, fields);
  const addStep = (fields) => send('post', '/steps', fields);
  const removeStep = async (stepId) => { setConfirmId(null); await send('delete', `/steps/${stepId}`); };
  const addDep = (stepId, blockedByStepId) => send('post', `/steps/${stepId}/deps`, { blockedByStepId });
  const removeDep = (stepId, blockedByStepId) => send('delete', `/steps/${stepId}/deps/${blockedByStepId}`);

  // Send steps to Tasks: a one-way copy. The server makes the tasks and links them back; the page then shows which steps are in Tasks.
  const sendToTasks = async (body) => {
    setConfirmSendAll(false);
    setBusy(true);
    try {
      const res = await api.post(`/api/plans/${id}/send-to-tasks`, body);
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'That could not be sent to Tasks. Try again.');
      const n = out.created.length;
      addToast(n ? `Sent ${n} ${n === 1 ? 'step' : 'steps'} to Tasks.${out.undated ? ` ${out.undated === 1 ? 'One has' : `${out.undated} have`} no date yet.` : ''}` : 'That is already in Tasks.', 'success', undefined, n ? { label: 'Open Tasks', href: '/tasks' } : undefined);
      await load();
    } catch (err) { addToast(err.message, 'error'); } finally { setBusy(false); }
  };

  // A bar dropped on the timeline: a move pins the step's start, dragging its right edge sets its length (the server works out every date).
  const onBarChange = (stepId, change, mode) => {
    const step = data?.steps.find((st) => st.id === stepId);
    const fields = dragToStepChange(step, change, mode, data?.plan.workWeek);
    if (fields) saveStep(stepId, fields);
  };

  const rows = useMemo(() => (data ? orderedRows(data.steps) : []), [data]);
  const fit = useMemo(() => (data ? fitMessage(data.plan, data.schedule) : null), [data]);
  const tlTasks = useMemo(() => (data ? timelineTasks(data.steps, data.deps, data.schedule) : []), [data]);
  const tlRange = useMemo(() => (data ? timelineRange(data.plan, data.schedule) : null), [data]);
  const nameOf = useMemo(() => Object.fromEntries((data?.steps || []).map((s) => [s.id, s.title])), [data]);

  if (loadError && !data) {
    return (
      <div className="p-6 space-y-3 max-w-[1700px]">
        <p className="text-sm" style={{ color: 'var(--color-text)' }} role="alert">{loadError}</p>
        <Tooltip text="Go back to your list of plans.">
          <button type="button" onClick={() => navigate('/plans')} className={BTN} style={BTN_STYLE}>{getIcon('arrow-left', { size: 13 })} Back to plans</button>
        </Tooltip>
      </div>
    );
  }
  if (!data) return <div className="p-6 space-y-4 max-w-[1700px]"><Skeleton className="h-28" label="Loading the plan" /><Skeleton className="h-64" label="Loading the steps" /></div>;

  const { plan, steps, deps, schedule, tasks = {} } = data;
  const unsent = steps.filter((st) => !tasks[st.id]).length;
  // a step and everything inside it: sending a group sends its sub-steps with it
  const subtree = (stepId) => { const out = [stepId]; for (const k of steps) if (k.parentStepId === stepId) out.push(...subtree(k.id)); return out; };
  const placed = schedule?.steps || {};
  const groupIds = new Set(steps.filter((st) => st.parentStepId != null).map((st) => st.parentStepId));
  const leaves = steps.filter((st) => !groupIds.has(st.id));
  const doneLeaves = leaves.filter((st) => st.status === 'done').length;
  const pill = STATUS_PILL[plan.status] || STATUS_PILL.draft;
  const startShown = plan.startDate || schedule?.projectStart || '';
  const editing = editingId != null ? steps.find((st) => st.id === editingId) : null;

  // timeline toolbar: move by most of a screen, or pick the zoom that shows the whole plan
  const nudge = (dir) => { const el = scrollRef.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' }); };
  const fitView = () => {
    const el = scrollRef.current;
    if (!el || !tlRange) return;
    const days = Math.max(1, Math.round((Date.parse(tlRange.targetEndDate) - Date.parse(tlRange.startDate)) / 86400000) + 1);
    const room = el.clientWidth - 200;
    setZoom(['week', 'month', 'quarter'].find((z) => days * ZOOM_PPD[z] <= room) || 'quarter');
    el.scrollTo({ left: 0, behavior: 'smooth' });
  };

  const stat = (label, value, icon) => (
    <div className="min-w-0">
      <div className="text-xs mb-1" style={LABEL_STYLE}>{label}</div>
      <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{icon && <span style={LABEL_STYLE}>{getIcon(icon, { size: 14 })}</span>}{value}</div>
    </div>
  );
  const fitTint = fit ? (fit.tone === 'ok' ? '#22c55e' : fit.tone === 'warn' ? '#f59e0b' : null) : null;
  const iconBtn = 'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';

  return (
    <div className="p-6 space-y-6 max-w-[1700px]">
      {/* The plan: kind and status, name, whose it is, and the settings */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs" style={LABEL_STYLE}>
            {getIcon('layers', { size: 14 })}
            <span className="uppercase tracking-wide">{plan.clientId ? 'Client plan' : 'Plan'}</span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
          </div>
          <h1 className="text-3xl font-bold leading-tight" style={{ color: 'var(--color-text)' }}>{plan.title}</h1>
          <p className="text-sm" style={LABEL_STYLE}>
            {plan.clientId
              ? <Link to={`/clients/${plan.clientId}`} className="transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{plan.clientName || 'Client'}</Link>
              : <span>No client</span>}
            {' / '}
            {plan.clientProjectId
              ? <Link to={`/client-projects/${plan.clientProjectId}`} className="transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{plan.clientProjectName || 'Project'}</Link>
              : <span>No project</span>}
          </p>
        </div>
        <Tooltip text="Change the plan's name, start and finish dates, working week, status, client and project.">
          <button type="button" onClick={() => setSettingsOpen(true)} className={`${BTN} text-sm`} style={BTN_STYLE}>{getIcon('sliders', { size: 14 })} Plan settings</button>
        </Tooltip>
      </header>

      {/* The dates at a glance, and whether the steps fit */}
      <div className="border-y py-4 grid grid-cols-2 lg:grid-cols-4 gap-4" style={{ borderColor: 'var(--color-border)' }}>
        {stat('Starts', startShown ? fmtDay(startShown) : 'Not set', 'calendar')}
        {stat('Finish by', plan.targetEndDate ? fmtDay(plan.targetEndDate) : 'Not set')}
        {stat('Working week', plan.workWeek === 'all' ? 'Every day' : 'Monday to Friday')}
        {stat('Progress', leaves.length ? `${doneLeaves} of ${leaves.length} ${leaves.length === 1 ? 'step' : 'steps'} done` : 'No steps yet')}
      </div>

      {fit && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm" role="status"
          style={{ background: fitTint ? `color-mix(in srgb, ${fitTint} 22%, transparent)` : 'var(--color-surface)', border: fitTint ? 'none' : '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <span style={{ color: TONE[fit.tone] }}>{getIcon(fit.tone === 'ok' ? 'check-circle' : 'info', { size: 16 })}</span>
          <span>{fit.text.replace(/^(Fits exactly\.|Fits\.|Over by[^.]*\.)/, '')
            ? <><strong>{(fit.text.match(/^(Fits exactly\.|Fits\.|Over by[^.]*\.)/) || [''])[0]}</strong>{fit.text.replace(/^(Fits exactly\.|Fits\.|Over by[^.]*\.)/, '')}</>
            : fit.text}</span>
          {fit.useStart && (
            <Tooltip text="Set the start date to the suggested day so the steps finish on time.">
              <button type="button" onClick={() => savePlan({ startDate: fit.useStart })} disabled={busy} className={BTN} style={BTN_STYLE}>Use {fmtDay(fit.useStart)}</button>
            </Tooltip>
          )}
        </div>
      )}

      {/* The steps */}
      <section className="space-y-3" data-tour="plans-steps">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold flex items-baseline gap-2" style={{ color: 'var(--color-text)' }}>Steps <span className="text-sm font-normal" style={LABEL_STYLE}>{steps.length}</span></h2>
          <div className="flex flex-wrap items-center gap-2">
            {steps.length > 0 && (confirmSendAll ? (
              <>
                <span className="text-xs" style={{ color: 'var(--color-text)' }}>Send {unsent} {unsent === 1 ? 'step' : 'steps'} to Tasks?</span>
                <Tooltip text="Yes, make a task for each step that is not in Tasks yet. They are copies: later changes to the plan are not copied to them, but ticking one in Tasks gives its step the same status."><button type="button" onClick={() => sendToTasks({})} disabled={busy} className={BTN} style={BTN_STYLE}>Yes</button></Tooltip>
                <Tooltip text="No, send nothing."><button type="button" onClick={() => setConfirmSendAll(false)} className={BTN} style={BTN_STYLE}>No</button></Tooltip>
              </>
            ) : (
              <Tooltip text={unsent === 0 ? 'Every step is already in Tasks.' : 'Make a task for every step that is not in Tasks yet. A step\'s last day becomes the due date and its days become the estimate; groups become tasks with their sub-steps inside; what a step waits on carries over. They are copies: later changes to the plan are not copied.'}>
                <button type="button" onClick={() => setConfirmSendAll(true)} disabled={busy || unsent === 0} className={BTN} style={BTN_STYLE}>{getIcon('list-checks', { size: 13 })} {unsent === 0 ? 'All in Tasks' : 'Send all to Tasks'}</button>
              </Tooltip>
            ))}
            <Tooltip text="Add a step: give it a name and a length in working days, or make it a milestone.">
              <button type="button" onClick={() => setAddOpen(true)} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>{getIcon('plus', { size: 14 })} Add step</button>
            </Tooltip>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={`${GRID} text-xs uppercase tracking-wide px-4 py-3 border-b`} style={{ ...LABEL_STYLE, borderColor: 'var(--color-border)' }}>
              <span>Step / dependency</span><span>Starts</span><span>Duration / ends</span><span>Status</span><span className="text-right">Actions</span>
            </div>
            {rows.length === 0 && <p className="text-sm px-4 py-4" style={LABEL_STYLE}>No steps yet. Use Add step, then say how long it takes.</p>}
            {rows.map(({ step, depth, isGroup }, i) => {
              const at = placed[step.id] || {};
              const myDeps = deps.filter((d) => d.stepId === step.id);
              const days = isGroup && at.start && at.end ? workDaysInclusive(at.start, at.end, plan.workWeek) : step.durationDays;
              return (
                <div key={step.id} id={`plan-step-${step.id}`} className={`${GRID} px-4 py-3 border-b`} style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex items-center gap-3 min-w-0" style={{ paddingLeft: depth * 20 }}>
                    <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium" style={{ background: 'var(--color-border)', color: 'var(--color-text)' }}>{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{step.title}</div>
                      <div className="text-xs flex items-center gap-1.5 truncate" style={LABEL_STYLE}>
                        {isGroup ? <span>Group</span> : myDeps.length === 0 ? <span>No dependency</span> : (
                          <><span className="flex-shrink-0">{getIcon('git-branch', { size: 12 })}</span><span className="truncate">Waits on {myDeps.map((d) => nameOf[d.blockedByStepId]).filter(Boolean).join(', ')}</span></>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm flex items-center gap-1" style={{ color: 'var(--color-text)' }}>{at.start ? fmtDay(at.start) : '—'}{step.startDate && !isGroup && <Tooltip text="This step is pinned to this day. Edit the step to unpin it."><span style={LABEL_STYLE}>{getIcon('pin', { size: 11 })}</span></Tooltip>}</div>
                    {at.start && <div className="text-xs" style={LABEL_STYLE}>{fmtNumeric(at.start)}</div>}
                  </div>
                  <div>
                    <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                      {step.isMilestone ? <span className="inline-flex items-center gap-1.5"><span style={{ color: 'var(--color-primary)' }}>◇</span> Milestone</span> : days ? `${days} working ${days === 1 ? 'day' : 'days'}` : '—'}
                    </div>
                    <div className="text-xs" style={{ color: at.conflict ? '#f59e0b' : 'var(--color-muted)' }}>{at.end ? `Ends ${fmtDay(at.end)}` : ''}{at.conflict ? ' · clashes' : ''}</div>
                  </div>
                  <Tooltip text="Where this step stands.">
                    <select value={step.status} onChange={(e) => saveStep(step.id, { status: e.target.value })} disabled={busy} aria-label={`Status of ${step.title}`} className={FIELD} style={FIELD_STYLE}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Tooltip>
                  <div className="flex items-center gap-1 justify-end">
                    {confirmId === step.id ? (
                      <>
                        <span className="text-xs" style={{ color: 'var(--color-text)' }}>{isGroup ? 'Delete with sub-steps?' : 'Delete?'}</span>
                        <Tooltip text="Yes, delete it. Sub-steps and links go with it and this cannot be undone."><button type="button" onClick={() => removeStep(step.id)} className={BTN} style={{ ...BTN_STYLE, color: '#ef4444' }}>Yes</button></Tooltip>
                        <Tooltip text="No, keep it."><button type="button" onClick={() => setConfirmId(null)} className={BTN} style={BTN_STYLE}>No</button></Tooltip>
                      </>
                    ) : (
                      <>
                        <Tooltip text="Edit this step: its name, start day, length, what it waits on, sub-steps, and sending it to Tasks.">
                          <button type="button" onClick={() => setEditingId(step.id)} disabled={busy} className={iconBtn} style={{ color: 'var(--color-muted)' }} aria-label={`Edit ${step.title}`}>{getIcon('edit', { size: 15 })}</button>
                        </Tooltip>
                        <Tooltip text="Delete this step. You are asked first.">
                          <button type="button" onClick={() => setConfirmId(step.id)} disabled={busy} className={iconBtn} style={{ color: '#ef4444' }} aria-label={`Delete ${step.title}`}>{getIcon('trash', { size: 15 })}</button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* The timeline: the same one Tasks uses, with Plans' own controls and colours */}
      <section className="space-y-3 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }} data-tour="plans-timeline">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Timeline</h2>
            {tlRange && <p className="text-sm" style={LABEL_STYLE}>{rangeText(tlRange.startDate, tlRange.targetEndDate)}</p>}
          </div>
          <div className="flex items-center gap-3">
            <div role="group" aria-label="Timeline zoom" className="flex items-center gap-0.5 p-1 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              {[['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter']].map(([k, label]) => (
                <Tooltip key={k} text={`Show the timeline by the ${k}.`}>
                  <button type="button" onClick={() => setZoom(k)} aria-pressed={zoom === k} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity duration-200 hover:opacity-70"
                    style={zoom === k ? { background: 'var(--color-border)', color: 'var(--color-text)' } : { color: 'var(--color-muted)' }}>{label}</button>
                </Tooltip>
              ))}
            </div>
            <Tooltip text="Move the timeline back."><button type="button" onClick={() => nudge(-1)} className={iconBtn} style={{ color: 'var(--color-text)' }} aria-label="Move the timeline back">{getIcon('arrow-left', { size: 16 })}</button></Tooltip>
            <Tooltip text="Fit the whole plan on screen."><button type="button" onClick={fitView} className={iconBtn} style={{ color: 'var(--color-text)' }} aria-label="Fit the whole plan on screen">{getIcon('focus', { size: 16 })}</button></Tooltip>
            <Tooltip text="Move the timeline forward."><button type="button" onClick={() => nudge(1)} className={iconBtn} style={{ color: 'var(--color-text)' }} aria-label="Move the timeline forward">{getIcon('arrow-right', { size: 16 })}</button></Tooltip>
          </div>
        </div>
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div style={{ height: Math.min(560, 70 + Math.max(tlTasks.length, 2) * 40) }}>
            <TaskTimeline tasks={tlTasks} project={tlRange} onEdit={(sid) => setEditingId(sid)} onBarChange={onBarChange} showBlocked={false} bare zoom={zoom} scrollRef={scrollRef} statusStyle={BAR_STYLE} labelHeader="Step" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs" style={LABEL_STYLE}>
          {[['todo', 'To do'], ['in-progress', 'In progress'], ['done', 'Done']].map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className="inline-block w-5 h-2.5 rounded-full" style={{ background: BAR_STYLE[k].bg, border: `1.5px solid ${BAR_STYLE[k].border}` }} />{label}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span style={{ color: 'var(--color-text)' }}>◇</span> Milestone</span>
          <span className="inline-flex items-center gap-1.5">{getIcon('git-branch', { size: 12 })} Dependency</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-px h-3" style={{ background: '#f59e0b' }} /> Today</span>
        </div>
      </section>

      {/* Notes about the plan itself */}
      <section className="space-y-2 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>Plan notes <span style={LABEL_STYLE}>{getIcon('pen-line', { size: 13 })}</span></h2>
        <Tooltip text="Anything about the plan itself. It saves when you click away. The microphone lets you dictate it.">
          <div className="w-full">
            <VoiceInput type="textarea" rows={3} append value={description} onChange={setDescription} label="Plan notes" disabled={busy}
              onBlur={() => { if (description.trim() !== (plan.description || '')) savePlan({ description: description.trim() }); }} />
          </div>
        </Tooltip>
      </section>

      <div className="pt-2">
        <Tooltip text={plan.clientId ? 'Back to this client\'s page, where their plans are listed.' : 'Back to your list of plans.'}>
          <Link to={plan.clientId ? `/clients/${plan.clientId}` : '/plans'} className="inline-flex items-center gap-2 text-sm font-medium transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
            {plan.clientId ? 'Back to client' : 'Back to plans'} {getIcon('arrow-right', { size: 14 })}
          </Link>
        </Tooltip>
      </div>

      {/* Plan settings */}
      {settingsOpen && (
        <Dialog title="Plan settings" size="xl" onClose={() => setSettingsOpen(false)}
          footer={<button type="button" onClick={() => setSettingsOpen(false)} className={BTN} style={BTN_STYLE}>Done</button>}>
          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs block" style={LABEL_STYLE}>Name</span>
              <Tooltip text="The plan's name. It saves when you click away. The microphone lets you say it.">
                <div className="w-full"><NameBox value={plan.title} onSave={(t) => savePlan({ title: t })} label="Plan name" disabled={busy} /></div>
              </Tooltip>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1 block">
                <span className="text-xs block" style={LABEL_STYLE}>Start</span>
                <Tooltip text="The first day of work. Clear it to work backwards from the finish date.">
                  <input type="date" value={plan.startDate || ''} onChange={(e) => savePlan({ startDate: e.target.value || null })} className={`${FIELD} w-full`} style={FIELD_STYLE} disabled={busy} />
                </Tooltip>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs block" style={LABEL_STYLE}>Finish by</span>
                <Tooltip text="The date it must be done by. The line under the dates says whether the steps fit.">
                  <input type="date" value={plan.targetEndDate || ''} onChange={(e) => savePlan({ targetEndDate: e.target.value || null })} className={`${FIELD} w-full`} style={FIELD_STYLE} disabled={busy} />
                </Tooltip>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs block" style={LABEL_STYLE}>Working week</span>
                <Tooltip text="Whether weekends count as working days. Step lengths are in working days.">
                  <select value={plan.workWeek} onChange={(e) => savePlan({ workWeek: e.target.value })} className={`${FIELD} w-full`} style={FIELD_STYLE} disabled={busy}>
                    <option value="weekdays">Monday to Friday</option>
                    <option value="all">Every day</option>
                  </select>
                </Tooltip>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs block" style={LABEL_STYLE}>Status</span>
                <Tooltip text="Where the plan stands. It is only a label for you.">
                  <select value={plan.status} onChange={(e) => savePlan({ status: e.target.value })} className={`${FIELD} w-full`} style={FIELD_STYLE} disabled={busy}>
                    <option value="draft">Draft</option><option value="active">Active</option><option value="done">Done</option><option value="archived">Archived</option>
                  </select>
                </Tooltip>
              </label>
              <PlanClientPicker clientId={plan.clientId} clientProjectId={plan.clientProjectId} clientName={plan.clientName} clientProjectName={plan.clientProjectName}
                onChange={(fields) => savePlan(fields)} disabled={busy} />
            </div>
          </div>
        </Dialog>
      )}

      {/* Add a step */}
      {addOpen && (
        <Dialog title="Add step" size="xl" onClose={() => setAddOpen(false)}>
          <p className="text-sm mb-3" style={LABEL_STYLE}>Name the step and say how long it takes. It stays open so you can add several; close it when you are done.</p>
          <AddStep busy={busy} onAdd={addStep} onCancel={() => setAddOpen(false)} closeAfter={false} cancelLabel="Close" />
        </Dialog>
      )}

      {/* Edit a step */}
      {editing && (() => {
        const st = editing;
        const isGroup = groupIds.has(st.id);
        const myDeps = deps.filter((d) => d.stepId === st.id);
        const options = isGroup ? [] : waitOptions(st, steps, deps);
        const at = placed[st.id] || {};
        return (
          <Dialog title="Edit step" size="xl" onClose={() => { setEditingId(null); setAddingUnder(null); }}
            footer={<button type="button" onClick={() => { setEditingId(null); setAddingUnder(null); }} className={BTN} style={BTN_STYLE}>Done</button>}>
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-xs block" style={LABEL_STYLE}>Name</span>
                <Tooltip text={isGroup ? 'A group: its dates come from the sub-steps inside it.' : 'The step name. It saves when you click away. The microphone lets you say it.'}>
                  <div className="w-full"><NameBox value={st.title} onSave={(t) => saveStep(st.id, { title: t })} label={`Name of step ${st.title}`} disabled={busy} /></div>
                </Tooltip>
              </label>
              {!isGroup && (
                <div className="flex flex-wrap items-end gap-4">
                  <label className="space-y-1 block">
                    <span className="text-xs block" style={LABEL_STYLE}>Starts</span>
                    <div className="flex items-center gap-1.5">
                      <Tooltip text={st.startDate ? 'This step is pinned to this day.' : 'Where the step lands now. Change it to pin the step to a day.'}>
                        <input type="date" value={st.startDate || at.start || ''} onChange={(e) => saveStep(st.id, { startDate: e.target.value || null })} disabled={busy}
                          aria-label={`Start of ${st.title}`} className={FIELD} style={{ ...FIELD_STYLE, ...(at.conflict ? { borderColor: '#f59e0b' } : {}) }} />
                      </Tooltip>
                      {st.startDate && (
                        <Tooltip text="Unpin: let the step start as soon as the steps it waits on are done.">
                          <button type="button" onClick={() => saveStep(st.id, { startDate: null })} disabled={busy} className={SMALL} style={BTN_STYLE} aria-label={`Unpin ${st.title}`}>{getIcon('pin', { size: 12 })}</button>
                        </Tooltip>
                      )}
                    </div>
                  </label>
                  {!st.isMilestone && (
                    <label className="space-y-1 block">
                      <span className="text-xs block" style={LABEL_STYLE}>Working days</span>
                      <Tooltip text="Working days this step takes.">
                        <input type="number" min="1" max="3650" defaultValue={st.durationDays} key={`${st.id}-${st.durationDays}`} disabled={busy}
                          onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n !== st.durationDays) saveStep(st.id, { durationDays: n }); else e.target.value = st.durationDays; }}
                          aria-label={`Days for ${st.title}`} className={`${FIELD} w-24`} style={FIELD_STYLE} />
                      </Tooltip>
                    </label>
                  )}
                  <Tooltip text={st.isMilestone ? 'Make this a normal step again.' : 'Make this a milestone: a point in time with no length, shown as a diamond.'}>
                    <label className="inline-flex items-center gap-1.5 text-sm pb-1.5" style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" checked={!!st.isMilestone} disabled={busy} onChange={() => saveStep(st.id, { isMilestone: !st.isMilestone, ...(st.isMilestone ? { durationDays: 1 } : {}) })} /> Milestone
                    </label>
                  </Tooltip>
                </div>
              )}
              {!isGroup && (
                <div className="space-y-1">
                  <span className="text-xs block" style={LABEL_STYLE}>Waits on</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {myDeps.length === 0 && <span className="text-sm" style={LABEL_STYLE}>Nothing: it starts on the plan's start.</span>}
                    {myDeps.map((d) => (
                      <Tooltip key={d.blockedByStepId} text={`This step starts after "${nameOf[d.blockedByStepId]}" ends. Click to remove the link.`}>
                        <button type="button" onClick={() => removeDep(st.id, d.blockedByStepId)} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-opacity duration-200 hover:opacity-60"
                          style={BTN_STYLE} aria-label={`Stop waiting on ${nameOf[d.blockedByStepId]}`}>
                          <span className="truncate max-w-[200px]">{nameOf[d.blockedByStepId]}</span>{getIcon('x', { size: 10 })}
                        </button>
                      </Tooltip>
                    ))}
                    {options.length > 0 && (
                      <Tooltip text="Choose a step that must finish before this one can start.">
                        <select value="" onChange={(e) => { if (e.target.value) addDep(st.id, Number(e.target.value)); }} disabled={busy} aria-label={`Add a step that ${st.title} waits on`} className={FIELD} style={FIELD_STYLE}>
                          <option value="">+ wait on</option>
                          {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                        </select>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <Tooltip text="Add a sub-step inside this step. The step then spans its sub-steps.">
                  <button type="button" onClick={() => setAddingUnder(addingUnder === st.id ? null : st.id)} disabled={busy || myDeps.length > 0 || deps.some((d) => d.blockedByStepId === st.id)} className={BTN} style={BTN_STYLE}>{getIcon('plus', { size: 13 })} Add a sub-step</button>
                </Tooltip>
                <Tooltip text={tasks[st.id] ? 'This step is a task in Tasks. Open Tasks to see it. Ticking or reopening the task there gives this step the same status; other changes to the step are not copied to the task.' : 'Make a task for this step (and its sub-steps) in Tasks. It is a copy: its last day becomes the due date and its days the estimate.'}>
                  <button type="button" onClick={() => (tasks[st.id] ? navigate('/tasks') : sendToTasks({ stepIds: subtree(st.id) }))} disabled={busy} className={BTN} style={{ ...BTN_STYLE, ...(tasks[st.id] ? { color: 'var(--color-primary)' } : {}) }}>
                    {getIcon('list-checks', { size: 13 })} {tasks[st.id] ? 'In Tasks: open' : 'Send to Tasks'}
                  </button>
                </Tooltip>
              </div>
              {addingUnder === st.id && (
                <AddStep parentStepId={st.id} busy={busy} onAdd={addStep} onCancel={() => setAddingUnder(null)} />
              )}
            </div>
          </Dialog>
        );
      })()}
    </div>
  );
}
