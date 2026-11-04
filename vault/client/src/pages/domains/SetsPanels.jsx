import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { offerUndo } from '../../utils/binUndo';
import { RESULT_ORDER, RESULT_TITLES } from './runAll.mjs';
import { spokenBrand } from './spoken.mjs';
import SuggestionTable from './SuggestionTable';

// The two "My sets" tools of the Domain page. A set is one business idea kept with everything found for it: the description, the
// generated names, the preferred name and shortlist, and what each tool said. The page owns the set being worked on (`ws`) so the Name
// Generator, the Current set board and the saved list all share it. Drawing a result is passed in (`Result`), because that code lives in
// the page next to the individual tools.

export const BLANK_WS = { id: null, name: '', description: '', suggestions: null, preferred: '', shortlist: [], tableNames: [], results: {}, errors: {}, runAt: null, savedJson: null };

/** What gets saved: everything the person would want back, nothing about the screen. */
export function dataOf(ws) {
  return {
    description: ws.description || '',
    suggestions: ws.suggestions || [],
    preferred: ws.preferred || '',
    shortlist: ws.shortlist || [],
    tableNames: ws.tableNames || [],
    results: ws.results || {},
    errors: ws.errors || {},
    runAt: ws.runAt || null,
  };
}
export const jsonOf = (ws) => JSON.stringify(dataOf(ws));
export const isDirty = (ws) => (ws.savedJson === null ? !!(ws.suggestions || ws.preferred || ws.description) : ws.savedJson !== jsonOf(ws));

/** Make the lookups in a plan (see runAll.mjs). One failing does not stop the others. */
export async function runPlan(plan) {
  return Promise.all(plan.jobs.map(async (job) => {
    try {
      const res = job.method === 'POST' ? await api.post(job.url, job.body) : await api.get(job.url);
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || 'Could not be checked.' };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message || 'Could not be checked.' };
    }
  }));
}

/**
 * Delete one or more sets. Each goes to the shared recycle bin, so one Undo brings them all back. Returns { deleted, binIds, failed }.
 */
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

function Section({ title, children }) {
  return (
    <section className="rounded-xl p-4" style={card}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
      {children}
    </section>
  );
}

// ── Current set ──────────────────────────────────────────────────────────────

