import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../Tooltip';
import EmptyState from '../EmptyState';
import { VoiceInputProvider, VoiceInput } from '../voiceInput/VoiceInput';

// Shares → Thesis. One written thesis per holding (why I own it, testable assumptions, red lines, valuation anchors) and a Check that
// asks a model whether the stored evidence (trades, news briefings, the previous check) still supports it. It judges the person's own
// thesis; it never says buy, sell or hold. Server: routes/sharesThesis.js, services/sharesThesis.js. Docs: docs/shares-thesis.md.

const MAX_ITEMS = 7;
const WARN = '#f59e0b';
const BAD = '#ef4444';

// Words are always shown with the colour, so the state is never colour-only.
const VERDICT = {
  intact: { label: 'Intact', color: 'var(--color-primary)' },
  weakening: { label: 'Weakening', color: WARN },
  impaired: { label: 'Impaired', color: BAD },
  broken: { label: 'Broken', color: BAD },
  'red-line': { label: 'Red line hit', color: BAD },
  unclear: { label: 'Not enough evidence', color: 'var(--color-muted)' },
};
const DRIFT_WORD = { improved: 'Improved', unchanged: 'Unchanged', weakened: 'Weakened', unclear: 'Unclear' };

const fmtWhen = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return String(iso).slice(0, 10); }
};
const keyOf = (t) => `${t.symbol}:${t.exchange || ''}`;
const emptyDraft = (symbol = '', exchange = '') => ({
  symbol, exchange, thesis: '', assumptions: [{ text: '', how: '' }], redLines: [{ text: '' }],
  anchors: { optimistic: '', neutral: '', pessimistic: '' }, mirror: '',
});

function Pill({ verdict, score }) {
  const v = VERDICT[verdict] || VERDICT.unclear;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color: v.color, borderColor: v.color }}>
      {v.label}{score != null ? ` · ${score}/10` : ''}
    </span>
  );
}

