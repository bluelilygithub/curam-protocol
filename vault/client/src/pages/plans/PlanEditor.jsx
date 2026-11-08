import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import TaskTimeline from '../../components/tasks/TaskTimeline';
import { fmtDay, fitMessage, orderedRows, timelineTasks, timelineRange, waitOptions, dragToStepChange } from './planLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const SMALL = 'inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const FIELD = 'px-2 py-1.5 rounded-lg border text-sm';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const LABEL_STYLE = { color: 'var(--color-muted)' };
const TONE = { ok: '#22c55e', warn: '#f59e0b', info: 'var(--color-muted)' };
const STATUS_LABEL = { todo: 'To do', 'in-progress': 'In progress', done: 'Done' };
const GRID = 'grid items-center gap-2 grid-cols-[minmax(180px,2.2fr)_150px_70px_100px_minmax(170px,1.6fr)_110px_auto]';

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
function AddStep({ onAdd, busy, parentStepId = null, onCancel }) {
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('1');
  const [milestone, setMilestone] = useState(false);
  const submit = async () => {
    if (!title.trim() || busy) return;
    const ok = await onAdd({ title: title.trim(), durationDays: milestone ? 0 : Number(days) || 1, isMilestone: milestone, parentStepId });
    if (ok) { setTitle(''); setDays('1'); setMilestone(false); onCancel?.(); }
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
      {onCancel && <Tooltip text="Do not add a sub-step after all."><button type="button" onClick={onCancel} className={BTN} style={BTN_STYLE}>Cancel</button></Tooltip>}
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
  const jumpToStep = (stepId) => { const el = document.getElementById(`plan-step-${stepId}`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.querySelector('input')?.focus(); } };

  return (
    <div className="p-6 space-y-6 max-w-[1700px]">
      <div className="flex items-center gap-2">
        <Tooltip text="Back to your list of plans.">
          <button type="button" onClick={() => navigate('/plans')} className={BTN} style={BTN_STYLE}>{getIcon('arrow-left', { size: 13 })} Plans</button>
        </Tooltip>
      </div>

      {/* The plan: name, dates, week, status, and whether it fits */}
      <section className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[240px] space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Name</span>
            <Tooltip text="The plan's name. It saves when you click away. The microphone lets you say it.">
              <div className="w-full"><NameBox value={plan.title} onSave={(t) => savePlan({ title: t })} label="Plan name" disabled={busy} /></div>
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Start</span>
            <Tooltip text="The first day of work. Clear it to work backwards from the finish date.">
              <input type="date" value={plan.startDate || ''} onChange={(e) => savePlan({ startDate: e.target.value || null })} className={FIELD} style={FIELD_STYLE} disabled={busy} />
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Finish by</span>
            <Tooltip text="The date it must be done by. The line below says whether the steps fit.">
              <input type="date" value={plan.targetEndDate || ''} onChange={(e) => savePlan({ targetEndDate: e.target.value || null })} className={FIELD} style={FIELD_STYLE} disabled={busy} />
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Working week</span>
            <Tooltip text="Whether weekends count as working days. Step lengths are in working days.">
              <select value={plan.workWeek} onChange={(e) => savePlan({ workWeek: e.target.value })} className={FIELD} style={FIELD_STYLE} disabled={busy}>
                <option value="weekdays">Monday to Friday</option>
                <option value="all">Every day</option>
              </select>
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Status</span>
            <Tooltip text="Where the plan stands. It is only a label for you.">
              <select value={plan.status} onChange={(e) => savePlan({ status: e.target.value })} className={FIELD} style={FIELD_STYLE} disabled={busy}>
                <option value="draft">Draft</option><option value="active">Active</option><option value="done">Done</option><option value="archived">Archived</option>
              </select>
            </Tooltip>
          </label>
        </div>

        {fit && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm" style={{ border: `1px solid ${TONE[fit.tone]}`, color: 'var(--color-text)' }} role="status">
            <span style={{ color: TONE[fit.tone] }}>{getIcon(fit.tone === 'ok' ? 'check' : 'info', { size: 14 })}</span>
            <span>{fit.text}</span>
            {fit.useStart && (
              <Tooltip text="Set the start date to the suggested day so the steps finish on time.">
                <button type="button" onClick={() => savePlan({ startDate: fit.useStart })} disabled={busy} className={BTN} style={BTN_STYLE}>Use {fmtDay(fit.useStart)}</button>
              </Tooltip>
            )}
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-xs block" style={LABEL_STYLE}>Notes</span>
          <Tooltip text="Anything about the plan itself. It saves when you click away. The microphone lets you dictate it.">
            <div className="w-full">
              <VoiceInput type="textarea" rows={2} append value={description} onChange={setDescription} label="Plan notes" disabled={busy}
                onBlur={() => { if (description.trim() !== (plan.description || '')) savePlan({ description: description.trim() }); }} />
            </div>
          </Tooltip>
        </label>
      </section>

      {/* The steps */}
      <section className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Steps</h2>
          {steps.length > 0 && (confirmSendAll ? (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Send {unsent} {unsent === 1 ? 'step' : 'steps'} to Tasks?</span>
              <Tooltip text="Yes, make a task for each step that is not in Tasks yet. They are copies: later changes to the plan are not copied to them, but ticking one in Tasks gives its step the same status."><button type="button" onClick={() => sendToTasks({ all: true })} disabled={busy} className={BTN} style={BTN_STYLE}>Yes</button></Tooltip>
              <Tooltip text="No, send nothing."><button type="button" onClick={() => setConfirmSendAll(false)} className={BTN} style={BTN_STYLE}>No</button></Tooltip>
            </div>
          ) : (
            <Tooltip text={unsent === 0 ? 'Every step is already in Tasks.' : 'Make a task for every step that is not in Tasks yet. A step\'s last day becomes the due date and its days become the estimate; groups become tasks with subtasks, and waits-on links become task dependencies. You are asked first.'}>
              <button type="button" onClick={() => setConfirmSendAll(true)} disabled={busy || unsent === 0} className={BTN} style={BTN_STYLE}>{getIcon('list-checks', { size: 13 })} {unsent === 0 ? 'All in Tasks' : 'Send all to Tasks'}</button>
            </Tooltip>
          ))}
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[980px] space-y-2">
            <div className={`${GRID} text-xs`} style={LABEL_STYLE}>
              <span>Step</span><span>Starts</span><span>Days</span><span>Ends</span><span>Waits on</span><span>Status</span><span />
            </div>
            {rows.length === 0 && <p className="text-sm py-2" style={LABEL_STYLE}>No steps yet. Add the first one below, then say how long it takes.</p>}
            {rows.map(({ step, depth, isGroup }) => {
              const at = placed[step.id] || {};
              const myDeps = deps.filter((d) => d.stepId === step.id);
              const options = isGroup ? [] : waitOptions(step, steps, deps);
              return (
                <React.Fragment key={step.id}>
                  <div id={`plan-step-${step.id}`} className={GRID}>
                    <div style={{ paddingLeft: depth * 18 }} className="min-w-0">
                      <Tooltip text={isGroup ? 'A group: its dates come from the sub-steps inside it.' : 'The step name. It saves when you click away. The microphone lets you say it.'}>
                        <div className="w-full"><NameBox value={step.title} onSave={(t) => saveStep(step.id, { title: t })} label={`Name of step ${step.title}`} disabled={busy} /></div>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1">
                      {isGroup ? (
                        <span className="text-xs" style={LABEL_STYLE}>{at.start ? fmtDay(at.start) : '—'}</span>
                      ) : (
                        <>
                          <Tooltip text={step.startDate ? 'This step is pinned to this day.' : 'Where the step lands now. Change it to pin the step to a day.'}>
                            <input type="date" value={step.startDate || at.start || ''} onChange={(e) => saveStep(step.id, { startDate: e.target.value || null })} disabled={busy}
                              aria-label={`Start of ${step.title}`} className={`${FIELD} w-[128px]`} style={{ ...FIELD_STYLE, ...(at.conflict ? { borderColor: '#f59e0b' } : {}) }} />
                          </Tooltip>
                          {step.startDate && (
                            <Tooltip text="Unpin: let the step start as soon as the steps it waits on are done.">
                              <button type="button" onClick={() => saveStep(step.id, { startDate: null })} disabled={busy} className={SMALL} style={BTN_STYLE} aria-label={`Unpin ${step.title}`}>{getIcon('pin', { size: 12 })}</button>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </div>
                    <div>
                      {isGroup || step.isMilestone ? <span className="text-xs" style={LABEL_STYLE}>{step.isMilestone ? 'Milestone' : '—'}</span> : (
                        <Tooltip text="Working days this step takes.">
                          <input type="number" min="1" max="3650" defaultValue={step.durationDays} key={`${step.id}-${step.durationDays}`} disabled={busy}
                            onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n !== step.durationDays) saveStep(step.id, { durationDays: n }); else e.target.value = step.durationDays; }}
                            aria-label={`Days for ${step.title}`} className={`${FIELD} w-16`} style={FIELD_STYLE} />
                        </Tooltip>
                      )}
                    </div>
                    <span className="text-xs" style={{ color: at.conflict ? '#f59e0b' : 'var(--color-text)' }}>{at.end ? fmtDay(at.end) : '—'}{at.conflict ? ' · clashes' : ''}</span>
                    <div className="flex flex-wrap items-center gap-1 min-w-0">
                      {isGroup ? <span className="text-xs" style={LABEL_STYLE}>—</span> : (
                        <>
                          {myDeps.map((d) => (
                            <Tooltip key={d.blockedByStepId} text={`This step starts after "${nameOf[d.blockedByStepId]}" ends. Click to remove the link.`}>
                              <button type="button" onClick={() => removeDep(step.id, d.blockedByStepId)} disabled={busy} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-opacity duration-200 hover:opacity-60"
                                style={BTN_STYLE} aria-label={`Stop waiting on ${nameOf[d.blockedByStepId]}`}>
                                <span className="truncate max-w-[110px]">{nameOf[d.blockedByStepId]}</span>{getIcon('x', { size: 10 })}
                              </button>
                            </Tooltip>
                          ))}
                          {options.length > 0 && (
                            <Tooltip text="Choose a step that must finish before this one can start.">
                              <select value="" onChange={(e) => { if (e.target.value) addDep(step.id, Number(e.target.value)); }} disabled={busy} aria-label={`Add a step that ${step.title} waits on`} className={`${FIELD} w-[90px] text-xs`} style={FIELD_STYLE}>
                                <option value="">+ wait on</option>
                                {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                              </select>
                            </Tooltip>
                          )}
                        </>
                      )}
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
                          <Tooltip text={step.isMilestone ? 'Make this a normal step again.' : 'Make this a milestone: a point in time with no length.'}>
                            <button type="button" onClick={() => saveStep(step.id, { isMilestone: !step.isMilestone, ...(step.isMilestone ? { durationDays: 1 } : {}) })} disabled={busy || isGroup}
                              className={SMALL} style={{ ...BTN_STYLE, ...(step.isMilestone ? { color: 'var(--color-primary)' } : {}) }} aria-label={`Toggle milestone for ${step.title}`}>◆</button>
                          </Tooltip>
                          <Tooltip text="Add a sub-step inside this step. The step then spans its sub-steps.">
                            <button type="button" onClick={() => setAddingUnder(addingUnder === step.id ? null : step.id)} disabled={busy || myDeps.length > 0 || deps.some((d) => d.blockedByStepId === step.id)}
                              className={SMALL} style={BTN_STYLE} aria-label={`Add a sub-step to ${step.title}`}>{getIcon('plus', { size: 12 })}</button>
                          </Tooltip>
                          <Tooltip text={tasks[step.id] ? 'This step is a task in Tasks. Open Tasks to see it. Ticking or reopening the task there gives this step the same status; other changes to the step are not copied to the task.' : (isGroup ? 'Send this group, and the sub-steps inside it, to Tasks as tasks with subtasks. A later change to the plan is not copied to them.' : 'Send this step to Tasks as a task: its last day is the due date and its days are the estimate. A later change to the step is not copied to the task.')}>
                            <button type="button" onClick={() => (tasks[step.id] ? navigate('/tasks') : sendToTasks({ stepIds: subtree(step.id) }))} disabled={busy}
                              className={SMALL} style={{ ...BTN_STYLE, ...(tasks[step.id] ? { color: 'var(--color-primary)' } : {}) }} aria-label={tasks[step.id] ? `${step.title} is in Tasks: open Tasks` : `Send ${step.title} to Tasks`}>{getIcon(tasks[step.id] ? 'check' : 'list-checks', { size: 12 })}</button>
                          </Tooltip>
                          <Tooltip text="Delete this step. You are asked first.">
                            <button type="button" onClick={() => setConfirmId(step.id)} disabled={busy} className={SMALL} style={BTN_STYLE} aria-label={`Delete ${step.title}`}>{getIcon('trash', { size: 12 })}</button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </div>
                  {addingUnder === step.id && (
                    <div style={{ paddingLeft: (depth + 1) * 18 }}>
                      <AddStep parentStepId={step.id} busy={busy} onAdd={addStep} onCancel={() => setAddingUnder(null)} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
        <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <AddStep busy={busy} onAdd={addStep} />
        </div>
      </section>

      {/* The timeline (the same one Tasks uses) */}
      <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div style={{ height: Math.min(560, 150 + tlTasks.length * 40) }}>
          <TaskTimeline tasks={tlTasks} project={tlRange} onEdit={jumpToStep} onBarChange={onBarChange} showBlocked={false} defaultZoom={tlRange && tlRange.targetEndDate && (new Date(tlRange.targetEndDate) - new Date(tlRange.startDate)) / 86400000 <= 28 ? 'week' : 'month'} />
        </div>
      </section>
    </div>
  );
}
