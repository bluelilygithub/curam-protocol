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

  const setView = (v: ViewId, self = true) => { selfMove.current = self; setViewState(v); window.scrollTo(0, 0); };
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s); };
  const say = (text: string) => { setToast(text); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(undefined), 6000); };

  const reset = () => {
    runId.current++;
    layoutSignal.current.cancelled = true;
    pdfPair.current?.destroy(); pdfPair.current = undefined;
    setPhase('idle'); setError(undefined); setDocs(undefined); setSim(undefined); setOverride(false); setResult(undefined);
    setLayout({ status: 'off', done: 0, total: 0, pages: [] }); setViewerPage(undefined);
  };

  const pick = (which: 'original' | 'edited', f: File | undefined) => { reset(); (which === 'original' ? setOriginal : setEdited)(f); };

  async function start() {
    if (!original || !edited) return;
    reset();
    const id = runId.current;
    try {
      setPhase('reading');
      const pair = await readPair(original, edited);
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
    setResult(r);
    setPhase('done');
    if (pair[0].sourceType === 'pdf' && pair[0].pages && pair[1].pages) {
      const big = Math.max(pair[0].pages.length, pair[1].pages.length) > settings.maxPagesForLayout;
      if (big) setLayout({ status: 'waiting', done: 0, total: 0, pages: [] });
      else void runLayout(pair, id);
    }
  }

  async function runLayout(pair = docs!, id = runId.current) {
    if (!original || !edited) return;
    const pages = alignPages(pair[0].pages!, pair[1].pages!);
    setLayout({ status: 'running', done: 0, total: pages.length, pages: [] });
    layoutSignal.current = { cancelled: false };
    try {
      pdfPair.current ??= await PdfPair.open(original, edited);
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
  }, [settings.trivial, settings.fileSizeChangePct, settings.wordCountDropPct]);

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
            <span className="privacy" tabIndex={0} title="Both files are read and compared inside this browser tab. Nothing is uploaded, sent to an AI model or saved.">🔒 Files never leave your computer</span>
            <button className="btn icon" onClick={() => setInfoOpen(true)} aria-label="How DocCompare works" title="How DocCompare works: what it checks, how to read the results, and what it cannot do.">ⓘ</button>
          </div>
          <nav className="tabs" aria-label="Tools">
            {DOC_COMPARE_TOOLS.map((t) => (
              <button key={t.id} className={`tab${view === t.id ? ' active' : ''}`} aria-current={view === t.id ? 'page' : undefined} onClick={() => setView(t.id as ViewId)} title={TOOL_BLURBS[t.id]}>{t.label}</button>
            ))}
          </nav>
        </header>
      )}
      {embedded && <span className="privacy privacy-embedded" tabIndex={0} title="Both files are read and compared inside this browser tab. Nothing is uploaded, sent to an AI model or saved.">🔒 Files never leave your computer</span>}

      <main data-guide={view}>
        {view === 'compare' && (
          <>
            <section className="drops" aria-label="Files to compare" data-guide="files">
              <DropZone label="Original" hint="The document before the AI edited it." file={original} onFile={(f) => pick('original', f)} />
              <DropZone label="Edited (LLM output)" hint="The version the AI produced." file={edited} onFile={(f) => pick('edited', f)} />
            </section>
            <div className="compare-row" data-guide="compare-button">
              <button className="btn primary" disabled={!original || !edited || busy} onClick={start} title={!original || !edited ? 'Choose both files first.' : 'Compare the two files. Nothing leaves this browser tab.'}>{busy ? 'Comparing…' : hasResults ? 'Compare again' : 'Compare'}</button>
              {busy && <span className="progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{stage}</span>}
            </div>
            {error && <div className="gate gate-stop" role="alert" data-guide="file-check"><strong>Can't compare these files.</strong> {error}</div>}
            {phase === 'gate2' && sim && docs && (
              <div className="gate gate-warn" role="alertdialog" aria-labelledby="g2-title" data-guide="same-document">
                <h2 id="g2-title">These files may not be versions of the same document</h2>
                <p>Similarity score <strong>{sim.score}</strong> / 100 (threshold {settings.similarityThreshold}).</p>
                {sim.reasons.length > 0 && <ul>{sim.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
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
                  <button className="btn primary" onClick={() => goChanges()} title="See every change in a table you can filter, search and sort.">See all changes</button>
                  <button className="btn" onClick={() => setView('metadata')} title="Compare the two files' size, dates, author and counts.">File details</button>
                  {isPdf && <button className="btn" onClick={() => setView('pages')} title="See which PDF pages look different, side by side.">PDF pages</button>}
                  <AuthorReviewButton all={all} trivialCount={result!.trivialCount} fileNames={[original!.name, edited!.name]} sim={sim} override={override} primary={false} />
                  <button className="btn" onClick={() => setView('report')} title="Download a PDF of this comparison for your own records.">PDF report</button>
                </div>
              </section>
            )}
          </>
        )}

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
          <ReportView result={result!} all={all} layoutChanges={layoutChanges} layout={layout} sim={sim} override={override} settings={settings} fileNames={[original!.name, edited!.name]} f={filters} onEditFilters={() => setView('changes')} />
        ) : needResults('Nothing to report yet'))}

        {view === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} />}
      </main>

      {viewerPage !== undefined && pdfPair.current && (
        <PageViewer pair={pdfPair.current} pages={layout.pages} start={viewerPage} threshold={settings.layoutPixelRatio} onClose={() => setViewerPage(undefined)} />
      )}
      {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} />}
      <div className="toast" role="status" aria-live="polite">{toast && <span>{toast}</span>}</div>
    </div>
  );
}
