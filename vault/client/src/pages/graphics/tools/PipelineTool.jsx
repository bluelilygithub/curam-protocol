import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, useProcessingWhile, loadImageInto, UrlImportRow, renderExport, formatBytes, ResultPlaceholder } from '../shared';

export default function PipelineTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderSendTo, setHelpTool, setPreviewImage } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  const [pipeSource, setPipeSource] = useState(null);
  const [pipeSteps, setPipeSteps] = useState([]);
  const [pipeStepOp, setPipeStepOp] = useState('grayscale');
  const [pipeBusy, setPipeBusy] = useState(false);
  const [pipeResult, setPipeResult] = useState(null);
  const [pipeError, setPipeError] = useState('');

  // Pipeline builder: ordered list of whitelisted ops applied server-side.
  const PIPE_OP_DEFS = {
    grayscale: { label: 'Grayscale', param: null },
    sepia: { label: 'Sepia', param: null },
    invert: { label: 'Invert', param: null },
    flip: { label: 'Flip vertical', param: null },
    flop: { label: 'Mirror horizontal', param: null },
    blur: { label: 'Blur', param: { min: 0.3, max: 60, step: 0.5, def: 5 } },
    sharpen: { label: 'Sharpen', param: { min: 0.3, max: 10, step: 0.1, def: 2 } },
    brightness: { label: 'Brightness', param: { min: 0.3, max: 2, step: 0.01, def: 1 } },
    contrast: { label: 'Contrast', param: { min: 0.3, max: 2, step: 0.01, def: 1 } },
    saturation: { label: 'Saturation', param: { min: 0, max: 2, step: 0.01, def: 1 } },
    gamma: { label: 'Gamma', param: { min: 1, max: 3, step: 0.01, def: 1 } },
    temperature: { label: 'Temperature', param: { min: -100, max: 100, step: 1, def: 0 } },
    rotate: { label: 'Rotate (angle)', param: { min: -180, max: 180, step: 1, def: 90 } },
    border: { label: 'Border', param: { min: 0, max: 200, step: 1, def: 24 }, color: true },
    resize: { label: 'Resize (width px)', param: { min: 16, max: 8000, step: 1, def: 1200 }, resize: true },
  };

  const addPipeStep = () => {
    const def = PIPE_OP_DEFS[pipeStepOp];
    const step = { id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`, op: pipeStepOp };
    if (def?.param) step.value = def.param.def;
    if (def?.color) step.color = '#ffffff';
    if (def?.resize) { step.width = def.param.def; step.fit = 'inside'; }
    setPipeSteps(prev => [...prev, step]);
  };

  const updatePipeStep = (id, patch) => setPipeSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  const removePipeStep = (id) => setPipeSteps(prev => prev.filter(s => s.id !== id));

  const movePipeStep = (id, dir) => setPipeSteps(prev => {
    const i = prev.findIndex(s => s.id === id);
    if (i < 0) return prev;
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const copy = [...prev];
    const [x] = copy.splice(i, 1);
    copy.splice(j, 0, x);
    return copy;
  });

  const runPipeline = async () => {
    if (!pipeSource?.imageDataUrl || !pipeSteps.length) return;
    setPipeBusy(true);
    setPipeError('');
    setPipeResult(null);
    try {
      const steps = pipeSteps.map(s => {
        const out = { op: s.op };
        if (s.value !== undefined) out.value = Number(s.value);
        if (s.color) out.color = s.color;
        if (s.op === 'resize') { out.width = Number(s.width) || undefined; out.fit = s.fit || 'inside'; }
        return out;
      });
      const res = await api.post('/api/graphics/pipeline', { imageDataUrl: pipeSource.imageDataUrl, steps });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Pipeline failed');
      setPipeResult(data);
    } catch (err) {
      setPipeError(err.message || 'Pipeline failed');
    } finally {
      setPipeBusy(false);
    }
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'pipeline' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setPipeResult(null); setPipeError(''); setPipeSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(pipeBusy ? 'Running pipeline…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Pipeline</h2>
            <button type="button" onClick={() => setHelpTool('pipeline')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Build a sequence of edits and apply them in order, in one pass. Up to 12 steps.</p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to run the pipeline of edits on."><input type="file" accept="image/*" onChange={e => { setPipeResult(null); setPipeError(''); loadImageInto(setPipeSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setPipeError(err); } else { setPipeResult(null); setPipeError(''); setPipeSource(src); } })} />
            </div>
            {pipeSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={pipeSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Tooltip text="Choose an edit to add to the pipeline."><select value={pipeStepOp} onChange={e => setPipeStepOp(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {Object.entries(PIPE_OP_DEFS).map(([id, d]) => <option key={id} value={id}>{d.label}</option>)}
              </select></Tooltip>
              <Tooltip text="Add the selected edit as the next step in the pipeline (up to 12 steps)."><button type="button" onClick={addPipeStep} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80 whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>+ Add step</button></Tooltip>
            </div>
            {pipeSteps.length === 0 ? (
              <div className="rounded-xl border px-4 py-5 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>No steps yet — add one above.</div>
            ) : (
              <div className="space-y-2">
                {pipeSteps.map((s, i) => {
                  const def = PIPE_OP_DEFS[s.op] || {};
                  return (
                    <div key={s.id} className="rounded-xl border px-3 py-2 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] w-5 text-center" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                        <span className="text-sm font-medium flex-1" style={{ color: 'var(--color-text)' }}>{def.label || s.op}</span>
                        <Tooltip text="Move this step earlier in the sequence."><button type="button" onClick={() => movePipeStep(s.id, -1)} disabled={i === 0} className="text-xs px-1.5 py-0.5 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↑</button></Tooltip>
                        <Tooltip text="Move this step later in the sequence."><button type="button" onClick={() => movePipeStep(s.id, 1)} disabled={i === pipeSteps.length - 1} className="text-xs px-1.5 py-0.5 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↓</button></Tooltip>
                        <Tooltip text="Remove this step from the pipeline."><button type="button" onClick={() => removePipeStep(s.id)} className="text-xs hover:opacity-70" style={{ color: '#ef4444' }}>Remove</button></Tooltip>
                      </div>
                      {def.param && (
                        <div className="flex items-center gap-2">
                          <input type="range" min={def.param.min} max={def.param.max} step={def.param.step} value={s.op === 'resize' ? s.width : s.value} onChange={e => updatePipeStep(s.id, s.op === 'resize' ? { width: e.target.value } : { value: e.target.value })} className="flex-1" title={`Adjust the strength of this ${def.label || s.op} step.`} />
                          <span className="text-[11px] w-12 text-right" style={{ color: 'var(--color-muted)' }}>{s.op === 'resize' ? `${s.width}px` : Number(s.value).toFixed(def.param.step < 1 ? 2 : 0)}</span>
                        </div>
                      )}
                      {def.color && (
                        <Tooltip text="Colour used by this step."><input type="color" value={s.color} onChange={e => updatePipeStep(s.id, { color: e.target.value })} className="h-7 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {pipeError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{pipeError}</div>}
            <Tooltip text="Run every step in the pipeline on the image, in order."><button type="button" onClick={runPipeline} disabled={pipeBusy || !pipeSource?.imageDataUrl || !pipeSteps.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {pipeBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('workflow', { size: 15 })}
              {pipeBusy ? 'Running...' : 'Run pipeline'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {pipeResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(pipeResult.imageDataUrl, `pipeline.${pipeResult.format}`, 'pipeline')}
                  {renderExport(pipeResult.imageDataUrl, 'pipeline')}
                </div>
              )}
            </div>
            <div className="p-4">
              {pipeResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(pipeResult)} className="block w-full"><img src={pipeResult.imageDataUrl} alt="pipeline result" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{pipeResult.steps} step{pipeResult.steps === 1 ? '' : 's'} · {pipeResult.width}×{pipeResult.height} · {formatBytes(pipeResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={pipeSource?.imageDataUrl} message="Your processed image will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
