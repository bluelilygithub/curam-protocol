import { TooltipHost } from '@planner-core/help/TooltipHost';
import { CONTEXT_TYPE, DOC_COMPARE_TOOLS, OPEN_TYPE, TOOL_BLURBS, VIEW_TYPE } from '@vault-client/pages/docCompare/docCompareTools.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { alignPages, compareLayout, PdfPair } from '../compare/layout';
import { readPair } from '../compare/read';
import { compareInWorker, similarityInWorker } from '../compare/workerClient';
import { GateError, type NormalizedDoc } from '../readers/types';
import type { Category, Change, ComparisonResult, SimilarityResult } from '../report/model';
import { SEVERITY } from '../report/severity';
import { loadSettings, saveSettings, VERSIONS_SIMILARITY, type Settings } from '../settings';
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
import { acceptMany, addRound, compact, createProject, decide as decideItem, deleteRounds, exportDue, fileOf, makeNewOriginal, recheckLatest, storeFile, timeline, type CompareFn } from '../project/engine';
import { defaultProjects, projectSize, PROJECT_WARN_MB, type Project, type ProjectStore } from '../project/model';
import { asCopy, exportName, exportProject, ImportError, importProject } from '../project/transfer';
import { itemIdOf, reviewable, summaryLine } from '../project/track';
import { itemKey } from '../review/verdict';
import type { ProjectReport } from '../report/pdfExport';
import { fmtSize, ProjectsView, type ImportConflict, type Quota } from './ProjectsView';
import { TimelineView } from './TimelineView';
import { VersionsView } from './VersionsView';
import { htmlReader } from '../readers/html';
import { downloadWord } from '../report/wordExport';
import { canFetchPages, requestPage } from '../web/fetchPage';

