import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, useProcessingWhile, loadImageInto, UrlImportRow, renderExport, formatBytes, ResultPlaceholder, useGraphicsRecipes } from '../shared';

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
  // Output format (blank = keep the picture's own) and the saved-recipe controls.
  const [pipeFormat, setPipeFormat] = useState('');
  const [pipeQuality, setPipeQuality] = useState('85');
  const { recipes, save: saveRecipeToServer, remove: removeRecipe } = useGraphicsRecipes();
  const [recipeId, setRecipeId] = useState(null);
  const [recipeName, setRecipeName] = useState('');
  const [recipeNote, setRecipeNote] = useState('');
  const [confirmDeleteRecipe, setConfirmDeleteRecipe] = useState(false);

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
    crop: { label: 'Crop to a shape', crop: true },
    watermark: { label: 'Add text (e.g. a name or ©)', text: true, color: true },
    logo: { label: 'Add my Brand Kit logo', logo: true },
  };
  const CROP_SHAPES = [['1:1', 'Square (1:1)'], ['4:5', 'Portrait (4:5)'], ['16:9', 'Wide (16:9)'], ['3:2', 'Photo (3:2)'], ['9:16', 'Story (9:16)'], ['4:3', 'Classic (4:3)']];
  const POSITIONS = [['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right'], ['bottom-left', 'Bottom left'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right']];

  const addPipeStep = () => {
    const def = PIPE_OP_DEFS[pipeStepOp];
    const step = { id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`, op: pipeStepOp };
    if (def?.param) step.value = def.param.def;
    if (def?.color) step.color = '#ffffff';
    if (def?.resize) { step.width = def.param.def; step.fit = 'inside'; }
    if (def?.crop) { step.aspect = '1:1'; step.strategy = 'attention'; }
    if (def?.text) { step.text = '© My Brand'; step.color = '#ffffff'; step.position = 'bottom-right'; step.opacity = 0.5; }
    if (def?.logo) { step.position = 'bottom-right'; step.scale = 20; step.opacity = 0.9; }
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

  const stepForServer = (s) => {
    const out = { op: s.op };
    if (s.value !== undefined) out.value = Number(s.value);
    if (s.color) out.color = s.color;
    if (s.op === 'resize') { out.width = Number(s.width) || undefined; out.fit = s.fit || 'inside'; }
    if (s.op === 'crop') { out.aspect = s.aspect; out.strategy = s.strategy; }
    if (s.op === 'watermark') { out.text = s.text; out.position = s.position; out.opacity = Number(s.opacity); }
    if (s.op === 'logo') { out.position = s.position; out.scale = Number(s.scale); out.opacity = Number(s.opacity); }
    return out;
  };

  const lossy = ['jpg', 'webp', 'avif'].includes(pipeFormat);

  const loadRecipe = (id) => {
    setConfirmDeleteRecipe(false);
    setRecipeNote('');
    const r = recipes.find((x) => String(x.id) === String(id));
    if (!r) { setRecipeId(null); return; }
    setRecipeId(r.id);
    setRecipeName(r.name);
    setPipeSteps(r.steps.map((st) => ({ ...st, id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}` })));
    setPipeFormat(r.outFormat || '');
    if (r.outQuality) setPipeQuality(String(r.outQuality));
    setPipeResult(null); setPipeError('');
  };

  const saveRecipe = async () => {
    setRecipeNote('');
    try {
      const sameName = recipes.find((x) => x.id === recipeId)?.name.toLowerCase() === recipeName.trim().toLowerCase();
      const saved = await saveRecipeToServer({
        id: sameName ? recipeId : undefined,
        name: recipeName,
        steps: pipeSteps.map(stepForServer),
        outFormat: pipeFormat || undefined,
        outQuality: lossy ? Number(pipeQuality) : undefined,
      });
      setRecipeId(saved.id);
      setRecipeNote(`Saved "${saved.name}". Run it on many pictures from Batch → Run a recipe.`);
    } catch (err) {
      setRecipeNote(err.message || 'Could not save the recipe');
    }
  };

  const deleteRecipe = async () => {
    const r = recipes.find((x) => x.id === recipeId);
    setConfirmDeleteRecipe(false);
    if (!r) return;
    try {
      await removeRecipe(r);
      setRecipeId(null); setRecipeName(''); setRecipeNote('');
    } catch (err) {
      setRecipeNote(err.message || 'Could not delete the recipe');
    }
  };

  const runPipeline = async () => {
    if (!pipeSource?.imageDataUrl || !pipeSteps.length) return;
    setPipeBusy(true);
    setPipeError('');
    setPipeResult(null);
    try {
      const steps = pipeSteps.map(stepForServer);
      const res = await api.post('/api/graphics/pipeline', { imageDataUrl: pipeSource.imageDataUrl, steps, format: pipeFormat || undefined, quality: lossy ? Number(pipeQuality) : undefined });
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
            <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>My recipes</label>
              <div className="flex items-center gap-2">
                <Tooltip text="Load one of your saved recipes into the step list below."><select value={recipeId ?? ''} onChange={e => loadRecipe(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="">{recipes.length ? 'Choose a saved recipe…' : 'No saved recipes yet'}</option>
                  {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select></Tooltip>
                {recipeId && !confirmDeleteRecipe && (
                  <Tooltip text="Delete this saved recipe. You can bring it back from the recycle bin for 30 days."><button type="button" onClick={() => setConfirmDeleteRecipe(true)} className="text-xs hover:opacity-70" style={{ color: '#ef4444' }}>Delete</button></Tooltip>
                )}
                {recipeId && confirmDeleteRecipe && (
                  <span className="text-xs flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
                    Delete?
                    <button type="button" className="font-medium hover:opacity-60" style={{ color: '#ef4444' }} onClick={deleteRecipe}>Yes</button>
                    <button type="button" className="font-medium hover:opacity-60" onClick={() => setConfirmDeleteRecipe(false)}>No</button>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Tooltip text="A name for the steps below. Saving under a name you already use replaces that recipe."><input type="text" value={recipeName} onChange={e => setRecipeName(e.target.value)} maxLength={80} placeholder="Name this recipe, e.g. Website hero" className="flex-1 px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                <Tooltip text="Save the steps and output format below so you can run them again on any picture or a whole batch."><button type="button" onClick={saveRecipe} disabled={!recipeName.trim() || !pipeSteps.length} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80 disabled:opacity-50 whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Save recipe</button></Tooltip>
              </div>
              {recipeNote && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{recipeNote}</p>}
            </div>
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
                      {def.crop && (
                        <div className="flex items-center gap-2">
                          <Tooltip text="The shape to crop to. The biggest area of that shape is kept, at full quality."><select value={s.aspect} onChange={e => updatePipeStep(s.id, { aspect: e.target.value })} className="flex-1 px-2 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            {CROP_SHAPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select></Tooltip>
                          <Tooltip text="Which part to keep: the most eye-catching part, the most detailed part, or the middle."><select value={s.strategy} onChange={e => updatePipeStep(s.id, { strategy: e.target.value })} className="flex-1 px-2 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            <option value="attention">Keep the main subject</option>
                            <option value="entropy">Keep the most detail</option>
                            <option value="centre">Keep the middle</option>
                          </select></Tooltip>
                        </div>
                      )}
                      {def.text && (
                        <Tooltip text="The words to put on the picture."><input type="text" value={s.text} maxLength={200} onChange={e => updatePipeStep(s.id, { text: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                      )}
                      {(def.text || def.logo) && (
                        <div className="flex items-center gap-2">
                          <Tooltip text="Where on the picture it goes."><select value={s.position} onChange={e => updatePipeStep(s.id, { position: e.target.value })} className="flex-1 px-2 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            {POSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select></Tooltip>
                          <Tooltip text="How solid it looks: low is faint, 1 is fully solid."><input type="range" min="0.1" max="1" step="0.05" value={s.opacity} onChange={e => updatePipeStep(s.id, { opacity: e.target.value })} className="flex-1" /></Tooltip>
                          {def.logo && (
                            <Tooltip text="How wide the logo is, as a percentage of the picture's width."><input type="range" min="5" max="60" step="1" value={s.scale} onChange={e => updatePipeStep(s.id, { scale: e.target.value })} className="flex-1" /></Tooltip>
                          )}
                        </div>
                      )}
                      {def.logo && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Uses the logo saved in Brand Kit (button above the tool list). A saved recipe keeps this by reference, so a new logo shows up in old recipes.</p>}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Save as</label>
              <Tooltip text="The file type of the finished picture. Leave on 'Keep' to stay in the picture's own type."><select value={pipeFormat} onChange={e => setPipeFormat(e.target.value)} className="px-2 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">Keep the picture's own type</option>
                <option value="webp">WebP</option>
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
                <option value="avif">AVIF</option>
              </select></Tooltip>
              {lossy && (
                <Tooltip text="Quality of the saved file: higher looks better and makes a bigger file."><input type="range" min="40" max="100" step="1" value={pipeQuality} onChange={e => setPipeQuality(e.target.value)} className="flex-1" /></Tooltip>
              )}
              {lossy && <span className="text-[11px] w-8 text-right" style={{ color: 'var(--color-muted)' }}>{pipeQuality}</span>}
            </div>
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
