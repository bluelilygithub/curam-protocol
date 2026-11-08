import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import PlanClientPicker from '../plans/PlanClientPicker';
import { fmtDay, fitMessage } from '../plans/planLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const FIELD = 'px-2 py-1.5 rounded-lg border text-sm';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const LABEL_STYLE = { color: 'var(--color-muted)' };
const TONE = { ok: '#22c55e', warn: '#f59e0b', info: 'var(--color-muted)' };

// How the steps of a NOTE follow each other (server/services/planFromNote.js): the three orders and what each says.
const ORDERS = [
  ['lists', 'As the note\'s lists say', 'Numbered lists run in order, one after another; bullets and check-boxes run together. This is the usual choice.'],
  ['sequence', 'One after another', 'Every step waits for the one written before it, in the same list, and each section waits for the section before.'],
  ['parallel', 'All together', 'Nothing waits for anything: every step can start on the first day.'],
];

/**
 * Make a plan from a diagram (kind 'diagram') or a note (kind 'note'). The steps come from the source (docs/plans.md), the person gives the
 * start, the finish-by date and the days each step takes (a length written in a note is already filled in), and a line under the dates says
 * whether it fits. Nothing is saved until Create plan; the server works out every date.
 */
export default function MakePlanDialog({ kind = 'diagram', diagram, drawingId, noteId, sourceTitle, onClose, onCreated }) {
  const getIcon = useIcon();
  const isNote = kind === 'note';
  const base = isNote ? '/api/plans/from-note' : '/api/plans/from-diagram';
  const [title, setTitle] = useState(sourceTitle || '');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [workWeek, setWorkWeek] = useState('weekdays');
  const [includeNo, setIncludeNo] = useState(false);
  const [order, setOrder] = useState('lists');
  const [link, setLink] = useState(undefined); // { clientId, clientProjectId } once chosen (or taken from the note); undefined: the server decides
  const [days, setDays] = useState({}); // ref -> what the person typed
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [whys, setWhys] = useState({}); // ref -> what the AI said it assumed, for steps whose length is an AI estimate the person has not changed
  const [estimateError, setEstimateError] = useState('');
  const ticket = useRef(0);

  // What goes to the server: only lengths the person actually typed, so an empty box means the length the source gives (or one day).
  const body = useMemo(() => {
    const durations = {};
    for (const [ref, v] of Object.entries(days)) if (String(v).trim() !== '') durations[ref] = Number(v);
    const common = { startDate: startDate || null, targetEndDate: targetEndDate || null, workWeek, durations, ...(link ? { clientId: link.clientId, clientProjectId: link.clientProjectId } : {}) };
    return isNote ? { noteId, order, ...common } : { diagram, includeNo, ...common };
  }, [isNote, noteId, order, diagram, includeNo, startDate, targetEndDate, workWeek, days, link]);

  // A note filed under a client (and one of its projects) starts the plan with them: shown here so it can be changed before the plan is made.
  useEffect(() => {
    if (link === undefined && preview && preview.note) setLink({ clientId: preview.note.clientId || null, clientProjectId: preview.note.clientProjectId || null });
  }, [preview, link]);

  // The preview follows every change after a short pause; an answer to an older request is ignored.
  useEffect(() => {
    const mine = ++ticket.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.post(`${base}/preview`, body);
        const data = await res.json().catch(() => ({}));
        if (mine !== ticket.current) return;
        if (!res.ok) { setError(data.error || 'That could not be worked out.'); return; }
        setPreview(data);
        setError('');
      } catch (err) { if (mine === ticket.current) setError(err.message || 'That could not be worked out.'); }
    }, 250);
    return () => clearTimeout(t);
  }, [body, base]);

  // Ask the AI for a length for every step the person has not typed one for (and the source did not give one). The numbers land in the boxes,
  // marked as estimates, and every one can be changed.
  const estimate = async () => {
    if (estimating || creating) return;
    setEstimating(true); setEstimateError('');
    try {
      const res = await api.post(`${base}/estimate`, isNote ? { noteId, order, title: title.trim() || undefined } : { diagram, includeNo, title: title.trim() || undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The AI could not estimate just now. Try again, or type the lengths yourself.');
      const got = data.estimates || {};
      setDays((d) => { const next = { ...d }; for (const [ref, e] of Object.entries(got)) if (String(d[ref] ?? '').trim() === '') next[ref] = String(e.days); return next; });
      setWhys((w) => { const next = { ...w }; for (const [ref, e] of Object.entries(got)) if (String(days[ref] ?? '').trim() === '') next[ref] = e.why || 'AI estimate'; return next; });
    } catch (err) { setEstimateError(err.message); } finally { setEstimating(false); }
  };

  const create = async () => {
    if (creating || !preview || error) return;
    setCreating(true);
    try {
      const res = await api.post(base, { ...body, title: title.trim() || undefined, ...(isNote ? {} : { drawingId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The plan could not be made. Try again.');
      onCreated(data.plan.id);
    } catch (err) { setError(err.message); setCreating(false); }
  };

  const nameOf = useMemo(() => Object.fromEntries((preview?.steps || []).map((s) => [s.ref, s.title])), [preview]);
  const depthOf = useMemo(() => {
    const byRef = Object.fromEntries((preview?.steps || []).map((s) => [s.ref, s]));
    const depth = (s, n = 0) => (s.parentRef && byRef[s.parentRef] && n < 20 ? 1 + depth(byRef[s.parentRef], n + 1) : 0);
    return Object.fromEntries((preview?.steps || []).map((s) => [s.ref, depth(s)]));
  }, [preview]);
  const fit = preview ? fitMessage({ targetEndDate }, preview.schedule) : null;
  const hasDecisionLeftOut = !isNote && !!preview && (preview.leftOut.length > 0 || includeNo);

  return (
    <Dialog
      title={isNote ? 'Make a plan from this note' : 'Make a plan from this diagram'}
      icon={getIcon('gantt-chart', { size: 16 })}
      size="2xl"
      onClose={creating ? undefined : onClose}
      footer={(
        <div className="flex items-center gap-2">
          <Tooltip text="Close this box without making a plan. Nothing has been saved."><button type="button" onClick={onClose} disabled={creating} className={BTN} style={BTN_STYLE}>Cancel</button></Tooltip>
          <Tooltip text={`Make the plan with these steps, lengths and dates, and link it to this ${isNote ? 'note' : 'diagram'}. You can change anything afterwards on the plan page.`}>
            <button type="button" onClick={create} disabled={creating || !preview || !!error} className={BTN} style={{ ...BTN_STYLE, background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' }}>
              {creating ? 'Making…' : 'Create plan'}
            </button>
          </Tooltip>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          {isNote
            ? 'Headings become sections and each line of a list becomes a step. A length written at the end of a line, such as "(3 days)", is used. Say when it starts, when it must finish, and how long the other steps take.'
            : 'Each box becomes a step, and each arrow means the next step waits for the one before it. Say when it starts, when it must finish, and how many working days each step takes.'}
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[200px] space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Plan name</span>
            <Tooltip text={`What to call the plan. It starts as the ${isNote ? 'note' : 'diagram'}'s name. The microphone lets you say it.`}>
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
          <PlanClientPicker clientId={link ? link.clientId : null} clientProjectId={link ? link.clientProjectId : null} onChange={(fields) => setLink((l) => ({ clientId: null, clientProjectId: null, ...(l || {}), ...fields }))} disabled={creating} />
        </div>

        {isNote && (
          <div role="radiogroup" aria-label="How the steps follow each other" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-xs" style={LABEL_STYLE}>Order</span>
            {ORDERS.map(([value, label, tip]) => (
              <Tooltip key={value} text={tip}>
                <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
                  <input type="radio" name="plan-order" checked={order === value} onChange={() => { setOrder(value); setWhys({}); }} disabled={creating} /> {label}
                </label>
              </Tooltip>
            ))}
          </div>
        )}

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

        {!preview && !error && <p className="text-sm" style={LABEL_STYLE}>{isNote ? 'Reading the note…' : 'Reading the diagram…'}</p>}
        {preview && (
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip text={`Ask the AI to suggest how many working days each step may take. It uses one AI request and sees only the step names and the plan name, never your ${isNote ? 'note' : 'diagram'}. Lengths you have typed${isNote ? ' or written in the note' : ''} are kept, and every number can be changed.`}>
              <button type="button" onClick={estimate} disabled={estimating || creating} className={BTN} style={BTN_STYLE}>{getIcon('sparkles', { size: 13 })} {estimating ? 'Estimating…' : 'Estimate lengths with AI'}</button>
            </Tooltip>
            {Object.keys(whys).length > 0 && <span className="text-xs" style={LABEL_STYLE}>Lengths marked ✦ are AI estimates. They are a starting point: check them.</span>}
            {estimateError && <span className="text-xs" style={{ color: '#ef4444' }} role="alert">{estimateError}</span>}
          </div>
        )}
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
                      <td className="py-1 pr-2" style={{ color: 'var(--color-text)', paddingLeft: (depthOf[s.ref] || 0) * 16 }}>
                        <span style={{ fontWeight: s.isGroup ? 600 : 400, textDecoration: s.status === 'done' ? 'line-through' : 'none', opacity: s.status === 'done' ? 0.6 : 1 }}>{s.isMilestone ? '◆ ' : ''}{s.title}</span>
                      </td>
                      <td className="py-1 pr-2 text-xs" style={LABEL_STYLE}>{s.waitsOn.length ? s.waitsOn.map((r) => nameOf[r]).join(', ') : '—'}</td>
                      <td className="py-1 pr-2">
                        {s.isGroup ? <span className="text-xs" style={LABEL_STYLE}>Section</span> : s.isMilestone ? <span className="text-xs" style={LABEL_STYLE}>Milestone</span> : (
                          <>
                            <Tooltip text={isNote && s.hintDays ? 'The length written in the note. Type a number to change it.' : 'How many working days this step takes. Empty means one.'}>
                              <input type="number" min="1" max="3650" value={days[s.ref] ?? ''} placeholder={String(s.durationDays)} onChange={(e) => { setDays((d) => ({ ...d, [s.ref]: e.target.value })); setWhys((w) => { if (!(s.ref in w)) return w; const n = { ...w }; delete n[s.ref]; return n; }); }}
                                aria-label={`Days for ${s.title}`} className={`${FIELD} w-20`} style={FIELD_STYLE} disabled={creating} />
                            </Tooltip>
                            {whys[s.ref] && <Tooltip text={`AI estimate: ${whys[s.ref]}. Change the number to make it your own.`}><span className="ml-1 text-xs cursor-help" style={{ color: 'var(--color-primary)' }} aria-label="AI estimate">✦</span></Tooltip>}
                          </>
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

        {preview && (hasDecisionLeftOut || preview.droppedLoops > 0 || (isNote && preview.emptyHeadings > 0)) && (
          <div className="rounded-xl p-3 text-xs space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            {!isNote && preview.leftOut.length > 0 && (
              <p>Every decision is taken as <strong>Yes</strong>, so the No branches are left out: {preview.leftOut.join(', ')}.</p>
            )}
            {!isNote && preview.droppedLoops > 0 && (
              <p>{preview.droppedLoops === 1 ? 'One arrow goes' : `${preview.droppedLoops} arrows go`} back to an earlier step (a loop, such as "no, ask again"). A plan cannot go in circles, so {preview.droppedLoops === 1 ? 'it is' : 'they are'} left out.</p>
            )}
            {isNote && preview.emptyHeadings > 0 && (
              <p>{preview.emptyHeadings === 1 ? 'One heading has' : `${preview.emptyHeadings} headings have`} no list under {preview.emptyHeadings === 1 ? 'it' : 'them'}, so {preview.emptyHeadings === 1 ? 'it is' : 'they are'} left out. Only lists become steps; paragraphs are ignored.</p>
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
