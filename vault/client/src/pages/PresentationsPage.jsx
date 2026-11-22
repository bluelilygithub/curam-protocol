import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startPresentationsTour, TOUR_KEY as PRESENTATIONS_TOUR_KEY } from '../utils/tours/presentationsTour';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { takeToolHandoff } from '../utils/toolHandoff.mjs';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { useModels } from '../hooks/useModels';
import { getModelShortName } from '../utils/models';
import { TOOL_COMPONENTS } from './presentations/toolRegistry';
import { PRESENTATION_GOALS } from './presentations/presentationGoals.mjs';
import PresentationsGuide from './presentations/PresentationsGuide';
import { addHistory, historyEnabled, setHistoryEnabled } from './presentations/historyStore.mjs';
import {
  PresentationContext, emptyDeck, normalizeDeck, readJson, usePresentationJob, CARD_STYLE, JobStatusCard,
} from './presentations/shared';

// The six tools, in the same four groups as the docs. Hover text is deliberately plain English.
const TOOL_GROUPS = [
  {
    id: 'make',
    label: 'Make',
    tip: 'Start a deck: from a written brief, or from a document, web page or pictures.',
    tools: [
      { id: 'create', label: 'Create deck', desc: 'Brief → outline → slides in the chosen theme' },
      { id: 'import', label: 'Import source', desc: 'PDF, DOCX, TXT/MD, web URL or images → text and pictures' },
    ],
  },
  {
    id: 'design',
    label: 'Design',
    tip: 'Choose how the deck looks, then edit its words and pictures.',
    tools: [
      { id: 'templates', label: 'Themes', desc: 'Built-in themes, saved themes, PowerPoint theme import, Brand Kit' },
      { id: 'slides', label: 'Slide editor', desc: 'Edit titles and body text, swap images, add and reorder slides' },
    ],
  },
  {
    id: 'finish',
    label: 'Finish',
    tip: 'Make the finished files: editable PowerPoint, PDF, HTML preview or PNGs.',
    tools: [{ id: 'export', label: 'Export', desc: 'PPTX, PDF, HTML preview or per-slide PNGs' }],
  },
  {
    id: 'library',
    label: 'Library',
    tip: 'Decks saved on the server and decks recently opened on this device.',
    tools: [{ id: 'decks', label: 'My decks', desc: 'Saved decks, browser history, reopen/duplicate/delete' }],
  },
];

const TOOL_TIPS = {
  create: 'Write a short brief and make a slide deck from it, using the theme you chose. Runs in the background; you can edit the result afterwards.',
  import: 'Pull the text and pictures out of a PDF, Word document, text file, web page or images, ready to make into slides.',
  templates: 'Pick a built-in theme, save your own, import colours and fonts from a PowerPoint theme, or apply your Brand Kit on top.',
  slides: 'Change the words, pictures and order of the slides. Everything is kept in one deck so the preview and exports stay in step.',
  export: 'Download the deck as an editable PPTX, a PDF, an HTML preview or one PNG per slide.',
  decks: 'Open decks you saved, duplicate or delete them, and see decks you opened recently on this device.',
};

