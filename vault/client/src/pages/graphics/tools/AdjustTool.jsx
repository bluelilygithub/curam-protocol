import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect, useReducer, useMemo } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, useProcessingWhile, loadImageInto, UrlImportRow, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';
import { ADJUST_DEFAULTS, initialHistory, reducer, valuesOf, canUndo, canRedo, describeSteps } from '../adjustHistory.mjs';

// One entry per slider. `group` starts a new heading above it.
const SLIDERS = [
  { key: 'brightness', label: 'Brightness', min: 0.3, max: 2, step: 0.01, fmt: (v) => Number(v).toFixed(2), tip: 'Makes the whole image lighter or darker.' },
  { key: 'contrast', label: 'Contrast', min: 0.3, max: 2, step: 0.01, fmt: (v) => Number(v).toFixed(2), tip: 'Increases or decreases the difference between light and dark areas.' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, fmt: (v) => Number(v).toFixed(2), tip: 'Makes colours more vivid (higher) or more muted/grey (lower).' },
  { key: 'hue', label: 'Hue shift', min: 0, max: 360, step: 1, fmt: (v) => `${v}°`, tip: 'Rotates every colour around the colour wheel by this many degrees.' },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 10, step: 0.1, fmt: (v) => Number(v).toFixed(1), tip: 'Increases edge definition to make details look crisper.' },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, fmt: (v) => (v > 0 ? `+${v}` : `${v}`), tip: 'Shifts the overall colour warmer (orange) or cooler (blue).' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1, fmt: (v) => `${v}%`, tip: 'Darkens the corners of the image to draw attention to the centre.' },
  { key: 'blackPoint', label: 'Black point', min: 0, max: 254, step: 1, fmt: (v) => `${v}`, group: 'Levels', tip: 'Any pixel darker than this becomes pure black — raises shadow contrast.' },
  { key: 'whitePoint', label: 'White point', min: 1, max: 255, step: 1, fmt: (v) => `${v}`, tip: 'Any pixel lighter than this becomes pure white — raises highlight contrast.' },
  { key: 'gamma', label: 'Gamma (midtones)', min: 1, max: 3, step: 0.01, fmt: (v) => Number(v).toFixed(2), tip: 'Brightens or darkens the mid-tones without affecting pure black or white.' },
  { key: 'blur', label: 'Blur', min: 0, max: 30, step: 0.5, fmt: (v) => Number(v).toFixed(1), tip: 'Softens the whole image.' },
  { key: 'denoise', label: 'Noise reduction', min: 0, max: 13, step: 1, fmt: (v) => (v > 0 ? `${v % 2 === 0 ? Number(v) + 1 : v}px` : 'off'), tip: 'Smooths out grain and speckling, especially in low-light photos.' },
];
const LABELS = Object.fromEntries(SLIDERS.map((s) => [s.key, s.label]));
const FORMATS = Object.fromEntries(SLIDERS.map((s) => [s.key, s.fmt]));
const isDefault = (v) => Object.keys(ADJUST_DEFAULTS).every((k) => Number(v[k]) === Number(ADJUST_DEFAULTS[k]));

