import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import { readsText, safeHref, positionText, costText, toggleOne, toggleAll, pruneSelection, deletedMessage, groupLayout, estimateCost, pageText } from './lookupHelpers.mjs';

// SERP Tracker, Lookup tab: search Google right now through DataForSEO, read the answer, keep it, open it again, and delete saved lookups
// (one, several or all, with Undo). See docs/serp-tracker.md. The server does the work; this only shows it.

const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const INNER = { background: 'var(--color-bg)', borderColor: 'var(--color-border)' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const DEPTHS = [10, 20, 50, 100, 200];

function Fact({ label, children }) {
  return (
    <div className="rounded-xl border p-3" style={INNER}>
      <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</dt>
      <dd className="text-sm font-semibold mt-0.5" style={{ color: 'var(--color-text)' }}>{children}</dd>
    </div>
  );
}

/** One lookup read out: where you are, the AI summary, the top 10 and the page layout. */
function LookupResult({ lookup, onDeeper, onRetry, busy }) {
  const s = lookup.summary || {};
  const mine = s.mine;
  const ai = s.aiOverview;
  const layout = groupLayout(s.layout);
  const cov = s.coverage; // how many results really came back (older saved lookups have none)
  const short = cov && cov.complete === false;
  return (
    <div className="space-y-4" data-guide="lookup-result">
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{lookup.keyword}</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
          {lookup.device === 'mobile' ? 'Mobile' : 'Desktop'} · {lookup.locationName} · {cov ? `${cov.returned} results checked (asked for ${cov.asked})` : `top ${lookup.depth}`} · {when(lookup.createdAt)} · cost {costText(lookup.costUsd)}{s.attempts > 1 ? ` (${s.attempts} tries)` : ''}
        </p>
        {readsText(s.reads) && (
          <Tooltip text="When your site is not found on the first read, Vault reads the same search again (up to three reads, each one paid) before saying it is not found, because Google sometimes serves a scraper a page that leaves a site out. A find is trusted at once, and the best position wins.">
            <p className="text-xs mt-0.5 w-fit" role="status" style={{ color: 'var(--color-muted)' }}>{readsText(s.reads)}</p>
          </Tooltip>
        )}
        {s.searched && (
          <Tooltip text="What DataForSEO says it actually searched: which Google site, which place (as a DataForSEO place number) and which language. Use it to check the results are for Australia.">
            <p className="text-xs mt-0.5 w-fit" style={{ color: 'var(--color-muted)' }}>
              Searched as: {s.searched.seDomain ? `Google (${s.searched.seDomain})` : 'Google'}
              {s.searched.locationCode != null ? ` · place ${s.searched.locationCode} (${lookup.locationName})` : ''}
              {s.searched.languageCode ? ` · language ${s.searched.languageCode}` : ''}
            </p>
          </Tooltip>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Fact label="Your site">
          {!mine ? 'No site' : mine.status === 'ranked' ? `#${mine.bestPosition} · ${pageText(mine.bestPosition)}` : short ? `Not found in the ${cov.returned} checked` : `Not found in the top ${lookup.depth}`}
        </Fact>
        <Fact label="Above your first result">
          {!mine || mine.itemsAboveMe == null ? '—' : `${mine.itemsAboveMe} other ${mine.itemsAboveMe === 1 ? 'box' : 'boxes'}`}
        </Fact>
        <Fact label="Google's AI summary">
          {!ai || !ai.present ? 'Not shown' : mine && ai.mineCited ? 'Names you' : 'Shown'}
        </Fact>
      </dl>

      {mine && mine.status !== 'ranked' && short && (
        <div className="rounded-xl border p-3 text-sm flex flex-wrap items-center gap-3" style={{ ...INNER, borderColor: '#f59e0b' }}>
          <span style={{ color: '#b45309' }}>
            DataForSEO returned only {cov.returned} of the {cov.asked} results asked for{s.attempts > 1 ? `, even after ${s.attempts} tries` : ''}, so only those were checked and your site could be further down.
            Google gives a short page most of the time and a full one only now and then.
          </span>
          {onRetry && (
            <Tooltip text="Searches the same words again, hoping for a fuller answer. Another paid search, shown with its cost afterwards.">
              <button type="button" disabled={busy} onClick={onRetry} data-guide="search-deeper"
                className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                Try again
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {mine && mine.status !== 'ranked' && !short && lookup.depth < 200 && onDeeper && (
        <div className="rounded-xl border p-3 text-sm flex flex-wrap items-center gap-3" style={INNER}>
          <span style={{ color: 'var(--color-text)' }}>Not in the top {lookup.depth}. You can look further down, as far as the top 200 (page 20).</span>
          <Tooltip text="Searches the same words again, this time asking for 200 results. Another paid search, shown with its cost afterwards.">
            <button type="button" disabled={busy} onClick={onDeeper} data-guide="search-deeper"
              className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              Search the top 200
            </button>
          </Tooltip>
        </div>
      )}

      {mine && mine.status !== 'ranked' && !short && lookup.depth >= 200 && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Not in the top 200 either. Going further than 200 needs DataForSEO's slower queued mode, which is not switched on here.</p>
      )}

      {mine && mine.uncertain && (
        <p className="text-sm" style={{ color: '#b45309' }}>
          Your site was not found, but {s.unknownDomainCount} {s.unknownDomainCount === 1 ? 'result does' : 'results do'} not show which website {s.unknownDomainCount === 1 ? 'it is' : 'they are'} (Google hides it for things like Pinterest pins), so your site could be one of them.
        </p>
      )}

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
        <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Sponsored ads</h4>
        {!Array.isArray(s.ads) ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Ads were not recorded for this older lookup. Look it up again to see them.</p>
        ) : s.ads.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No sponsored ads came back for this search. Ads change with the place, the device and the time, so this does not prove none are running.</p>
        ) : (
          <ol className="space-y-1.5">
            {s.ads.map((a, i) => (
              <li key={`${a.position}-${i}`} className="rounded-xl border px-3 py-2 text-sm" style={a.isMine ? { ...INNER, borderColor: 'var(--color-primary)' } : INNER}>
                <span className="block font-medium truncate" style={{ color: 'var(--color-text)' }}>{a.title || a.domain}{a.isMine ? ' (you)' : ''}</span>
                <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{a.domain || a.shownUrl}</span>
                {a.description && <span className="block text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{a.description}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Top 10 results</h4>
        <ol className="space-y-1.5">
          {(s.top10 || []).map((r) => (
            <li key={`${r.position}-${r.url}`} className="rounded-xl border px-3 py-2 text-sm flex gap-3" style={r.isMine ? { ...INNER, borderColor: 'var(--color-primary)' } : INNER}>
              <span className="font-semibold w-6 shrink-0" style={{ color: 'var(--color-text)' }}>{r.position}</span>
              <span className="min-w-0">
                <span className="block font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.title || r.domain || r.site}{r.isMine ? ' (you)' : ''}</span>
                {safeHref(r.url)
                  ? <a href={safeHref(r.url)} target="_blank" rel="noopener noreferrer" className="block text-xs underline truncate" style={{ color: 'var(--color-muted)' }}>{r.shownUrl || r.domain || r.site || 'Open result'}</a>
                  : <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{r.shownUrl || r.domain || r.site}</span>}
                {!r.domain && <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{r.site ? `${r.site}: ` : ''}website not shown by Google</span>}
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

export default function LookupPanel({ status, siteId = null, site = null, onSpendChanged }) {
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
  const [busy, setBusy] = useState(false);
  const resultRef = useRef(null);
  const selectAllRef = useRef(null);

  const loadSaved = useCallback(async () => {
    try {
      const res = await api.get(`/api/serp-tracker/lookups?siteId=${siteId == null ? 'quick' : siteId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the saved lookups.');
      setSaved(data.lookups);
      setSelected((sel) => pruneSelection(sel, data.lookups.map((l) => l.id)));
    } catch (err) {
      setSaved([]);
      addToast(err.message, 'error');
    }
  }, [addToast, siteId]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const ids = (saved || []).map((l) => l.id);
  const allPicked = ids.length > 0 && ids.every((id) => selected.has(id));
  const somePicked = selected.size > 0 && !allPicked;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = somePicked; }, [somePicked]);

  const scrollToResult = () => setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  /** One paid search. `over` can change the words, device, depth or AI summary (used by Find my site and Search the top 200). */
  async function runLookup(over = {}) {
    const kw = (over.keyword ?? keyword).trim();
    if (!kw) { addToast('Type the search you want to look up.', 'error'); return; }
    const body = { keyword: kw, device: over.device ?? device, depth: over.depth ?? depth, aiOverview: over.aiOverview ?? ai, siteId };
    const est = estimateCost(body.depth, body.aiOverview, status?.pricing);
    startProcessing('Looking up on Google…', `This is a paid search through DataForSEO${est != null ? `, expected to cost about ${costText(est)}` : ''}. The real cost is shown when it finishes.`);
    setBusy(true);
    try {
      const res = await api.post('/api/serp-tracker/lookups', body);
      const data = await res.json();
      if (!res.ok) { addToast(data.error || 'The lookup failed.', 'error'); return; }
      setResult(data.lookup);
      const m = data.lookup.summary && data.lookup.summary.mine;
      addToast(m && m.status === 'ranked' ? `Found your site at #${m.bestPosition} (${pageText(m.bestPosition)}). Cost ${costText(data.lookup.costUsd)}.` : `Looked up. Cost ${costText(data.lookup.costUsd)}.`, 'success');
      scrollToResult();
      loadSaved();
      onSpendChanged?.();
    } catch {
      addToast('The lookup could not be done. Check your connection and try again.', 'error');
    } finally {
      setBusy(false);
      stopProcessing();
    }
  }
  const lookUp = (e) => { e?.preventDefault(); runLookup(); };
  // Find my site: the top 100 without the AI summary (the cheapest search that goes this deep), so a site on page 5 or 12 shows up
  const findMySite = () => runLookup({ depth: 100, aiOverview: false });

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
      const res = await api.delete('/api/serp-tracker/lookups', all ? { all: true, siteId: siteId == null ? 'quick' : siteId } : { ids: [...selected] });
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
              {site ? ` Results are read for ${site.name || site.domain}, searched from ${site.locationName}.` : ' This is a Quick lookup: there is no site, so it cannot say where your own site is.'}
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
                    {DEPTHS.map((n) => <option key={n} value={n}>Top {n}{n >= 20 ? ` (about page ${n / 10})` : ''}</option>)}
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
            {(() => {
              const est = estimateCost(depth, ai, status?.pricing);
              const estFind = estimateCost(100, false, status?.pricing);
              return (
                <>
                  {est != null && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Expected cost of this search: up to about {costText(est)}. The real cost is shown afterwards{depth >= 50 ? ' (a short answer from Google costs less, but is tried again, so it can cost a little more in all)' : site ? ' (if your site is not found, the search is read again, up to three reads in all, so a miss can cost up to three times this)' : ''}.</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <Tooltip text="Searches Google now through DataForSEO. This is a paid search; the cost is shown when it finishes. The result is saved to the list.">
                      <button type="submit" disabled={!connected || !keyword.trim() || busy} data-guide="lookup-run"
                        className="px-3.5 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        {getIcon('search', { size: 14 })} Look up
                      </button>
                    </Tooltip>
                    <Tooltip text={site ? `Not in the top 10? This asks for the top 100 results for this site, without the AI summary${estFind != null ? `, up to about ${costText(estFind)}` : ''}, and tells you the position and about which page of Google it is on. Google often gives a short page, so a short answer is tried again (up to 4 times) and the result says how many results were really checked.` : 'Finding where your site sits needs a site. Add one on the Site setup tab; Quick lookups have no site.'}>
                      <button type="button" disabled={!connected || !keyword.trim() || !site || busy} onClick={findMySite} data-guide="find-my-site"
                        className="px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                        Find my site
                      </button>
                    </Tooltip>
                  </div>
                </>
              );
            })()}
          </form>
          {status && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Spent this month: {costText(status.spentThisMonthUsd)} of {costText(status.capUsd)}.</p>}
        </section>

        {result && (
          <section ref={resultRef} className="rounded-2xl border p-6" style={CARD} aria-label="Lookup result">
            <LookupResult lookup={result} busy={busy}
              onDeeper={site ? () => runLookup({ keyword: result.keyword, device: result.device, depth: 200, aiOverview: false }) : null}
              onRetry={site ? () => runLookup({ keyword: result.keyword, device: result.device, depth: result.depth, aiOverview: false }) : null} />
          </section>
        )}
      </div>

      <section className="rounded-2xl border p-6 space-y-4 min-w-0" style={CARD} aria-labelledby="saved-title" data-guide="saved-lookups">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="saved-title" className="text-base font-semibold truncate" style={{ color: 'var(--color-text)' }}>{site ? `Saved lookups for ${site.name || site.domain}` : 'Quick lookups'}</h2>
          <span className="text-xs shrink-0" style={{ color: 'var(--color-muted)' }}>latest 50 · newest first</span>
        </div>

        {saved === null ? <Skeleton lines={4} label="Loading saved lookups" /> : saved.length === 0 ? (
          <EmptyState icon="search" title="No saved lookups yet" body={site ? 'Look up a search for this site and it is kept here, so you can open it again later.' : 'Quick lookups are kept here, so you can open them again later.'} />
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
