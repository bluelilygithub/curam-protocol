import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, magicWandSelectionCanvas, tintSelectionCanvas, loadImageEl, useProcessingWhile, loadImageInto, UrlImportRow, renderExport, formatCost, CostNote } from '../shared';

export default function InpaintTool({ active }) {
  const getIcon = useIcon();
  const { handoff, registerResult, renderSendTo, setHelpTool, setPreviewImage } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();
  const mode = active ? 'inpaint' : null;

  const [inpaintSource, setInpaintSource] = useState(null);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintBrush, setInpaintBrush] = useState('40');
  const [inpaintBusy, setInpaintBusy] = useState(false);
  const [inpaintResult, setInpaintResult] = useState(null);
  const [inpaintError, setInpaintError] = useState('');
  const inpaintCanvasRef = useRef(null);
  const inpaintMaskRef = useRef(null);
  const inpaintImgRef = useRef(null);
  const inpaintDrawing = useRef(false);
  const [inpaintHasMask, setInpaintHasMask] = useState(false);
  const [inpaintSelectMode, setInpaintSelectMode] = useState('paint');

  // 'paint' | 'wand'
  const [inpaintTolerance, setInpaintTolerance] = useState(30);

  const drawInpaintBase = () => {
    const disp = inpaintCanvasRef.current;
    const mask = inpaintMaskRef.current;
    const img = inpaintImgRef.current;
    if (!disp || !mask || !img) return;
    const cap = 1024;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (Math.max(w, h) > cap) { const s = cap / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    disp.width = w; disp.height = h; mask.width = w; mask.height = h;
    disp.getContext('2d').drawImage(img, 0, 0, w, h);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, w, h);
    setInpaintHasMask(false);
  };

  const loadInpaint = (src) => { setInpaintError(''); setInpaintResult(null); setInpaintSource(src); };

  const inpaintPos = (e) => {
    const c = inpaintCanvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const inpaintPaint = (x, y) => {
    const disp = inpaintCanvasRef.current;
    const mask = inpaintMaskRef.current;
    if (!disp || !mask) return;
    const rect = disp.getBoundingClientRect();
    const scale = disp.width / (rect.width || disp.width);
    const r = Math.max(2, Number(inpaintBrush) * scale);
    const dctx = disp.getContext('2d');
    dctx.fillStyle = 'rgba(239,68,68,0.5)';
    dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill();
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
  };

  const inpaintWandAt = (x, y) => {
    const disp = inpaintCanvasRef.current;
    const mask = inpaintMaskRef.current;
    const img = inpaintImgRef.current;
    if (!disp || !mask || !img) return;
    const sel = magicWandSelectionCanvas(img, disp.width, disp.height, x, y, inpaintTolerance);
    mask.getContext('2d').drawImage(sel, 0, 0);
    disp.getContext('2d').drawImage(tintSelectionCanvas(sel, 'rgba(239,68,68,0.5)'), 0, 0);
    setInpaintHasMask(true);
  };

  const onInpaintDown = (e) => {
    const { x, y } = inpaintPos(e);
    if (inpaintSelectMode === 'wand') { inpaintWandAt(x, y); return; }
    inpaintDrawing.current = true; inpaintPaint(x, y); setInpaintHasMask(true);
  };

  const onInpaintMove = (e) => { if (inpaintSelectMode === 'wand' || !inpaintDrawing.current) return; const { x, y } = inpaintPos(e); inpaintPaint(x, y); };

  const onInpaintUp = () => { inpaintDrawing.current = false; };

  const clearInpaintMask = () => drawInpaintBase();

  const runInpaint = async () => {
    const mask = inpaintMaskRef.current;
    const img = inpaintImgRef.current;
    if (!mask || !img) { setInpaintError('Load an image first'); return; }
    if (!inpaintHasMask) { setInpaintError('Paint over the area you want to change'); return; }
    if (!inpaintPrompt.trim()) { setInpaintError('Describe what should fill the masked area'); return; }
    setInpaintBusy(true);
    setInpaintError('');
    setInpaintResult(null);
    try {
      const tmp = document.createElement('canvas');
      tmp.width = mask.width;
      tmp.height = mask.height;
      tmp.getContext('2d').drawImage(img, 0, 0, tmp.width, tmp.height);
      const res = await api.post('/api/graphics/inpaint', {
        imageDataUrl: tmp.toDataURL('image/png'),
        maskDataUrl: mask.toDataURL('image/png'),
        prompt: inpaintPrompt.trim(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Inpainting failed');
      setInpaintResult(data);
    } catch (err) {
      setInpaintError(err.message || 'Inpainting failed');
    } finally {
      setInpaintBusy(false);
    }
  };

  // Load the inpaint source onto the canvas (and reset the mask) when it changes.
  useEffect(() => {
    if (mode !== 'inpaint' || !inpaintSource?.imageDataUrl) return undefined;
    let cancelled = false;
    loadImageEl(inpaintSource.imageDataUrl)
      .then((img) => { if (!cancelled) { inpaintImgRef.current = img; drawInpaintBase(); } })
      .catch(() => { if (!cancelled) setInpaintError('Could not load that image.'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inpaintSource, mode]);

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'inpaint' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    loadInpaint(src); if (handoff.prompt) setInpaintPrompt(handoff.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  // Lets Ask Graphics read this tool's finished result back (it asks by tool id).
  useEffect(() => { registerResult('inpaint', () => inpaintResult?.imageDataUrl || null); }, [inpaintResult, registerResult]);

  useProcessingWhile(inpaintBusy ? 'Inpainting…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Inpaint / Remove</h2>
            <button type="button" onClick={() => setHelpTool('inpaint')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Hosted (FAL) · paid</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Paint over an area, then describe what should be there. The model repaints just the masked region. Requires the FAL image provider.</p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to paint a mask over."><input type="file" accept="image/*" onChange={e => loadImageInto(loadInpaint)(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setInpaintError(err); } else { loadInpaint(src); } })} />
            </div>
            {inpaintSource?.imageDataUrl && (
              <div className="space-y-2">
                <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <Tooltip text="Paint over the area you want the AI to repaint."><canvas
                    ref={inpaintCanvasRef}
                    onMouseDown={onInpaintDown}
                    onMouseMove={onInpaintMove}
                    onMouseUp={onInpaintUp}
                    onMouseLeave={onInpaintUp}
                    className="w-full rounded-lg"
                    style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
                  /></Tooltip>
                  <canvas ref={inpaintMaskRef} style={{ display: 'none' }} />
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip text="Paint mode: drag the brush over the area to repaint."><button type="button" onClick={() => setInpaintSelectMode('paint')} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: inpaintSelectMode === 'paint' ? 'var(--color-primary)' : 'transparent', color: inpaintSelectMode === 'paint' ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Paint</button></Tooltip>
                  <Tooltip text="Magic wand mode: click a spot and every connected pixel of a similar colour is selected automatically."><button type="button" onClick={() => setInpaintSelectMode('wand')} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: inpaintSelectMode === 'wand' ? 'var(--color-primary)' : 'transparent', color: inpaintSelectMode === 'wand' ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Magic wand</button></Tooltip>
                </div>
                {inpaintSelectMode === 'paint' ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Brush</span>
                    <Tooltip text="Size of the paint brush used to mark the area to repaint."><input type="range" min="6" max="120" step="2" value={inpaintBrush} onChange={e => setInpaintBrush(e.target.value)} className="flex-1" /></Tooltip>
                    <span className="text-[11px] w-8 text-right" style={{ color: 'var(--color-muted)' }}>{inpaintBrush}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Tolerance</span>
                    <Tooltip text="How similar neighbouring pixels must be to get selected. Higher picks up a wider range of colours; click again to add more to the selection."><input type="range" min="0" max="100" value={inpaintTolerance} onChange={e => setInpaintTolerance(Number(e.target.value))} className="flex-1" /></Tooltip>
                    <span className="text-[11px] w-8 text-right" style={{ color: 'var(--color-muted)' }}>{inpaintTolerance}</span>
                  </div>
                )}
                <Tooltip text="Erase the painted mask and start over."><button type="button" onClick={clearInpaintMask} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Clear mask</button></Tooltip>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>What should fill the area?</label>
              <Tooltip text="Describe what should appear in the masked (painted) area."><textarea value={inpaintPrompt} onChange={e => setInpaintPrompt(e.target.value)} rows={2} placeholder="e.g. empty grass, clear blue sky, a wooden table" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>To remove an object, describe the background that should replace it.</p>
            </div>
            {inpaintError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{inpaintError}</div>}
            <CostNote tool="inpaint" refreshKey={inpaintResult} />
            <Tooltip text="Send the mask and description to the AI to repaint the masked area."><button type="button" onClick={runInpaint} disabled={inpaintBusy || !inpaintSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {inpaintBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('eraser', { size: 15 })}
              {inpaintBusy ? 'Inpainting...' : 'Inpaint'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {inpaintResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(inpaintResult.imageDataUrl, 'inpainted.jpg', 'inpaint')}
                  {renderExport(inpaintResult.imageDataUrl, 'inpainted')}
                </div>
              )}
            </div>
            <div className="p-4">
              {inpaintResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(inpaintResult)} className="block w-full"><img src={inpaintResult.imageDataUrl} alt="inpainted" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  {inpaintResult.cost && <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{formatCost(inpaintResult.cost)}</p>}
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Your inpainted image will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
