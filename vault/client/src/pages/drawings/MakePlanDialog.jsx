import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { fmtDay, fitMessage } from '../plans/planLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const FIELD = 'px-2 py-1.5 rounded-lg border text-sm';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const LABEL_STYLE = { color: 'var(--color-muted)' };
const TONE = { ok: '#22c55e', warn: '#f59e0b', info: 'var(--color-muted)' };

/**
 * Make a plan from a diagram. The steps come from the diagram (docs/plans.md), the person gives the start, the finish-by date and the days each
 * step takes, and a line under the dates says whether it fits. Nothing is saved until Create plan; the server works out every date.
 */
export default function MakePlanDialog({ diagram, drawingId, drawingTitle, onClose, onCreated }) {
  const getIcon = useIcon();
  const [title, setTitle] = useState(drawingTitle || '');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [workWeek, setWorkWeek] = useState('weekdays');
  const [includeNo, setIncludeNo] = useState(false);
  const [days, setDays] = useState({}); // ref -> what the person typed
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const ticket = useRef(0);

  // What goes to the server: only lengths the person actually typed, so an empty box means "one day".
  const body = useMemo(() => {
    const durations = {};
    for (const [ref, v] of Object.entries(days)) if (String(v).trim() !== '') durations[ref] = Number(v);
    return { diagram, startDate: startDate || null, targetEndDate: targetEndDate || null, workWeek, includeNo, durations };
  }, [diagram, startDate, targetEndDate, workWeek, includeNo, days]);

  // The preview follows every change after a short pause; an answer to an older request is ignored.
  useEffect(() => {
    const mine = ++ticket.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.post('/api/plans/from-diagram/preview', body);
        const data = await res.json().catch(() => ({}));
        if (mine !== ticket.current) return;
        if (!res.ok) { setError(data.error || 'That could not be worked out.'); return; }
        setPreview(data);
        setError('');
      } catch (err) { if (mine === ticket.current) setError(err.message || 'That could not be worked out.'); }
    }, 250);
    return () => clearTimeout(t);
  }, [body]);

  const create = async () => {
    if (creating || !preview || error) return;
    setCreating(true);
    try {
      const res = await api.post('/api/plans/from-diagram', { ...body, title: title.trim() || undefined, drawingId });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The plan could not be made. Try again.');
      onCreated(data.plan.id);
    } catch (err) { setError(err.message); setCreating(false); }
  };

  const nameOf = useMemo(() => Object.fromEntries((preview?.steps || []).map((s) => [s.ref, s.title])), [preview]);
  const fit = preview ? fitMessage({ targetEndDate }, preview.schedule) : null;
  const hasDecisionLeftOut = !!preview && (preview.leftOut.length > 0 || includeNo);

  return (
    <Dialog
      title="Make a plan from this diagram"
      icon={getIcon('gantt-chart', { size: 16 })}
      size="2xl"
      onClose={creating ? undefined : onClose}
      footer={(
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} disabled={creating} className={BTN} style={BTN_STYLE}>Cancel</button>
          <Tooltip text="Make the plan with these steps, lengths and dates, and link it to this diagram. You can change anything afterwards on the plan page.">
            <button type="button" onClick={create} disabled={creating || !preview || !!error} className={BTN} style={{ ...BTN_STYLE, background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' }}>
              {creating ? 'Making…' : 'Create plan'}
            </button>
          </Tooltip>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          Each box becomes a step, and each arrow means the next step waits for the one before it. Say when it starts, when it must finish, and how many working days each step takes.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[200px] space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Plan name</span>
            <Tooltip text="What to call the plan. It starts as the diagram's name. The microphone lets you say it.">
              <div className="w-full"><VoiceInput value={title} onChange={setTitle} label="Plan name" placeholder="Plan name" disabled={creating} /></div>
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Start</span>
            <Tooltip text="The first day of work. Leave it empty if you only know the finish date: the plan then suggests a start.">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={FIELD} style={FIELD_STYLE} disabled={creating} />
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Finish by</span>
            <Tooltip text="The date it must be done by. The line below says whether the steps fit.">
              <input type="date" value={targetEndDate} onChange={(e) => setTargetEndDate(e.target.value)} className={FIELD} style={FIELD_STYLE} disabled={creating} />
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Working week</span>
            <Tooltip text="Whether weekends count as working days. Step lengths are in working days.">
              <select value={workWeek} onChange={(e) => setWorkWeek(e.target.value)} className={FIELD} style={FIELD_STYLE} disabled={creating}>
                <option value="weekdays">Monday to Friday</option>
                <option value="all">Every day</option>
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
                <button type="button" onClick={() => setStartDate(fit.useStart)} className={BTN} style={BTN_STYLE}>Use {fmtDay(fit.useStart)}</button>
              </Tooltip>
            )}
          </div>
        )}
        {error && <p className="text-sm" style={{ color: '#ef4444' }} role="alert">{error}</p>}

        {!preview && !error && <p className="text-sm" style={LABEL_STYLE}>Reading the diagram…</p>}
        {preview && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-xs text-left" style={LABEL_STYLE}>
                  <th className="font-normal pb-1 pr-2">Step</th><th className="font-normal pb-1 pr-2">Waits on</th><th className="font-normal pb-1 pr-2 w-24">Days</th><th className="font-normal pb-1 pr-2">Starts</th><th className="font-normal pb-1">Ends</th>
                </tr>
              </thead>
              <tbody>
                {preview.steps.map((s) => {
                  const at = preview.schedule.steps[s.ref] || {};
                  return (
                    <tr key={s.ref} className="align-middle">
                      <td className="py-1 pr-2" style={{ color: 'var(--color-text)' }}>{s.isMilestone ? '◆ ' : ''}{s.title}</td>
                      <td className="py-1 pr-2 text-xs" style={LABEL_STYLE}>{s.waitsOn.length ? s.waitsOn.map((r) => nameOf[r]).join(', ') : '—'}</td>
                      <td className="py-1 pr-2">
                        {s.isMilestone ? <span className="text-xs" style={LABEL_STYLE}>Milestone</span> : (
                          <Tooltip text="How many working days this step takes. Empty means one.">
                            <input type="number" min="1" max="3650" value={days[s.ref] ?? ''} placeholder="1" onChange={(e) => setDays((d) => ({ ...d, [s.ref]: e.target.value }))}
                              aria-label={`Days for ${s.title}`} className={`${FIELD} w-20`} style={FIELD_STYLE} disabled={creating} />
                          </Tooltip>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-xs" style={{ color: 'var(--color-text)' }}>{at.start ? fmtDay(at.start) : '—'}</td>
                      <td className="py-1 text-xs" style={{ color: 'var(--color-text)' }}>{at.end ? fmtDay(at.end) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {preview && (hasDecisionLeftOut || preview.droppedLoops > 0) && (
          <div className="rounded-xl p-3 text-xs space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            {preview.leftOut.length > 0 && (
              <p>Every decision is taken as <strong>Yes</strong>, so the No branches are left out: {preview.leftOut.join(', ')}.</p>
            )}
            {preview.droppedLoops > 0 && (
              <p>{preview.droppedLoops === 1 ? 'One arrow goes' : `${preview.droppedLoops} arrows go`} back to an earlier step (a loop, such as "no, ask again"). A plan cannot go in circles, so {preview.droppedLoops === 1 ? 'it is' : 'they are'} left out.</p>
            )}
            {hasDecisionLeftOut && (
              <Tooltip text="Put the No branches in the plan too, as steps. You can delete any you will not need on the plan page.">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={includeNo} onChange={(e) => setIncludeNo(e.target.checked)} disabled={creating} /> Include the No branches as steps
                </label>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