export default function AdjustTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  const [adjPresets, setAdjPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('graphics.adjustPresets') || '[]'); } catch { return []; }
  });
  const [adjPresetName, setAdjPresetName] = useState('');
  const [adjSource, setAdjSource] = useState(null);
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjResult, setAdjResult] = useState(null);
  const [adjError, setAdjError] = useState('');

  // The sliders are the ticked steps of this list (see adjustHistory.mjs). While a slider is being dragged, `draft` holds its value;
  // it becomes a step when the person lets go.
  const [hist, dispatch] = useReducer(reducer, undefined, initialHistory);
  const vals = useMemo(() => valuesOf(hist), [hist]);
  const [draft, setDraft] = useState(null); // { key, value }
  const shown = (key) => (draft && draft.key === key ? draft.value : vals[key]);
  const steps = useMemo(() => describeSteps(hist, LABELS, FORMATS), [hist]);

  const commitDraft = () => {
    if (!draft) return;
    dispatch({ type: 'change', sets: { [draft.key]: draft.value } });
    setDraft(null);
  };

  // Adjust presets (localStorage).
  const persistAdjPresets = (next) => {
    setAdjPresets(next);
    try { localStorage.setItem('graphics.adjustPresets', JSON.stringify(next)); } catch { /* ignore quota */ }
  };

  const saveAdjPreset = () => {
    const name = adjPresetName.trim();
    if (!name) return;
    const next = [...adjPresets.filter(p => p.name !== name), { name, values: { ...vals } }];
    persistAdjPresets(next);
    setAdjPresetName('');
  };

  const deleteAdjPreset = (name) => persistAdjPresets(adjPresets.filter(p => p.name !== name));

  const runAdjust = async (values = vals) => {
    if (!adjSource?.imageDataUrl) return;
    setAdjBusy(true);
    setAdjError('');
    try {
      const res = await api.post('/api/graphics/adjust', { imageDataUrl: adjSource.imageDataUrl, ...Object.fromEntries(Object.keys(ADJUST_DEFAULTS).map((k) => [k, Number(values[k])])) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Adjust failed');
      setAdjResult(data);
    } catch (err) {
      setAdjError(err.message || 'Adjust failed');
    } finally {
      setAdjBusy(false);
    }
  };

  // Do a step-list action (tick, untick, undo, redo, back to a step, preset, reset) and show what it gives: the result follows the sliders.
  // With every slider back at its default the picture is simply the original, so there is nothing to ask the server for.
  const stepAction = (action) => {
    const next = reducer(hist, action);
    if (next === hist) return;
    setDraft(null);
    dispatch(action);
    if (!adjSource?.imageDataUrl) return;
    const values = valuesOf(next);
    if (isDefault(values)) { setAdjResult(null); setAdjError(''); } else { runAdjust(values); }
  };

  const applyAdjPreset = (name) => {
    const p = adjPresets.find(x => x.name === name);
    if (!p) return;
    const sets = Object.fromEntries(Object.keys(ADJUST_DEFAULTS).map((k) => [k, p.values?.[k] ?? ADJUST_DEFAULTS[k]]));
    stepAction({ type: 'change', sets, label: `Preset: ${name}` });
  };

  const resetAdjust = () => stepAction({ type: 'change', sets: ADJUST_DEFAULTS, label: 'Reset everything' });

  const startOver = () => { dispatch({ type: 'clear' }); setDraft(null); setAdjResult(null); setAdjError(''); };

  const applyNow = () => {
    const values = draft ? { ...vals, [draft.key]: draft.value } : vals;
    commitDraft();
    runAdjust(values);
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'adjust' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    dispatch({ type: 'clear' }); setDraft(null);
    setAdjResult(null); setAdjError(''); setAdjSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  // Ctrl/Cmd+Z undoes the latest step, Ctrl/Cmd+Shift+Z (or Ctrl+Y) brings it back: only while this tool is showing and no text box has the keyboard.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea' || (tag === 'input' && document.activeElement.type !== 'range')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepAction({ type: 'undo' }); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); stepAction({ type: 'redo' }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  useProcessingWhile(adjBusy ? 'Applying adjustments…' : null);

  const lastOnId = [...steps].reverse().find((s) => s.on)?.id;

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Adjust</h2>
            <button type="button" onClick={() => setHelpTool('adjust')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to adjust."><input type="file" accept="image/*" onChange={e => { startOver(); loadImageInto(setAdjSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <div className="mt-2"><UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setAdjError(err); } else { startOver(); setAdjSource(src); } })} /></div>
            </div>
            {adjSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={adjSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
              {SLIDERS.map((sl) => (
                <React.Fragment key={sl.key}>
                  {sl.group && (
                    <p className="sm:col-span-2 pt-2 mt-1 border-t text-[11px] font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{sl.group}</p>
                  )}
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{sl.label}: {sl.fmt(shown(sl.key))}</label>
                    <Tooltip text={sl.tip}><input
                      type="range"
                      min={sl.min}
                      max={sl.max}
                      step={sl.step}
                      value={shown(sl.key)}
                      onChange={e => setDraft({ key: sl.key, value: Number(e.target.value) })}
                      onPointerUp={commitDraft}
                      onKeyUp={commitDraft}
                      onBlur={commitDraft}
                      className="w-full"
                    /></Tooltip>
                  </div>
                </React.Fragment>
              ))}
            </div>
            {adjError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{adjError}</div>}
            <div className="flex items-center gap-2">
              <Tooltip text="Apply all the adjustments above to the image."><button type="button" onClick={applyNow} disabled={adjBusy || !adjSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {adjBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sliders', { size: 15 })}
                {adjBusy ? 'Applying...' : 'Apply adjustments'}
              </button></Tooltip>
              <Tooltip text="Put every slider back to its default value. This is one step in the list below, so you can undo it."><button type="button" onClick={resetAdjust} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset</button></Tooltip>
            </div>

            <div className="pt-3 mt-1 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }} data-tour="adjust-steps">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Your steps</p>
                <div className="flex items-center gap-1.5">
                  <Tooltip text="Take back the latest step (Ctrl+Z)."><button type="button" onClick={() => stepAction({ type: 'undo' })} disabled={!canUndo(hist)} className="text-xs px-2 py-1 rounded-lg border disabled:opacity-40 hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Undo</button></Tooltip>
                  <Tooltip text="Bring back the step you just took back (Ctrl+Shift+Z)."><button type="button" onClick={() => stepAction({ type: 'redo' })} disabled={!canRedo(hist)} className="text-xs px-2 py-1 rounded-lg border disabled:opacity-40 hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Redo</button></Tooltip>
                </div>
              </div>
              {steps.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Each change you make to a slider is listed here as a step. Untick any step to take just that change out, without losing the ones after it.</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {steps.map((st, i) => (
                    <li key={st.id} className="flex items-center gap-2 text-xs rounded-lg border px-2 py-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <span className="w-5 text-center" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                      <Tooltip text={st.on ? 'Untick to take this change out. The other steps stay.' : 'Tick to put this change back.'}><input type="checkbox" checked={st.on} onChange={() => stepAction({ type: 'toggle', id: st.id })} /></Tooltip>
                      <span className="flex-1 min-w-0 truncate" style={{ color: st.on ? 'var(--color-text)' : 'var(--color-muted)', textDecoration: st.on ? 'none' : 'line-through' }}>{st.text}</span>
                      {st.id !== lastOnId && (
                        <Tooltip text="Go back to how the picture looked right after this step: every later step is unticked (you can tick them again)."><button type="button" onClick={() => stepAction({ type: 'backTo', id: st.id })} className="hover:opacity-60 whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>Back to here</button></Tooltip>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pt-3 mt-1 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Presets</p>
              <div className="flex items-center gap-2">
                <Tooltip text="Name to save the current slider settings under."><input type="text" value={adjPresetName} onChange={e => setAdjPresetName(e.target.value)} placeholder="Preset name" className="flex-1 min-w-0 px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                <Tooltip text="Save the current slider settings under this name for reuse later."><button type="button" onClick={saveAdjPreset} disabled={!adjPresetName.trim()} className="px-3 py-2 rounded-xl text-sm border disabled:opacity-50 hover:opacity-80 whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Save current</button></Tooltip>
              </div>
              {adjPresets.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {adjPresets.map(p => (
                    <span key={p.name} className="inline-flex items-center gap-1 rounded-lg border text-xs" style={{ borderColor: 'var(--color-border)' }}>
                      <Tooltip text="Load this saved preset into the sliders above (one step in the list, so you can undo it)."><button type="button" onClick={() => applyAdjPreset(p.name)} className="pl-2 py-1 hover:opacity-70" style={{ color: 'var(--color-text)' }}>{p.name}</button></Tooltip>
                      <Tooltip text="Delete this saved preset."><button type="button" onClick={() => deleteAdjPreset(p.name)} className="px-1.5 py-1 hover:opacity-70" style={{ color: '#ef4444' }}>×</button></Tooltip>
                    </span>
                  ))}
                </div>
              ) : <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Save the current sliders as a named preset to reuse later.</p>}
            </div>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {adjResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(adjSource?.imageDataUrl, adjResult?.imageDataUrl)}
                  {renderSendTo(adjResult.imageDataUrl, `adjusted.${adjResult.format}`, 'adjust')}
                  {renderExport(adjResult.imageDataUrl, 'adjusted')}
                  <Tooltip text="Save the adjusted image to your device."><button onClick={() => downloadDataUrl(adjResult.imageDataUrl, `adjusted-${Date.now()}.${adjResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {adjResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(adjSource?.imageDataUrl, adjResult, { alt: 'result' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{adjResult.width}×{adjResult.height} · {String(adjResult.format).toUpperCase()} · {formatBytes(adjResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={adjSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