export function CurrentSetPanel({ ws, setWs, Result, running, onRun, saving, onSave, onNew, onDelete, onCheckHandles, checkingHandles, goto }) {
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = isDirty(ws);
  const hasAny = !!(ws.suggestions || ws.preferred || ws.description);

  if (!hasAny) {
    return (
      <div className="space-y-3 text-sm" style={{ color: 'var(--color-text)' }} data-guide="current-set">
        <p>No set yet. Generate names in the Name Generator, choose a preferred name, and run all the tools on it. The results gather here so you can save them as a set.</p>
        <Tooltip text="Go to the Name Generator to start a set.">
          <button onClick={() => goto('suggest')} className="px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity" style={{ background: 'var(--color-primary)', color: '#fff' }}>Open Name Generator</button>
        </Tooltip>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Already saved one? Open it from Saved sets.</p>
      </div>
    );
  }

  const results = ws.results || {};
  const errors = ws.errors || {};
  const toolKeys = RESULT_ORDER.filter((k) => results[k] || errors[k]);
  const ran = toolKeys.length > 0;

  return (
    <div className="space-y-4" data-guide="current-set">
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
        <span>{ws.id ? `Saved set: ${ws.name}` : 'Not saved yet'}</span>
        {dirty && <span className="px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#b45309' }}>Unsaved changes</span>}
        {ws.runAt && <span>· last run {when(ws.runAt)}</span>}
      </div>

      {ws.description && (
        <p className="text-xs leading-relaxed rounded-lg px-3 py-2" style={card}><span style={{ color: 'var(--color-muted)' }}>The business: </span>{ws.description}</p>
      )}

      <div className="space-y-2">
        <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Preferred name</label>
        <Tooltip text="The name every tool runs on. Choose one on the Name Generator, or type or say one here.">
          <div data-guide="preferred-name">
            <VoiceInput value={ws.preferred} onChange={(v) => setWs((w) => ({ ...w, preferred: v }))} placeholder="e.g. vinoire" label="Preferred name" parse={spokenBrand} />
          </div>
        </Tooltip>
        {ws.shortlist.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Shortlist for Compare Names: {ws.shortlist.join(', ')}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text="Run Name Scorer, Social Handles, Registrar Pricing (.com and .com.au), Domain Profile (if the name is taken) and Compare Names (your shortlist) on the preferred name.">
            <button onClick={onRun} disabled={running || !ws.preferred.trim()} data-guide="run-all"
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {running ? 'Checking…' : ran ? 'Run all tools again' : `Run all tools on ${ws.preferred.trim() || 'the preferred name'}`}
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="rounded-xl p-4 space-y-2" style={card} data-guide="save-set">
        <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{ws.id ? 'Set name' : 'Save this as a set'}</label>
        <Tooltip text="Name the set so you can find it again, for example the business or the product.">
          <div><VoiceInput value={ws.name} onChange={(v) => setWs((w) => ({ ...w, name: v }))} placeholder={ws.preferred ? `e.g. ${ws.preferred} (wine fridges)` : 'e.g. Wine fridge business'} label="Set name" /></div>
        </Tooltip>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text={ws.id ? 'Save your changes to this set, including the results shown here.' : 'Keep this set, with the names and every result, so you can come back to it.'}>
            <button onClick={onSave} disabled={saving || !ws.name.trim()}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {saving ? 'Saving…' : ws.id ? 'Update set' : 'Save set'}
            </button>
          </Tooltip>
          {!confirmNew ? (
            <Tooltip text="Clear the board and start a different set. A saved set stays saved.">
              <button onClick={() => (dirty ? setConfirmNew(true) : onNew())} className="px-3 py-1.5 rounded-lg text-sm border hover:opacity-70 transition-opacity" style={btnLine}>New set</button>
            </Tooltip>
          ) : (
            <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              Discard unsaved changes?
              <button onClick={() => { setConfirmNew(false); onNew(); }} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>Yes</button>
              <button onClick={() => setConfirmNew(false)} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>No</button>
            </span>
          )}
          {ws.id && (!confirmDelete ? (
            <Tooltip text="Delete this saved set. It stays in Settings, Recycle bin for 30 days.">
              <button onClick={() => setConfirmDelete(true)} className="px-3 py-1.5 rounded-lg text-sm border hover:opacity-70 transition-opacity" style={btnLine}>Delete set</button>
            </Tooltip>
          ) : (
            <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              Delete this set?
              <button onClick={() => { setConfirmDelete(false); onDelete(); }} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>No</button>
            </span>
          ))}
        </div>
      </div>

      {ws.suggestions && ws.suggestions.length > 0 && (
        <Section title="Suggestions to consider">
          <p className="text-xs mt-1 mb-3" style={{ color: 'var(--color-muted)' }}>Three candidates side by side: their domain endings and social media handles.</p>
          <SuggestionTable ws={ws} setWs={setWs} onCheckHandles={onCheckHandles} checking={checkingHandles} />
        </Section>
      )}

      {!ran && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing has been checked for this set yet. Choose a preferred name and run all the tools.</p>}

      {RESULT_ORDER.map((key) => {
        const r = results[key];
        const err = errors[key];
        if (!r && !err) return null;
        return (
          <Section key={key} title={RESULT_TITLES[key]}>
            {key === 'pricing' && r ? Object.entries(r).map(([ending, data]) => (
              <div key={ending} className="mt-2">
                <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>.{ending}</p>
                <Result mode="pricing" data={data} />
              </div>
            )) : r ? <Result mode={key} data={r} /> : null}
            {!r && err && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>{err}</p>}
            {key === 'pricing' && r && errors.pricing && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>{errors.pricing}</p>}
          </Section>
        );
      })}
    </div>
  );
}

// ── Saved sets ───────────────────────────────────────────────────────────────

export function SavedSetsPanel({ onOpen, onDeleted, refreshKey, goto }) {
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
        <p>No saved sets yet. Generate names, choose a preferred name, run all the tools, then save the set from Current set.</p>
        <Tooltip text="Go to the Name Generator to start a set.">
          <button onClick={() => goto('suggest')} className="px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity" style={{ background: 'var(--color-primary)', color: '#fff' }}>Open Name Generator</button>
        </Tooltip>
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
            <button onClick={() => setConfirm('selected')} className="px-3 py-1 rounded-lg border hover:opacity-70 transition-opacity" style={btnLine}>Delete selected ({chosen.length})</button>
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
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {s.preferred ? `Preferred: ${s.preferred} · ` : ''}{s.names} name{s.names === 1 ? '' : 's'} · {s.results} tool result{s.results === 1 ? '' : 's'} · updated {when(s.updatedAt)}
            </p>
          </div>
          <Tooltip text="Open this set on the Current set board, with the names and results as they were saved.">
            <button onClick={() => open(s.id)} disabled={busy === s.id} className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>Open</button>
          </Tooltip>
          {confirm === s.id ? (
            <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              Delete?
              <button onClick={() => removeSets([s])} disabled={busy === s.id} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>Yes</button>
              <button onClick={() => setConfirm(null)} className="px-2 py-1 rounded border hover:opacity-70" style={btnLine}>No</button>
            </span>
          ) : (
            <Tooltip text="Delete this set. It stays in Settings, Recycle bin for 30 days.">
              <button onClick={() => setConfirm(s.id)} className="px-3 py-1.5 rounded-lg text-sm border hover:opacity-70 transition-opacity" style={btnLine}>Delete</button>
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  );
}
