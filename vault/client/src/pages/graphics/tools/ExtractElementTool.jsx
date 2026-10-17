import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, magicWandSelectionCanvas, restoreWithinSelection, tintSelectionCanvas, loadImageInto, UrlImportRow, renderExport } from '../shared';

export default function ExtractElementTool({ active }) {
  const getIcon = useIcon();
  const { handoff, registerResult, renderSendTo, setHelpTool, setPreviewImage } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();
  const mode = active ? 'extract' : null;

  // Extract element (canvas mask → server)
  const [extractSource, setExtractSource] = useState(null);

  const [extractBrush, setExtractBrush] = useState(30);
  const [extractErasing, setExtractErasing] = useState(false);
  const [extractFeather, setExtractFeather] = useState(5);
  const [extractSelectMode, setExtractSelectMode] = useState('paint');

  // 'paint' | 'wand'
  const [extractTolerance, setExtractTolerance] = useState(30);

  const [extractBusy, setExtractBusy] = useState(false);
  const [extractResult, setExtractResult] = useState(null);
  const [extractError, setExtractError] = useState('');
  const extractCanvasRef = useRef(null);
  const extractMaskRef = useRef(null);
  const extractImgRef = useRef(null);
  const extractIsDrawingRef = useRef(false);

  // ── Extract Element ─────────────────────────────────────────────
  const drawExtractBase = () => {
    const disp = extractCanvasRef.current;
    const mask = extractMaskRef.current;
    const img = extractImgRef.current;
    if (!disp || !mask || !img) return;
    const cap = 1200;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (Math.max(w, h) > cap) { const s = cap / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    disp.width = w; disp.height = h; mask.width = w; mask.height = h;
    disp.getContext('2d').drawImage(img, 0, 0, w, h);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, w, h);
  };

  useEffect(() => {
    if (mode !== 'extract' || !extractSource?.imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      extractImgRef.current = img;
      setExtractResult(null);
      setExtractError('');
      drawExtractBase();
    };
    img.src = extractSource.imageDataUrl;
  }, [mode, extractSource]);

  const extractPos = (e) => {
    const c = extractCanvasRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const extractPaint = (x, y) => {
    const disp = extractCanvasRef.current;
    const mask = extractMaskRef.current;
    if (!disp || !mask) return;
    const rect = disp.getBoundingClientRect();
    const r = Math.max(3, Number(extractBrush)) * (disp.width / rect.width) * 0.5;
    const dctx = disp.getContext('2d');
    if (extractErasing) {
      // Restore original pixels then paint light red to show erased mask area
      const img = extractImgRef.current;
      if (img) {
        dctx.save();
        dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.clip();
        dctx.drawImage(img, 0, 0, disp.width, disp.height);
        dctx.restore();
      }
      dctx.fillStyle = 'rgba(239,68,68,0.25)';
      dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill();
      const mctx = mask.getContext('2d');
      mctx.fillStyle = '#000';
      mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
    } else {
      dctx.fillStyle = 'rgba(34,197,94,0.45)';
      dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill();
      const mctx = mask.getContext('2d');
      mctx.fillStyle = '#fff';
      mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
    }
  };

  const extractWandAt = (x, y) => {
    const disp = extractCanvasRef.current;
    const mask = extractMaskRef.current;
    const img = extractImgRef.current;
    if (!disp || !mask || !img) return;
    const sel = magicWandSelectionCanvas(img, disp.width, disp.height, x, y, extractTolerance);
    const dctx = disp.getContext('2d');
    const mctx = mask.getContext('2d');
    if (extractErasing) {
      dctx.drawImage(restoreWithinSelection(img, sel, disp.width, disp.height), 0, 0);
      dctx.drawImage(tintSelectionCanvas(sel, 'rgba(239,68,68,0.25)'), 0, 0);
      mctx.drawImage(tintSelectionCanvas(sel, '#000'), 0, 0);
    } else {
      dctx.drawImage(tintSelectionCanvas(sel, 'rgba(34,197,94,0.45)'), 0, 0);
      mctx.drawImage(sel, 0, 0);
    }
  };

  const onExtractDown = (e) => {
    const p = extractPos(e);
    if (!p) return;
    if (extractSelectMode === 'wand') { extractWandAt(p.x, p.y); return; }
    extractIsDrawingRef.current = true; extractPaint(p.x, p.y);
  };

  const onExtractMove = (e) => { if (extractSelectMode === 'wand' || !extractIsDrawingRef.current) return; const p = extractPos(e); if (p) extractPaint(p.x, p.y); };

  const onExtractUp = () => { extractIsDrawingRef.current = false; };

  const clearExtractMask = () => drawExtractBase();

  const runExtract = async () => {
    const mask = extractMaskRef.current;
    const disp = extractCanvasRef.current;
    if (!mask || !disp) { setExtractError('Load an image first'); return; }
    // Get original image at display size
    const tmp = document.createElement('canvas');
    tmp.width = disp.width; tmp.height = disp.height;
    tmp.getContext('2d').drawImage(extractImgRef.current, 0, 0, tmp.width, tmp.height);
    setExtractBusy(true); setExtractError(''); setExtractResult(null);
    try {
      const res = await api.post('/api/graphics/extract', {
        imageDataUrl: tmp.toDataURL('image/png'),
        maskDataUrl: mask.toDataURL('image/png'),
        feather: extractFeather,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraction failed');
      setExtractResult(data);
    } catch (err) {
      setExtractError(err.message || 'Extraction failed');
    } finally {
      setExtractBusy(false);
    }
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'extract' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setExtractResult(null); setExtractSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  // Lets Ask Graphics read this tool's finished result back (it asks by tool id).
  useEffect(() => { registerResult('extract', () => extractResult?.imageDataUrl || null); }, [extractResult, registerResult]);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Extract element</h2>
            <button type="button" onClick={() => setHelpTool('extract')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Paint (green) over the element you want to keep. Everything outside the painted area will be removed. Use the Erase brush to clean up paint strokes.</p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => loadImageInto(src => { setExtractSource(src); })(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) setExtractError(err); else setExtractSource(src); })} />
            </div>
            {extractSource?.imageDataUrl && (
              <div className="space-y-2">
                <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <canvas
                    ref={extractCanvasRef}
                    onMouseDown={onExtractDown}
                    onMouseMove={onExtractMove}
                    onMouseUp={onExtractUp}
                    onMouseLeave={onExtractUp}
                    className="w-full rounded-lg"
                    style={{ display: 'block', cursor: extractSelectMode === 'wand' ? 'crosshair' : (extractErasing ? 'crosshair' : 'cell'), touchAction: 'none' }}
                  />
                  <canvas ref={extractMaskRef} style={{ display: 'none' }} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setExtractErasing(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: !extractErasing ? 'var(--color-primary)' : 'transparent', color: !extractErasing ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Keep</button>
                    <button type="button" onClick={() => setExtractErasing(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: extractErasing ? 'var(--color-primary)' : 'transparent', color: extractErasing ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Erase</button>
                  </div>
                  <div className="flex gap-2">
                    <Tooltip text="Paint mode: drag the brush to mark the element to keep (or erase mask strokes)."><button type="button" onClick={() => setExtractSelectMode('paint')} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: extractSelectMode === 'paint' ? 'var(--color-primary)' : 'transparent', color: extractSelectMode === 'paint' ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Paint</button></Tooltip>
                    <Tooltip text="Magic wand mode: click a spot and every connected pixel of a similar colour is selected automatically."><button type="button" onClick={() => setExtractSelectMode('wand')} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: extractSelectMode === 'wand' ? 'var(--color-primary)' : 'transparent', color: extractSelectMode === 'wand' ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>Magic wand</button></Tooltip>
                  </div>
                  {extractSelectMode === 'paint' ? (
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Brush: {extractBrush}px</label>
                      <Tooltip text="How large an area each click/drag paints into or out of the mask."><input type="range" min="5" max="120" step="1" value={extractBrush} onChange={e => setExtractBrush(Number(e.target.value))} className="w-full" /></Tooltip>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Tolerance: {extractTolerance}</label>
                      <Tooltip text="How similar neighbouring pixels must be to get selected. Higher picks up a wider range of colours; click again to add more to the selection."><input type="range" min="0" max="100" value={extractTolerance} onChange={e => setExtractTolerance(Number(e.target.value))} className="w-full" /></Tooltip>
                    </div>
                  )}
                  <Tooltip text="Clear the mask and start over."><button type="button" onClick={clearExtractMask} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Clear</button></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Feather edges: {extractFeather}px</label>
                  <input type="range" min="0" max="30" step="1" value={extractFeather} onChange={e => setExtractFeather(Number(e.target.value))} className="w-full" />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>Higher values give softer, more natural edges. 0 = hard edge.</p>
                </div>
              </div>
            )}
            {extractError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{extractError}</div>}
            <button type="button" onClick={runExtract} disabled={extractBusy || !extractSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {extractBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('scan-search', { size: 15 })}
              {extractBusy ? 'Extracting...' : 'Extract element'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {extractResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(extractResult.imageDataUrl, 'extracted.png', 'extract')}
                  {renderExport(extractResult.imageDataUrl, 'extracted')}
                </div>
              )}
            </div>
            <div className="p-4">
              {extractResult?.imageDataUrl ? (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundImage: 'repeating-conic-gradient(#d0d0d0 0% 25%, #f5f5f5 0% 50%)', backgroundSize: '20px 20px' }}>
                  <button type="button" onClick={() => setPreviewImage(extractResult)} className="block w-full">
                    <img src={extractResult.imageDataUrl} alt="extracted element" className="w-full" />
                  </button>
                </div>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Paint the element you want to keep, then click Extract.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
