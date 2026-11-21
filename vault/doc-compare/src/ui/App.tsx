import { TooltipHost } from '@planner-core/help/TooltipHost';
import { CONTEXT_TYPE, DOC_COMPARE_TOOLS, OPEN_TYPE, TOOL_BLURBS, VIEW_TYPE } from '@vault-client/pages/docCompare/docCompareTools.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { alignPages, compareLayout, PdfPair } from '../compare/layout';
import { readPair } from '../compare/read';
import { compareInWorker, similarityInWorker } from '../compare/workerClient';
import { GateError, type NormalizedDoc } from '../readers/types';
import type { Category, Change, ComparisonResult, SimilarityResult } from '../report/model';
import { SEVERITY } from '../report/severity';
import { loadSettings, saveSettings, type Settings } from '../settings';
import { DropZone } from './DropZone';
import { currentGuideTool, isView, openGuideTool, type GuideHooks } from './guide';
import { InfoModal, infoSeen } from './InfoModal';
import { PageViewer } from './PageViewer';
import { AuthorReviewButton, ChangesView, EmptyView, MetadataView, PagesView, ReportView, SummaryBar, useChangeFilters, type FilterPreset, type Layout, type ViewId } from './Results';
import { SettingsPanel } from './SettingsDrawer';
import { ReviewView } from './ReviewView';
import { defaultStore, pairKeyOf, type DecisionStore } from '../review/decisions';
import { progress, reviewItems, verdictOf, type Decision, type Decisions } from '../review/verdict';
import { defaultChecks, toFile, upsertCheck, type CheckStore, type SavedCheck } from '../review/savedChecks';
import { SavedChecksView } from './SavedChecksView';

type Phase = 'idle' | 'reading' | 'similarity' | 'gate2' | 'comparing' | 'done';

export const APP_VERSION = '0.2.0';
// Inside Vault, the page around this app draws the tool list, the job screen and the (i) box, and picks the view; standalone, the app does.
const embedded = window.parent !== window;

/** Scrolls to a part marked data-guide="<id>" and flashes it. */
function showPart(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-guide="${id}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  el.classList.remove('guide-flash'); void el.offsetWidth; el.classList.add('guide-flash');
  window.setTimeout(() => el.classList.remove('guide-flash'), 1800);
  return true;
}

