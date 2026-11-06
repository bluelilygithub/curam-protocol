import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import { safeHref, positionText, costText, toggleOne, toggleAll, pruneSelection, deletedMessage, groupLayout } from './lookupHelpers.mjs';

// SERP Tracker, Lookup tab: search Google right now through DataForSEO, read the answer, keep it, open it again, and delete saved lookups
// (one, several or all, with Undo). See docs/serp-tracker.md. The server does the work; this only shows it.

const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const INNER = { background: 'var(--color-bg)', borderColor: 'var(--color-border)' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const DEPTHS = [10, 20, 50, 100];

function Fact({ label, children }) {
  return (
    <div className="rounded-xl border p-3" style={INNER}>
      <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</dt>
      <dd className="text-sm font-semibold mt-0.5" style={{ color: 'var(--color-text)' }}>{children}</dd>
    </div>
  );
}

/** One lookup read out: where you are, the AI summary, the top 10 and the page layout. */
function LookupResult({ lookup }) {
  const s = lookup.summary || {};
  const mine = s.mine;
  const ai = s.aiOverview;
  const layout = groupLayout(s.layout);
  return (
    <div className="space-y-4" data-guide="lookup-result">
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{lookup.keyword}</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
          {lookup.device === 'mobile' ? 'Mobile' : 'Desktop'} · {lookup.locationName} · top {lookup.depth} · {when(lookup.createdAt)} · cost {costText(lookup.costUsd)}
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Fact label="Your site">
          {!mine ? 'No site saved' : mine.status === 'ranked' ? `#${mine.bestPosition}` : `Not in the top ${lookup.depth}`}
        </Fact>
        <Fact label="Above your first result">
          {!mine || mine.itemsAboveMe == null ? '—' : `${mine.itemsAboveMe} other ${mine.itemsAboveMe === 1 ? 'box' : 'boxes'}`}
        </Fact>
        <Fact label="Google's AI summary">
          {!ai || !ai.present ? 'Not shown' : mine && ai.mineCited ? 'Names you' : 'Shown'}
        </Fact>
      </dl>

      {mine && mine.status === 'ranked' && (
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          Your best page: {safeHref(mine.bestUrl)
            ? <a href={safeHref(mine.bestUrl)} target="_blank" rel="noopener noreferrer" className="underline break-all">{mine.bestUrl}</a>
            : <span className="break-all">{mine.bestUrl}</span>}
          {mine.urls.length > 1 && <span style={{ color: 'var(--color-muted)' }}> ({mine.urls.length} of your pages appear)</span>}
        </p>
      )}

      {ai && ai.present && (
        <div className="rounded-xl border p-3 text-sm space-y-1" style={INNER}>
          <p className="font-medium" style={{ color: 'var(--color-text)' }}>The AI summary named {ai.citations.length} {ai.citations.length === 1 ? 'site' : 'sites'}</p>
          {ai.competitorsCited.length > 0 && <p style={{ color: 'var(--color-muted)' }}>Competitors named: {ai.competitorsCited.join(', ')}</p>}
          {ai.citations.length > 0 && <p className="text-xs break-words" style={{ color: 'var(--color-muted)' }}>{ai.citations.map((c) => c.domain).filter(Boolean).join(', ')}</p>}
          {ai.citations.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Google showed a summary but no sources were returned.</p>}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Top 10 results</h4>
        <ol className="space-y-1.5">
          {(s.top10 || []).map((r) => (
            <li key={`${r.position}-${r.url}`} className="rounded-xl border px-3 py-2 text-sm flex gap-3" style={r.isMine ? { ...INNER, borderColor: 'var(--color-primary)' } : INNER}>
              <span className="font-semibold w-6 shrink-0" style={{ color: 'var(--color-text)' }}>{r.position}</span>
              <span className="min-w-0">
                <span className="block font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.title || r.domain}{r.isMine ? ' (you)' : ''}</span>
                {safeHref(r.url)
                  ? <a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" className="block text-xs underline truncate" style={{ color: 'var(--color-muted)' }}>{r.domain}</a>
                  : <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{r.domain}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {layout.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Order of everything on the page</h4>
          <p className="text-xs flex flex-wrap gap-1.5">
            {layout.map((g, i) => (
              <span key={`${g.name}-${i}`} className="rounded-full border px-2.5 py-1" style={{ ...INNER, color: 'var(--color-text)' }}>{g.name}{g.count > 1 ? ` ×${g.count}` : ''}</span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

export default function LookupPanel({ status, siteSaved, onSpendChanged }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [keyword, setKeyword] = useState('');
  const [device, setDevice] = useState('desktop');
  const [depth, setDepth] = useState(10);
  const [ai, setAi] = useState(true);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null); // null = loading
  const [selected, setSelected] = useState(new Set());
  const [confirm, setConfirm] = useState(null); // null | 'selected' | 'all'
  const [deleting, setDeleting] = useState(false);
  const resultRef = useRef(null);
  const selectAllRef = useRef(null);

  const loadSaved = useCallback(async () => {
    try {
      const res = await api.get('/api/serp-tracker/lookups');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the saved lookups.');
      setSaved(data.lookups);
      setSelected((sel) => pruneSelection(sel, data.lookups.map((l) => l.id)));
    } catch (err) {
      setSaved([]);
      addToast(err.message, 'error');
    }
  }, [addToast]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const ids = (saved || []).map((l) => l.id);
  const allPicked = ids.length > 0 && ids.every((id) => selected.has(id));
  const somePicked = selected.size > 0 && !allPicked;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = somePicked; }, [somePicked]);

  const scrollToResult = () => setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  async function lookUp(e) {
    e?.preventDefault();
    if (!keyword.trim()) { addToast('Type the search you want to look up.', 'error'); return; }
    startProcessing('Looking up on Google…', 'This is a paid search through DataForSEO. The cost is shown when it finishes.');
    try {
      const res = await api.post('/api/serp-tracker/lookups', { keyword, device, depth, aiOverview: ai });
      const data = await res.json();
      if (!res.ok) { addToast(data.error || 'The lookup failed.', 'error'); return; }
      setResult(data.lookup);
      addToast(`Looked up. Cost ${costText(data.lookup.costUsd)}.`, 'success');
      scrollToResult();
      loadSaved();
      onSpendChanged?.();
    } catch {
      addToast('The lookup could not be done. Check your connection and try again.', 'error');
    } finally {
      stopProcessing();
    }
  }

  async function open(id) {
    try {
      const res = await api.get(`/api/serp-tracker/lookups/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open that lookup.');
      setResult(data.lookup);
      scrollToResult();
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  async function undo(binIds) {
    try {
      for (const id of binIds) {
        // eslint-disable-next-line no-await-in-loop
        const res = await api.post(`/api/recycle-bin/${id}/restore`);
        if (!res.ok) throw new Error('restore failed');
      }
      addToast(`${binIds.length} lookup${binIds.length === 1 ? '' : 's'} restored ✓`, 'success');
    } catch {
      addToast('Some lookups could not be restored. Look in Settings, Recycle bin.', 'error');
    }
    loadSaved();
  }

  async function doDelete(all) {
    setDeleting(true);
    try {
      const res = await api.delete('/api/serp-tracker/lookups', all ? { all: true } : { ids: [...selected] });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The lookups could not be deleted.');
      setConfirm(null);
      setSelected(new Set());
      if (result && (all || selected.has(result.id))) setResult(null);
      await loadSaved();
      if (data.deleted > 0) addToast(deletedMessage(data.deleted, data.retentionDays || 30), 'success', undefined, { label: 'Undo', onClick: () => undo(data.binIds) });
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  const connected = status?.dataForSeoConfigured;
  const btn = 'px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';

  return (
    <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-6" data-guide="lookup">
      <div className="space-y-6 min-w-0">
        <section className="rounded-2xl border p-6 space-y-4" style={CARD} aria-labelledby="lookup-title" data-guide="lookup-form">
          <div>
            <h2 id="lookup-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Look up a search</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
              See who is on Google right now for any search. Each lookup is a paid search, and what it cost is shown afterwards.
              {siteSaved ? '' : ' Save your site details first if you want to see where your own site is.'}
            </p>
          </div>
          {!connected && (
            <p className="text-sm" style={{ color: '#b45309' }}>DataForSEO is not connected on this server, so lookups cannot run. Ask an admin to set it up.</p>
          )}
          <form onSubmit={lookUp} className="space-y-4">
            <div>
              <label htmlFor="lookup-keyword" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Search</label>
              <Tooltip text="The words you would type into Google, for example: walk in wine cabinets.">
                <input id="lookup-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={200} placeholder="walk in wine cabinets"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD} />
              </Tooltip>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <fieldset>
                <legend className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Device</legend>
                <div className="flex gap-4">
                  {['desktop', 'mobile'].map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                      <input type="radio" name="lookup-device" checked={device === d} onChange={() => setDevice(d)} />
                      {d === 'desktop' ? 'Desktop' : 'Mobile'}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="lookup-depth" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Results to ask for</label>
                <Tooltip text="How deep into Google's results to look. The top 10 is the cheapest. Going deeper costs more, and is only needed to find out how far down your site is.">
                  <select id="lookup-depth" value={depth} onChange={(e) => setDepth(Number(e.target.value))}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD}>
                    {DEPTHS.map((n) => <option key={n} value={n}>Top {n}</option>)}
                  </select>
                </Tooltip>
              </div>
            </div>
            <Tooltip text="Also ask for the AI summary Google sometimes shows above the results, and who it names. This can cost a little more, and only appears for some searches.">
              <label className="flex items-center gap-2 text-sm w-fit" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
                Include Google's AI summary
              </label>
            </Tooltip>
            <Tooltip text="Searches Google now through DataForSEO. This is a paid search; the cost is shown when it finishes. The result is saved to the list.">
              <button type="submit" disabled={!connected || !keyword.trim()} data-guide="lookup-run"
                className="px-3.5 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {getIcon('search', { size: 14 })} Look up
              </button>
            </Tooltip>
          </form>
          {status && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Spent this month: {costText(status.spentThisMonthUsd)} of {costText(status.capUsd)}.</p>}
        </section>

        {result && (
          <section ref={resultRef} className="rounded-2xl border p-6" style={CARD} aria-label="Lookup result">
            <LookupResult lookup={result} />
          </section>
        )}
      </div>

      <section className="rounded-2xl border p-6 space-y-4 min-w-0" style={CARD} aria-labelledby="saved-title" data-guide="saved-lookups">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="saved-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Saved lookups</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>latest 50 · newest first</span>
        </div>

        {saved === null ? <Skeleton lines={4} label="Loading saved lookups" /> : saved.length === 0 ? (
          <EmptyState icon="search" title="No saved lookups yet" body="Look up a search and it is kept here, so you can open it again later." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" data-guide="select-delete">
              <Tooltip text="Tick or untick every saved lookup.">
                <label className="flex items-center gap-2 text-xs font-medium mr-2" style={{ color: 'var(--color-text)' }}>
                  <input ref={selectAllRef} type="checkbox" checked={allPicked} onChange={() => setSelected((s) => toggleAll(s, ids))} aria-label="Select all saved lookups" />
                  Select all
                </label>
              </Tooltip>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{selected.size} selected</span>
              <span className="flex-1" />
              {confirm ? (
                <span className="flex items-center gap-2 text-xs" role="alert" style={{ color: 'var(--color-text)' }}>
                  Delete {confirm === 'all' ? `all ${saved.length}` : selected.size} lookup{(confirm === 'all' ? saved.length : selected.size) === 1 ? '' : 's'}?
                  <button type="button" disabled={deleting} onClick={() => doDelete(confirm === 'all')} className={btn} style={{ borderColor: '#ef4444', color: '#991b1b' }}>Yes</button>
                  <button type="button" disabled={deleting} onClick={() => setConfirm(null)} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>No</button>
                </span>
              ) : (
                <>
                  <Tooltip text="Deletes the lookups you have ticked. They are kept for 30 days, and the Undo on the message brings them back.">
                    <button type="button" disabled={selected.size === 0} onClick={() => setConfirm('selected')} className={`${btn} flex items-center gap-1.5`} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {getIcon('trash', { size: 13 })} Delete selected
                    </button>
                  </Tooltip>
                  <Tooltip text="Deletes every saved lookup. They are kept for 30 days, and the Undo on the message brings them back.">
                    <button type="button" onClick={() => setConfirm('all')} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Delete all</button>
                  </Tooltip>
                </>
              )}
            </div>

            <ul className="space-y-2">
              {saved.map((l) => (
                <li key={l.id} className="rounded-xl border p-3 flex items-start gap-3" style={result && result.id === l.id ? { ...INNER, borderColor: 'var(--color-primary)' } : INNER}>
                  <input type="checkbox" className="mt-1" checked={selected.has(l.id)} onChange={() => setSelected((s) => toggleOne(s, l.id))} aria-label={`Select the lookup for ${l.keyword}`} />
                  <Tooltip text="Open this saved lookup.">
                    <button type="button" onClick={() => open(l.id)} className="min-w-0 flex-1 text-left transition-opacity duration-200 hover:opacity-70">
                      <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{l.keyword}</span>
                      <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        {l.device === 'mobile' ? 'Mobile' : 'Desktop'} · top {l.depth} · {when(l.createdAt)} · {costText(l.costUsd)}
                      </span>
                    </button>
                  </Tooltip>
                  <span className="text-xs font-semibold shrink-0 pt-0.5" style={{ color: 'var(--color-text)' }}>{positionText(l)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