const TOOL_HELP = {
  create: {
    title: 'Create deck',
    what: 'Give Vault a brief in plain language and it writes a short outline, then fills it out as slides.',
    features: [
      '6–12 slides by default, with a 20-slide maximum',
      'Uses the workspace models configured by your admin, not a hard-coded provider',
      'Works from a brief alone, or from text and images brought in by Import source',
      'Runs in the background with progress, Cancel and Resume',
      'The finished deck opens in the slide editor — nothing is exported until you ask',
    ],
  },
  import: {
    title: 'Import source',
    what: 'Turn documents, web pages and pictures into source material for a deck.',
    features: [
      'PDF, DOCX, TXT/MD, .pptx/.potx and images — up to 10 files at once',
      'Or paste a web page URL to fetch its text safely on the server',
      'Extracted text appears in an editable box before you use it',
      'Images become references the slide editor and preview can show directly',
      'Files handed over from another Vault tool are picked up automatically',
    ],
  },
  templates: {
    title: 'Themes',
    what: 'Choose the look of the deck before you generate it, or save your own theme.',
    features: [
      'Six built-in themes: paper, ink, warm, ocean, forest and mono',
      'Save a theme with your own colours, font and title size',
      'Importing a .pptx/.potx takes its colours and fonts, not its PowerPoint masters',
      'Brand Kit is an override on top of the chosen theme',
      'The current deck is previewed so you can see the effect',
    ],
  },
  slides: {
    title: 'Slide editor',
    what: 'Make the deck say what you want, then save it.',
    features: [
      'Edit deck title, subtitle and each slide’s title, body, bullets, image and notes',
      'Use one of five layouts: title, bullets, two-column, picture or closing',
      'Add, delete and reorder slides, up to the server’s slide limit',
      'Live HTML preview uses the same renderer as PDF and PNG export',
      'Save to My decks, or hand the deck to another tool with Use in…',
    ],
  },
  export: {
    title: 'Export',
    what: 'Make the finished files from the current deck.',
    features: [
      'PPTX keeps text as editable text boxes',
      'PDF and per-slide PNGs render from the same HTML as the preview',
      'HTML preview is a single self-contained file',
      'Apply the Brand Kit override at export time if you want it',
      'Long exports run in the background with progress and Cancel',
    ],
  },
  decks: {
    title: 'My decks',
    what: 'Find a deck again and manage your library.',
    features: [
      'Open a saved deck straight into the slide editor',
      'Duplicate a deck before trying a big change',
      'Deleted decks go to the recycle bin for 30 days',
      'Recent decks on this device are opt-in browser history, not a backup',
    ],
  },
};

const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);
const labelFor = (id) => ALL_TOOLS.find((t) => t.id === id)?.label || id;
const groupFor = (id) => TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === id))?.id || 'make';

const OPEN_ON_LAST_KEY = 'vault_presentations_open_on_last';
const LAST_TOOL_KEY = 'vault_presentations_last_tool';
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
function initialTool() {
  if (readLocal(OPEN_ON_LAST_KEY) !== '1') return 'start';
  const last = readLocal(LAST_TOOL_KEY);
  return ALL_TOOLS.some((t) => t.id === last) ? last : 'start';
}