export function App() {
  const [view, setViewState] = useState<ViewId>('compare');
  const selfMove = useRef(false); // true when the app changed view by itself (Vault's tool list then follows)
  const [original, setOriginal] = useState<File>();
  const [edited, setEdited] = useState<File>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();
  const [docs, setDocs] = useState<[NormalizedDoc, NormalizedDoc]>();
  const [sim, setSim] = useState<SimilarityResult>();
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<ComparisonResult>();
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [infoOpen, setInfoOpen] = useState(() => !embedded && !infoSeen());
  const [toast, setToast] = useState<string>();
  const [layout, setLayout] = useState<Layout>({ status: 'off', done: 0, total: 0, pages: [] });
  const [viewerPage, setViewerPage] = useState<number>();
  const pdfPair = useRef<PdfPair>(undefined);
  const layoutSignal = useRef({ cancelled: false });
  const runId = useRef(0);
  const toastTimer = useRef<number>(undefined);
  // review decisions (addendum §6.2): kept in this browser per pair of files
  const [store, setStore] = useState<DecisionStore>();
  const [pairKey, setPairKey] = useState<string>();
  const [decisions, setDecisions] = useState<Decisions>({});
  useEffect(() => { void defaultStore().then(setStore); }, []);
  // saved checks: every comparison, with a label, kept in this browser so it can be opened again
  const [checkStore, setCheckStore] = useState<CheckStore>();
  const [checks, setChecks] = useState<SavedCheck[]>([]);
  const [savedId, setSavedId] = useState<string>();
  const [label, setLabel] = useState('');
  const refreshChecks = async (s = checkStore) => { if (s) setChecks(await s.list().catch(() => [])); };
  useEffect(() => { void defaultChecks().then((s) => { setCheckStore(s); void refreshChecks(s); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = (key: string, d: Decision | null) => {
    setDecisions((prev) => {
      const next = { ...prev };
      if (d) next[key] = { decision: d, decidedAt: new Date().toISOString() }; else delete next[key];
      if (store && pairKey) void store.save(pairKey, next).catch(() => say('Could not save that decision in this browser.'));
      return next;
    });
  };
  const decideMany = (keys: string[]) => {
    setDecisions((prev) => {
      const at = new Date().toISOString();
      const next = { ...prev };
      for (const k of keys) next[k] = { decision: 'accept', decidedAt: at };
      if (store && pairKey) void store.save(pairKey, next).catch(() => say('Could not save those decisions in this browser.'));
      return next;
    });
  };

  const setView = (v: ViewId, self = true) => { selfMove.current = self; setViewState(v); window.scrollTo(0, 0); };
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s); };
  const say = (text: string) => { setToast(text); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(undefined), 6000); };

  const reset = () => {
    runId.current++;
    layoutSignal.current.cancelled = true;
    pdfPair.current?.destroy(); pdfPair.current = undefined;
    setPhase('idle'); setError(undefined); setDocs(undefined); setSim(undefined); setOverride(false); setResult(undefined);
    setPairKey(undefined); setDecisions({});
    setLayout({ status: 'off', done: 0, total: 0, pages: [] }); setViewerPage(undefined);
  };

  // a new file after a saved check means a new check: its label must not carry over (a label typed before choosing files is kept)
  const pick = (which: 'original' | 'edited', f: File | undefined) => {
    reset();
    if (savedId) { setSavedId(undefined); setLabel(''); }
    (which === 'original' ? setOriginal : setEdited)(f);
  };

  // the two files of the comparison in progress (a saved check is opened and compared in one click, before state updates land)
  const filesRef = useRef<[File, File]>(undefined);

  async function start(o = original, e = edited) {
    if (!o || !e) return;
    reset();
    filesRef.current = [o, e];
    const id = runId.current;
    try {
      setPhase('reading');
      const pair = await readPair(o, e);
      if (id !== runId.current) return;
      setDocs(pair);
      setPhase('similarity');
      const s = await similarityInWorker(pair[0], pair[1]);
      if (id !== runId.current) return;
      setSim(s);
      if (s.score < settings.similarityThreshold) { setPhase('gate2'); return; }
      await compare(pair, id);
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof GateError ? e.message : `Something went wrong: ${(e as Error)?.message ?? e}`);
      setPhase('idle');
    }
  }

  async function compare(pair: [NormalizedDoc, NormalizedDoc], id: number) {
    setPhase('comparing');
    const r = await compareInWorker(pair[0], pair[1], settings);
    if (id !== runId.current) return;
    // earlier decisions for these exact two files (same hashes), so a reload or a re-run keeps them
    const [o, e] = filesRef.current!;
    let saved: Decisions = {};
    let key: string | undefined;
    try {
      key = await pairKeyOf(o, e);
      if (store) saved = await store.load(key);
    } catch { /* decisions start empty */ }
    if (id !== runId.current) return;
    setPairKey(key);
    setDecisions(saved);
    setResult(r);
    setPhase('done');
    // every comparison is saved with its label, so it can be found and opened again (one saved check per pair of files)
    if (key && checkStore) {
      try {
        const c = await upsertCheck(checkStore, { pairKey: key, label, original: o, edited: e, sourceType: pair[0].sourceType });
        setSavedId(c.id); setLabel(c.label);
        void refreshChecks();
      } catch { say('This check could not be saved in this browser.'); }
    }
    if (!embedded) setView('review'); // verdict first (inside Vault, the page around the app picks the next tool)
    if (pair[0].sourceType === 'pdf' && pair[0].pages && pair[1].pages) {
      const big = Math.max(pair[0].pages.length, pair[1].pages.length) > settings.maxPagesForLayout;
      if (big) setLayout({ status: 'waiting', done: 0, total: 0, pages: [] });
      else void runLayout(pair, id);
    }
  }

  async function runLayout(pair = docs!, id = runId.current) {
    const files = filesRef.current;
    if (!files) return;
    const pages = alignPages(pair[0].pages!, pair[1].pages!);
    setLayout({ status: 'running', done: 0, total: pages.length, pages: [] });
    layoutSignal.current = { cancelled: false };
    try {
      pdfPair.current ??= await PdfPair.open(files[0], files[1]);
      const out = await compareLayout(pdfPair.current, pages, settings.layoutPixelRatio, (done, total) => { if (id === runId.current) setLayout((l) => ({ ...l, done, total })); }, layoutSignal.current);
      if (id === runId.current) setLayout({ status: 'done', done: pages.length, total: pages.length, pages: out });
    } catch (e) {
      if (id === runId.current) setLayout((l) => ({ ...l, status: 'error', error: (e as Error)?.message ?? String(e) }));
    }
  }

  // trivial-change rules and thresholds change the result: re-run the (fast) comparison on the docs already read
  const firstSettings = useRef(true);
  useEffect(() => {
    if (firstSettings.current) { firstSettings.current = false; return; }
    if (phase !== 'done' || !docs) return;
    const id = runId.current;
    compareInWorker(docs[0], docs[1], settings).then((r) => { if (id === runId.current) setResult(r); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.trivial, settings.fileSizeChangePct, settings.wordCountDropPct, settings.wordLimit, settings.pageLimit, settings.excludeReferences, settings.includeFootnotes, settings.requiredHeadings, settings.glossary]);

  useEffect(() => () => pdfPair.current?.destroy(), []);

  const layoutChanges: Change[] = useMemo(() => {
    let id = 1 + Math.max(0, ...(result?.changes ?? []).flatMap((c) => [c.id, ...(c.children ?? []).map((k) => k.id)]));
    return layout.pages.filter((p) => p.ratio > settings.layoutPixelRatio).map((p) => ({
      id: id++,
      category: 'layout' as const,
      severity: SEVERITY.layout,
      location: p.a && p.b ? (p.a === p.b ? `Page ${p.a}` : `Page ${p.a} → ${p.b} (edited)`) : p.a ? `Page ${p.a}` : `Page ${p.b} (edited)`,
      detail: p.a && p.b ? `${(p.ratio * 100).toFixed(1)}% of the page's pixels changed` : p.a ? 'Page only in the original' : 'Page only in the edited file',
      page: p.a ?? p.b,
    }));
  }, [layout.pages, result, settings.layoutPixelRatio]);

  const all = useMemo(() => [...(result?.changes ?? []), ...layoutChanges], [result, layoutChanges]);
  const filters = useChangeFilters(all, settings.showTrivial);

  // keep the saved check's verdict and progress in step with the decisions, for the Saved checks list
  useEffect(() => {
    if (!checkStore || !savedId || phase !== 'done' || !result) return;
    const items = reviewItems(all, decisions);
    const p = progress(items);
    const verdict = verdictOf(items);
    const counts = { red: items.filter((i) => i.tier === 'red').length, amber: items.filter((i) => i.tier === 'amber').length, decided: p.decided, total: p.total };
    void checkStore.get(savedId).then(async (c) => {
      if (!c || (c.verdict === verdict && JSON.stringify(c.counts) === JSON.stringify(counts))) return;
      await checkStore.put({ ...c, verdict, counts });
      void refreshChecks();
    }).catch(() => {});
  }, [decisions, result, savedId, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSaved = (c: SavedCheck) => {
    const o = toFile(c.original), e = toFile(c.edited);
    setOriginal(o); setEdited(e); setLabel(c.label); setSavedId(c.id);
    setView('compare');
    void start(o, e);
  };
  const renameSaved = async (c: SavedCheck, newLabel: string) => {
    if (!checkStore) return;
    await checkStore.put({ ...c, label: newLabel });
    if (c.id === savedId) setLabel(newLabel);
    void refreshChecks();
    say(`Renamed to "${newLabel}".`);
  };
  const deleteSaved = async (c: SavedCheck) => {
    if (!checkStore) return;
    await checkStore.remove(c.id);
    await store?.remove(c.pairKey).catch(() => {});
    if (c.id === savedId) setSavedId(undefined);
    void refreshChecks();
    say(`Deleted "${c.label}" and its decisions from this browser.`);
  };

  const busy = phase === 'reading' || phase === 'similarity' || phase === 'comparing';
  const stage = { reading: 'Reading both files…', similarity: 'Checking they are the same document…', comparing: 'Comparing content and formatting…' }[phase as 'reading'];
  const isPdf = docs?.[0].sourceType === 'pdf';
  const hasResults = phase === 'done' && !!result;
  const openPage = (p: number) => { if (pdfPair.current && layout.status === 'done') setViewerPage(p); else say('The page viewer opens once the page check has finished.'); };
  const goChanges = (preset?: FilterPreset) => { if (preset) filters.apply(preset); setView('changes'); };

  // ---- Vault's page around this app: it switches views (tool list, job steps) and shows parts (guide's Open buttons). Same origin only.
  const hooks = useRef<GuideHooks>(undefined);
  hooks.current = {
    openInfo: () => setInfoOpen(true),
    setView: (v) => setView(v, false),
    later: (fn) => window.setTimeout(fn, 60),
    openViewer: () => { if (layout.status !== 'done' || !pdfPair.current) return false; setViewerPage(layoutChanges[0]?.page ?? 1); return true; },
    show: showPart,
    toast: say,
    hasResults: () => hasResults,
    isPdf: () => !!isPdf,
  };
  const applyPreset = useRef(filters.apply);
  applyPreset.current = filters.apply;
  useEffect(() => {
    if (!embedded) return undefined;
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || ev.source !== window.parent) return;
      const d = ev.data as { type?: unknown; id?: unknown; view?: unknown; filter?: FilterPreset } | null;
      if (!d || !hooks.current) return;
      if (d.type === VIEW_TYPE && isView(d.view)) {
        setViewerPage(undefined);
        if (d.filter && typeof d.filter === 'object') applyPreset.current(d.filter);
        hooks.current.setView(d.view);
      } else if (d.type === OPEN_TYPE && typeof d.id === 'string') {
        setViewerPage(undefined);
        openGuideTool(d.id, hooks.current);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const guideTool = currentGuideTool({ info: infoOpen, viewer: viewerPage !== undefined, gate2: phase === 'gate2', error: !!error, view });
  useEffect(() => {
    if (!embedded) return;
    const cause = selfMove.current ? 'self' : 'vault';
    selfMove.current = false;
    try { window.parent.postMessage({ type: CONTEXT_TYPE, tool: guideTool, view, results: hasResults, pdf: !!isPdf, cause }, window.location.origin); } catch { /* the guide must never break the app */ }
  }, [guideTool, view, hasResults, isPdf]);

  const needResults = (title: string) => <EmptyView title={title} text="Choose the original and the edited file in Compare documents and press Compare. The results appear here." onAction={() => setView('compare')} />;

  return (
    <div className={`app${embedded ? ' embedded' : ''}`}>
      <TooltipHost look="vault" />
      {!embedded && (
        <header className="top">
          <div>
            <h1>DocCompare</h1>
            <p className="muted">Compare an original document with an LLM-edited version and catch anything it skipped or changed.</p>
          </div>
          <div className="top-actions">
            <span className="privacy" tabIndex={0} title="Both files are read and compared inside this browser tab. Nothing is uploaded or sent to an AI model; each check is saved in this browser only.">🔒 Files never leave your computer</span>
            <button className="btn icon" onClick={() => setInfoOpen(true)} aria-label="How DocCompare works" title="How DocCompare works: what it checks, how to read the results, and what it cannot do.">ⓘ</button>
          </div>
          <nav className="tabs" aria-label="Tools">
            {DOC_COMPARE_TOOLS.map((t) => (
              <button key={t.id} className={`tab${view === t.id ? ' active' : ''}`} aria-current={view === t.id ? 'page' : undefined} onClick={() => setView(t.id as ViewId)} title={TOOL_BLURBS[t.id]}>{t.label}</button>
            ))}
          </nav>
        </header>
      )}
      {embedded && <span className="privacy privacy-embedded" tabIndex={0} title="Both files are read and compared inside this browser tab. Nothing is uploaded or sent to an AI model; each check is saved in this browser only.">🔒 Files never leave your computer</span>}

      <main data-guide={view}>
        {view === 'compare' && (
          <>
            <div className="label-row" data-guide="check-label">
              <label className="field">Label (optional)
                <input value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder="e.g. Housing submission, draft 3" maxLength={120}
                  title="A name for this check, so you can find it again in Saved checks. Leave it empty to use the edited file's name and today's date." />
              </label>
              <label className="field narrow" data-guide="word-limit">Word limit (optional)
                <input type="number" min={1} step={50} value={settings.wordLimit ?? ''} placeholder="e.g. 3000"
                  onChange={(ev) => { const n = Number(ev.target.value); setSettings({ ...settings, wordLimit: ev.target.value && n > 0 ? Math.round(n) : null }); }}
                  title="The submission's word limit. If the edited version is over it, that is a red item. The reference list is not counted (change this in Settings)." />
              </label>
              {savedId && <span className="muted small">Saved as "{checks.find((c) => c.id === savedId)?.label ?? label}" · <button className="link" onClick={() => setView('saved')} title="See all your saved checks.">Saved checks</button></span>}
              {!savedId && checks.length > 0 && <button className="link" onClick={() => setView('saved')} title="Open a check you ran before.">Open a saved check ({checks.length})</button>}
            </div>
            <section className="drops" aria-label="Files to compare" data-guide="files">
              <DropZone label="Original" hint="The document before the AI edited it." file={original} onFile={(f) => pick('original', f)} />
              <DropZone label="Edited (LLM output)" hint="The version the AI produced." file={edited} onFile={(f) => pick('edited', f)} />
            </section>
            <div className="compare-row" data-guide="compare-button">
              <button className="btn primary" disabled={!original || !edited || busy} onClick={() => void start()} title={!original || !edited ? 'Choose both files first.' : 'Compare the two files. Nothing leaves this browser tab.'}>{busy ? 'Comparing…' : hasResults ? 'Compare again' : 'Compare'}</button>
              {busy && <span className="progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{stage}</span>}
            </div>
            {error && <div className="gate gate-stop" role="alert" data-guide="file-check"><strong>Can't compare these files.</strong> {error}</div>}
            {phase === 'gate2' && sim && docs && (
              <div className="gate gate-warn" role="alertdialog" aria-labelledby="g2-title" data-guide="same-document">
                <h2 id="g2-title">These look like different documents</h2>
                <p>{sim.reasons[0] ? `(${sim.reasons[0][0].toLowerCase()}${sim.reasons[0].slice(1)}) ` : ''}Check you've picked the right files.</p>
                {sim.reasons.length > 1 && <ul>{sim.reasons.slice(1).map((r) => <li key={r}>{r}</li>)}</ul>}
                <p className="muted small">Similarity {sim.score} out of 100; below {settings.similarityThreshold} counts as different.</p>
                <div className="row">
                  <button className="btn" onClick={reset} title="Stop here and choose different files.">Cancel</button>
                  <button className="btn primary" onClick={() => { setOverride(true); void compare(docs, runId.current); }} title="Compare them anyway. The report will say this check was overridden.">Compare anyway</button>
                </div>
              </div>
            )}
            {hasResults && sim && (
              <section className="done-card" aria-label="Result">
                <h2>Comparison done</h2>
                <SummaryBar all={all} layoutChanges={layoutChanges} result={result!} settings={settings} onShowTrivial={(v) => setSettings({ ...settings, showTrivial: v })} onPick={(cat?: Category) => goChanges({ categories: cat ? [cat] : [] })} />
                <p className="gate-summary muted">File types match ✓ · Similarity {sim.score}/100{sim.score < settings.similarityThreshold && override ? ' · compared anyway (below threshold)' : ''}{isPdf && layout.status === 'running' ? ` · comparing pages ${layout.done}/${layout.total}…` : ''}</p>
                <div className="row">
                  <button className="btn primary" onClick={() => setView('review')} title="Is it ready to submit? The verdict and a card for each change to decide.">See the verdict</button>
                  <button className="btn" onClick={() => goChanges()} title="See every change in a table you can filter, search and sort.">All changes</button>
                  <button className="btn" onClick={() => setView('metadata')} title="Compare the two files' size, dates, author and counts.">File details</button>
                  {isPdf && <button className="btn" onClick={() => setView('pages')} title="See which PDF pages look different, side by side.">PDF pages</button>}
                  <AuthorReviewButton all={all} trivialCount={result!.trivialCount} fileNames={[original!.name, edited!.name]} sim={sim} override={override} decisions={decisions} primary={false} />
                  <button className="btn" onClick={() => setView('report')} title="Download a PDF of this comparison for your own records.">PDF report</button>
                </div>
              </section>
            )}
          </>
        )}

        {view === 'review' && (hasResults ? (
          <ReviewView
            changes={all}
            words={result!.words}
            decisions={decisions}
            persistent={!!store?.persistent}
            onDecide={decide}
            onDismissSimilar={decideMany}
            onShowAll={() => goChanges({})}
            onShowIn={(c) => { filters.clear(); filters.setSearch(c.location); setView('changes'); }}
            say={say}
          />
        ) : needResults('No verdict yet'))}

        {view === 'changes' && (hasResults ? (
          <>
            <SummaryBar all={all} layoutChanges={layoutChanges} result={result!} settings={settings} onShowTrivial={(v) => setSettings({ ...settings, showTrivial: v })} onPick={(cat?: Category) => filters.apply({ categories: cat ? [cat] : [] })} activeCats={filters.cats} />
            <ChangesView all={all} f={filters} isPdf={!!isPdf} onOpenPage={openPage} />
          </>
        ) : needResults('No changes to show yet'))}

        {view === 'metadata' && (hasResults ? <MetadataView result={result!} /> : needResults('No file details yet'))}

        {view === 'pages' && (!hasResults ? needResults('No pages to show yet')
          : !isPdf ? <EmptyView title="PDF pages is for PDF files" text="These files are not PDFs, so there are no pages to draw. Their changes are all in Changes." onAction={() => setView('changes')} action="Go to Changes" />
            : <PagesView layout={layout} threshold={settings.layoutPixelRatio} maxPages={settings.maxPagesForLayout} onRunLayout={() => void runLayout()} onOpenPage={openPage} />)}

        {view === 'report' && (hasResults && sim ? (
          <ReportView result={result!} all={all} layoutChanges={layoutChanges} layout={layout} sim={sim} override={override} settings={settings} fileNames={[original!.name, edited!.name]} f={filters} decisions={decisions} onEditFilters={() => setView('changes')} />
        ) : needResults('Nothing to report yet'))}

        {view === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} />}

        {view === 'saved' && (
          <SavedChecksView
            checks={checks}
            currentId={savedId}
            persistent={!!checkStore?.persistent}
            onOpen={openSaved}
            onRename={(c, l) => void renameSaved(c, l)}
            onDelete={(c) => void deleteSaved(c)}
            onNew={() => { pick('original', undefined); setEdited(undefined); setLabel(''); setView('compare'); }}
          />
        )}
      </main>

      {viewerPage !== undefined && pdfPair.current && (
        <PageViewer pair={pdfPair.current} pages={layout.pages} start={viewerPage} threshold={settings.layoutPixelRatio} onClose={() => setViewerPage(undefined)} />
      )}
      {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} />}
      <div className="toast" role="status" aria-live="polite">{toast && <span>{toast}</span>}</div>
    </div>
  );
}
