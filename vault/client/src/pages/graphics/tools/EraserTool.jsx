import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { magicWandSelectionCanvas, restoreWithinSelection, downloadDataUrl, loadImageInto } from '../shared';

export default function EraserTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();
  const mode = active ? 'eraser' : null;

  // Eraser (client-side canvas)
  const [eraserSource, setEraserSource] = useState(null);

  const [eraserBrush, setEraserBrush] = useState(30);
  const [eraserMode, setEraserMode] = useState('erase');

  // 'erase' | 'restore'
  const [eraserSelectMode, setEraserSelectMode] = useState('paint');

  // 'paint' | 'wand'
  const [eraserTolerance, setEraserTolerance] = useState(30);

  const [eraserCanUndo, setEraserCanUndo] = useState(false);
  const [eraserCanRedo, setEraserCanRedo] = useState(false);
  const eraserCanvasRef = useRef(null);
  const eraserImgRef = useRef(null);
  const eraserIsDrawingRef = useRef(false);
  const eraserLastRef = useRef(null);
  const eraserUndoRef = useRef([]);
  const eraserRedoRef = useRef([]);

  // Inpaint: paint a white mask (red overlay on screen) over the area to change.
  // ── Eraser ──────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'eraser' || !eraserSource?.imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      eraserImgRef.current = img;
      const canvas = eraserCanvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      eraserUndoRef.current = [];
      eraserRedoRef.current = [];
      setEraserCanUndo(false);
      setEraserCanRedo(false);
    };
    img.src = eraserSource.imageDataUrl;
  }, [mode, eraserSource]);

  const eraserPos = (e) => {
    const c = eraserCanvasRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const eraserApplyDot = (from, to) => {
    const canvas = eraserCanvasRef.current;
    const img = eraserImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const radius = Math.max(3, Number(eraserBrush)) * (canvas.width / rect.width) * 0.5;
    const dist = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    const steps = from ? Math.max(1, Math.ceil(dist / (radius * 0.4))) : 1;
    const startP = from || to;
    ctx.save();
    for (let i = 0; i <= steps; i++) {
      const t = steps > 0 ? i / steps : 0;
      const cx = startP.x + (to.x - startP.x) * t;
      const cy = startP.y + (to.y - startP.y) * t;
      if (eraserMode === 'restore') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fill();
      }
    }
    ctx.restore();
  };

  const eraserWandAt = (x, y) => {
    const canvas = eraserCanvasRef.current;
    const img = eraserImgRef.current;
    if (!canvas || !img) return;
    const sel = magicWandSelectionCanvas(img, canvas.width, canvas.height, x, y, eraserTolerance);
    const ctx = canvas.getContext('2d');
    if (eraserMode === 'restore') {
      ctx.drawImage(restoreWithinSelection(img, sel, canvas.width, canvas.height), 0, 0);
    } else {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(sel, 0, 0);
      ctx.restore();
    }
  };

  const onEraserDown = (e) => {
    const p = eraserPos(e);
    if (!p) return;
    e.preventDefault();
    const canvas = eraserCanvasRef.current;
    if (canvas) {
      const snap = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      eraserUndoRef.current = [...eraserUndoRef.current, snap].slice(-20);
      eraserRedoRef.current = [];
      setEraserCanUndo(true);
      setEraserCanRedo(false);
    }
    if (eraserSelectMode === 'wand') { eraserWandAt(p.x, p.y); return; }
    eraserIsDrawingRef.current = true;
    eraserLastRef.current = p;
    eraserApplyDot(null, p);
  };

  const onEraserMove = (e) => {
    if (eraserSelectMode === 'wand' || !eraserIsDrawingRef.current) return;
    const p = eraserPos(e);
    if (!p) return;
    eraserApplyDot(eraserLastRef.current, p);
    eraserLastRef.current = p;
  };

  const onEraserUp = () => { eraserIsDrawingRef.current = false; eraserLastRef.current = null; };

  const undoEraser = () => {
    const snap = eraserUndoRef.current[eraserUndoRef.current.length - 1];
    if (!snap || !eraserCanvasRef.current) return;
    const canvas = eraserCanvasRef.current;
    const current = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    eraserRedoRef.current = [...eraserRedoRef.current, current].slice(-20);
    eraserUndoRef.current = eraserUndoRef.current.slice(0, -1);
    canvas.getContext('2d').putImageData(snap, 0, 0);
    setEraserCanUndo(eraserUndoRef.current.length > 0);
    setEraserCanRedo(true);
  };

  const redoEraser = () => {
    const snap = eraserRedoRef.current[eraserRedoRef.current.length - 1];
    if (!snap || !eraserCanvasRef.current) return;
    const canvas = eraserCanvasRef.current;
    const current = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    eraserUndoRef.current = [...eraserUndoRef.current, current].slice(-20);
    eraserRedoRef.current = eraserRedoRef.current.slice(0, -1);
    canvas.getContext('2d').putImageData(snap, 0, 0);
    setEraserCanRedo(eraserRedoRef.current.length > 0);
    setEraserCanUndo(true);
  };

  const resetEraser = () => {
    const canvas = eraserCanvasRef.current;
    const img = eraserImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    eraserUndoRef.current = [];
    eraserRedoRef.current = [];
    setEraserCanUndo(false);
    setEraserCanRedo(false);
  };

  const exportEraser = () => {
    const canvas = eraserCanvasRef.current;
    if (!canvas) return;
    downloadDataUrl(canvas.toDataURL('image/png'), `erased-${Date.now()}.png`);
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Eraser</h2>
            <button type="button" onClick={() => setHelpTool('eraser')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs in browser · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4 mb-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Paint over parts of an image to erase them to transparency. Switch to Restore mode to paint original pixels back. Exports as a PNG with an alpha channel.</p>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
            <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) loadImageInto(src => { setEraserSource(src); setEraserCanUndo(false); setEraserCanRedo(false); })(f); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-2">
              {['erase', 'restore'].map(m => (
                <button key={m} type="button" onClick={() => setEraserMode(m)} className="px-3 py-1.5 rounded-lg text-xs font-medium border capitalize" style={{ background: eraserMode === m ? 'var(--color-primary)' : 'transparent', color: eraserMode === m ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>{m === 'erase' ? 'Erase' : 'Restore'}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <Tooltip text="Paint mode: drag the brush over the area you want to erase or restore."><button type="button" onClick={() => setEraserSelectMode('paint')} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: eraserSelectMode === 'paint' ? 'var(--color-primary)' : 'transparent', color: eraserSelectMode === 'paint' ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Paint</button></Tooltip>
              <Tooltip text="Magic wand mode: click a spot and every connected pixel of a similar colour is selected automatically."><button type="button" onClick={() => setEraserSelectMode('wand')} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: eraserSelectMode === 'wand' ? 'var(--color-primary)' : 'transparent', color: eraserSelectMode === 'wand' ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Magic wand</button></Tooltip>
            </div>
            {eraserSelectMode === 'paint' ? (
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Brush size: {eraserBrush}px</label>
                <Tooltip text="How large an area each click/drag erases or restores."><input type="range" min="5" max="120" value={eraserBrush} onChange={e => setEraserBrush(Number(e.target.value))} className="w-full" /></Tooltip>
              </div>
            ) : (
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Tolerance: {eraserTolerance}</label>
                <Tooltip text="How similar neighbouring pixels must be to get selected. Higher picks up a wider range of colours; click again to add more to the selection."><input type="range" min="0" max="100" value={eraserTolerance} onChange={e => setEraserTolerance(Number(e.target.value))} className="w-full" /></Tooltip>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <Tooltip text="Undo the last change."><button type="button" onClick={undoEraser} disabled={!eraserCanUndo} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Undo</button></Tooltip>
              <Tooltip text="Redo the last undone change."><button type="button" onClick={redoEraser} disabled={!eraserCanRedo} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Redo</button></Tooltip>
              <Tooltip text="Start over from the original image."><button type="button" onClick={resetEraser} disabled={!eraserSource?.imageDataUrl} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset</button></Tooltip>
              <Tooltip text="Download the current result as a PNG with transparency."><button type="button" onClick={exportEraser} disabled={!eraserSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {getIcon('download', { size: 15 })} Export PNG
              </button></Tooltip>
            </div>
          </div>
        </div>
        {!eraserSource?.imageDataUrl ? (
          <div className="rounded-2xl border flex items-center justify-center text-sm text-center px-6 py-20" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
            Choose an image, then paint over the areas you want to erase.
          </div>
        ) : (
          <div className="rounded-2xl border p-3 flex justify-center" style={{ borderColor: 'var(--color-border)', backgroundImage: 'repeating-conic-gradient(#d0d0d0 0% 25%, #f5f5f5 0% 50%)', backgroundSize: '20px 20px' }}>
            <canvas
              ref={eraserCanvasRef}
              onMouseDown={onEraserDown}
              onMouseMove={onEraserMove}
              onMouseUp={onEraserUp}
              onMouseLeave={onEraserUp}
              style={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', borderRadius: 6, cursor: eraserSelectMode === 'wand' ? 'crosshair' : (eraserMode === 'erase' ? 'cell' : 'copy'), touchAction: 'none' }}
            />
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Everything runs in your browser — nothing is uploaded. The checkerboard pattern shows transparent areas.</p>
      </section>
    </>
  );
}