/** Saves a Blob as a file on this computer (the export of a project). */
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const newProjectId = () => globalThis.crypto?.randomUUID?.() ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

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

  // ---- projects (addendum §7): a clean copy of the original and every later draft as a round, kept in this browser ----
  const [projectStore, setProjectStore] = useState<ProjectStore>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>();
  const projectRef = useRef<Project>(undefined);
  const [roundNo, setRoundNo] = useState<number>(); // the round on screen; undefined = the latest
  const [roundOnly, setRoundOnly] = useState(false);
  const [asProject, setAsProject] = useState(true); // "Save as a project", ticked by default (§7.2)
  // "These are intentionally different versions" (§0.2): one-off comparisons only, never a project round
  const [versions, setVersions] = useState(false);
  const quickVersions = versions && !project;
  const threshold = quickVersions ? VERSIONS_SIMILARITY : settings.similarityThreshold;
  const [latestFile, setLatestFile] = useState<File>();
  const [note, setNote] = useState('');
  const [quota, setQuota] = useState<Quota>();
  const [conflict, setConflict] = useState<ImportConflict>();
  const [reminderHidden, setReminderHidden] = useState(false);
  const refreshProjects = async (s = projectStore) => { if (s) setProjects(await s.list().catch(() => [])); };
  const estimate = async () => { try { const e = await navigator.storage?.estimate?.(); if (e?.quota) setQuota({ usage: e.usage ?? 0, quota: e.quota }); } catch { /* not available: no meter */ } };
  useEffect(() => { void defaultProjects().then((s) => { setProjectStore(s); void refreshProjects(s); }); void estimate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveProject = async (p: Project) => {
    const sized = { ...p, sizeBytes: projectSize(p) };
    projectRef.current = sized;
    setProject(sized);
    try { await projectStore?.put(sized); } catch { say('This project could not be saved in this browser. Export it to keep a copy.'); }
    void refreshProjects(); void estimate();
    return sized;
  };
  // one change to the project at a time, each on the newest copy, so quick decisions never overwrite each other
  const projectQueue = useRef<Promise<void>>(Promise.resolve());
  const updateProject = (fn: (p: Project) => Promise<Project> | Project) => {
    projectQueue.current = projectQueue.current.then(async () => {
      const p = projectRef.current;
      if (!p) return;
      const next = await fn(p);
      if (next !== p) await saveProject(next);
    }).catch((e) => say(`That did not work: ${(e as Error)?.message ?? e}`));
    return projectQueue.current;
  };
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
  const setSettings = (s: Settings) => {
    setSettingsState(s); saveSettings(s);
    // a project keeps its own word limit, page limit, required headings and protected terms
    const p = projectRef.current;
    const mine = { wordLimit: s.wordLimit, pageLimit: s.pageLimit, requiredHeadings: s.requiredHeadings, glossary: s.glossary };
    if (p && JSON.stringify(mine) !== JSON.stringify({ ...mine, ...p.settings })) void updateProject((x) => ({ ...x, settings: mine }));
  };
  const compareFn: CompareFn = (a, b) => compareInWorker(a, b, settings);
  const say = (text: string) => { setToast(text); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(undefined), 6000); };

  const reset = () => {
    runId.current++;
    layoutSignal.current.cancelled = true;
    pdfPair.current?.destroy(); pdfPair.current = undefined;
    setPhase('idle'); setError(undefined); setDocs(undefined); setSim(undefined); setOverride(false); setResult(undefined);
    simRef.current = undefined; overrideRef.current = false;
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
  const simRef = useRef<SimilarityResult>(undefined);
  const overrideRef = useRef(false);

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
      simRef.current = s;
      if (s.score < threshold) { setPhase('gate2'); return; }
      await compare(pair, id);
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof GateError ? e.message : `Something went wrong: ${(e as Error)?.message ?? e}`);
      setPhase('idle');
    }
  }

  async function compare(pair: [NormalizedDoc, NormalizedDoc], id: number) {
    if (projectRef.current) return addRoundFlow(pair, id);
    if (asProject && !versions) return startProjectFlow(pair, id);
    setPhase('comparing');
    const r = await compareInWorker(pair[0], pair[1], settings, versions);
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
        const c = await upsertCheck(checkStore, { pairKey: key, label, original: o, edited: e, sourceType: pair[0].sourceType, versions });
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
    // a project: only its latest round is checked again (§7.8); earlier rounds keep the result they had
    if (projectRef.current) { void updateProject((p) => recheckLatest(p, compareFn)); return; }
    if (phase !== 'done' || !docs) return;
    const id = runId.current;
    compareInWorker(docs[0], docs[1], settings, versions).then((r) => { if (id === runId.current) setResult(r); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.trivial, settings.fileSizeChangePct, settings.wordCountDropPct, settings.wordLimit, settings.pageLimit, settings.excludeReferences, settings.includeFootnotes, settings.requiredHeadings, settings.glossary]);

  useEffect(() => () => pdfPair.current?.destroy(), []);


  // what is on screen: a quick comparison, or the project round chosen (its comparison with the accepted state, or with the previous round)
  const round = project?.rounds.find((r) => r.number === (roundNo ?? project.rounds[project.rounds.length - 1]?.number));
  const latestNo = project?.rounds[project.rounds.length - 1]?.number;
  const shown = project ? (round ? (roundOnly && round.vsPrevious ? round.vsPrevious : round.vsAccepted) : undefined) : result;
  // opening another project round: its page check (PDFs only) waits for a click, unless it was just run for this round
  useEffect(() => {
    if (!project || !round) return;
    const k = `${project.id}:${round.number}`;
    if (layoutKey.current === k) return;
    layoutKey.current = k;
    layoutSignal.current.cancelled = true;
    pdfPair.current?.destroy(); pdfPair.current = undefined;
    const o = fileOf(project.original), e = fileOf(round.file);
    if (o && e && project.original.doc.pages && round.file.doc.pages) {
      filesRef.current = [o, e];
      setDocs([project.original.doc, round.file.doc]);
      setLayout({ status: 'waiting', done: 0, total: 0, pages: [] });
    } else setLayout({ status: 'off', done: 0, total: 0, pages: [] });
  }, [project?.id, round?.number]); // eslint-disable-line react-hooks/exhaustive-deps

  const layoutChanges: Change[] = useMemo(() => {
    let id = 1 + Math.max(0, ...(shown?.changes ?? []).flatMap((c) => [c.id, ...(c.children ?? []).map((k) => k.id)]));
    return layout.pages.filter((p) => p.ratio > settings.layoutPixelRatio).map((p) => ({
      id: id++,
      category: 'layout' as const,
      severity: SEVERITY.layout,
      location: p.a && p.b ? (p.a === p.b ? `Page ${p.a}` : `Page ${p.a} → ${p.b} (edited)`) : p.a ? `Page ${p.a}` : `Page ${p.b} (edited)`,
      detail: p.a && p.b ? `${(p.ratio * 100).toFixed(1)}% of the page's pixels changed` : p.a ? 'Page only in the original' : 'Page only in the edited file',
      page: p.a ?? p.b,
    }));
  }, [layout.pages, shown, settings.layoutPixelRatio]);

  const all = useMemo(() => [...(shown?.changes ?? []), ...layoutChanges], [shown, layoutChanges]);
  const filters = useChangeFilters(all, settings.showTrivial);

  // keep the saved check's verdict and progress in step with the decisions, for the Saved checks list
  useEffect(() => {
    if (!checkStore || !savedId || phase !== 'done' || !result || versions) return; // versions: no verdict to keep
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
    setAsProject(false); setVersions(!!c.versions);
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

  // ---- project flows ----
  const layoutKey = useRef<string>(undefined); // which project round the page check belongs to
  const startLayout = (pair: [NormalizedDoc, NormalizedDoc], id: number) => {
    if (pair[0].sourceType !== 'pdf' || !pair[0].pages || !pair[1].pages) return;
    const big = Math.max(pair[0].pages.length, pair[1].pages.length) > settings.maxPagesForLayout;
    if (big) setLayout({ status: 'waiting', done: 0, total: 0, pages: [] });
    else void runLayout(pair, id);
  };
  const roundExtras = (p: Project): Project => {
    const last = p.rounds[p.rounds.length - 1];
    return last ? { ...p, rounds: [...p.rounds.slice(0, -1), { ...last, similarity: simRef.current ?? last.similarity, override: overrideRef.current }] } : p;
  };

  /** The first comparison with "Save as a project" ticked: the original becomes the project's clean copy, the edited file round 1. */
  async function startProjectFlow(pair: [NormalizedDoc, NormalizedDoc], id: number) {
    setPhase('comparing');
    const [o, e] = filesRef.current!;
    let p = createProject(await storeFile(o, pair[0]), label);
    p = { ...p, settings: { wordLimit: settings.wordLimit, pageLimit: settings.pageLimit, requiredHeadings: settings.requiredHeadings, glossary: settings.glossary } };
    const { project: withRound } = await addRound(p, await storeFile(e, pair[1]), compareFn, note);
    if (id !== runId.current) return;
    const saved = await saveProject(roundExtras(withRound));
    layoutKey.current = `${saved.id}:1`;
    setRoundNo(undefined); setRoundOnly(false); setNote(''); setLabel(''); setEdited(undefined); setLatestFile(undefined);
    setPhase('done');
    say(`Saved as the project "${saved.name}". Add each new draft as the next round.`);
    if (!embedded) setView('review');
    startLayout(pair, id);
  }

  /** A new draft in an open project: the next round, checked against the accepted state and the previous round (§7.2, §7.4). */
  async function addRoundFlow(pair: [NormalizedDoc, NormalizedDoc], id: number) {
    setPhase('comparing');
    const p = projectRef.current!;
    const r = await addRound(p, await storeFile(filesRef.current![1], pair[1]), compareFn, note);
    if (id !== runId.current) return;
    if (r.duplicateOf) {
      setPhase('idle');
      say(r.duplicateOf === 'original' ? 'This is the same file as the original, so it was not added.' : `This is the same file as round ${r.duplicateOf}, so it was not added again.`);
      return;
    }
    const saved = await saveProject(roundExtras(r.project));
    const n = saved.rounds[saved.rounds.length - 1].number;
    layoutKey.current = `${saved.id}:${n}`;
    setRoundNo(undefined); setRoundOnly(false); setNote(''); setLatestFile(undefined);
    setPhase('done');
    // the project already had results, so Vault's page would not move on by itself: go to the new round's verdict
    setView('review');
    startLayout(pair, id);
  }

  const openProject = (p: Project) => {
    reset();
    projectRef.current = p;
    setProject(p);
    setRoundNo(undefined); setRoundOnly(false); setReminderHidden(false);
    setOriginal(fileOf(p.original)); setEdited(undefined); setLatestFile(undefined); setNote('');
    if (p.settings) setSettingsState((s) => ({ ...s, ...p.settings }));
    setView(p.rounds.length ? 'review' : 'compare');
  };
  const closeProject = () => {
    reset();
    projectRef.current = undefined;
    setProject(undefined); setRoundNo(undefined); setRoundOnly(false); layoutKey.current = undefined;
    setOriginal(undefined); setEdited(undefined); setLatestFile(undefined); setLabel(''); setNote('');
    setView('compare');
  };
  // ---- web pages: inside Vault a box can fetch a page by its address (web/fetchPage.ts); the standalone build only takes files ----
  /** A page fetched as the original of a new check becomes a project at once: its dated snapshot is kept before any draft exists. */
  async function startPageProject(file: File, doc: NormalizedDoc) {
    reset();
    const p = createProject(await storeFile(file, doc), label.trim() || undefined);
    const saved = await saveProject({ ...p, settings: { wordLimit: settings.wordLimit, pageLimit: settings.pageLimit, requiredHeadings: settings.requiredHeadings, glossary: settings.glossary } });
    setLabel('');
    openProject(saved);
    say(`Saved the page, as it was at ${new Date(file.lastModified).toLocaleString('en-AU')}, as the original of the project "${saved.name}". Download it as Word to edit, then add your edited file as round 1.`);
  }
  const fetchInto = canFetchPages() ? {
    original: async (u: string) => { const page = await requestPage(u); if (asProject && !versions) await startPageProject(page.file, page.doc); else pick('original', page.file); },
    edited: async (u: string) => pick('edited', (await requestPage(u)).file),
    latest: async (u: string) => { const page = await requestPage(u); reset(); setLatestFile(page.file); },
  } : undefined;
  const isWebPage = (f?: File) => !!f && /\.(html?|xhtml)$/i.test(f.name);
  /** "Download as Word": the original web page's content as a .docx made here, to edit in Word and add back as a round. */
  const wordDownload = async (src: { doc?: NormalizedDoc; file?: File }, name: string) => {
    try { await downloadWord(src.doc ?? (await htmlReader.read(src.file!)), name); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const WORD_TIP = "Download the page's main content as a Word file (.docx), made here in this browser. Edit it in Word or Google Docs, keep it as .docx, and add it back as the next round: every check runs against this snapshot.";
  const putProject = async (p: Project) => { await projectStore?.put({ ...p, sizeBytes: projectSize(p) }); void refreshProjects(); void estimate(); };
  const exportOne = async (p: Project) => {
    try {
      download(await exportProject(p), exportName(p));
      const marked = { ...p, exportedAt: new Date().toISOString(), exportedAtRound: p.rounds.length };
      if (p.id === projectRef.current?.id) await updateProject((x) => ({ ...x, exportedAt: marked.exportedAt, exportedAtRound: marked.exportedAtRound }));
      else await putProject(marked);
      setReminderHidden(true);
      say(`Exported "${p.name}" as ${exportName(p)}. Keep it somewhere safe; Import project brings it back.`);
    } catch (e) { say(`Could not export this project: ${(e as Error)?.message ?? e}`); }
  };
  const importOne = async (f: File) => {
    try {
      const p = await importProject(f);
      const existing = projects.find((x) => x.id === p.id);
      if (existing) { setConflict({ incoming: p, existing }); return; }
      await putProject(p);
      say(`Imported "${p.name}" (${p.rounds.length} round${p.rounds.length === 1 ? '' : 's'}).`);
    } catch (e) { say(e instanceof ImportError ? e.message : `Could not import this file: ${(e as Error)?.message ?? e}`); }
  };
  const resolveImport = async (choice: 'both' | 'replace' | 'cancel') => {
    const c = conflict;
    setConflict(undefined);
    if (!c || choice === 'cancel') return;
    if (choice === 'both') { await putProject(asCopy(c.incoming, newProjectId())); say(`Imported as "${c.incoming.name} (imported)".`); return; }
    await putProject(c.incoming);
    if (projectRef.current?.id === c.incoming.id) openProject(c.incoming);
    say(`Replaced "${c.existing.name}" with the imported project.`);
  };
  const renameProject = async (p: Project, name: string) => {
    if (p.id === projectRef.current?.id) await updateProject((x) => ({ ...x, name }));
    else await putProject({ ...p, name });
    say(`Renamed to "${name}".`);
  };
  const deleteProject = async (p: Project) => {
    await projectStore?.remove(p.id);
    if (p.id === projectRef.current?.id) closeProject();
    void refreshProjects(); void estimate();
    say(`Deleted the project "${p.name}" and its files from this browser.`);
  };

  // decisions of the round on screen, in the form the review screen uses (keyed by each change's content)
  const projectDecisions = useMemo(() => {
    const d: Decisions = {};
    if (!round || roundOnly) return d;
    const byId = new Map(round.items.map((i) => [i.itemId, i]));
    for (const c of round.vsAccepted.changes) {
      const i = reviewable(c) ? byId.get(itemIdOf(c)) : undefined;
      if (i?.decision) d[itemKey(c)] = { decision: i.decision, decidedAt: i.decidedAt ?? '' };
    }
    return d;
  }, [round, roundOnly]);
  const shownDecisions = project ? projectDecisions : decisions;
  const decideInProject = (key: string, d: Decision | null) => {
    const c = round?.vsAccepted.changes.find((x) => itemKey(x) === key);
    if (!c || !round) return;
    const n = round.number;
    void updateProject((p) => decideItem(p, n, itemIdOf(c), d, compareFn));
  };
  const acceptManyInProject = (keys: string[]) => {
    const ids = (round?.vsAccepted.changes ?? []).filter((c) => keys.includes(itemKey(c))).map(itemIdOf);
    void updateProject((p) => acceptMany(p, ids));
  };
  const projectReport: ProjectReport | undefined = project && round ? {
    name: project.name,
    round: round.number,
    rounds: project.rounds.length,
    summary: round.number > 1 ? summaryLine(round.number, round.summary) : undefined,
    timeline: timeline(project).map((r) => ({ number: r.number, addedAt: r.addedAt, note: r.note, words: r.words, summary: r.number === 1 ? '-' : `${r.summary.fixed} / ${r.summary.notFixed} / ${r.summary.new}`, counts: `${r.counts.red} / ${r.counts.amber} / ${r.counts.info}`, verdict: r.verdict, largestLoss: r.largestLoss })),
    replacements: project.originalHistory.map((h) => ({ round: h.replacedByRound, at: h.replacedAt, reason: h.reason, absorbed: h.absorbed, items: h.absorbedItems })),
  } : undefined;
  const shownSim: SimilarityResult | undefined = project ? round?.similarity ?? sim : sim;
  const fileNames: [string, string] | undefined = project && round ? [project.original.name, round.file.name] : original && edited ? [original.name, edited.name] : undefined;

  const busy = phase === 'reading' || phase === 'similarity' || phase === 'comparing';
  const stage = { reading: 'Reading both files…', similarity: 'Checking they are the same document…', comparing: 'Comparing content and formatting…' }[phase as 'reading'];
  const isPdf = (project ? project.original.doc : docs?.[0])?.sourceType === 'pdf';
  const hasResults = project ? !!round : phase === 'done' && !!result;
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
    try { window.parent.postMessage({ type: CONTEXT_TYPE, tool: guideTool, view, results: hasResults, pdf: !!isPdf, versions: hasResults && quickVersions, cause }, window.location.origin); } catch { /* the guide must never break the app */ }
  }, [guideTool, view, hasResults, isPdf, quickVersions]);

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
            {project ? (
              <>
                <div className="project-head" data-guide="project-head">
                  <strong>Project: {project.name}</strong>
                  <span className="muted small">Original: {project.original.name} · {project.rounds.length} round{project.rounds.length === 1 ? '' : 's'}</span>
                  <button className="link" onClick={() => setView('timeline')} title="Every round of this project, with what was fixed and what is new.">Timeline</button>
                  <button className="link" onClick={closeProject} title="Leave this project (it stays in Projects) and start a new check.">Close project</button>
                </div>
                {exportDue(project) && !reminderHidden && (
                  <div className="gate gate-warn export-reminder" role="status" data-guide="export-reminder">
                    Your browser can clear saved files. Export your project to keep a copy.{' '}
                    <button className="btn" onClick={() => void exportOne(project)}>Export project</button> <button className="btn ghost" onClick={() => setReminderHidden(true)}>Not now</button>
                  </div>
                )}
                <div className="label-row">
                  <label className="field" data-guide="round-note">Note for this round (optional)
                    <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. Asked the LLM to fix the issues" maxLength={200}
                      title="A short note shown in the timeline, such as what you asked the LLM to do." />
                  </label>
                  <label className="field narrow" data-guide="word-limit">Word limit (optional)
                    <input type="number" min={1} step={50} value={settings.wordLimit ?? ''} placeholder="e.g. 3000"
                      onChange={(ev) => { const n = Number(ev.target.value); setSettings({ ...settings, wordLimit: ev.target.value && n > 0 ? Math.round(n) : null }); }}
                      title="This project's word limit. If the latest version is over it, that is a red item." />
                  </label>
                </div>
                <section className="drops" aria-label="Files to compare" data-guide="files">
                  <DropZone label="Original (kept in this project)" hint="The clean copy every draft is checked against." file={original}
                    onFile={() => say('The original stays as it is. To check against a later round instead, use "Make the new original" in Timeline.')} />
                  <div data-guide="add-round">
                    <DropZone label={`Add the latest version (round ${(latestNo ?? 0) + 1})`} hint="The newest draft, from the LLM or from you, or the published page." file={latestFile} onFile={(f) => { reset(); setLatestFile(f); }} onFetch={fetchInto?.latest} />
                  </div>
                </section>
                {project.original.doc.sourceType === 'html' && (
                  <div className="row" data-guide="download-word">
                    <button className="btn" onClick={() => void wordDownload({ doc: project.original.doc }, `${project.name}_original`)} title={WORD_TIP}>Download the original as Word</button>
                    <span className="muted small">Then add your edited .docx above as the next round, or fetch the published page to check it went live as approved.</span>
                  </div>
                )}
                <div className="compare-row" data-guide="compare-button">
                  <button className="btn primary" disabled={!original || !latestFile || busy} onClick={() => void start(original, latestFile)}
                    title={!latestFile ? 'Add the latest version first.' : 'Check this version against your original and the previous round. Nothing leaves this browser tab.'}>{busy ? 'Checking…' : 'Check this version'}</button>
                  {busy && <span className="progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{stage}</span>}
                </div>
              </>
            ) : (
              <>
                <div className="label-row" data-guide="check-label">
                  <label className="field">{asProject ? 'Project name (optional)' : 'Label (optional)'}
                    <input value={label} onChange={(ev) => setLabel(ev.target.value)} placeholder={asProject ? 'e.g. Senate inquiry submission: housing' : 'e.g. Housing submission, draft 3'} maxLength={120}
                      title={asProject ? 'A name for the project. Leave it empty to use the document title or the file name.' : "A name for this check, so you can find it again in Saved checks. Leave it empty to use the edited file's name and today's date."} />
                  </label>
                  <label className="field narrow" data-guide="word-limit">Word limit (optional)
                    <input type="number" min={1} step={50} value={settings.wordLimit ?? ''} placeholder="e.g. 3000"
                      onChange={(ev) => { const n = Number(ev.target.value); setSettings({ ...settings, wordLimit: ev.target.value && n > 0 ? Math.round(n) : null }); }}
                      title="The submission's word limit. If the edited version is over it, that is a red item. The reference list is not counted (change this in Settings)." />
                  </label>
                  {savedId && <span className="muted small">Saved as "{checks.find((c) => c.id === savedId)?.label ?? label}" · <button className="link" onClick={() => setView('saved')} title="See all your saved checks.">Saved checks</button></span>}
                  {!savedId && projects.length > 0 && <button className="link" onClick={() => setView('projects')} title="Open a project and add its next draft.">Open a project ({projects.length})</button>}
                  {!savedId && checks.length > 0 && <button className="link" onClick={() => setView('saved')} title="Open a check you ran before.">Open a saved check ({checks.length})</button>}
                </div>
                <section className="drops" aria-label="Files to compare" data-guide="files">
                  <DropZone label={versions ? 'Version A' : 'Original'} hint={versions ? 'One version, for example the long one.' : 'The document before the AI edited it, or the web page before your edits.'} file={original} onFile={(f) => pick('original', f)} onFetch={fetchInto?.original} />
                  <DropZone label={versions ? 'Version B' : 'Edited (LLM output)'} hint={versions ? 'The other version, for example the short one.' : 'The version the AI produced, or your edited Word file.'} file={edited} onFile={(f) => pick('edited', f)} onFetch={fetchInto?.edited} />
                </section>
                {isWebPage(original) && !versions && (
                  <div className="row" data-guide="download-word">
                    <button className="btn" onClick={() => void wordDownload({ file: original }, `${original!.name}`)} title={WORD_TIP}>Download the original as Word</button>
                  </div>
                )}
                {original && (
                  <label className="inline save-project" data-guide="save-project" title="A project keeps a clean copy of your original, so every later draft is checked against it and you can see what was fixed round by round. Untick to compare these two files once (kept under Saved checks).">
                    <input type="checkbox" checked={asProject && !versions} disabled={versions} onChange={(ev) => setAsProject(ev.target.checked)} /> Save this as your original? We'll keep a clean copy so every later draft is checked against it (a project).
                  </label>
                )}
                <label className="inline save-project" data-guide="versions-mode" title="For two versions meant to differ, such as a long and a short one, or one for government and one for industry. There is no verdict and nothing to decide: the sections are grouped, and numbers and quotes that differ are still listed. The same-document warning only shows below 30. Not for projects.">
                  <input type="checkbox" checked={versions} onChange={(ev) => { reset(); setVersions(ev.target.checked); if (ev.target.checked) setAsProject(false); }} /> These are intentionally different versions
                </label>
                <div className="compare-row" data-guide="compare-button">
                  <button className="btn primary" disabled={!original || !edited || busy} onClick={() => void start()} title={!original || !edited ? 'Choose both files first.' : 'Compare the two files. Nothing leaves this browser tab.'}>{busy ? 'Comparing…' : hasResults ? 'Compare again' : 'Compare'}</button>
                  {busy && <span className="progress" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{stage}</span>}
                </div>
              </>
            )}
            {error && <div className="gate gate-stop" role="alert" data-guide="file-check"><strong>Can't compare these files.</strong> {error}</div>}
            {phase === 'gate2' && sim && docs && (
              <div className="gate gate-warn" role="alertdialog" aria-labelledby="g2-title" data-guide="same-document">
                <h2 id="g2-title">These look like different documents</h2>
                <p>{sim.reasons[0] ? `(${sim.reasons[0][0].toLowerCase()}${sim.reasons[0].slice(1)}) ` : ''}Check you've picked the right files.</p>
                {sim.reasons.length > 1 && <ul>{sim.reasons.slice(1).map((r) => <li key={r}>{r}</li>)}</ul>}
                <p className="muted small">Similarity {sim.score} out of 100; below {threshold} counts as different{quickVersions ? ' for intentionally different versions' : ''}.</p>
                <div className="row">
                  <button className="btn" onClick={reset} title="Stop here and choose different files.">Cancel</button>
                  <button className="btn primary" onClick={() => { setOverride(true); overrideRef.current = true; void compare(docs, runId.current); }} title="Compare them anyway. The report will say this check was overridden.">Compare anyway</button>
                </div>
              </div>
            )}
            {hasResults && shownSim && fileNames && (
              <section className="done-card" aria-label="Result">
                <h2>{project && round ? `Round ${round.number} checked` : 'Comparison done'}</h2>
                {project && round && round.number > 1 && <p><strong>{summaryLine(round.number, round.summary)}</strong></p>}
                <SummaryBar all={all} layoutChanges={layoutChanges} result={shown!} settings={settings} onShowTrivial={(v) => setSettings({ ...settings, showTrivial: v })} onPick={(cat?: Category) => goChanges({ categories: cat ? [cat] : [] })} />
                <p className="gate-summary muted">File types match ✓ · Similarity {shownSim.score}/100{shownSim.score < threshold && (project ? round?.override : override) ? ' · compared anyway (below threshold)' : ''}{isPdf && layout.status === 'running' ? ` · comparing pages ${layout.done}/${layout.total}…` : ''}</p>
                <div className="row">
                  <button className="btn primary" onClick={() => setView('review')} title={quickVersions ? 'The sections in both versions, worded differently, or only in one, and any numbers or quotes that differ.' : 'Is it ready to submit? The verdict and a card for each change to decide.'}>{quickVersions ? 'See the version comparison' : 'See the verdict'}</button>
                  <button className="btn" onClick={() => goChanges()} title="See every change in a table you can filter, search and sort.">All changes</button>
                  <button className="btn" onClick={() => setView('metadata')} title="Compare the two files' size, dates, author and counts.">File details</button>
                  {isPdf && <button className="btn" onClick={() => setView('pages')} title="See which PDF pages look different, side by side.">PDF pages</button>}
                  {project && <button className="btn" onClick={() => setView('timeline')} title="Every round of this project: what was fixed, what is new, and the verdict.">Timeline</button>}
                  {!quickVersions && <AuthorReviewButton all={all} trivialCount={shown!.trivialCount} fileNames={fileNames} sim={shownSim} override={project ? !!round?.override : override} decisions={shownDecisions} primary={false} />}
                  <button className="btn" onClick={() => setView('report')} title="Download a PDF of this comparison for your own records.">PDF report</button>
                </div>
              </section>
            )}
          </>
        )}

        {view === 'review' && hasResults && quickVersions && (
          <VersionsView sections={shown!.sections ?? []} changes={all} words={shown!.words} onShowAll={() => goChanges({})} onShowIn={(c) => { filters.clear(); filters.setSearch(c.location); setView('changes'); }} />
        )}
        {view === 'review' && !(hasResults && quickVersions) && (hasResults ? (
          <ReviewView
            changes={all}
            words={shown!.words}
            decisions={shownDecisions}
            persistent={project ? !!projectStore?.persistent : !!store?.persistent}
            onDecide={project ? decideInProject : decide}
            onDismissSimilar={project ? acceptManyInProject : decideMany}
            project={project && round ? {
              name: project.name,
              round: round.number,
              latestRound: latestNo ?? round.number,
              summary: round.number > 1 ? summaryLine(round.number, round.summary) : undefined,
              readOnly: round.number !== latestNo || roundOnly,
              roundOnly: roundOnly && !!round.vsPrevious,
              canRoundOnly: !!round.vsPrevious,
              onRoundOnly: setRoundOnly,
              resolved: round.items.filter((i) => i.status === 'fixed' || (i.status === 'accepted' && !round.vsAccepted.changes.some((c) => reviewable(c) && itemIdOf(c) === i.itemId))),
              onUndoAccept: (i) => void updateProject((p) => decideItem(p, i.decidedInRound!, i.itemId, null, compareFn)),
            } : undefined}
            onShowAll={() => goChanges({})}
            onShowIn={(c) => { filters.clear(); filters.setSearch(c.location); setView('changes'); }}
            say={say}
          />
        ) : needResults('No verdict yet'))}

        {view === 'changes' && (hasResults ? (
          <>
            <SummaryBar all={all} layoutChanges={layoutChanges} result={shown!} settings={settings} onShowTrivial={(v) => setSettings({ ...settings, showTrivial: v })} onPick={(cat?: Category) => filters.apply({ categories: cat ? [cat] : [] })} activeCats={filters.cats} />
            <ChangesView all={all} f={filters} isPdf={!!isPdf} onOpenPage={openPage} />
          </>
        ) : needResults('No changes to show yet'))}

        {view === 'metadata' && (hasResults ? <MetadataView result={shown!} /> : needResults('No file details yet'))}

        {view === 'pages' && (!hasResults ? needResults('No pages to show yet')
          : !isPdf ? <EmptyView title="PDF pages is for PDF files" text="These files are not PDFs, so there are no pages to draw. Their changes are all in Changes." onAction={() => setView('changes')} action="Go to Changes" />
            : <PagesView layout={layout} threshold={settings.layoutPixelRatio} maxPages={settings.maxPagesForLayout} onRunLayout={() => void runLayout()} onOpenPage={openPage} />)}

        {view === 'report' && (hasResults && shownSim && fileNames ? (
          <ReportView result={shown!} all={all} layoutChanges={layoutChanges} layout={layout} sim={shownSim} override={project ? !!round?.override : override} settings={settings} fileNames={fileNames} f={filters} decisions={shownDecisions} project={projectReport} versions={quickVersions} onEditFilters={() => setView('changes')} />
        ) : needResults('Nothing to report yet'))}

        {view === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} />}

        {view === 'projects' && (
          <ProjectsView
            projects={projects}
            currentId={project?.id}
            persistent={!!projectStore?.persistent}
            quota={quota}
            warnMb={PROJECT_WARN_MB}
            conflict={conflict}
            onOpen={openProject}
            onRename={(p, n) => void renameProject(p, n)}
            onExport={(p) => void exportOne(p)}
            onDelete={(p) => void deleteProject(p)}
            onImport={(f) => void importOne(f)}
            onResolveImport={(c) => void resolveImport(c)}
            onQuick={() => { if (project) closeProject(); else setView('compare'); }}
          />
        )}

        {view === 'timeline' && (project ? (
          <TimelineView
            project={project}
            viewing={round?.number}
            warnMb={PROJECT_WARN_MB}
            onOpenRound={(n) => { setRoundNo(n === latestNo ? undefined : n); setRoundOnly(false); setView('review'); }}
            onDeleteFrom={(n) => { setRoundNo(undefined); void updateProject((p) => deleteRounds(p, n)).then(() => say(`Deleted round ${n}${latestNo && latestNo > n ? ` and the rounds after it` : ''}.`)); }}
            onNewOriginal={(reason) => void updateProject((p) => makeNewOriginal(p, reason)).then(() => { if (projectRef.current) setOriginal(fileOf(projectRef.current.original)); say('This round is now the original. Later rounds are checked against it; the timeline and the report show the change and your reason.'); })}
            onCompact={() => void updateProject((p) => { const c = compact(p); say(c.freed ? `Freed ${fmtSize(c.freed)}. The old rounds' results and decisions are kept.` : 'Nothing to compact.'); return c.project; })}
            onExport={() => void exportOne(project)}
          />
        ) : <EmptyView title="No project open" text="Open a project in Projects, or start one in Compare documents with &quot;Save as a project&quot; ticked." onAction={() => setView('projects')} action="Go to Projects" />)}

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
