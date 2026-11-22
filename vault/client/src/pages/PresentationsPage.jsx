import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import Tooltip from '../components/Tooltip';
import Skeleton from '../components/Skeleton';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startPresentationsTour, TOUR_KEY as PRESENTATIONS_TOUR_KEY } from '../utils/tours/presentationsTour';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { takeToolHandoff } from '../utils/toolHandoff.mjs';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { useModels } from '../hooks/useModels';
import { TOOL_COMPONENTS } from './presentations/toolRegistry';
import { PRESENTATION_GOALS } from './presentations/presentationGoals.mjs';
import {
  PRESENTATIONS_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, TOOL_HELP, HOW_IT_WORKS, labelFor,
} from './presentations/presentationsTools.mjs';
import PresentationsGuide from './presentations/PresentationsGuide';
import Slideshow from './presentations/Slideshow';
import { addHistory, historyEnabled, setHistoryEnabled } from './presentations/historyStore.mjs';
import {
  PresentationContext, emptyDeck, normalizeDeck, readJson, usePresentationJob, JobStatusCard,
} from './presentations/shared';

const ALL_TOOLS = PRESENTATIONS_TOOLS;

const OPEN_ON_LAST_KEY = 'vault_presentations_open_on_last';
const LAST_TOOL_KEY = 'vault_presentations_last_tool';
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
function initialTool() {
  if (readLocal(OPEN_ON_LAST_KEY) !== '1') return 'start';
  const last = readLocal(LAST_TOOL_KEY);
  return ALL_TOOLS.some((t) => t.id === last) ? last : 'start';
}

