import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { fmtDay, filterPlans, progressText } from './planLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const FIELD = 'px-3 py-2 rounded-xl border text-sm';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const LABEL_STYLE = { color: 'var(--color-muted)' };

/** The person's plans, with the box at the top where a new one is started. */
export default function PlanList() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [items, setItems] = useState(null); // null while loading
  const [max, setMax] = useState(100);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/plans');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load your plans.');
      setItems(data.plans || []);
      if (data.max) setMax(data.max);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load your plans.');
      setItems((prev) => prev || []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await api.post('/api/plans', { title: title.trim() || undefined, startDate: startDate || null, targetEndDate: targetEndDate || null });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The plan could not be made. Try again.');
      navigate(`/plans/${data.plan.id}`);
    } catch (err) { addToast(err.message, 'error'); } finally { setCreating(false); }
  };

  const undo = async (binId) => {
    try {
      const res = await api.post(`/api/recycle-bin/${binId}/restore`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not put the plan back.');
      addToast('Plan put back.', 'success');
      load();
    } catch (err) { addToast(err.message, 'error'); }
  };

  const remove = async (p) => {
    setConfirmId(null);
    try {
      const res = await api.delete(`/api/plans/${p.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The plan could not be deleted. Try again.');
      setItems((prev) => prev.filter((x) => x.id !== p.id));
      addToast(`"${p.title}" deleted. Kept 30 days in the recycle bin.`, 'success', undefined, data.binId ? { label: 'Undo', onClick: () => undo(data.binId) } : undefined);
    } catch (err) { addToast(err.message, 'error'); }
  };

  const shown = useMemo(() => filterPlans(items || [], query), [items, query]);
  const full = (items || []).length >= max;

  return (
    <div className="p-6 space-y-6 max-w-[1700px]">
      <section className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Start a plan</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px] space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Name</span>
            <Tooltip text="What the plan is for. You can change it later. The microphone lets you say it.">
              <div className="w-full">
                <VoiceInput value={title} onChange={setTitle} placeholder="Kitchen renovation" label="Plan name" disabled={creating} />
              </div>
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Start</span>
            <Tooltip text="The first day of work. Leave it empty if you only know when it must finish.">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={FIELD} style={FIELD_STYLE} disabled={creating} />
            </Tooltip>
          </label>
          <label className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>Finish by</span>
            <Tooltip text="The date it must be done by. Plans tells you whether the steps fit, and if there is no start date it suggests one.">
              <input type="date" value={targetEndDate} onChange={(e) => setTargetEndDate(e.target.value)} className={FIELD} style={FIELD_STYLE} disabled={creating} />
            </Tooltip>
          </label>
          <Tooltip text={full ? `You have ${max} plans, the most you can keep. Delete one first.` : 'Make the plan, then add its steps.'}>
            <button type="button" onClick={create} disabled={creating || full} className={BTN} style={{ ...BTN_STYLE, background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' }}>
              {getIcon('plus', { size: 13 })} {creating ? 'Making…' : 'Make plan'}
            </button>
          </Tooltip>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Your plans</h2>
          <Tooltip text="Narrow the list to plans whose name or description has all the words you type. The microphone lets you say them.">
            <div className="w-64">
              <VoiceInput value={query} onChange={setQuery} placeholder="Search your plans…" label="Search your plans" />
            </div>
          </Tooltip>
        </div>
        {error && <p className="text-sm" style={{ color: '#ef4444' }} role="alert">{error}</p>}
        {items === null ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" label="Loading your plans" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon="gantt-chart" title="No plans yet" body="Name a plan above, then add its steps. Give each step a length in days and say which steps wait on others, and Plans works out the dates." />
        ) : shown.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No plans match that search.</p>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((p) => (
              <div key={p.id} className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <Tooltip text="Open this plan to edit its steps and see the timeline.">
                  <button type="button" onClick={() => navigate(`/plans/${p.id}`)} className="text-left transition-opacity duration-200 hover:opacity-60">
                    <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{p.title}</span>
                  </button>
                </Tooltip>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {progressText(p)}
                  {p.startDate || p.targetEndDate ? ` · ${p.startDate ? fmtDay(p.startDate) : '…'} to ${p.targetEndDate ? fmtDay(p.targetEndDate) : '…'}` : ''}
                  {p.status !== 'active' ? ` · ${p.status}` : ''}
                </p>
                <div className="flex items-center gap-2 mt-auto pt-1">
                  {confirmId === p.id ? (
                    <>
                      <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete?</span>
                      <Tooltip text="Yes, delete it. It waits 30 days in the recycle bin and an Undo button appears.">
                        <button type="button" onClick={() => remove(p)} className={BTN} style={{ ...BTN_STYLE, color: '#ef4444' }}>Yes</button>
                      </Tooltip>
                      <Tooltip text="No, keep it."><button type="button" onClick={() => setConfirmId(null)} className={BTN} style={BTN_STYLE}>No</button></Tooltip>
                    </>
                  ) : (
                    <Tooltip text="Delete this plan and its steps. You are asked first, and you can undo it.">
                      <button type="button" onClick={() => setConfirmId(p.id)} className={BTN} style={BTN_STYLE} aria-label={`Delete ${p.title}`}>{getIcon('trash', { size: 13 })} Delete</button>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
