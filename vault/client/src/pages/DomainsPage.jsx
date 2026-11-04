import React, { useEffect, useState } from 'react';
import api from '../utils/apiClient';
import useProcessingStore from '../store/processingStore';
import useToastStore from '../store/toastStore';
import Tooltip from '../components/Tooltip';
import { VoiceInputProvider, VoiceInput } from '../components/voiceInput/VoiceInput';
import DomainsTutorChat from './domains/DomainsTutorChat';
import { GUIDE_TOOLS } from './domains/domainsTools.mjs';
import BriefForm from './domains/BriefForm';
import NameResults, { Chips } from './domains/NameResults';
import SavedSets from './domains/SavedSets';
import { BLANK_FILTERS } from './domains/filters.mjs';
import { BLANK_WS, dataOf, jsonOf, isDirty, fromSet, mergeRound, orderedPool, addTurn, addNote } from './domains/workspace.mjs';

// The Domain tool: a guided journey from a brief to a name you can be confident in. Brief -> Names -> Shortlist (-> Check -> Decide).
// The set being worked on lives here, so every step shares it and Save set keeps all of it.

const STEPS = [
  ['brief', '1  Brief'],
  ['names', '2  Names'],
  ['shortlist', '3  Shortlist'],
];
const line = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const primary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };

