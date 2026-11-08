import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { loadExcalidraw } from './loadExcalidraw';
import { fileNameFor, isDarkColour, saveLabel, sceneSignature } from './sceneLogic.mjs';
import { toClean, toSketch, lookDefaults, inkFromTheme, normaliseLook } from './lookConvert.mjs';
import { saveDrawingToNotes } from './saveDrawingToNotes.mjs';
import { layoutDiagram } from './diagramLayout.mjs';
import { readDiagram, numberingInput } from './sceneDiagram.mjs';
import { assignNumbers } from './shapeNumbers.mjs';

const SAVE_DELAY_MS = 1500; // a pause in drawing this long saves
const RETRY_MS = 6000; // after a failed save (offline, server busy) it tries again this often
const THUMB_MAX = 320;

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Vault's text colour for lines in the clean look (null in a dark theme: see lookConvert.inkFromTheme). */
function themeInk() {
  const cs = getComputedStyle(document.documentElement);
  return inkFromTheme(cs.getPropertyValue('--color-text'), isDarkColour(cs.getPropertyValue('--color-bg')));
}

const settleFonts = async () => {
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* measuring with what is loaded is fine */ }
};

/** The pieces as they would look in `toLook`, with their text re-measured for the new font; the same list when nothing needs changing. */
async function elementsForLook(lib, elements, fromLook, toLook) {
  if (fromLook === toLook) return elements;
  const c = toLook === 'clean' ? toClean(elements, { ink: themeInk() }) : toSketch(elements);
  if (!c.changed) return elements;
  await settleFonts();
  return lib.restoreElements(c.elements, null, { refreshDimensions: true });
}

/**
 * One drawing on the Excalidraw editor. Loads the drawing and the editor, saves by itself shortly after the last change (and again on
 * leaving), guards against two tabs overwriting each other, and exports a PNG, an SVG or a .excalidraw file.
 */
