import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { clampNum, downloadDataUrl, loadImageInto } from '../shared';

export default function RedactTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();
  const mode = active ? 'redact' : null;

  const [redactSource, setRedactSource] = useState(null);
  const [redactRects, setRedactRects] = useState([]);
  const [redactMode, setRedactMode] = useState('pixelate');
  const [redactStrength, setRedactStrength] = useState(16);
  const [redactExport, setRedactExport] = useState(null);
  const redactCanvasRef = useRef(null);
  const redactImgRef = useRef(null);
  const redactDrawRef = useRef(null);
  const redactDrawFnRef = useRef(null);
  const [redactPast, setRedactPast] = useState([]);
  const [redactFuture, setRedactFuture] = useState([]);
  const redactRectsRef = useRef([]);

  useEffect(() => { redactRectsRef.current = redactRects; }, [redactRects]);

  const recordRedact = (snapshot) => {
    setRedactPast(p => [...p, snapshot].slice(-20));
    setRedactFuture([]);
  };

  const undoRedact = () => {
    if (!redactPast.length) return;
    const prev = redactPast[redactPast.length - 1];
    setRedactFuture(f => [redactRectsRef.current, ...f].slice(0, 20));
    setRedactPast(p => p.slice(0, -1));
    setRedactRects(prev);
  };

  const redoRedact = () => {
    if (!redactFuture.length) return;
    const next = redactFuture[0];
    setRedactPast(p => [...p, redactRectsRef.current].slice(-20));
    setRedactFuture(f => f.slice(1));
    setRedactRects(next);
  };

  // Redact: render the image with each rectangle blurred or pixelated. `preview`
  // is the in-progress drag rect (drawn as a dashed outline only).
  const drawRedact = (preview) => {
    const canvas = redactCanvasRef.current;
    const img = redactImgRef.current;
    if (!canvas || !img) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    for (const r of redactRects) {
      const rx = Math.round(r.x * W);
      const ry = Math.round(r.y * H);
      const rw = Math.round(r.w * W);
      const rh = Math.round(r.h * H);
      if (rw < 1 || rh < 1) continue;
      if (redactMode === 'blur') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
        ctx.filter = `blur(${Math.max(1, Number(redactStrength))}px)`;
        ctx.drawImage(img, 0, 0, W, H);
        ctx.restore();
        ctx.filter = 'none';
      } else {
        const block = Math.max(2, Number(redactStrength));
        const tw = Math.max(1, Math.round(rw / block));
        const th = Math.max(1, Math.round(rh / block));
        const tmp = document.createElement('canvas');
        tmp.width = tw;
        tmp.height = th;
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(img, rx, ry, rw, rh, 0, 0, tw, th);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tw, th, rx, ry, rw, rh);
        ctx.imageSmoothingEnabled = true;
      }
    }
    if (preview) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(preview.x * W, preview.y * H, preview.w * W, preview.h * H);
      ctx.restore();
    }
  };

  redactDrawFnRef.current = drawRedact;

  useEffect(() => {
    if (mode !== 'redact' || !redactSource?.imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      redactImgRef.current = img;
      const canvas = redactCanvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      redactDrawFnRef.current?.(null);
    };
    img.src = redactSource.imageDataUrl;
  }, [mode, redactSource]);

  useEffect(() => {
    redactDrawFnRef.current?.(null);
  }, [redactRects, redactMode, redactStrength]);

  const redactPointFromEvent = (e) => {
    const canvas = redactCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clampNum((e.clientX - rect.left) / rect.width, 0, 1),
      y: clampNum((e.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const onRedactDrawMove = useCallback((e) => {
    const d = redactDrawRef.current;
    const canvas = redactCanvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    const pr = { x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w: Math.abs(cx - d.startX), h: Math.abs(cy - d.startY) };
    redactDrawFnRef.current?.(pr);
  }, []);

  const onRedactDrawUp = useCallback((e) => {
    const d = redactDrawRef.current;
    redactDrawRef.current = null;
    window.removeEventListener('mousemove', onRedactDrawMove);
    window.removeEventListener('mouseup', onRedactDrawUp);
    const canvas = redactCanvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    const pr = { x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w: Math.abs(cx - d.startX), h: Math.abs(cy - d.startY) };
    if (pr.w > 0.01 && pr.h > 0.01) {
      const before = redactRectsRef.current;
      setRedactPast(p => [...p, before].slice(-20));
      setRedactFuture([]);
      setRedactRects(prev => [...prev, pr]);
    } else redactDrawFnRef.current?.(null);
  }, [onRedactDrawMove]);

  const onRedactDown = (e) => {
    const p = redactPointFromEvent(e);
    if (!p) return;
    e.preventDefault();
    redactDrawRef.current = { startX: p.x, startY: p.y };
    window.addEventListener('mousemove', onRedactDrawMove);
    window.addEventListener('mouseup', onRedactDrawUp);
  };

  const exportRedact = () => {
    const canvas = redactCanvasRef.current;
    if (!canvas) return;
    drawRedact(null);
    const url = canvas.toDataURL('image/png');
    setRedactExport(url);
    downloadDataUrl(url, `redacted-${Date.now()}.png`);
  };

  // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo while this tool is showing.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !typing) {
        e.preventDefault();
        if (e.shiftKey) redoRedact(); else undoRedact();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Redact</h2>
            <button type="button" onClick={() => setHelpTool('redact')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free · never uploaded</span>
        </div>
        <div className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="grow min-w-[200px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
            <Tooltip text="Choose the image to redact."><input type="file" accept="image/*" onChange={e => { setRedactRects([]); setRedactExport(null); setRedactPast([]); setRedactFuture([]); redactImgRef.current = null; loadImageInto(setRedactSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
          </div>
          <div className="flex gap-2 self-end">
            {['pixelate', 'blur'].map(m => (
              <button key={m} type="button" onClick={() => setRedactMode(m)} className="px-3 py-1.5 rounded-lg text-xs font-medium border capitalize" style={{ background: redactMode === m ? 'var(--color-primary)' : 'transparent', color: redactMode === m ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }} title={m === 'pixelate' ? 'Hide each box behind a mosaic of large blocks.' : 'Hide each box behind a soft blur.'}>{m}</button>
            ))}
          </div>
          <div className="self-end min-w-[160px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{redactMode === 'blur' ? 'Blur' : 'Block size'}: {redactStrength}px</label>
            <input type="range" min="4" max="60" value={redactStrength} onChange={e => setRedactStrength(Number(e.target.value))} className="w-full" title={redactMode === 'blur' ? 'How strong the blur is over each redacted box.' : 'Size of the mosaic blocks over each redacted box — bigger hides more detail.'} />
          </div>
          <div className="flex gap-2 self-end">
            <Tooltip text="Undo the last box you drew."><button type="button" onClick={undoRedact} disabled={!redactPast.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Undo</button></Tooltip>
            <Tooltip text="Redo the last undone box."><button type="button" onClick={redoRedact} disabled={!redactFuture.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Redo</button></Tooltip>
            <Tooltip text="Remove every redaction box."><button type="button" onClick={() => { if (!redactRects.length) return; recordRedact(redactRectsRef.current); setRedactRects([]); }} disabled={!redactRects.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Clear</button></Tooltip>
            <Tooltip text="Flatten the redaction boxes onto the image and save it as a PNG."><button type="button" onClick={exportRedact} disabled={!redactSource?.imageDataUrl || !redactRects.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {getIcon('download', { size: 15 })} Export PNG
            </button></Tooltip>
          </div>
        </div>
        {!redactSource?.imageDataUrl ? (
          <div className="rounded-2xl border flex items-center justify-center text-sm text-center px-6 py-20" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose an image, then drag boxes over anything you want to hide.</div>
        ) : (
          <div className="rounded-2xl border p-4 flex justify-center" style={{ borderColor: 'var(--color-border)', background: '#1e1e1e' }}>
            <Tooltip text="Drag to draw a box over anything you want to hide."><canvas
              ref={redactCanvasRef}
              onMouseDown={onRedactDown}
              style={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', borderRadius: 6, cursor: 'crosshair', touchAction: 'none' }}
            /></Tooltip>
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Drag to add a box. Switch between pixelate and blur and adjust strength at any time — all boxes update live. Everything is processed in your browser.</p>
      </section>
    </>
  );
}