export default function SharesThesisTab({ onAskGuide }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [theses, setTheses] = useState([]);
  const [untracked, setUntracked] = useState([]);
  const [selected, setSelected] = useState(null); // key of the open thesis
  const [draft, setDraft] = useState(null); // the editor, when open
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shares/thesis');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load theses');
      setTheses(data.theses || []);
      setUntracked(data.untracked || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load theses');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = theses.find((t) => keyOf(t) === selected) || null;

  useEffect(() => {
    setShowHistory(false);
    setHistory([]);
    setConfirmDelete(false);
  }, [selected]);

  const loadHistory = async () => {
    if (!current) return;
    try {
      const res = await api.get(`/api/shares/thesis/${current.id}/checks`);
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Could not load history');
      setHistory(Array.isArray(data) ? data : []);
      setShowHistory(true);
    } catch (err) {
      addToast(err.message || 'Could not load history', 'error');
    }
  };

  const startNew = (symbol, exchange) => { setDraft(emptyDraft(symbol, exchange)); setSelected(null); };
  const startEdit = () => {
    if (!current) return;
    setDraft({
      symbol: current.symbol, exchange: current.exchange || '', thesis: current.thesis || '',
      assumptions: current.assumptions.length ? current.assumptions.map((a) => ({ text: a.text, how: a.how || '' })) : [{ text: '', how: '' }],
      redLines: current.redLines.length ? current.redLines.map((r) => ({ text: r.text })) : [{ text: '' }],
      anchors: { optimistic: '', neutral: '', pessimistic: '', ...(current.anchors || {}) }, mirror: current.mirror || '',
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.put('/api/shares/thesis', draft);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      await load();
      setSelected(keyOf(data));
      setDraft(null);
      addToast('Thesis saved', 'success');
    } catch (err) {
      addToast(err.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runCheck = async () => {
    if (!current) return;
    startProcessing(`Checking the ${current.symbol} thesis…`, 'Reading your trades, news briefings and the last check. This can take up to a minute.');
    try {
      const res = await api.post(`/api/shares/thesis/${current.id}/check`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Check failed');
      await load();
      setShowHistory(false);
    } catch (err) {
      addToast(err.message || 'Check failed', 'error');
    } finally {
      stopProcessing();
    }
  };

  const undoDelete = async (binId) => {
    try {
      const res = await api.post(`/api/recycle-bin/${binId}/restore`);
      if (!res.ok) throw new Error('restore failed');
      await load();
      addToast('Thesis restored ✓', 'success');
    } catch {
      addToast('That could not be restored. Look in Settings → Recycle bin.', 'error');
    }
  };

  const remove = async () => {
    if (!current) return;
    try {
      const res = await api.delete(`/api/shares/thesis/${current.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setSelected(null);
      setConfirmDelete(false);
      await load();
      addToast(`${current.symbol} thesis deleted. Kept 30 days.`, 'success', undefined, { label: 'Undo', onClick: () => undoDelete(data.binId) });
    } catch (err) {
      addToast(err.message || 'Delete failed', 'error');
    }
  };

  const setList = (field, i, patch) => setDraft((d) => ({ ...d, [field]: d[field].map((it, n) => (n === i ? { ...it, ...patch } : it)) }));
  const addItem = (field, blank) => setDraft((d) => (d[field].length >= MAX_ITEMS ? d : { ...d, [field]: [...d[field], blank] }));
  const dropItem = (field, i) => setDraft((d) => ({ ...d, [field]: d[field].filter((_, n) => n !== i) }));

  const card = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
  const btnGhost = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const btnCls = 'text-sm px-3 py-1.5 rounded-md hover:opacity-70 transition-opacity duration-200 disabled:opacity-40';

  if (loading) {
    return <div className="space-y-2 max-w-3xl" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />)}</div>;
  }

  const latest = current?.latestCheck || null;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="max-w-[1700px]" data-tour="shares-thesis">
        <div className="mb-5">
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Thesis journal</p>
          <p className="text-xs mt-0.5 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            Write down why you own a share and what would make you wrong, then check it against what Vault has stored. It tests your own thesis; it never says whether to buy, sell or hold.
          </p>
        </div>
        {error && <p className="text-xs mb-3 px-3 py-2 rounded-md" style={{ background: '#fff1f2', color: BAD }}>{error}</p>}

        <div className="grid gap-6 xl:grid-cols-[320px_1fr] items-start">
          {/* left: one row per thesis, then holdings with none */}
          <div className="space-y-2">
            {theses.map((t) => (
              <button
                key={t.id} type="button" onClick={() => { setSelected(keyOf(t)); setDraft(null); }}
                className="w-full text-left px-3 py-2.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                style={{ ...card, outline: selected === keyOf(t) ? '2px solid var(--color-primary)' : 'none' }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t.symbol}<span className="text-xs ml-1" style={{ color: 'var(--color-muted)' }}>{t.exchange}</span></span>
                  {t.latestCheck ? <Pill verdict={t.latestCheck.verdict} score={t.latestCheck.healthScore} /> : <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Not checked yet</span>}
                </span>
                <span className="block text-xs mt-1 truncate" style={{ color: 'var(--color-muted)' }}>{t.thesis || `${t.assumptions.length} assumption${t.assumptions.length === 1 ? '' : 's'}`}</span>
              </button>
            ))}
            {untracked.length > 0 && (
              <div className="pt-3">
                <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>Holdings with no thesis yet</p>
                {untracked.map((u) => (
                  <Tooltip key={keyOf(u)} text={`Write why you own ${u.symbol} and what would prove you wrong.`}>
                    <button type="button" onClick={() => startNew(u.symbol, u.exchange)} className="w-full flex items-center justify-between px-3 py-2 mb-1.5 rounded-lg border border-dashed text-sm hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      <span>{u.symbol}<span className="text-xs ml-1" style={{ color: 'var(--color-muted)' }}>{u.exchange}</span></span>
                      <span style={{ color: 'var(--color-primary)' }}>{getIcon('plus', { size: 14 })}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
            <Tooltip text="Write a thesis for a share that is not in your holdings, such as one you are watching or have sold.">
              <button type="button" onClick={() => startNew('', '')} className={`${btnCls} border w-full mt-2`} style={btnGhost}>Write a thesis for another share</button>
            </Tooltip>
          </div>

          {/* right: editor, or the open thesis, or a prompt */}
          <div>
            {draft && (
              <div className="rounded-xl border p-4 space-y-4" style={card}>
                <div className="flex gap-2">
                  <label className="text-xs flex-1" style={{ color: 'var(--color-muted)' }}>Symbol
                    <input value={draft.symbol} disabled={!!theses.find((t) => keyOf(t) === `${draft.symbol}:${draft.exchange}`)} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} className="block w-full mt-1 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }} />
                  </label>
                  <label className="text-xs w-32" style={{ color: 'var(--color-muted)' }}>Exchange
                    <select value={draft.exchange} onChange={(e) => setDraft({ ...draft, exchange: e.target.value })} className="block w-full mt-1 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                      <option value="">Any</option><option>ASX</option><option>NYSE</option><option>NASDAQ</option>
                    </select>
                  </label>
                </div>

                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Why do I own it?</p>
                  <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>A sentence or two: the business, its edge, why the price is fair. If you cannot write it, that is worth knowing.</p>
                  <VoiceInput type="textarea" append rows={3} value={draft.thesis} onChange={(v) => setDraft({ ...draft, thesis: v })} placeholder="e.g. Dominant AI chip maker with a software moat, bought below my fair value." label="Why I own it" />
                </div>

                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Assumptions <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>(3 to 7 things that must stay true, each one checkable)</span></p>
                  {draft.assumptions.map((a, i) => (
                    <div key={i} className="flex gap-2 items-start mt-2">
                      <div className="flex-1 space-y-1.5">
                        <VoiceInput value={a.text} onChange={(v) => setList('assumptions', i, { text: v })} placeholder="e.g. Data-centre revenue keeps growing faster than 20% a year" label={`Assumption ${i + 1}`} />
                        <VoiceInput value={a.how} onChange={(v) => setList('assumptions', i, { how: v })} placeholder="How would I know? e.g. each quarterly result" label={`How to verify assumption ${i + 1}`} />
                      </div>
                      <Tooltip text="Remove this assumption">
                        <button type="button" onClick={() => dropItem('assumptions', i)} aria-label="Remove assumption" className="mt-2 hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button>
                      </Tooltip>
                    </div>
                  ))}
                  {draft.assumptions.length < MAX_ITEMS && <button type="button" onClick={() => addItem('assumptions', { text: '', how: '' })} className="text-xs mt-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>+ Add an assumption</button>}
                </div>

                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Red lines <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>(things that would mean the thesis is wrong, decided now while calm)</span></p>
                  {draft.redLines.map((r, i) => (
                    <div key={i} className="flex gap-2 items-center mt-2">
                      <div className="flex-1"><VoiceInput value={r.text} onChange={(v) => setList('redLines', i, { text: v })} placeholder="e.g. Loses a top-three customer, or margins fall below 55% for two quarters" label={`Red line ${i + 1}`} /></div>
                      <Tooltip text="Remove this red line">
                        <button type="button" onClick={() => dropItem('redLines', i)} aria-label="Remove red line" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button>
                      </Tooltip>
                    </div>
                  ))}
                  {draft.redLines.length < MAX_ITEMS && <button type="button" onClick={() => addItem('redLines', { text: '' })} className="text-xs mt-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>+ Add a red line</button>}
                </div>

                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Value anchors <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>(optional: what you think it is worth in each case)</span></p>
                  <div className="grid sm:grid-cols-3 gap-2 mt-1">
                    {['optimistic', 'neutral', 'pessimistic'].map((k) => (
                      <VoiceInput key={k} value={draft.anchors[k]} onChange={(v) => setDraft({ ...draft, anchors: { ...draft.anchors, [k]: v } })} placeholder={k[0].toUpperCase() + k.slice(1)} label={`${k} value`} />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Mirror test <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>(optional: five sentences on why you would buy it today)</span></p>
                  <VoiceInput type="textarea" append rows={4} value={draft.mirror} onChange={(v) => setDraft({ ...draft, mirror: v })} placeholder="If you cannot finish five sentences, you may not understand the purchase." label="Mirror test" />
                </div>

                <div className="flex gap-2">
                  <button type="button" onClick={save} disabled={saving || !draft.symbol.trim()} className={btnCls} style={btnPrimary}>{saving ? 'Saving…' : 'Save thesis'}</button>
                  <button type="button" onClick={() => setDraft(null)} className={`${btnCls} border`} style={btnGhost}>Cancel</button>
                </div>
              </div>
            )}

            {!draft && current && (
              <div className="space-y-4">
                <div className="rounded-xl border p-4" style={card}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{current.symbol} <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>{current.exchange}</span></h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip text="Ask a model whether your stored trades and news briefings still support this thesis. It cannot see company filings, so many answers will be 'not enough evidence'."><button type="button" onClick={runCheck} className={btnCls} style={btnPrimary}>Check now</button></Tooltip>
                      <Tooltip text="Change the thesis, assumptions or red lines. Past checks keep the wording they were run against."><button type="button" onClick={startEdit} className={`${btnCls} border`} style={btnGhost}>Edit</button></Tooltip>
                      {confirmDelete ? (
                        <span className="text-sm" style={{ color: 'var(--color-text)' }}>Delete? <button type="button" onClick={remove} className="underline hover:opacity-60 transition-opacity duration-200" style={{ color: BAD }}>Yes</button> / <button type="button" onClick={() => setConfirmDelete(false)} className="underline hover:opacity-60 transition-opacity duration-200">No</button></span>
                      ) : (
                        <Tooltip text="Delete this thesis and its check history. Kept 30 days in the recycle bin."><button type="button" onClick={() => setConfirmDelete(true)} className={`${btnCls} border`} style={btnGhost}>Delete</button></Tooltip>
                      )}
                    </div>
                  </div>
                  {current.thesis && <p className="text-sm mb-3" style={{ color: 'var(--color-text)' }}>{current.thesis}</p>}

                  <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Assumptions</p>
                  <ol className="space-y-1.5 mb-3">
                    {current.assumptions.map((a, i) => {
                      const r = latest?.ratings?.find((x) => x.n === i + 1);
                      return (
                        <li key={i} className="text-sm flex items-start justify-between gap-3" style={{ color: 'var(--color-text)' }}>
                          <span>{i + 1}. {a.text}{a.how && <span className="text-xs block" style={{ color: 'var(--color-muted)' }}>Verify: {a.how}</span>}{r?.evidence && <span className="text-xs block" style={{ color: 'var(--color-muted)' }}>Evidence: {r.evidence}</span>}</span>
                          {r && <span className="text-xs whitespace-nowrap" style={{ color: (VERDICT[r.rating] || VERDICT.unclear).color }}>{(VERDICT[r.rating] || VERDICT.unclear).label}</span>}
                        </li>
                      );
                    })}
                  </ol>

                  {current.redLines.length > 0 && (
                    <>
                      <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Red lines</p>
                      <ul className="space-y-1.5 mb-3">
                        {current.redLines.map((r, i) => {
                          const hit = latest?.redLineHits?.find((h) => h.n === i + 1);
                          return (
                            <li key={i} className="text-sm" style={{ color: hit ? BAD : 'var(--color-text)' }}>
                              {hit ? 'Hit: ' : ''}{r.text}{hit && <span className="text-xs block">Evidence: {hit.evidence}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}

                  {(current.anchors?.optimistic || current.anchors?.neutral || current.anchors?.pessimistic) && (
                    <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Value anchors: optimistic {current.anchors.optimistic || '—'} · neutral {current.anchors.neutral || '—'} · pessimistic {current.anchors.pessimistic || '—'}</p>
                  )}
                  {current.mirror && <details className="text-sm"><summary className="cursor-pointer text-xs" style={{ color: 'var(--color-muted)' }}>Mirror test</summary><p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{current.mirror}</p></details>}
                </div>

                {latest ? (
                  <div className="rounded-xl border p-4" style={card}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Latest check · {fmtWhen(latest.createdAt)}</p>
                      <Pill verdict={latest.verdict} score={latest.healthScore} />
                    </div>
                    {latest.summary && <p className="text-sm mb-3" style={{ color: 'var(--color-text)' }}>{latest.summary}</p>}
                    {latest.drift?.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Change since the last check</p>
                        <ul className="space-y-1">
                          {latest.drift.map((d) => (
                            <li key={d.dimension} className="text-sm" style={{ color: 'var(--color-text)' }}>
                              <span className="capitalize">{d.dimension}</span>: <span style={{ color: d.change === 'weakened' ? BAD : 'var(--color-text)' }}>{DRIFT_WORD[d.change] || d.change}</span>
                              {d.evidence && <span className="text-xs block" style={{ color: 'var(--color-muted)' }}>{d.evidence}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {latest.watchNext && <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Watch next: {latest.watchNext}</p>}
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Based on your Vault data and news briefings only, not company filings. It says whether your thesis holds, not whether to buy or sell.</p>
                    <button type="button" onClick={showHistory ? () => setShowHistory(false) : loadHistory} className="text-xs mt-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>{showHistory ? 'Hide history' : 'Show earlier checks'}</button>
                    {showHistory && (
                      <ul className="mt-2 space-y-1">
                        {history.map((h) => (
                          <li key={h.id} className="text-sm flex items-center justify-between gap-2" style={{ color: 'var(--color-text)' }}>
                            <span>{fmtWhen(h.createdAt)}</span><Pill verdict={h.verdict} score={h.healthScore} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="text-sm px-1" style={{ color: 'var(--color-muted)' }}>Not checked yet. Press Check now to test the assumptions against your stored data.</p>
                )}
              </div>
            )}

            {!draft && !current && (
              <EmptyState
                icon="info"
                title={theses.length || untracked.length ? 'Pick a share on the left' : 'No theses yet'}
                body={untracked.length || theses.length ? 'Open a thesis to read or check it, or write one for a holding that has none.' : 'Add a trade first, then write down why you own it and what would prove you wrong.'}
                action={onAskGuide ? <button type="button" onClick={onAskGuide} className={`${btnCls} border`} style={btnGhost}>Ask the guide how this works</button> : null}
              />
            )}
          </div>
        </div>
      </div>
    </VoiceInputProvider>
  );
}