export default function DrawingEditor({ id, onSavedChange }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [lib, setLib] = useState(null);
  const [initial, setInitial] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [look, setLook] = useState('sketch'); // 'sketch' (hand-drawn) or 'clean' (see lookConvert.mjs)
  const [exportLook, setExportLook] = useState('same'); // the look of PNG and SVG pictures and of the picture sent to Notes: 'same' as the drawing, or 'clean' / 'sketch'
  const [notesOpen, setNotesOpen] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');
  // "Draw it for me": the words, a change to ask for, and the diagram drawn last time (so it can be changed; kept for this visit only)
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiChange, setAiChange] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [showNums, setShowNums] = useState(() => { try { return localStorage.getItem('vault:drawings:showNumbers') === '1'; } catch { return false; } }); // small numbers on the shapes (not part of the drawing)
  const [badges, setBadges] = useState([]); // [{ id, num, x, y }] where the numbers show, in pixels on the board
  const [suggest, setSuggest] = useState({ busy: false, list: null }); // What have I missed?
  const [readable, setReadable] = useState(null); // the diagram on the drawing that can be changed by voice: { count, others } or null
  // Stretching: 'keep' (a stretch keeps the shape: nothing is squashed) or 'free' (wider or taller on its own). Holding Shift does the opposite for one drag.
  const [keepShape, setKeepShape] = useState(() => { try { return localStorage.getItem('vault:drawings:keepShape') === '1'; } catch { return false; } });
  const [gridOn, setGridOn] = useState(false); // the board's grid: shown, and what is drawn or moved snaps to it
  const [linkedNotes, setLinkedNotes] = useState([]); // the person's notes that link back to this drawing (made by To Notes)
  const [notesMenu, setNotesMenu] = useState(false);

  const apiRef = useRef(null);
  const lookRef = useRef('sketch');
  const showNumsRef = useRef(showNums);
  showNumsRef.current = showNums;
  const numberingRef = useRef(false);
  const numberBoxesRef = useRef(() => {});
  const keepShapeRef = useRef(keepShape);
  keepShapeRef.current = keepShape;
  const listsLoaded = useRef(false);
  // The newest { elements, appState, files } the editor reported. Saves read THIS, never the editor itself: when the page is left the
  // editor has already been torn down and would report an empty drawing, which must never be saved over the real one.
  const latestRef = useRef(null);
  const sigRef = useRef(null); // fingerprint of what the server has
  const baseRef = useRef(null); // the server's "updatedAt" for it
  const titleRef = useRef('');
  const timerRef = useRef(null);
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const needsPreviewRef = useRef(false); // a drawing with pieces but no preview picture (for example one brought in from a file) gets its first preview on opening
  const leftRef = useRef(false); // set when the page is being left: the editor is going away and its reports no longer count
  const stoppedRef = useRef(false); // set when the server says it changed elsewhere: no more automatic saves
  const idRef = useRef(id);
  idRef.current = id;
  // what the server has: the drawing's pieces AND its look (a look change on an empty drawing is still a change to save)
  const fingerprint = (elements, files, appState) => `${sceneSignature(elements, files)}|${lookRef.current}|${appState && appState.gridModeEnabled ? 'grid' : ''}`;

  // ---- load the drawing and the editor ----
  useEffect(() => {
    let alive = true; // set inside the effect: a development double-mount must not leave it false
    setLib(null); setInitial(null); setLoadError(''); setStatus('idle'); sigRef.current = null; stoppedRef.current = false; latestRef.current = null; leftRef.current = false;
    (async () => {
      try {
        const [res, mod] = await Promise.all([api.get(`/api/drawings/${id}`), loadExcalidraw()]);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not open that diagram.');
        if (!alive) return;
        const d = data.drawing;
        let scene = null;
        try { scene = JSON.parse(d.scene); } catch { scene = null; }
        const restored = mod.restore(scene || { type: 'excalidraw', elements: [], appState: {}, files: {} }, null, null);
        const dark = isDarkColour(getComputedStyle(document.documentElement).getPropertyValue('--color-bg'));
        lookRef.current = normaliseLook(d.look);
        setLook(lookRef.current);
        setExportLook('same');
        sigRef.current = fingerprint(restored.elements, restored.files, restored.appState);
        setGridOn(!!restored.appState.gridModeEnabled);
        baseRef.current = d.updatedAt;
        titleRef.current = d.title;
        needsPreviewRef.current = !d.thumbnail && d.elementCount > 0;
        setTitle(d.title);
        setSavedAt(new Date(d.updatedAt));
        setStatus('saved');
        setInitial({
          elements: restored.elements,
          files: restored.files,
          // new pieces start in the drawing's own look (clean: steady lines, square corners, plain font)
          appState: { ...restored.appState, ...lookDefaults(lookRef.current, { ink: themeInk() }), theme: restored.appState.theme || (dark ? 'dark' : 'light'), collaborators: new Map() },
        });
        setLib(mod);
      } catch (err) {
        if (alive) setLoadError(err.message || 'Could not open that diagram.');
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // ---- the notes this drawing was sent to ----
  const loadLinkedNotes = useCallback(async () => {
    try {
      const res = await api.get(`/api/drawings/${idRef.current}/notes`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.notes)) setLinkedNotes(data.notes);
    } catch { /* the button just stays hidden: it is a convenience */ }
  }, []);
  useEffect(() => { setLinkedNotes([]); setNotesMenu(false); loadLinkedNotes(); }, [id, loadLinkedNotes]);

  // ---- undo and redo ----
  // The board keeps its own history (every drawing, move, stretch, look switch and diagram is a step) and has Undo / Redo arrows at its
  // bottom left. The shortcuts (Ctrl+Z, Ctrl+Shift+Z) work anywhere on the page (handleKeyboardGlobally). The history belongs to this visit.

  // ---- stretching: keep the shape or free ----
  // The board keeps a stretched shape's proportions only while Shift is held. To make that a choice that stays, while (and only while) a
  // stretch is under way the board is told Shift is held when "Keep shape" is on (and not held when it is off); holding the real Shift
  // then does the opposite for that one drag. Pictures already work the other way round on the board, so they are left alone.
  useEffect(() => {
    let armed = false; // the press began on a stretch handle (the board shows a resize cursor there), so even the first movement counts
    const arm = (e) => { const c = (e.target && e.target.style && e.target.style.cursor) || ''; armed = /-resize$/.test(c); };
    const decide = (e) => {
      const ex = apiRef.current;
      if (!ex) return;
      const st = ex.getAppState();
      if (!st.isResizing && !armed) return;
      const picked = st.selectedElementIds || {};
      if (ex.getSceneElements().some((el) => picked[el.id] && el.type === 'image')) return;
      const want = keepShapeRef.current ? !e.shiftKey : e.shiftKey;
      Object.defineProperty(e, 'shiftKey', { get: () => want, configurable: true });
    };
    const decideAndDisarm = (e) => { decide(e); armed = false; };
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('pointermove', decide, true);
    window.addEventListener('pointerup', decideAndDisarm, true);
    return () => { window.removeEventListener('pointerdown', arm, true); window.removeEventListener('pointermove', decide, true); window.removeEventListener('pointerup', decideAndDisarm, true); };
  }, []);
  const chooseKeepShape = (v) => {
    setKeepShape(v);
    try { localStorage.setItem('vault:drawings:keepShape', v ? '1' : '0'); } catch { /* the choice just is not remembered */ }
  };

  // ---- saving ----
  const buildThumbnail = useCallback(async (elements, appState, files) => {
    if (!elements.some((e) => !e.isDeleted)) return null;
    try {
      const blob = await lib.exportToBlob({ elements, appState: { ...appState, exportBackground: true }, files, mimeType: 'image/jpeg', quality: 0.6, maxWidthOrHeight: THUMB_MAX });
      const url = await blobToDataUrl(blob);
      return url.length <= 140 * 1024 ? url : undefined; // too big for the list: keep the old preview
    } catch { return undefined; }
  }, [lib]);

  const save = useCallback(async () => {
    const cur = latestRef.current;
    if (!cur || !lib || stoppedRef.current) return;
    if (savingRef.current) { againRef.current = true; return; }
    const { elements, files } = cur;
    const sig = fingerprint(elements, files, cur.appState);
    if (sig === sigRef.current) { setStatus('saved'); return; }
    savingRef.current = true;
    againRef.current = false;
    setStatus('saving');
    try {
      const appState = cur.appState;
      const body = { scene: lib.serializeAsJSON(elements, appState, files, 'local'), look: lookRef.current, baseUpdatedAt: baseRef.current };
      const thumb = await buildThumbnail(elements, appState, files);
      if (thumb !== undefined) body.thumbnail = thumb;
      const res = await api.put(`/api/drawings/${idRef.current}`, body);
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) { stoppedRef.current = true; setStatus('changed'); return; }
      if (!res.ok) {
        const retry = res.status >= 500;
        setStatusDetail(data.error || '');
        setStatus('error');
        if (retry) timerRef.current = setTimeout(save, RETRY_MS);
        return;
      }
      sigRef.current = sig;
      baseRef.current = data.drawing.updatedAt;
      setSavedAt(new Date(data.drawing.updatedAt));
      setStatusDetail('');
      setStatus('saved');
      if (onSavedChange) onSavedChange();
    } catch {
      setStatusDetail('');
      setStatus('error');
      timerRef.current = setTimeout(save, RETRY_MS); // offline or the server is busy: keep the drawing on screen and try again
    } finally {
      savingRef.current = false;
      if (againRef.current && !stoppedRef.current) { againRef.current = false; save(); }
    }
  }, [lib, buildThumbnail, onSavedChange]);

  const onChange = useCallback((elements, appState, files) => {
    if (sigRef.current === null || stoppedRef.current || leftRef.current) return;
    latestRef.current = { elements, appState, files };
    // "Draw it for me" sits in the board's More tools menu (as the board's own text-to-diagram entry). The board would open its own dialog for it;
    // instead that dialog is closed at once and our panel opens.
    if (appState.openDialog && appState.openDialog.name === 'ttd' && appState.openDialog.tab === 'text-to-diagram') {
      if (apiRef.current) apiRef.current.updateScene({ appState: { openDialog: null }, captureUpdate: lib && lib.CaptureUpdateAction ? lib.CaptureUpdateAction.NEVER : undefined });
      setNotesOpen(false); setAiOpen(true);
    }
    if (needsPreviewRef.current) { needsPreviewRef.current = false; sigRef.current = 'preview'; } // makes the next check see a change, so a first save (with its preview) happens
    // shape numbers: where the little numbers go, and any box that has none yet gets one
    if (showNumsRef.current && elements.length < 800) {
      const z = appState.zoom.value;
      const next = elements.filter((e) => !e.isDeleted && e.customData && e.customData.vaultNo && (e.type === 'rectangle' || e.type === 'diamond' || e.type === 'ellipse'))
        .map((e) => ({ id: e.id, num: e.customData.vaultNo, x: Math.round((e.x + appState.scrollX) * z), y: Math.round((e.y + appState.scrollY) * z) }));
      setBadges((old) => (old.length === next.length && old.every((o, i) => o.id === next[i].id && o.num === next[i].num && o.x === next[i].x && o.y === next[i].y) ? old : next));
      if (!numberingRef.current) {
        const inp = numberingInput(elements);
        if (inp.boxes.some((b) => !b.num)) { numberingRef.current = true; setTimeout(() => { numberBoxesRef.current(); numberingRef.current = false; }, 0); }
      }
    }
    // what is selected, and the grid: for the buttons above the board
    const picked = appState.selectedElementIds || {};
    setGridOn((g) => (g === !!appState.gridModeEnabled ? g : !!appState.gridModeEnabled));
    if (fingerprint(elements, files, appState) === sigRef.current) return;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save, lib]);

  // Leaving the drawing (back to the list, another page) saves what is waiting. The latest save is kept in a ref so this only runs on leaving.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    leftRef.current = true;
    if (latestRef.current && !stoppedRef.current) saveRef.current();
  }, []);
  useEffect(() => {
    const warn = (e) => {
      if (status === 'dirty' || status === 'saving' || status === 'error') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  // Go to one of those notes. Anything still waiting is saved first, as for "Your drawings".
  const openNote = async (noteId) => {
    setNotesMenu(false);
    clearTimeout(timerRef.current);
    await save();
    navigate(`/notes?note=${noteId}`);
  };

  const goBack = async () => {
    clearTimeout(timerRef.current);
    await save();
    navigate('/drawings');
  };

  const saveTitle = async () => {
    const next = title.trim();
    if (!next) { setTitle(titleRef.current); return; }
    if (next === titleRef.current) return;
    try {
      const res = await api.put(`/api/drawings/${id}`, { title: next, baseUpdatedAt: baseRef.current });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) { stoppedRef.current = true; setStatus('changed'); return; }
      if (!res.ok) throw new Error(data.error || 'Could not rename it.');
      titleRef.current = data.drawing.title;
      baseRef.current = data.drawing.updatedAt;
      setTitle(data.drawing.title);
    } catch (err) {
      addToast(err.message, 'error');
      setTitle(titleRef.current);
    }
  };

  // ---- shape numbers ----
  // Each box (with writing in it) carries a number in its customData.vaultNo, given once and kept: a step put in between two others gets a
  // sub-number (4.1), anything else the next whole number. The little numbers on screen are separate (an overlay), so they never print or export.
  const numberBoxes = () => {
    const ex = apiRef.current;
    if (!ex || !lib) return;
    const els = ex.getSceneElements();
    const inp = numberingInput(els);
    const given = assignNumbers(inp.boxes, inp.edges, inp.taken);
    if (!given.size) return;
    ex.updateScene({
      elements: els.map((e) => (given.has(e.id) ? { ...e, customData: { ...(e.customData || {}), vaultNo: given.get(e.id) }, version: (e.version || 0) + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() } : e)),
      captureUpdate: lib.CaptureUpdateAction.NEVER,
    });
    latestRef.current = { elements: ex.getSceneElements(), appState: ex.getAppState(), files: ex.getFiles() };
    markDirty();
  };
  numberBoxesRef.current = numberBoxes;
  const toggleNumbers = () => {
    const next = !showNums;
    setShowNums(next);
    showNumsRef.current = next;
    try { localStorage.setItem('vault:drawings:showNumbers', next ? '1' : '0'); } catch { /* not remembered */ }
    if (next) numberBoxes(); else setBadges([]);
    const ex = apiRef.current;
    if (ex && next) ex.updateScene({ appState: { selectedElementIds: ex.getAppState().selectedElementIds }, captureUpdate: lib.CaptureUpdateAction.NEVER }); // makes the board report once, so the numbers appear
  };

  // ---- Draw it for me ----
  // Lays a diagram structure out and puts it on the drawing as ordinary pieces (one Undo removes it). A change REPLACES the diagram it was
  // read from (readDiagram: its boxes, writing and arrows), in the same place, so anything else on the drawing is untouched.
  const refreshReadable = () => {
    const ex = apiRef.current;
    if (!ex) { setReadable(null); return; }
    const r = readDiagram(ex.getSceneElements(), ex.getAppState().selectedElementIds);
    setReadable(r && !r.tooBig ? { count: r.count, others: r.others } : null);
  };
  useEffect(() => { if (aiOpen) refreshReadable(); }, [aiOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const placeDiagram = async (diagram, replace) => {
    const ex = apiRef.current;
    const existing = ex.getSceneElements();
    const run = Date.now().toString(36);
    const oldIds = replace ? replace.ids : new Set();
    const old = existing.filter((e) => !e.isDeleted && oldIds.has(e.id));
    const others = existing.filter((e) => !e.isDeleted && !oldIds.has(e.id) && !(e.containerId && oldIds.has(e.containerId)));
    let origin;
    if (old.length) origin = { x: Math.min(...old.map((e) => e.x)), y: Math.min(...old.map((e) => e.y)) };
    else if (others.length) origin = { x: Math.min(...others.map((e) => e.x)), y: Math.max(...others.map((e) => e.y + (e.height || 0))) + 110 }; // below what is already there
    else { const st = ex.getAppState(); origin = { x: -st.scrollX + 80 / st.zoom.value, y: -st.scrollY + 120 / st.zoom.value }; } // top left of what is on screen
    // shape numbers: boxes the AI kept keep theirs; new ones get one (a sub-number when put in between two others)
    const taken = numberingInput(existing).taken;
    const given = assignNumbers(diagram.nodes, diagram.edges, taken);
    diagram = { ...diagram, nodes: diagram.nodes.map((n) => (given.has(n.id) ? { ...n, num: given.get(n.id) } : n)) };
    const { skeleton } = layoutDiagram(diagram, { origin, runId: run });
    let made = lib.convertToExcalidrawElements(skeleton);
    if (lookRef.current === 'clean') made = toClean(made, { ink: themeInk() }).elements; // drawn in the drawing's own look
    const goneNow = (e) => oldIds.has(e.id) || (e.containerId && oldIds.has(e.containerId));
    const kept = existing.map((e) => (goneNow(e) && !e.isDeleted ? { ...e, isDeleted: true, version: (e.version || 0) + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() } : e));
    ex.updateScene({
      elements: [...kept, ...made],
      appState: { selectedElementIds: Object.fromEntries(made.filter((e) => !e.containerId).map((e) => [e.id, true])) },
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    });
    ex.scrollToContent(made, { fitToContent: true, viewportZoomFactor: 0.85, animate: true }); // fits a big diagram on screen, but never zooms a small one in
    if (lookRef.current === 'clean') { // the plain font is measured once it has loaded
      await settleFonts();
      ex.updateScene({ elements: lib.restoreElements(ex.getSceneElements(), null, { refreshDimensions: true }), captureUpdate: lib.CaptureUpdateAction.NEVER });
    }
    latestRef.current = { elements: ex.getSceneElements(), appState: ex.getAppState(), files: ex.getFiles() };
    markDirty();
  };

  const drawFromWords = async (change, wordsOverride) => {
    const ex = apiRef.current;
    if (!ex || !lib || aiBusy) return;
    const words = (wordsOverride != null ? wordsOverride : (change ? aiChange : aiText)).trim();
    if (!words) { addToast(change ? 'Say what to change first.' : 'Say or type what you want drawn first.', 'error'); return; }
    let cur = null;
    if (change) {
      numberBoxes(); // every box has a number before the AI sees the diagram
      cur = readDiagram(ex.getSceneElements(), ex.getAppState().selectedElementIds);
      if (!cur) { addToast('There is no diagram here to change yet: boxes with writing in them, joined by arrows.', 'error'); return; }
      if (cur.tooBig) { addToast(`That diagram has ${cur.count} boxes, more than can be changed by voice (40).`, 'error'); return; }
    }
    setAiBusy(true);
    startProcessing(change ? 'Changing your diagram…' : 'Drawing your diagram…', 'The AI is working out the boxes and arrows from your words. This takes a few seconds.');
    try {
      const res = await api.post('/api/drawings/diagram', change ? { previous: cur.diagram, instruction: words } : { text: words });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.diagram) throw new Error(data.error || 'The diagram could not be drawn. Try again.');
      // the panel closes so the diagram gets the whole board; reopen it to change the diagram or draw another
      setAiOpen(false);
      await new Promise((r) => setTimeout(r, 300)); // let the board take its full size before it zooms to fit
      await placeDiagram(data.diagram, cur);
      if (change) { setAiChange(''); setSuggest({ busy: false, list: null }); }
      addToast('Drawn. Move, edit or Undo it like anything else.', 'success');
    } catch (err) {
      addToast(err.message || 'The diagram could not be drawn. Try again.', 'error');
    } finally {
      stopProcessing();
      setAiBusy(false);
    }
  };

  // ---- What have I missed? ----
  const askSuggestions = async () => {
    const ex = apiRef.current;
    if (!ex || !lib || suggest.busy) return;
    numberBoxes();
    const cur = readDiagram(ex.getSceneElements(), ex.getAppState().selectedElementIds);
    if (!cur || cur.tooBig) { addToast(cur && cur.tooBig ? 'That diagram is too big to look over (40 boxes at most).' : 'There is no diagram here to look over yet.', 'error'); return; }
    setSuggest({ busy: true, list: null });
    startProcessing('Looking over your diagram…', 'The AI is reading the boxes and arrows for anything missed. This takes a few seconds.');
    try {
      const res = await api.post('/api/drawings/suggestions', { diagram: cur.diagram });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.suggestions)) throw new Error(data.error || 'The suggestions could not be made. Try again.');
      setSuggest({ busy: false, list: data.suggestions });
    } catch (err) {
      setSuggest({ busy: false, list: null });
      addToast(err.message || 'The suggestions could not be made. Try again.', 'error');
    } finally {
      stopProcessing();
    }
  };

  // ---- snap to grid, select all, fit to screen ----
  const toggleGrid = () => {
    const ex = apiRef.current;
    if (!ex) return;
    const next = !ex.getAppState().gridModeEnabled;
    ex.updateScene({ appState: { gridModeEnabled: next }, captureUpdate: lib.CaptureUpdateAction.NEVER });
    setGridOn(next);
    latestRef.current = { elements: ex.getSceneElements(), appState: ex.getAppState(), files: ex.getFiles() };
    markDirty(); // the grid choice is saved with the drawing
  };
  const selectAll = () => {
    const ex = apiRef.current;
    if (!ex) return;
    const ids = {};
    ex.getSceneElements().forEach((e) => { if (!e.isDeleted) ids[e.id] = true; });
    ex.updateScene({ appState: { selectedElementIds: ids, activeTool: { ...ex.getAppState().activeTool, type: 'selection' } }, captureUpdate: lib.CaptureUpdateAction.NEVER });
  };
  const fitToScreen = () => {
    const ex = apiRef.current;
    if (!ex) return;
    const els = ex.getSceneElements().filter((e) => !e.isDeleted);
    if (els.length) ex.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.85, animate: true }); // zooms in or out so everything fills the screen
  };

  // ---- the look: sketch or clean ----
  const markDirty = () => {
    setStatus((st) => (st === 'saving' ? st : 'dirty'));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, SAVE_DELAY_MS);
  };
  const applyLook = async (next) => {
    const ex = apiRef.current;
    if (!ex || !lib || next === lookRef.current) return;
    const ink = themeInk();
    const c = next === 'clean' ? toClean(ex.getSceneElements(), { ink }) : toSketch(ex.getSceneElements());
    lookRef.current = next;
    setLook(next);
    // one undo step brings the old look back; new pieces now start in this look
    ex.updateScene({ elements: c.elements, appState: lookDefaults(next, { ink }), captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY });
    // text is measured with its font, so once the new fonts are in, re-measure without adding a second undo step
    await settleFonts();
    ex.updateScene({ elements: lib.restoreElements(ex.getSceneElements(), null, { refreshDimensions: true }), captureUpdate: lib.CaptureUpdateAction.NEVER });
    latestRef.current = { elements: ex.getSceneElements(), appState: ex.getAppState(), files: ex.getFiles() };
    markDirty();
    addToast(c.changed ? `${c.changed} piece${c.changed === 1 ? '' : 's'} made ${next === 'clean' ? 'clean' : 'sketchy'}. Switch back any time.` : `New pieces will now be drawn ${next === 'clean' ? 'clean' : 'sketchy'}.`, 'success');
  };

  // ---- export, and Save to Notes ----
  // The scene as PNG and SVG pictures and the Notes picture should show it: in the drawing's own look, or converted for the picture only.
  const sceneForPicture = async () => {
    const ex = apiRef.current;
    const target = exportLook === 'same' ? lookRef.current : exportLook;
    const elements = await elementsForLook(lib, ex.getSceneElements(), lookRef.current, target);
    return { elements, files: ex.getFiles(), appState: { ...ex.getAppState(), exportBackground: true, exportEmbedScene: true } };
  };

  const exportScene = async (kind) => {
    const ex = apiRef.current;
    if (!ex || !lib) return;
    if (!ex.getSceneElements().some((e) => !e.isDeleted)) { addToast('The diagram is empty, so there is nothing to export.', 'error'); return; }
    try {
      if (kind === 'png') {
        download(fileNameFor(title, 'png'), await lib.exportToBlob({ ...(await sceneForPicture()), mimeType: 'image/png' }));
      } else if (kind === 'svg') {
        const svg = await lib.exportToSvg(await sceneForPicture());
        download(fileNameFor(title, 'svg'), new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      } else {
        // the file is always the drawing exactly as it is, so opening it again gives the same drawing
        download(fileNameFor(title, 'excalidraw'), new Blob([lib.serializeAsJSON(ex.getSceneElements(), ex.getAppState(), ex.getFiles(), 'local')], { type: 'application/json' }));
      }
    } catch (err) {
      addToast(`Could not export: ${err.message || 'something went wrong'}`, 'error');
    }
  };

  const openNotesPanel = () => {
    setAiOpen(false);
    setNotesOpen((v) => !v);
    if (listsLoaded.current) return;
    listsLoaded.current = true;
    api.get('/api/projects').then((r) => r.json()).then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/api/clients?status=active').then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : [])).catch(() => {});
  };

  const saveToNotes = async () => {
    const ex = apiRef.current;
    if (!ex || !lib) return;
    if (!ex.getSceneElements().some((e) => !e.isDeleted)) { addToast('The diagram is empty, so there is nothing to put in a note.', 'error'); return; }
    setSavingNote(true);
    const open = (noteId) => ({ label: 'Open', onClick: () => window.open(`/notes?note=${noteId}`, '_blank', 'noopener') });
    try {
      clearTimeout(timerRef.current);
      await save(); // the drawing itself is saved first, so the link back to it in the note works
      const png = await lib.exportToBlob({ ...(await sceneForPicture()), mimeType: 'image/png' });
      const { noteId } = await saveDrawingToNotes({
        api, title, drawingId: idRef.current, png,
        projectId: projectId ? Number(projectId) : null, clientId: clientId ? Number(clientId) : null,
      });
      addToast('Saved to Notes ✓', 'success', undefined, open(noteId));
      setNotesOpen(false);
      loadLinkedNotes();
    } catch (err) {
      addToast(err.message || 'That could not be saved to Notes. Try again.', 'error', undefined, err.noteId ? open(err.noteId) : undefined);
    } finally {
      setSavingNote(false);
    }
  };

  if (loadError) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{loadError}</p>
        <button type="button" className={BTN} style={BTN_STYLE} onClick={() => navigate('/drawings')}>{getIcon('arrow-left', { size: 14 })} Back to your drawings</button>
      </div>
    );
  }

  const Excalidraw = lib && lib.Excalidraw;
  const Menu = lib && lib.MainMenu;
  const bad = status === 'error' || status === 'changed';

  // Undo / Redo, Keep shape / Free and Select all sit in the drawing area (the board's top right), not in the bar above it.
  const renderBoardTools = () => {
    // the board defines its own --color-primary and friends inside itself, so Vault's values are read from the page and put back for these controls
    const root = getComputedStyle(document.documentElement);
    const vars = {};
    ['--color-bg', '--color-surface', '--color-border', '--color-primary', '--color-text', '--color-muted', '--color-on-primary'].forEach((k) => { const v = root.getPropertyValue(k).trim(); if (v) vars[k] = v; });
    return (
    <div className="flex flex-wrap items-center justify-end gap-2" style={{ maxWidth: '38rem', ...vars }}>
          <div role="group" aria-label="When stretching" className="inline-flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }} data-tour="drawings-stretch">
            {[
              [true, 'Keep shape', 'When you drag a corner to stretch what is selected (one thing, or everything with Select all), it grows or shrinks evenly so nothing is squashed or bent out of shape. Text and arrows scale with it. Hold Shift while dragging to stretch freely for that one drag.'],
              [false, 'Free', 'When you drag a corner to stretch what is selected, it can be made wider or taller on its own, so the shape can change. Hold Shift while dragging to keep the shape for that one drag.'],
            ].map(([val, label, tip]) => (
              <Tooltip key={label} text={tip}>
                <button
                  type="button" aria-pressed={keepShape === val} disabled={!lib}
                  onClick={() => chooseKeepShape(val)}
                  className="px-3 py-1.5 text-xs transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                  style={{ background: keepShape === val ? 'var(--color-primary)' : 'var(--color-surface)', color: keepShape === val ? '#fff' : 'var(--color-text)' }}
                >{label}</button>
              </Tooltip>
            ))}
          </div>
          <Tooltip text="Select everything on the diagram (boxes, arrows and text), ready to stretch or move together. Ctrl+A does the same.">
            <button type="button" disabled={!lib} onClick={selectAll} className={BTN} style={BTN_STYLE}>Select all</button>
          </Tooltip>
    </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <Tooltip text="Go back to your list of diagrams. Anything still waiting is saved first.">
          <button type="button" className={BTN} style={BTN_STYLE} onClick={goBack}>{getIcon('arrow-left', { size: 14 })} Your diagrams</button>
        </Tooltip>
        <div className="w-56 sm:w-72">
          <Tooltip text="The name of this diagram. Type or say a new one and press Enter.">
            <div className="w-full" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.querySelector('input')?.blur(); } }}>
              <VoiceInput value={title} onChange={setTitle} onBlur={saveTitle} placeholder="Name this diagram" label="Diagram name" />
            </div>
          </Tooltip>
        </div>
        <Tooltip text={status === 'changed' ? 'This diagram was saved from another tab. Reload this page to see the newer version.' : 'Your diagram saves by itself a moment after you stop diagram.'}>
          <span className="text-xs" role="status" aria-live="polite" style={{ color: bad ? '#b45309' : 'var(--color-muted)' }}>
            {saveLabel(status, savedAt, statusDetail)}
          </span>
        </Tooltip>
        {status === 'changed' && (
          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => window.location.reload()}>Reload</button>
        )}
        <div role="group" aria-label="Look of the diagram" className="inline-flex rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }} data-tour="drawings-look">
          {[
            ['sketch', 'Sketch', 'The hand-drawn look. Switching is reversible: every piece remembers how it was drawn, so going back to Sketch gives you exactly what you drew.'],
            ['clean', 'Clean', "A conservative look: steady straight lines, square corners, straight arrows, solid fills, a plain font and Vault's own text colour for lines. Pieces you drew in your own colours keep them. Use Undo or switch back to Sketch to return."],
          ].map(([id2, label, tip]) => (
            <Tooltip key={id2} text={tip}>
              <button
                type="button" aria-pressed={look === id2} disabled={!lib || !Excalidraw}
                onClick={() => applyLook(id2)}
                className="px-3 py-1.5 text-xs transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                style={{ background: look === id2 ? 'var(--color-primary)' : 'var(--color-surface)', color: look === id2 ? '#fff' : 'var(--color-text)' }}
              >{label}</button>
            </Tooltip>
          ))}
        </div>
        <Tooltip text="Zoom so the whole diagram fills the screen, bigger or smaller as needed.">
          <button type="button" disabled={!lib} onClick={fitToScreen} className={BTN} style={BTN_STYLE}>Fit to screen</button>
        </Tooltip>
        <Tooltip text={gridOn ? 'The grid is on: what you draw and move snaps to it. Press to turn it off.' : 'Show a grid and snap what you draw and move to it, so boxes line up neatly. The choice is saved with the diagram.'}>
          <button type="button" disabled={!lib} aria-pressed={gridOn} onClick={toggleGrid} className={BTN} style={{ ...BTN_STYLE, ...(gridOn ? { background: 'var(--color-primary)', color: '#fff' } : {}) }}>
            Snap to grid
          </button>
        </Tooltip>
        <Tooltip text={showNums ? 'Numbers are showing on the shapes so you can refer to them (for example: add a step after 7). They are not part of the diagram and do not print or export. Press to hide them.' : 'Show a small number on each shape so you can refer to it when asking for changes (for example: add a step after 7). The numbers never print or export.'}>
          <button type="button" disabled={!lib} aria-pressed={showNums} onClick={toggleNumbers} className={BTN} style={{ ...BTN_STYLE, ...(showNums ? { background: 'var(--color-primary)', color: '#fff' } : {}) }}>
            Numbers
          </button>
        </Tooltip>
        <div className="flex flex-wrap items-center gap-2 ml-auto" data-tour="drawings-export">
          <Tooltip text="The look of the PNG and SVG pictures and of the picture sent to Notes. 'Same' follows the diagram; the others change the picture only, never the diagram. The .excalidraw file is always the diagram exactly as it is.">
            <select
              value={exportLook} onChange={(e) => setExportLook(e.target.value)} aria-label="Look of pictures"
              className="px-2 py-1.5 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="same">Pictures: same look</option>
              <option value="clean">Pictures: clean</option>
              <option value="sketch">Pictures: sketch</option>
            </select>
          </Tooltip>
          <Tooltip text="Save a PNG picture of the whole diagram to your computer.">
            <button type="button" className={BTN} style={BTN_STYLE} disabled={!lib} onClick={() => exportScene('png')}>{getIcon('image', { size: 13 })} PNG</button>
          </Tooltip>
          <Tooltip text="Save an SVG picture (sharp at any size) of the whole diagram to your computer.">
            <button type="button" className={BTN} style={BTN_STYLE} disabled={!lib} onClick={() => exportScene('svg')}>{getIcon('image', { size: 13 })} SVG</button>
          </Tooltip>
          <Tooltip text="Save the diagram as a file ending in .excalidraw. You can open it again with Open a file, or in other Excalidraw programs.">
            <button type="button" className={BTN} style={BTN_STYLE} disabled={!lib} onClick={() => exportScene('file')}>{getIcon('download', { size: 13 })} File</button>
          </Tooltip>
          <div className="relative" data-tour="drawings-notes">
            <Tooltip text={linkedNotes.length === 0 ? 'Put this diagram in a new note: the picture is attached and shown inside the note, with a link back to the diagram.' : (linkedNotes.length === 1 ? `This diagram is in a note (${linkedNotes[0].title}). Go to it, or put it in another note.` : `This diagram is in ${linkedNotes.length} notes. Choose one to go to it, or put it in another note.`)}>
              <button
                type="button" className={BTN} style={BTN_STYLE} disabled={!lib}
                aria-haspopup={linkedNotes.length ? 'menu' : undefined} aria-expanded={linkedNotes.length ? notesMenu : notesOpen}
                onClick={() => (linkedNotes.length ? setNotesMenu((v) => !v) : openNotesPanel())}
              >{getIcon('file-text', { size: 13 })} {linkedNotes.length === 0 ? 'To Notes' : (linkedNotes.length === 1 ? 'In a note' : `In ${linkedNotes.length} notes`)}</button>
            </Tooltip>
            {notesMenu && linkedNotes.length > 0 && (
              <ul role="menu" className="absolute right-0 mt-1 z-20 min-w-[14rem] max-w-xs rounded-xl border p-1 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                {linkedNotes.map((n) => (
                  <li key={n.id} role="none">
                    <button type="button" role="menuitem" onClick={() => { setNotesMenu(false); openNote(n.id); }} className="block w-full text-left px-3 py-1.5 rounded-lg text-xs truncate transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-text)' }}>
                      Go to: {n.title || 'Untitled'}
                    </button>
                  </li>
                ))}
                <li role="none">
                  <button type="button" role="menuitem" onClick={() => { setNotesMenu(false); openNotesPanel(); }} className="block w-full text-left px-3 py-1.5 rounded-lg text-xs border-t transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
                    Put in another note
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>
      </div>
      {aiOpen && (
        <div className="px-3 py-2 border-b space-y-2 shrink-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Say or type what you want drawn: the steps of a process, who reports to whom, an idea with branches, or things in order. It is drawn as boxes and arrows you can move and change.
            This uses one AI request. Only the words you put here are sent, never your diagrams.
          </p>
          <Tooltip text="Describe what to draw. Press the microphone and just talk, or type. Name the steps, people or ideas and how they lead on.">
            <div className="w-full">
              <VoiceInput type="textarea" append rows={3} value={aiText} onChange={setAiText} label="Describe what to draw" placeholder="For example: A customer calls, the receptionist books a visit, the surveyor attends, then we send the quote. If the customer says no, we close the job." />
            </div>
          </Tooltip>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Draw it now. It goes onto this diagram (below anything already there) in the look the diagram is in. One Undo removes it.">
              <button type="button" disabled={aiBusy || !aiText.trim()} onClick={() => drawFromWords(false)} className="px-4 py-1.5 rounded-xl text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
                {aiBusy ? 'Drawing…' : 'Draw it'}
              </button>
            </Tooltip>
          </div>
          {readable && (
            <div className="space-y-1 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Change this diagram{readable.others ? ` (the one you have selected, or the biggest of ${readable.others + 1})` : ''}: {readable.count} boxes. Say what to change, for example insert a step, add one at the start or the end, or add a loop back. Turn on Numbers to refer to a box by its number, like after 7. It is redrawn in the same place, so boxes you moved by hand in it are laid out again.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[14rem]" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); drawFromWords(true); } }}>
                  <Tooltip text="What to change, for example: add a step after the visit, make it left to right, or leave out the last box.">
                    <div className="w-full">
                      <VoiceInput value={aiChange} onChange={setAiChange} label="What to change" placeholder="For example: add a step after 7, or after the visit" />
                    </div>
                  </Tooltip>
                </div>
                <Tooltip text="Redraw the diagram with this change.">
                  <button type="button" disabled={aiBusy || !aiChange.trim()} onClick={() => drawFromWords(true)} className={BTN} style={BTN_STYLE}>Change it</button>
                </Tooltip>
                <Tooltip text="Have the AI look over the diagram and list what you may not have considered: a Yes or No with nowhere to go, a step that could wait forever, no clear end, and so on. It changes nothing until you press Add this on one of its suggestions.">
                  <button type="button" disabled={aiBusy || suggest.busy} onClick={askSuggestions} className={BTN} style={BTN_STYLE} data-tour="drawings-missed">{getIcon('sparkles', { size: 13 })} {suggest.busy ? 'Looking…' : 'What have I missed?'}</button>
                </Tooltip>
              </div>
              {suggest.list && (
                <div className="space-y-1.5 pt-1" aria-live="polite">
                  {suggest.list.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing important stands out. The AI only sees what is drawn, so it may still be missing something only you know.</p>}
                  {suggest.list.map((s, i) => (
                    <div key={`${i}-${s.text}`} className="flex flex-wrap items-start gap-2 rounded-xl border px-2.5 py-1.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <div className="flex-1 min-w-[14rem] text-xs" style={{ color: 'var(--color-text)' }}>
                        {s.about.length > 0 && <span className="mr-1.5 font-medium" style={{ color: 'var(--color-primary)' }}>{s.about.join(', ')}</span>}
                        {s.text}
                      </div>
                      {s.change && (
                        <Tooltip text={`Make this change to the diagram: ${s.change}`}>
                          <button type="button" disabled={aiBusy} onClick={() => drawFromWords(true, s.change)} className={BTN} style={BTN_STYLE}>Add this</button>
                        </Tooltip>
                      )}
                      <Tooltip text="Hide this suggestion.">
                        <button type="button" onClick={() => setSuggest((p) => ({ ...p, list: p.list.filter((_, j) => j !== i) }))} className={BTN} style={BTN_STYLE} aria-label="Dismiss this suggestion">Dismiss</button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {notesOpen && (
        <div className="flex flex-wrap items-end gap-3 px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Makes a new note named “{title || 'Diagram'}” with this diagram inside it. Optionally file it:</p>
          <label className="block space-y-0.5">
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Project</span>
            <Tooltip text="File the new note under one of your projects. Leave it empty to file it later.">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="block px-2 py-1.5 rounded-xl border text-xs" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.title}</option>)}
              </select>
            </Tooltip>
          </label>
          <label className="block space-y-0.5">
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Client</span>
            <Tooltip text="File the new note under one of your clients. Leave it empty to file it later.">
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="block px-2 py-1.5 rounded-xl border text-xs" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">No client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Tooltip>
          </label>
          <Tooltip text="Save the note now. The diagram is saved first, then a picture of it (in the look chosen at the top) is attached to the new note.">
            <button type="button" disabled={savingNote} onClick={saveToNotes} className="px-4 py-1.5 rounded-xl text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              {savingNote ? 'Saving…' : 'Save to Notes'}
            </button>
          </Tooltip>
        </div>
      )}
      <div className="flex-1 min-h-0 relative" data-tour="drawings-board">
        {showNums && badges.length > 0 && (
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 2 }}>
            {badges.map((b) => (
              <span key={b.id} className="absolute rounded-full px-1.5 text-[10px] leading-4 font-medium" style={{ left: b.x, top: b.y, transform: 'translate(-35%, -60%)', background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>{b.num}</span>
            ))}
          </div>
        )}
        {!Excalidraw && (
          <div className="p-6 max-w-sm"><Skeleton lines={3} label="Loading the board" /></div>
        )}
        {Excalidraw && initial && (
          <Excalidraw
            excalidrawAPI={(a) => { apiRef.current = a; }}
            initialData={initial}
            onChange={onChange}
            langCode="en"
            handleKeyboardGlobally
            renderTopRightUI={renderBoardTools}
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: true } }}
          >
            {lib.TTDDialogTrigger && <lib.TTDDialogTrigger icon={getIcon('sparkles', { size: 16 })}>Draw it for me</lib.TTDDialogTrigger>}
            <Menu>
              <Menu.DefaultItems.SaveAsImage />
              <Menu.DefaultItems.ClearCanvas />
              <Menu.DefaultItems.ToggleTheme />
              <Menu.DefaultItems.ChangeCanvasBackground />
              <Menu.DefaultItems.Help />
            </Menu>
          </Excalidraw>
        )}
      </div>
    </div>
  );
}
