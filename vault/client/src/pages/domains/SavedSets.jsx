import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { offerUndo } from '../../utils/binUndo';

// Saved sets: the library. Open one to carry on exactly where you left off (no new lookups), delete the ones you no longer need. Deleted
// sets go to the shared recycle bin for 30 days with an Undo.

/** Delete one or more sets. Each goes to the shared recycle bin, so one Undo brings them all back. Returns { deleted, binIds, failed }. */
export async function deleteSets(sets) {
  const binIds = [];
  let failed = 0;
  for (const s of sets) {
    try {
      const res = await api.delete(`/api/domains/sets/${s.id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (d.binId) binIds.push(d.binId);
    } catch { failed += 1; }
  }
  return { deleted: sets.length - failed, binIds, failed };
}

/** The toast after a delete: with Undo when the recycle bin holds a copy. */
export function announceDeleted(addToast, sets, result, after) {
  if (result.failed && !result.deleted) { addToast('Could not delete.', 'error'); return; }
  const what = sets.length === 1 ? `Set "${sets[0].name}"` : `${result.deleted} sets`;
  if (result.binIds.length) offerUndo({ message: `${what} deleted. A copy stays in Settings, Recycle bin for 30 days.`, binIds: result.binIds, restoredMessage: result.binIds.length > 1 ? 'Sets restored.' : 'Set restored.', after });
  else addToast(`${what} deleted.`);
  if (result.failed) addToast(`${result.failed} could not be deleted.`, 'error');
}

const card = { background: 'var(--color-bg)', border: '1px solid var(--color-border)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const when = (d) => (d ? new Date(d).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function SavedSets({ onOpen, onDeleted, refreshKey, onStart }) {
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState(null);
  const [confirm, setConfirm] = useState(null); // a set id, or 'selected'
  const [busy, setBusy] = useState(null);
  const [picked, setPicked] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/domains/sets');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setList(d.sets || []);
      setPicked((p) => new Set([...p].filter((id) => (d.sets || []).some((s) => s.id === id))));
    } catch (e) { addToast(e.message || 'Could not load your sets.', 'error'); setList([]); }
  }, [addToast]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const open = async (id) => {
    setBusy(id);
    try {
      const res = await api.get(`/api/domains/sets/${id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      onOpen(d.set);
    } catch (e) { addToast(e.message || 'Could not open that set.', 'error'); } finally { setBusy(null); }
  };

  const removeSets = async (sets) => {
    setBusy(sets.length === 1 ? sets[0].id : 'selected');
    try {
      const result = await deleteSets(sets);
      setConfirm(null);
      setPicked(new Set());
      sets.forEach((s) => onDeleted?.(s.id));
      announceDeleted(addToast, sets, result, load);
      load();
    } finally { setBusy(null); }
  };

  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (list === null) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (!list.length) {
    return (
      <div className="space-y-3 text-sm" style={{ color: 'var(--color-text)' }} data-guide="saved-sets">
        <p>No saved sets yet. Make some names, then press Save set at the top of the page to keep them here.</p>
        <button onClick={onStart} className="px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Start a brief</button>
      </div>
    );
  }

  const chosen = list.filter((s) => picked.has(s.id));
  return (
    <div className="space-y-3" data-guide="saved-sets">
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--color-muted)' }}>
        <Tooltip text={picked.size === list.length ? 'Untick every set.' : 'Tick every set, to delete several at once.'}>
          <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={picked.size === list.length} onChange={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((s) => s.id)))} />
            Select all
          </label>
        </Tooltip>
        {chosen.length > 0 && (confirm === 'selected' ? (
          <span className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            Delete {chosen.length} set{chosen.length === 1 ? '' : 's'}?
            <button onClick={() => removeSets(chosen)} disabled={busy === 'selected'} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>Yes</button>
            <button onClick={() => setConfirm(null)} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>No</button>
          </span>
        ) : (
          <Tooltip text="Delete every ticked set. They stay in Settings, Recycle bin for 30 days.">
            <button onClick={() => setConfirm('selected')} className="px-3 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Delete selected ({chosen.length})</button>
          </Tooltip>
        ))}
      </div>
      {list.map((s) => (
        <div key={s.id} className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" style={card}>
          <Tooltip text="Tick to include this set when you delete several.">
            <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} />
          </Tooltip>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{s.name}</p>
            {s.what && <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{s.what}</p>}
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {s.preferred ? `Preferred: ${s.preferred} · ` : ''}{s.names} name{s.names === 1 ? '' : 's'} · {s.shortlist} shortlisted{s.checked ? ` · ${s.checked} checked` : ''} · updated {when(s.updatedAt)}
            </p>
          </div>
          <Tooltip text="Open this set exactly as it was saved, with its brief, names and shortlist. No new lookups are made.">
            <button onClick={() => open(s.id)} disabled={busy === s.id} className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity duration-200 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Open</button>
          </Tooltip>
          {confirm === s.id ? (
            <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              Delete?
              <button onClick={() => removeSets([s])} disabled={busy === s.id} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>Yes</button>
              <button onClick={() => setConfirm(null)} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>No</button>
            </span>
          ) : (
            <Tooltip text="Delete this set. It stays in Settings, Recycle bin for 30 days.">
              <button onClick={() => setConfirm(s.id)} className="px-3 py-1.5 rounded-lg text-sm border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Delete</button>
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  );
}