function Shortlist({ ws, setWs, goto }) {
  const cards = ws.pool.filter((c) => ws.shortlist.includes(c.name));
  if (!cards.length) {
    return (
      <div className="space-y-3 text-sm" style={{ color: 'var(--color-text)' }}>
        <p>Nothing shortlisted yet. Star the names you like on the Names step.</p>
        <button onClick={() => goto('names')} className="px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity duration-200" style={primary}>Back to the names</button>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-guide="shortlist">
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{cards.length} shortlisted. Remove a name with its star.</p>
      <div className="grid gap-3 xl:grid-cols-2">
        {cards.map((c) => (
          <div key={c.name} className="rounded-xl px-4 py-3 space-y-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-primary)' }}>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{c.label || c.name}</span>
              {c.label && <span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{c.name}</span>}
              <Tooltip text="Remove this name from your shortlist."><button onClick={() => setWs((w) => ({ ...w, shortlist: w.shortlist.filter((n) => n !== c.name), preferred: w.preferred === c.name ? '' : w.preferred }))} className="ml-auto text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={line}>★ Remove</button></Tooltip>
            </div>
            <Chips card={c} required={ws.brief.required.tlds} />
            {c.reasoning && <p className="text-sm" style={{ color: 'var(--color-text)' }}>{c.reasoning}</p>}
            {c.risks.length > 0 && <ul className="text-xs space-y-0.5" style={{ color: '#b45309' }}>{c.risks.map((r, i) => <li key={i}>⚠ {r}</li>)}</ul>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DomainsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [step, setStep] = useState('brief');           // 'brief' | 'names' | 'shortlist' | 'sets'
  const [ws, setWs] = useState(BLANK_WS);              // the set being worked on, shared by every step
  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [editingBrief, setEditingBrief] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [confirmNew, setConfirmNew] = useState(false);
  const [config, setConfig] = useState(null);

  useEffect(() => { api.get('/api/domains/config').then((r) => r.json()).then(setConfig).catch(() => setConfig(null)); }, []);

  const setBrief = (updater) => setWs((w) => ({ ...w, brief: typeof updater === 'function' ? updater(w.brief) : updater }));
  const dirty = isDirty(ws);

  // One round of names (see server/services/domainNaming/generate.js): wide generation, free filtering, checks for the best few, reasons.
  const generate = async (mode = 'round', seed = '', briefOverride = null) => {
    setGenerating(true);
    startProcessing(mode === 'variations' ? `Making variations of ${seed}…` : 'Finding names…', mode === 'variations' ? 'Prefixes, suffixes and spellings, checked for availability.' : 'Writing ideas, filtering them, checking the best for availability and explaining the finalists.');
    try {
      const res = await api.post('/api/domains/generate', { brief: briefOverride || ws.brief, mode, seed, feedback: ws.feedback, seen: ws.seen, round: ws.rounds + 1 });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWs((w) => mergeRound(w, data));
      setStep('names');
      setEditingBrief(false);
      if (!data.cards.length) addToast('No names passed the checks this time. Loosen the brief or the required endings, or try again.', 'error');
      else if (data.explainError) addToast('The names are ready, but the explanations could not be written just now.', 'error');
    } catch (e) { addToast(e.message || 'Could not make names just now.', 'error'); } finally { setGenerating(false); stopProcessing(); }
  };

  // Talk it through. A question gets an answer from the names so far; detail is added to the brief and makes a new round that builds on it.
  const ask = async (question) => {
    setAsking(true);
    try {
      const cards = [...ws.pool.filter((c) => ws.shortlist.includes(c.name) || ws.preferred === c.name), ...orderedPool(ws.pool)].filter((c, i, a) => a.findIndex((x) => x.name === c.name) === i).slice(0, 30);
      const res = await api.post('/api/domains/ask', { brief: ws.brief, cards, history: ws.conversation, question });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWs((w) => addTurn(w, question, data.answer));
      return true;
    } catch (e) { addToast(e.message || 'Could not answer just now.', 'error'); return false; } finally { setAsking(false); }
  };
  const refine = async (text) => {
    const next = addNote(ws, text);
    setWs(next);
    await generate('round', '', next.brief);
    return true;
  };

  const save = async () => {
    const name = ws.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      const body = { name, data: dataOf(ws) };
      const res = ws.id ? await api.put(`/api/domains/sets/${ws.id}`, body) : await api.post('/api/domains/sets', body);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setWs((w) => ({ ...w, id: d.set.id, name: d.set.name, savedJson: jsonOf(w) }));
      setSavedTick((t) => t + 1);
      addToast(ws.id ? 'Set updated.' : 'Set saved.');
    } catch (e) { addToast(e.message || 'Could not save the set.', 'error'); } finally { setSaving(false); }
  };

  const newSet = () => { setWs(BLANK_WS); setFilters(BLANK_FILTERS); setStep('brief'); setEditingBrief(false); setConfirmNew(false); };
  const openSet = (set) => { setWs(fromSet(set)); setFilters(BLANK_FILTERS); setStep(set.data && set.data.pool && set.data.pool.length ? 'names' : 'brief'); setEditingBrief(false); };
  const openToolById = (id) => { const t = GUIDE_TOOLS.find((x) => x.id === id); const next = t ? t.tool : id; if (['brief', 'names', 'shortlist', 'sets'].includes(next)) setStep(next); };

  const hasNames = ws.pool.length > 0;
  const stepBtn = (id, label) => (
    <Tooltip key={id} text={id === 'brief' ? 'Describe what you are naming.' : id === 'names' ? 'See the names, filter them and steer new rounds.' : 'Your starred names.'}>
      <button onClick={() => setStep(id)} disabled={id !== 'brief' && !hasNames}
        className="px-3 py-1.5 text-sm transition-opacity duration-200 hover:opacity-70 disabled:opacity-30 border-b-2"
        style={{ borderColor: step === id ? 'var(--color-primary)' : 'transparent', color: step === id ? 'var(--color-primary)' : 'var(--color-text)', fontWeight: step === id ? 600 : 400, background: 'transparent' }}>
        {label}{id === 'shortlist' && ws.shortlist.length ? ` (${ws.shortlist.length})` : ''}
      </button>
    </Tooltip>
  );

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="h-full overflow-y-auto" style={{ background: 'var(--color-bg)' }}>
        <div className="px-6 pt-5 pb-3 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
          <h1 className="text-base font-semibold mr-2" style={{ color: 'var(--color-text)' }}>Domain &amp; Brand</h1>
          {config && config.provider === 'fake' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: '#fef3c7', color: '#b45309' }}>Test mode: stand-in data, not real availability</span>
          )}
          <div className="flex items-center" role="tablist" aria-label="Steps">{STEPS.map(([id, label]) => stepBtn(id, label))}</div>
          <Tooltip text="Your saved sets: open one to carry on, or delete the ones you no longer need.">
            <button onClick={() => setStep('sets')} className="px-3 py-1.5 text-sm transition-opacity duration-200 hover:opacity-70 border-b-2"
              style={{ borderColor: step === 'sets' ? 'var(--color-primary)' : 'transparent', color: step === 'sets' ? 'var(--color-primary)' : 'var(--color-text)', fontWeight: step === 'sets' ? 600 : 400, background: 'transparent' }}>Saved sets</button>
          </Tooltip>

          <div className="ml-auto flex flex-wrap items-center gap-2" data-guide="save-set">
            {(hasNames || ws.id || ws.brief.what) && step !== 'sets' && (
              <>
                <div className="w-56">
                  <Tooltip text="Name the set so you can find it again, for example the business or the product.">
                    <div><VoiceInput value={ws.name} onChange={(v) => setWs((w) => ({ ...w, name: v }))} placeholder="Name this set" label="Set name" /></div>
                  </Tooltip>
                </div>
                <Tooltip text={ws.id ? 'Save your changes to this set: the brief, every name, your shortlist and the feedback.' : 'Keep the brief, every name and your shortlist so you can come back to them later.'}>
                  <button onClick={save} disabled={saving || !ws.name.trim()} className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={primary}>
                    {saving ? 'Saving…' : ws.id ? 'Update set' : 'Save set'}
                  </button>
                </Tooltip>
                <span className="text-xs" style={{ color: ws.id && !dirty ? '#15803d' : '#b45309' }} aria-live="polite">{ws.id ? (dirty ? 'Unsaved changes' : '✓ Saved') : (dirty ? 'Not saved yet' : '')}</span>
                {!confirmNew ? (
                  <Tooltip text="Start a different naming brief. A saved set stays saved.">
                    <button onClick={() => (dirty ? setConfirmNew(true) : newSet())} className="px-3 py-1.5 rounded-lg text-sm border hover:opacity-70 transition-opacity duration-200" style={line}>New set</button>
                  </Tooltip>
                ) : (
                  <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                    Discard unsaved changes?
                    <button onClick={newSet} className="px-2 py-1 rounded border hover:opacity-70" style={line}>Yes</button>
                    <button onClick={() => setConfirmNew(false)} className="px-2 py-1 rounded border hover:opacity-70" style={line}>No</button>
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-5 max-w-[1700px]">
          {step === 'brief' && (
            <div>
              <BriefForm brief={ws.brief} setBrief={setBrief} onGenerate={() => generate('round')} generating={generating} config={config} />
            </div>
          )}

          {step === 'names' && (
            <div className="space-y-5">
              {editingBrief && (
                <div className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <BriefForm brief={ws.brief} setBrief={setBrief} onGenerate={() => generate('round')} generating={generating} config={config} submitLabel="Update names" compact />
                  <button onClick={() => setEditingBrief(false)} className="mt-3 text-xs underline hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Close without changing</button>
                </div>
              )}
              <NameResults ws={ws} setWs={setWs} filters={filters} setFilters={setFilters} config={config} generating={generating} asking={asking}
                onAsk={ask} onRefine={refine}
                onMore={() => generate('round')} onVariations={(name) => generate('variations', name)} onEditBrief={() => setEditingBrief((e) => !e)} />
            </div>
          )}

          {step === 'shortlist' && <Shortlist ws={ws} setWs={setWs} goto={setStep} />}

          {step === 'sets' && (
            <div className="max-w-3xl">
              <SavedSets onOpen={openSet} refreshKey={savedTick} onStart={newSet}
                onDeleted={(id) => { if (ws.id === id) setWs((w) => ({ ...w, id: null, savedJson: null })); }} />
            </div>
          )}
        </div>
      </div>
      <DomainsTutorChat currentTool={step} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
