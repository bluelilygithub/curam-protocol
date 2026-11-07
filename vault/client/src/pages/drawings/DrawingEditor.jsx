import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { loadExcalidraw } from './loadExcalidraw';
import { fileNameFor, isDarkColour, saveLabel, sceneSignature } from './sceneLogic.mjs';

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

/**
 * One drawing on the Excalidraw editor. Loads the drawing and the editor, saves by itself shortly after the last change (and again on
 * leaving), guards against two tabs overwriting each other, and exports a PNG, an SVG or a .excalidraw file.
 */
export default function DrawingEditor({ id, onSavedChange }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [lib, setLib] = useState(null);
  const [initial, setInitial] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  const apiRef = useRef(null);
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

  // ---- load the drawing and the editor ----
  useEffect(() => {
    let alive = true; // set inside the effect: a development double-mount must not leave it false
    setLib(null); setInitial(null); setLoadError(''); setStatus('idle'); sigRef.current = null; stoppedRef.current = false; latestRef.current = null; leftRef.current = false;
    (async () => {
      try {
        const [res, mod] = await Promise.all([api.get(`/api/drawings/${id}`), loadExcalidraw()]);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not open that drawing.');
        if (!alive) return;
        const d = data.drawing;
        let scene = null;
        try { scene = JSON.parse(d.scene); } catch { scene = null; }
        const restored = mod.restore(scene || { type: 'excalidraw', elements: [], appState: {}, files: {} }, null, null);
        const dark = isDarkColour(getComputedStyle(document.documentElement).getPropertyValue('--color-bg'));
        sigRef.current = sceneSignature(restored.elements, restored.files);
        baseRef.current = d.updatedAt;
        titleRef.current = d.title;
        needsPreviewRef.current = !d.thumbnail && d.elementCount > 0;
        setTitle(d.title);
        setSavedAt(new Date(d.updatedAt));
        setStatus('saved');
        setInitial({
          elements: restored.elements,
          files: restored.files,
          appState: { ...restored.appState, theme: restored.appState.theme || (dark ? 'dark' : 'light'), collaborators: new Map() },
        });
        setLib(mod);
      } catch (err) {
        if (alive) setLoadError(err.message || 'Could not open that drawing.');
      }
    })();
    return () => { alive = false; };
  }, [id]);

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
    const sig = sceneSignature(elements, files);
    if (sig === sigRef.current) { setStatus('saved'); return; }
    savingRef.current = true;
    againRef.current = false;
    setStatus('saving');
    try {
      const appState = cur.appState;
      const body = { scene: lib.serializeAsJSON(elements, appState, files, 'local'), baseUpdatedAt: baseRef.current };
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
    if (needsPreviewRef.current) { needsPreviewRef.current = false; sigRef.current = 'preview'; } // makes the next check see a change, so a first save (with its preview) happens
    if (sceneSignature(elements, files) === sigRef.current) return;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

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

  // ---- export ----
  const exportScene = async (kind) => {
    const ex = apiRef.current;
    if (!ex || !lib) return;
    const elements = ex.getSceneElements();
    if (!elements.some((e) => !e.isDeleted)) { addToast('The drawing is empty, so there is nothing to export.', 'error'); return; }
    const appState = { ...ex.getAppState(), exportBackground: true, exportEmbedScene: true };
    const files = ex.getFiles();
    try {
      if (kind === 'png') {
        download(fileNameFor(title, 'png'), await lib.exportToBlob({ elements, appState, files, mimeType: 'image/png' }));
      } else if (kind === 'svg') {
        const svg = await lib.exportToSvg({ elements, appState, files });
        download(fileNameFor(title, 'svg'), new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      } else {
        download(fileNameFor(title, 'excalidraw'), new Blob([lib.serializeAsJSON(elements, ex.getAppState(), files, 'local')], { type: 'application/json' }));
      }
    } catch (err) {
      addToast(`Could not export: ${err.message || 'something went wrong'}`, 'error');
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <Tooltip text="Go back to your list of drawings. Anything still waiting is saved first.">
          <button type="button" className={BTN} style={BTN_STYLE} onClick={goBack}>{getIcon('arrow-left', { size: 14 })} Your drawings</button>
        </Tooltip>
        <div className="w-56 sm:w-72">
          <Tooltip text="The name of this drawing. Type or say a new one and press Enter.">
            <div className="w-full" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.querySelector('input')?.blur(); } }}>
              <VoiceInput value={title} onChange={setTitle} onBlur={saveTitle} placeholder="Name this drawing" label="Drawing name" />
            </div>
          </Tooltip>
        </div>
        <Tooltip text={status === 'changed' ? 'This drawing was saved from another tab. Reload this page to see the newer version.' : 'Your drawing saves by itself a moment after you stop drawing.'}>
          <span className="text-xs" role="status" aria-live="polite" style={{ color: bad ? '#b45309' : 'var(--color-muted)' }}>
            {saveLabel(status, savedAt, statusDetail)}
          </span>
        </Tooltip>
        {status === 'changed' && (
          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => window.location.reload()}>Reload</button>
        )}
        <div className="flex flex-wrap items-center gap-2 ml-auto" data-tour="drawings-export">
          <Tooltip text="Save a PNG picture of the whole drawing to your computer.">
            <button type="button" className={BTN} style={BTN_STYLE} disabled={!lib} onClick={() => exportScene('png')}>{getIcon('image', { size: 13 })} PNG</button>
          </Tooltip>
          <Tooltip text="Save an SVG picture (sharp at any size) of the whole drawing to your computer.">
            <button type="button" className={BTN} style={BTN_STYLE} disabled={!lib} onClick={() => exportScene('svg')}>{getIcon('image', { size: 13 })} SVG</button>
          </Tooltip>
          <Tooltip text="Save the drawing as a file ending in .excalidraw. You can open it again with Open a file, or in other Excalidraw programs.">
            <button type="button" className={BTN} style={BTN_STYLE} disabled={!lib} onClick={() => exportScene('file')}>{getIcon('download', { size: 13 })} File</button>
          </Tooltip>
        </div>
      </div>
      <div className="flex-1 min-h-0" data-tour="drawings-board">
        {!Excalidraw && (
          <div className="p-6 max-w-sm"><Skeleton lines={3} label="Loading the drawing board" /></div>
        )}
        {Excalidraw && initial && (
          <Excalidraw
            excalidrawAPI={(a) => { apiRef.current = a; }}
            initialData={initial}
            onChange={onChange}
            langCode="en"
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: true } }}
          >
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