// vault_models can hold image/search providers. Presentations only offers text models; keep this in step with
// server/services/modelResolver.js isNonTextModel so the picker never offers an id the API will reject.
const NON_TEXT_PROVIDERS = new Set(['fal', 'seedance', 'replicate', 'serper', 'serpapi']);
const isTextModel = (m) => {
  const id = String(m?.id || '').trim();
  if (!id || NON_TEXT_PROVIDERS.has(String(m.provider || '').toLowerCase())) return false;
  const lower = id.toLowerCase();
  return !lower.startsWith('fal-ai/') && !lower.startsWith('fal/') && !/minimax\/|hailuo|video-01|image-to-video|\/flux/.test(lower);
};

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

  // Vault's documented model-selection rule: useModels + the memberModelSelection flag, admins always.
  const { models: configuredModels, defaultModel } = useModels();
  const [chatModel, setChatModel] = useState(null);
  const canSelectModel = Boolean(user?.isAdmin) || featureAccess.memberModelSelection !== false;
  const chatModels = useMemo(() => (Array.isArray(configuredModels) ? configuredModels.filter(isTextModel) : []), [configuredModels]);
  const effectiveModel = (canSelectModel ? chatModel : null) || defaultModel || chatModels[0]?.id || '';
  useEffect(() => {
    if (chatModel && chatModels.length && !chatModels.some((m) => m.id === chatModel)) setChatModel(null);
  }, [chatModel, chatModels]);

  const [tool, setTool] = useState(initialTool);
  const [openGroup, setOpenGroup] = useState(() => groupFor(initialTool()));
  const [goal, setGoal] = useState(null);
  const [openOnLast, setOpenOnLast] = useState(() => readLocal(OPEN_ON_LAST_KEY) === '1');
  const [search, setSearch] = useState('');
  const [helpTool, setHelpTool] = useState(null);
  const [visited, setVisited] = useState(() => new Set());

  const [meta, setMeta] = useState({ maxSlides: 20, brandKit: { available: false, label: '' } });
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
      .then((d) => setMeta({ maxSlides: d.maxSlides || 20, brandKit: d.brandKit || { available: false, label: '' } }))
      .catch(() => {});
    // A file left for Presentations by another tool opens Import source.
    const incoming = takeToolHandoff('presentations') || takeToolHandoff('import');
    if (incoming) { setHandoff({ target: 'import', file: incoming }); setTool('import'); setGoal(null); }
  }, [canUse]);

  // Settings -> Presentations Tour opens /presentations?tour=1. Wait until access is known so members with the flag get it too.
  useEffect(() => {
    if (!canUse || !searchParams.has('tour')) return;
    setTool('start'); setGoal(null); setOpenGroup('make');
    const next = new URLSearchParams(searchParams); next.delete('tour');
    setSearchParams(next, { replace: true });
    const timer = setTimeout(() => startPresentationsTour(), 300);
    return () => clearTimeout(timer);
  }, [canUse]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(PRESENTATIONS_TOUR_KEY); } catch (_) { /* ignore */ }
    setTool('start'); setGoal(null); setOpenGroup('make');
    setTimeout(startPresentationsTour, 100);
  };

  const setHistoryOn = useCallback((on) => { setHistoryEnabled(on); setHistoryOnState(on); }, []);

  const recordHistory = useCallback((nextDeck, type = sourceType) => {
    if (!historyOn || !nextDeck?.slides?.length) return;
    addHistory({ title: nextDeck.title, deck: normalizeDeck(nextDeck), sourceType: type })
      .catch(() => toast('Could not add this deck to local history.', 'error'));
  }, [historyOn, sourceType, toast]);

  const setDeck = useCallback((value) => {
    setDeckRaw((prev) => normalizeDeck(typeof value === 'function' ? value(prev) : value, metaRef.current?.maxSlides || 20));
  }, []);

  const handleJobResult = useCallback((kind, payload, id) => {
    if (payload?.error) return;
    if (kind === 'create') {
      const next = normalizeDeck(payload?.deck, metaRef.current?.maxSlides || 20);
      setDeckRaw(next);
      setThemeId(next.themeId);
      recordHistory(next);
      toast('Deck ready — check it in the slide editor.', 'success');
    } else if (kind === 'export') {
      setExportFile({ ...payload, jobId: id });
      toast('Export ready to download.', 'success');
    }
  }, [recordHistory, toast]);

  const { job, startJob, cancelJob, resumeJob, dismissJob } = usePresentationJob(handleJobResult);

  const saveDeck = useCallback(async ({ asNew = false, title, type } = {}) => {
    const clean = normalizeDeck(deck, metaRef.current?.maxSlides || 20);
    const isNew = asNew || !savedDeckId;
    const res = isNew
      ? await api.post('/api/presentations/decks', {
        deck: clean,
        ...(title ? { title } : {}),
        ...(type || sourceType ? { sourceType: type || sourceType } : {}),
      })
      : await api.patch(`/api/presentations/decks/${savedDeckId}`, { deck: clean });
    const data = await readJson(res, 'Could not save the deck.');
    if (data?.deck?.id) setSavedDeckId(String(data.deck.id));
    toast(isNew ? 'Deck saved to My decks.' : 'Deck updated.', 'success');
    return data?.deck || clean;
  }, [deck, savedDeckId, sourceType, toast]);

  const loadDeck = useCallback(async (id) => {
    const res = await api.get(`/api/presentations/decks/${encodeURIComponent(id)}`);
    const data = await readJson(res, 'Could not open that deck.');
    const next = normalizeDeck(data?.deck || data, metaRef.current?.maxSlides || 20);
    setDeckRaw(next);
    setThemeId(next.themeId);
    setSavedDeckId(String(id));
    setSourceType(data?.deck?.sourceType || data?.sourceType || 'brief');
    recordHistory(next, data?.deck?.sourceType || 'brief');
    return next;
  }, [recordHistory]);

  useEffect(() => {
    // A ?tour=1 visit stays on the start screen rather than opening a linked deck under the tour.
    if (!canUse || !routeDeckId || searchParams.has('tour')) return;
    loadDeck(routeDeckId)
      .then(() => setTool('slides'))
      .catch((err) => toast(err.message || 'Could not open that deck.', 'error'));
    // Load once per route id; loadDeck deliberately left out to avoid reloading after every edit.
  }, [canUse, routeDeckId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openToolById = useCallback((id) => {
    if (!ALL_TOOLS.some((t) => t.id === id)) return;
    setOpenGroup(groupFor(id));
    setTool(id);
  }, []);
  const startGoal = (g) => { setGoal(g); openToolById(g.steps[0].tool); };
  const backToStart = () => { setGoal(null); setTool('start'); };
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
    themeId, chooseTheme, applyBrand, setApplyBrand, sourceType, setSourceType,
    savedDeckId, setSavedDeckId, exportFile, setExportFile,
    historyOn, setHistoryOn,
    job, startJob, cancelJob, resumeJob, dismissJob,
    saveDeck, loadDeck, takeIncomingFile, toast,
    model: effectiveModel, models: chatModels, canSelectModel, setChatModel,
  }), [
    tool, openToolById, deck, setDeck, meta, sourceText, imageRefs, themeId, chooseTheme, applyBrand,
    sourceType, savedDeckId, exportFile, historyOn, setHistoryOn, job, startJob, cancelJob, resumeJob,
    dismissJob, saveDeck, loadDeck, takeIncomingFile, toast,
    effectiveModel, chatModels, canSelectModel,
  ]);

  const query = search.trim().toLowerCase();
  const filteredGroups = TOOL_GROUPS
    .map((g) => ({ ...g, tools: g.tools.filter((t) => !query || t.label.toLowerCase().includes(query) || (TOOL_TIPS[t.id] || '').toLowerCase().includes(query)) }))
    .filter((g) => g.tools.length);

  const renderTools = () => ALL_TOOLS.map(({ id }) => {
    const Tool = TOOL_COMPONENTS[id];
    if (!Tool || !(visited.has(id) || tool === id)) return null;
    return (
      <div key={id} hidden={tool !== id}>
        <Suspense fallback={<p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}>
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
          <aside
            data-tour="presentations-sidebar"
            className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
                {getIcon('monitor', { size: 16 })}
              </div>
              <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Presentations</h1>
              <Tooltip text="How Presentations works">
                <button
                  type="button"
                  data-tour="presentations-info"
                  aria-label="How Presentations works"
                  onClick={appInfo.open}
                  className="hover:opacity-60 transition-opacity"
                  style={{ color: 'var(--color-muted)', lineHeight: 1 }}
                >
                  {getIcon('info', { size: 13 })}
                </button>
              </Tooltip>
              <Tooltip text="Take the guided tour of Presentations">
                <button
                  type="button"
                  data-tour="presentations-tour"
                  aria-label="Take the guided tour of Presentations"
                  onClick={startTour}
                  className="hover:opacity-60 transition-opacity"
                  style={{ color: 'var(--color-muted)', lineHeight: 1 }}
                >
                  {getIcon('compass', { size: 14 })}
                </button>
              </Tooltip>
            </div>

            {canSelectModel && chatModels.length > 0 && (
              <label className="block space-y-1" data-tour="presentations-model">
                <span className="text-[11px] font-medium" style={{ color: 'var(--color-muted)' }}>AI model</span>
                <Tooltip text="Choose the model used to write slides and answer the guide. Your admin's Settings choice is used until you pick one here.">
                  <select
                    value={effectiveModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    aria-label="AI model for Presentations"
                    className="w-full px-2 py-1.5 rounded-lg border text-xs"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {chatModels.map((m) => <option key={m.id} value={m.id}>{getModelShortName(m.id)}</option>)}
                  </select>
                </Tooltip>
              </label>
            )}
            {!canSelectModel && effectiveModel && (
              <p className="text-[10px] truncate" style={{ color: 'var(--color-muted)' }}>
                Using {getModelShortName(effectiveModel)}
              </p>
            )}

            {appInfo.show && (
              <ToolInfoModal title="How Presentations Works" onClose={appInfo.close}>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  Six tools across four groups. Presentations opens on “What do you want to do?”: pick a job and its tools open one step at a time, with “Back to all jobs” above every tool. Hover any group or tool for a plain explanation. The guide chat at the bottom right can point you at the right tools, but it cannot see your decks.
                </p>
                <div className="rounded-lg p-3 text-sm space-y-2" style={{ ...CARD_STYLE, border: '1px solid var(--color-border)' }}>
                  <p style={{ color: 'var(--color-text)' }}><strong>Make</strong> — Create deck writes a short outline and turns it into slides from a brief. Import source pulls text and pictures from documents, web pages and images.</p>
                  <p style={{ color: 'var(--color-text)' }}><strong>Design</strong> — Themes picks a look (or brings one from PowerPoint, or from your Brand Kit). Slide editor changes the words, pictures and slide order.</p>
                  <p style={{ color: 'var(--color-text)' }}><strong>Finish</strong> — Export makes an editable PPTX, a PDF, an HTML preview or per-slide PNGs.</p>
                  <p style={{ color: 'var(--color-text)' }}><strong>Library</strong> — My decks reopens, duplicates and deletes saved decks; opt-in recent decks are kept in this browser only.</p>
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  There is one canonical deck model behind the preview and every export, so they do not drift apart. Long jobs run in the background with progress, Cancel and Resume.
                </p>
              </ToolInfoModal>
            )}

            <Tooltip text="Go back to the list of jobs (brief, document, brand, saved deck).">
              <button
                type="button"
                onClick={backToStart}
                className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
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

            <Tooltip text="Filter the tool list below by name or description.">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tools…"
                className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none focus:border-[var(--color-primary)]"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </Tooltip>

            {filteredGroups.map((group) => {
              const open = openGroup === group.id || Boolean(query);
              return (
                <div key={group.id}>
                  <Tooltip text={group.tip} side="right">
                    <button
                      type="button"
                      onClick={() => setOpenGroup((prev) => (prev === group.id ? null : group.id))}
                      className="text-xs font-semibold w-full text-left py-1 transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {open ? '▼' : '▶'} {group.label}
                    </button>
                  </Tooltip>
                  {open && (
                    <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                      {group.tools.map((t) => (
                        <li key={t.id}>
                          <Tooltip text={TOOL_TIPS[t.id]} side="right">
                            <button
                              type="button"
                              onClick={() => openToolById(t.id)}
                              className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                              style={{
                                background: tool === t.id ? 'var(--color-bg)' : 'transparent',
                                color: tool === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                              }}
                            >
                              {t.label}
                            </button>
                          </Tooltip>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </aside>

          <main data-tour="presentations-main" className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 max-w-6xl">
            {tool !== 'start' && (
              <BackToJobs onBack={backToStart} toolLabel={labelFor(tool)} goal={stepIndex(goal, tool) >= 0 ? goal : null} />
            )}
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {tool === 'start' && 'Turn a brief, document, web page or set of pictures into a small slide deck you can edit and export.'}
              {tool === 'create' && 'Write a brief and let the workspace models make a first deck in your chosen theme.'}
              {tool === 'import' && 'Bring text and pictures in from files or a web page, ready for Create deck.'}
              {tool === 'templates' && 'Choose the look of the deck before you generate it, or apply your Brand Kit.'}
              {tool === 'slides' && 'Edit the words, pictures and order of the slides, then save the deck.'}
              {tool === 'export' && 'Download the deck as PPTX, PDF, HTML or per-slide PNGs.'}
              {tool === 'decks' && 'Saved decks and decks recently opened on this device.'}
            </p>

            {tool === 'start' && (
              <div data-tour="presentations-jobs">
                <JobStart
                  goals={PRESENTATION_GOALS}
                  intro="Pick what you are trying to make. We will open just the tools you need, in order."
                  onPick={startGoal}
                  labelFor={labelFor}
                  openOnLast={openOnLast}
                  onToggleOpenOnLast={(on) => { setOpenOnLast(on); writeLocal(OPEN_ON_LAST_KEY, on ? '1' : '0'); }}
                  appName="Presentations"
                />
              </div>
            )}
            <JobBar goal={goal} mode={tool} onStep={openToolById} labelFor={labelFor} carry="the deck stays with you" />

            {job && <JobStatusCard />}

            {tool !== 'start' && <div className="space-y-6">{renderTools()}</div>}
          </main>
        </div>

        {helpTool && TOOL_HELP[helpTool] && (
          <ToolInfoModal title={TOOL_HELP[helpTool].title} onClose={() => setHelpTool(null)}>
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

        <PresentationsGuide
          currentTool={tool}
          onOpenTool={openToolById}
          model={effectiveModel}
          models={chatModels}
          canSelectModel={canSelectModel}
          onModelChange={setChatModel}
        />
      </VoiceInputProvider>
    </PresentationContext.Provider>
  );
}
