import { TooltipHost } from '@planner-core/help/TooltipHost';
import { CONTEXT_TYPE, OPEN_TYPE } from '@vault-client/pages/docCompare/docCompareTools.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { alignPages, compareLayout, PdfPair, type LayoutPage } from '../compare/layout';
import { readPair } from '../compare/read';
import { compareInWorker, similarityInWorker } from '../compare/workerClient';
import { GateError, type NormalizedDoc } from '../readers/types';
import type { Change, ComparisonResult, SimilarityResult } from '../report/model';
import { SEVERITY } from '../report/severity';
import { loadSettings, saveSettings, type Settings } from '../settings';
import { DropZone } from './DropZone';
import { currentGuideTool, openGuideTool } from './guide';
import { InfoModal, infoSeen } from './InfoModal';
import { PageViewer } from './PageViewer';
import { Results } from './Results';
import { SettingsDrawer } from './SettingsDrawer';

type Phase = 'idle' | 'reading' | 'similarity' | 'gate2' | 'comparing' | 'done';
type Layout = { status: 'off' | 'waiting' | 'running' | 'done' | 'error'; done: number; total: number; pages: LayoutPage[]; error?: string };

export const APP_VERSION = '0.1.0';
const embedded = window.parent !== window;

/** Scrolls to a part marked data-guide="<id>" and flashes it; opens it if it is a fold-out. */
function showPart(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-guide="${id}"]`);
  if (!el) return false;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  el.classList.remove('guide-flash'); void el.offsetWidth; el.classList.add('guide-flash');
  window.setTimeout(() => el.classList.remove('guide-flash'), 1800);
  return true;
}

export function App() {
  const [original, setOriginal] = useState<File>();
  const [edited, setEdited] = useState<File>();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>();
  const [docs, setDocs] = useState<[NormalizedDoc, NormalizedDoc]>();
  const [sim, setSim] = useState<SimilarityResult>();
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState<ComparisonResult>();
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(() => !infoSeen());
  const [toast, setToast] = useState<string>();
  const [layout, setLayout] = useState<Layout>({ status: 'off', done: 0, total: 0, pages: [] });
  const [viewerPage, setViewerPage] = useState<number>();
  const pdfPair = useRef<PdfPair>(undefined);
  const layoutSignal = useRef({ cancelled: false });
  const runId = useRef(0);
  const toastTimer = useRef<number>(undefined);

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

  const busy = phase === 'reading' || phase === 'similarity' || phase === 'comparing';
  const stage = { reading: 'Reading both files…', similarity: 'Checking they are the same document…', comparing: 'Comparing content and formatting…' }[phase as 'reading'];
  const isPdf = docs?.[0].sourceType === 'pdf';
  const hasResults = phase === 'done' && !!result;

  // ---- Vault's guide chat (in the page around this app): it asks us to show parts, and is told which part the person is on. Same origin only.
  const hooks = useRef<Parameters<typeof openGuideTool>[1]>(undefined);
  hooks.current = {
    openInfo: () => setInfoOpen(true),
    openSettings: () => setSettingsOpen(true),
    openViewer: () => { if (layout.status !== 'done' || !pdfPair.current) return false; setViewerPage(layoutChanges[0]?.page ?? 1); return true; },
    show: showPart,
    toast: say,
    hasResults: () => hasResults,
    isPdf: () => !!isPdf,
  };
  useEffect(() => {
    if (!embedded) return undefined;
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin || ev.source !== window.parent) return;
      const d = ev.data as { type?: unknown; id?: unknown } | null;
      if (!d || d.type !== OPEN_TYPE || typeof d.id !== 'string' || !hooks.current) return;
      setSettingsOpen(false); setInfoOpen(false); setViewerPage(undefined);
      const id = d.id;
      // let the closed panels leave the page before scrolling
      window.setTimeout(() => { if (hooks.current) openGuideTool(id, hooks.current); }, 0);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const guideTool = currentGuideTool({ info: infoOpen, settings: settingsOpen, viewer: viewerPage !== undefined, gate2: phase === 'gate2', error: !!error, results: hasResults });
  useEffect(() => {
    if (!embedded) return;
    try { window.parent.postMessage({ type: CONTEXT_TYPE, tool: guideTool }, window.location.origin); } catch { /* the guide must never break the app */ }
  }, [guideTool]);

  return (
    <div className="app">
      <TooltipHost look="vault" />
      <header className="top">
        <div>
          <h1>DocCompare</h1>
          <p className="muted">Compare an original document with an LLM-edited version and catch anything it skipped or changed.</p>
        </div>
        <div className="top-actions">
          <span className="privacy" tabIndex={0} title="Both files are read and compared inside this browser tab. Nothing is uploaded, sent to an AI model or saved.">🔒 Files never leave your computer</span>
          <button className="btn icon" onClick={() => setInfoOpen(true)} aria-label="How DocCompare works" title="How DocCompare works: what it checks, how to read the results, and what it cannot do." data-guide="info">ⓘ</button>
          <button className="btn" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" data-guide="settings" title="Settings: the same-document threshold, when file size and word count are flagged, and which differences count as trivial.">Settings</button>
        </div>
      </header>

      <section className="drops" aria-label="Files to compare" data-guide="files">
        <DropZone label="Original" hint="The document before the AI edited it." file={original} onFile={(f) => pick('original', f)} />
        <DropZone label="Edited (LLM output)" hint="The version the AI produced." file={edited} onFile={(f) => pick('edited', f)} />
      </section>

      <div className="compare-row" data-guide="compare">
        <button className="btn primary" disabled={!original || !edited || busy} onClick={start} title={!original || !edited ? 'Choose both files first.' : 'Compare the two files. Nothing leaves this browser tab.'}>{busy ? 'Comparing…' : 'Compare'}</button>
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

      {hasResults && docs && sim && (
        <Results
          result={result!}
          layoutChanges={layoutChanges}
          layout={layout}
          isPdf={isPdf}
          sim={sim}
          override={override}
          settings={settings}
          onShowTrivial={(v) => setSettings({ ...settings, showTrivial: v })}
          fileNames={[original!.name, edited!.name]}
          onRunLayout={() => void runLayout()}
          onOpenPage={(p) => setViewerPage(p)}
        />
      )}

      {viewerPage !== undefined && pdfPair.current && (
        <PageViewer pair={pdfPair.current} pages={layout.pages} start={viewerPage} threshold={settings.layoutPixelRatio} onClose={() => setViewerPage(undefined)} />
      )}

      {settingsOpen && <SettingsDrawer settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
      {infoOpen && <InfoModal onClose={() => setInfoOpen(false)} />}
      <div className="toast" role="status" aria-live="polite">{toast && <span>{toast}</span>}</div>
    </div>
  );
}