export default function PresentationsPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const toast = useCallback((message, kind = 'success') => addToast(message, kind), [addToast]);
  const params = useParams();
  const routeDeckId = params?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const appInfo = useToolInfoModal('vault_presentations_info_seen');

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  // This flag defaults OFF (docs/presentations.md), so unlike the always-on tools, members need an explicit true.
  const canUse = Boolean(user?.isAdmin) || featureAccess.presentations === true;

  // No model picker: the deck is written with the workspace default model set by an admin (Settings → AI & Chat). The page sends
  // no model id, so the server uses that default; defaultModel is only read here to name it next to Make deck.
  const { defaultModel } = useModels();

  const [tool, setTool] = useState(initialTool);
  const [goal, setGoal] = useState(null);
  const [openOnLast, setOpenOnLast] = useState(() => readLocal(OPEN_ON_LAST_KEY) === '1');
  const [helpTool, setHelpTool] = useState(null);
  const [visited, setVisited] = useState(() => new Set());

  const [meta, setMeta] = useState({ maxSlides: 20, brandKit: { available: false, label: '' }, designs: [] });
  const metaRef = useRef(meta);
  useEffect(() => { metaRef.current = meta; }, [meta]);
  const [deck, setDeckRaw] = useState(emptyDeck);
  const [sourceText, setSourceText] = useState('');
  const [imageRefs, setImageRefs] = useState([]);
  const [themeId, setThemeId] = useState('paper');
  const [applyBrand, setApplyBrand] = useState(false);
  const [sourceType, setSourceType] = useState('brief');
  const [savedDeckId, setSavedDeckId] = useState(null);
  const [exportFile, setExportFile] = useState(null);
  const [historyOn, setHistoryOnState] = useState(historyEnabled);
  const [handoff, setHandoff] = useState(null);
  const [autosaveState, setAutosaveState] = useState('idle');
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const deckRef = useRef(deck);
  const autosaveRef = useRef({ timer: null, skip: true, last: '' });
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => { if (openOnLast && tool !== 'start') writeLocal(LAST_TOOL_KEY, tool); }, [tool, openOnLast]);
  useEffect(() => { setVisited((v) => (v.has(tool) ? v : new Set(v).add(tool))); }, [tool]);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    api.get('/api/presentations/meta')
      .then((r) => readJson(r, 'Could not load Presentations settings.'))
      .then((d) => setMeta({
        maxSlides: d.maxSlides || 20,
        brandKit: d.brandKit || { available: false, label: '' },
        designs: Array.isArray(d.designs) ? d.designs : [],
      }))
      .catch(() => {});
    // A file left for Presentations by another tool opens Import source.
    const incoming = takeToolHandoff('presentations') || takeToolHandoff('import');
    if (incoming) { setHandoff({ target: 'import', file: incoming }); setTool('import'); setGoal(null); }
  }, [canUse]);

  // Settings -> Presentations Tour opens /presentations?tour=1. Wait until access is known so members with the flag get it too.
  useEffect(() => {
    if (!canUse || !searchParams.has('tour')) return;
    setTool('start'); setGoal(null);
    const next = new URLSearchParams(searchParams); next.delete('tour');
    setSearchParams(next, { replace: true });
    const timer = setTimeout(() => startPresentationsTour(), 300);
    return () => clearTimeout(timer);
  }, [canUse]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(PRESENTATIONS_TOUR_KEY); } catch (_) { /* ignore */ }
    setTool('start'); setGoal(null);
    setTimeout(startPresentationsTour, 100);
  };

  const setHistoryOn = useCallback((on) => { setHistoryEnabled(on); setHistoryOnState(on); }, []);

  const recordHistory = useCallback((nextDeck, type = sourceType) => {
    if (!historyOn || !nextDeck?.slides?.length) return;
    addHistory({ title: nextDeck.title, deck: normalizeDeck(nextDeck), sourceType: type })
      .catch(() => toast('Could not add this deck to local history.', 'error'));
  }, [historyOn, sourceType, toast]);

  const setDeck = useCallback((value, { history = true } = {}) => {
    const prev = deckRef.current;
    const next = normalizeDeck(typeof value === 'function' ? value(prev) : value, metaRef.current?.maxSlides || 20);
    if (history && JSON.stringify(prev) !== JSON.stringify(next)) {
      undoRef.current = [...undoRef.current.slice(-49), prev];
      redoRef.current = [];
      setHistoryTick((n) => n + 1);
    }
    deckRef.current = next;
    setDeckRaw(next);
  }, []);

  const undo = useCallback(() => {
    if (!undoRef.current.length) return;
    const prev = undoRef.current.pop();
    redoRef.current = [...redoRef.current, deckRef.current].slice(-50);
    deckRef.current = prev;
    setDeckRaw(prev);
    setHistoryTick((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    if (!redoRef.current.length) return;
    const next = redoRef.current.pop();
    undoRef.current = [...undoRef.current, deckRef.current].slice(-50);
    deckRef.current = next;
    setDeckRaw(next);
    setHistoryTick((n) => n + 1);
  }, []);
  const replaceDeck = useCallback((next) => {
    undoRef.current = [];
    redoRef.current = [];
    deckRef.current = next;
    setDeckRaw(next);
    autosaveRef.current = { timer: null, skip: true, last: JSON.stringify(next) };
    setHistoryTick((n) => n + 1);
  }, []);
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  const handleJobResult = useCallback((kind, payload, id) => {
    if (payload?.error) return;
    if (kind === 'create') {
      const next = normalizeDeck(payload?.deck, metaRef.current?.maxSlides || 20);
      replaceDeck(next);
      setThemeId(next.themeId);
      recordHistory(next);
      toast(payload?.warning || 'Deck ready — check it in the slide editor.', payload?.warning ? 'warn' : 'success');
    } else if (kind === 'export') {
      setExportFile({ ...payload, jobId: id });
      toast('Export ready to download.', 'success');
    }
  }, [recordHistory, replaceDeck, toast]);

  const { job, startJob, cancelJob, resumeJob, dismissJob } = usePresentationJob(handleJobResult);

  const saveDeck = useCallback(async ({ asNew = false, title, type, versionLabel, silent = false } = {}) => {
    const clean = normalizeDeck(deckRef.current, metaRef.current?.maxSlides || 20);
    const isNew = asNew || !savedDeckId;
    const res = isNew
      ? await api.post('/api/presentations/decks', {
        deck: clean,
        ...(title ? { title } : {}),
        ...(type || sourceType ? { sourceType: type || sourceType } : {}),
      })
      : await api.patch(`/api/presentations/decks/${savedDeckId}`, { deck: clean, ...(versionLabel ? { versionLabel } : {}) });
    const data = await readJson(res, 'Could not save the deck.');
    if (data?.deck?.id) setSavedDeckId(String(data.deck.id));
    autosaveRef.current.last = JSON.stringify(clean);
    if (!silent) toast(isNew ? 'Deck saved to My decks.' : 'Deck updated.', 'success');
    return data?.deck || clean;
  }, [savedDeckId, sourceType, toast]);

  const loadDeck = useCallback(async (id) => {
    const res = await api.get(`/api/presentations/decks/${encodeURIComponent(id)}`);
    const data = await readJson(res, 'Could not open that deck.');
    // GET /decks/:id answers { deck: row }; the slides are in row.data (server/services/presentations/store.js rowToDeck).
    const row = data?.deck || data || {};
    const next = normalizeDeck(row.data && typeof row.data === 'object' ? row.data : row, metaRef.current?.maxSlides || 20);
    replaceDeck(next);
    setThemeId(next.themeId);
    setSavedDeckId(String(id));
    setSourceType(row.sourceType || 'brief');
    recordHistory(next, row.sourceType || 'brief');
    return next;
  }, [recordHistory, replaceDeck]);

  useEffect(() => {
    // A ?tour=1 visit stays on the start screen rather than opening a linked deck under the tour.
    if (!canUse || !routeDeckId || searchParams.has('tour')) return;
    loadDeck(routeDeckId)
      .then(() => setTool('slides'))
      .catch((err) => toast(err.message || 'Could not open that deck.', 'error'));
    // Load once per route id; loadDeck deliberately left out to avoid reloading after every edit.
  }, [canUse, routeDeckId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved decks autosave 1.6s after typing stops; the server keeps the previous JSON as a version.
  useEffect(() => {
    if (!canUse || !savedDeckId || !deck.slides.length) return undefined;
    const current = JSON.stringify(deck);
    if (autosaveRef.current.skip || current === autosaveRef.current.last) {
      autosaveRef.current.skip = false;
      autosaveRef.current.last = current;
      return undefined;
    }
    clearTimeout(autosaveRef.current.timer);
    autosaveRef.current.timer = setTimeout(async () => {
      setAutosaveState('saving');
      try {
        await saveDeck({ versionLabel: 'Autosave', silent: true });
        setAutosaveState('saved');
      } catch {
        setAutosaveState('error');
      }
    }, 1600);
    return () => clearTimeout(autosaveRef.current.timer);
  }, [canUse, deck, savedDeckId, saveDeck]);

  // Undo/redo only outside text fields, so Ctrl+Z keeps working normally inside an input or textarea.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const openToolById = useCallback((id) => {
    if (!ALL_TOOLS.some((t) => t.id === id)) return;
    setTool(id);
  }, []);
  const startGoal = (g) => { setGoal(g); openToolById(g.steps[0].tool); };
  const backToStart = () => { setGoal(null); setTool('start'); };
  // The full-screen slideshow, opened from any tool with present(slideIndex).
  const [show, setShow] = useState(null);
  const present = useCallback((start = 0) => { if (deck.slides.length) setShow({ start }); }, [deck.slides.length]);
  const chooseTransition = useCallback((id) => setDeck((prev) => ({ ...prev, transition: id })), [setDeck]);

  // The design style (layout decoration) lives on the deck, so the preview, saves and every export carry it.
  const chooseDesign = useCallback((id) => setDeck((prev) => ({ ...prev, designId: id })), [setDeck]);
  const chooseTheme = useCallback((id) => {
    setThemeId(id);
    setDeck((prev) => ({ ...prev, themeId: id }));
  }, [setDeck]);
  const takeIncomingFile = useCallback((target) => {
    if (!handoff || handoff.target !== target) return null;
    setHandoff(null);
    return handoff.file;
  }, [handoff]);

  const ctx = useMemo(() => ({
    tool, setTool: openToolById, openTool: openToolById, setHelpTool,
    deck, setDeck, meta, sourceText, setSourceText, imageRefs, setImageRefs,
    themeId, chooseTheme, chooseDesign, chooseTransition, present, applyBrand, setApplyBrand, sourceType, setSourceType,
    savedDeckId, setSavedDeckId, exportFile, setExportFile,
    historyOn, setHistoryOn,
    undo, redo, canUndo, canRedo, autosaveState,
    job, startJob, cancelJob, resumeJob, dismissJob,
    saveDeck, loadDeck, takeIncomingFile, toast,
    defaultModel,
  }), [
    tool, openToolById, deck, setDeck, meta, sourceText, imageRefs, themeId, chooseTheme, chooseDesign, chooseTransition, present, applyBrand,
    sourceType, savedDeckId, exportFile, historyOn, setHistoryOn, undo, redo, canUndo, canRedo, autosaveState,
    job, startJob, cancelJob, resumeJob, dismissJob, saveDeck, loadDeck, takeIncomingFile, toast,
    defaultModel, historyTick,
  ]);

  // ToolSidebar groups (components/ToolSidebar.jsx): the list, tips and icons come from presentationsTools.mjs, shared with the guide.
  // Tools that need a deck say what to do first, like Contract Review's "Open or start a contract first".
  const hintFor = (id) => ((id === 'slides' || id === 'export') && !deck.slides.length ? 'Make or open a deck first' : undefined);
  const MENU = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: PRESENTATIONS_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id], hint: hintFor(t.id) })),
  }));

  const renderTools = () => ALL_TOOLS.map(({ id }) => {
    const Tool = TOOL_COMPONENTS[id];
    if (!Tool || !(visited.has(id) || tool === id)) return null;
    return (
      <div key={id} hidden={tool !== id}>
        <Suspense fallback={<Skeleton lines={4} className="h-10" label={`Loading ${labelFor(id)}`} />}>
          <Tool active={tool === id} />
        </Suspense>
      </div>
    );
  });

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <PresentationContext.Provider value={ctx}>
      <VoiceInputProvider lang="en-AU">
        <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
          <ToolSidebar
            title="Presentations"
            icon="monitor"
            groups={MENU}
            current={tool}
            onSelect={openToolById}
            onInfo={appInfo.open}
            infoTip="How Presentations works: the four groups, the jobs on the start screen and the one deck behind every export."
            onTour={startTour}
            tourTip="Take the guided tour of Presentations: the jobs, the tool list, help and the guide."
          >
            <Tooltip text="Go back to the list of jobs (brief, document, brand, saved deck).">
              <button
                type="button"
                onClick={backToStart}
                className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity duration-200 hover:opacity-70"
                style={{
                  borderColor: tool === 'start' ? 'var(--color-primary)' : 'var(--color-border)',
                  color: tool === 'start' ? 'var(--color-primary)' : 'var(--color-text)',
                  background: 'var(--color-bg)',
                }}
              >
                {getIcon('layout-grid', { size: 13 })}
                What do you want to do?
              </button>
            </Tooltip>
          </ToolSidebar>

          <div className="flex-1 min-w-0 p-4 sm:p-6" style={{ background: 'var(--color-bg)' }} data-tour="presentations-main">
            <div className="max-w-[1700px] space-y-4">
              {tool === 'start' ? (
                <div data-tour="presentations-jobs">
                  <JobStart
                    goals={PRESENTATION_GOALS}
                    intro="Turn a brief, document, web page or set of pictures into a small slide deck you can edit and export. Pick a job and Presentations opens just the tools you need, in order, or choose a tool on the left."
                    onPick={startGoal}
                    labelFor={labelFor}
                    openOnLast={openOnLast}
                    onToggleOpenOnLast={(on) => { setOpenOnLast(on); writeLocal(OPEN_ON_LAST_KEY, on ? '1' : '0'); }}
                    appName="Presentations"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <BackToJobs onBack={backToStart} toolLabel={labelFor(tool)} goal={stepIndex(goal, tool) >= 0 ? goal : null} />
                  <JobBar goal={goal} mode={tool} onStep={openToolById} labelFor={labelFor} carry="the deck stays with you" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>
                    <div className="flex items-center gap-2">
                      {savedDeckId && autosaveState !== 'idle' && (
                        <span className="text-xs" aria-live="polite" style={{ color: 'var(--color-muted)' }}>
                          {autosaveState === 'saving' ? 'Autosaving…' : autosaveState === 'saved' ? 'Autosaved' : 'Autosave failed'}
                        </span>
                      )}
                      <Tooltip text={canUndo ? 'Undo the last slide edit (Ctrl+Z outside a text field).' : 'Nothing to undo yet.'}>
                        <button type="button" onClick={undo} disabled={!canUndo} className="text-xs underline transition-opacity duration-200 hover:opacity-60 disabled:no-underline disabled:opacity-40" style={{ color: 'var(--color-primary)' }}>Undo</button>
                      </Tooltip>
                      <Tooltip text={canRedo ? 'Redo the last slide edit (Ctrl+Shift+Z outside a text field).' : 'Nothing to redo yet.'}>
                        <button type="button" onClick={redo} disabled={!canRedo} className="text-xs underline transition-opacity duration-200 hover:opacity-60 disabled:no-underline disabled:opacity-40" style={{ color: 'var(--color-primary)' }}>Redo</button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              )}

              {job && <JobStatusCard />}

              {tool !== 'start' && renderTools()}
            </div>
          </div>
        </div>

        {appInfo.show && (
          <ToolInfoModal title="How Presentations Works" onClose={appInfo.close}>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Six tools in four groups. Presentations opens on “What do you want to do?”: pick a job and its tools open one step at a time, with “Back to all jobs” above every tool. Hover any group or tool for a plain explanation. The guide chat at the bottom right can point you at the right tools, but it cannot see your decks.
            </p>
            <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {HOW_IT_WORKS.map(([heading, text]) => (
                <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
              ))}
            </div>
          </ToolInfoModal>
        )}

        {helpTool && TOOL_HELP[helpTool] && (
          <ToolInfoModal title={`How ${labelFor(helpTool)} Works`} onClose={() => setHelpTool(null)}>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_HELP[helpTool].what}</p>
            <ul className="space-y-1.5">
              {TOOL_HELP[helpTool].features.map((feat) => (
                <li key={feat} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon('check', { size: 14 })}</span>
                  {feat}
                </li>
              ))}
            </ul>
          </ToolInfoModal>
        )}

        {show && (
          <Slideshow
            deck={deck}
            applyBrand={applyBrand}
            start={show.start}
            onClose={() => setShow(null)}
            onTransition={chooseTransition}
          />
        )}

        <PresentationsGuide currentTool={tool} onOpenTool={openToolById} />
      </VoiceInputProvider>
    </PresentationContext.Provider>
  );
}
