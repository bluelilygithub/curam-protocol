import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, renderExport, ResultPlaceholder } from '../shared';

export default function RecolorTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();
  const mode = active ? 'recolor' : null;

  const [recolorSource, setRecolorSource] = useState(null);
  const [recolorSrcColor, setRecolorSrcColor] = useState('#cc3333');
  const [recolorTargetColor, setRecolorTargetColor] = useState('#3377ee');
  const [recolorTolerance, setRecolorTolerance] = useState('20');
  const [recolorMode, setRecolorMode] = useState('match');
  const [recoloring, setRecoloring] = useState(false);
  const [recolorResult, setRecolorResult] = useState(null);
  const [recolorError, setRecolorError] = useState('');
  const [recolorZoom, setRecolorZoom] = useState('1');
  const [recolorHoverHex, setRecolorHoverHex] = useState(null);
  const [loupeVisible, setLoupeVisible] = useState(false);
  const recolorCanvasRef = useRef(null);
  const loupeCanvasRef = useRef(null);
  const recolorScrollRef = useRef(null);
  const dragRef = useRef(null);

  const handleRecolorFile = async (file) => {
    if (!file) return;
    setRecolorError('');
    setRecolorResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setRecolorSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setRecolorError('Could not read that image file.');
    }
  };

  useEffect(() => {
    if (mode !== 'recolor' || !recolorSource?.imageDataUrl) return;
    const canvas = recolorCanvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
    img.src = recolorSource.imageDataUrl;
  }, [mode, recolorSource]);

  const getRecolorPixel = (e) => {
    const canvas = recolorCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const py = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
    try {
      // Average a small 3x3 block so compression noise doesn't skew the pick.
      const sx = Math.max(0, px - 1);
      const sy = Math.max(0, py - 1);
      const w = Math.min(3, canvas.width - sx);
      const h = Math.min(3, canvas.height - sy);
      const { data } = canvas.getContext('2d').getImageData(sx, sy, w, h);
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
      }
      if (n === 0) return null;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
      return { px, py, hex };
    } catch {
      return null;
    }
  };

  const drawLoupe = (px, py) => {
    const canvas = recolorCanvasRef.current;
    const loupe = loupeCanvasRef.current;
    if (!canvas || !loupe) return;
    const lctx = loupe.getContext('2d');
    lctx.imageSmoothingEnabled = false;
    const crop = 9; // source pixels across the loupe (smaller = stronger magnification)
    lctx.clearRect(0, 0, loupe.width, loupe.height);
    lctx.drawImage(canvas, px - (crop - 1) / 2, py - (crop - 1) / 2, crop, crop, 0, 0, loupe.width, loupe.height);
    const cell = loupe.width / crop;
    const c = (crop - 1) / 2;
    lctx.strokeStyle = 'rgba(255,255,255,0.95)';
    lctx.lineWidth = 1;
    lctx.strokeRect(c * cell, c * cell, cell, cell);
    lctx.strokeStyle = 'rgba(0,0,0,0.95)';
    lctx.strokeRect(c * cell - 1, c * cell - 1, cell + 2, cell + 2);
  };

  const handleRecolorHover = (e) => {
    const p = getRecolorPixel(e);
    if (!p) { setLoupeVisible(false); return; }
    setRecolorHoverHex(p.hex);
    setLoupeVisible(true);
    drawLoupe(p.px, p.py);
  };

  const handleRecolorMouseDown = (e) => {
    const sc = recolorScrollRef.current;
    if (!sc) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: sc.scrollLeft, scrollTop: sc.scrollTop, moved: false };
  };

  const handleRecolorMouseMove = (e) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        d.moved = true;
        setLoupeVisible(false);
      }
      if (d.moved) {
        const sc = recolorScrollRef.current;
        if (sc) {
          sc.scrollLeft = d.scrollLeft - dx;
          sc.scrollTop = d.scrollTop - dy;
        }
      }
      return;
    }
    handleRecolorHover(e);
  };

  const handleRecolorMouseUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) {
      const p = getRecolorPixel(e);
      if (p) setRecolorSrcColor(p.hex);
    }
  };

  const handleRecolorMouseLeave = () => {
    setLoupeVisible(false);
    dragRef.current = null;
  };

  const runRecolor = async () => {
    if (!recolorSource?.imageDataUrl) return;
    setRecoloring(true);
    setRecolorError('');
    try {
      const res = await api.post('/api/graphics/recolor', {
        imageDataUrl: recolorSource.imageDataUrl,
        sourceColor: recolorSrcColor,
        targetColor: recolorTargetColor,
        tolerance: Number(recolorTolerance),
        mode: recolorMode,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recolour failed');
      setRecolorResult(data);
    } catch (err) {
      setRecolorError(err.message || 'Recolour failed');
    } finally {
      setRecoloring(false);
    }
  };

  const downloadRecolor = () => {
    if (!recolorResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = recolorResult.imageDataUrl;
    a.download = `recolored-${Date.now()}.png`;
    a.click();
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'recolor' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setRecolorResult(null); setRecolorError(''); setRecolorSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(recoloring ? 'Recolouring…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Recolor an item</h2>
            <button type="button" onClick={() => setHelpTool('recolor')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Shift the colour of a specific item. Pick the colour to change (click the image to sample it), set how broad the match is, and choose the new colour. Shading is preserved.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image containing the item you want to recolour."><input
                type="file"
                accept="image/*"
                onChange={e => handleRecolorFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              /></Tooltip>
            </div>

            {recolorSource?.imageDataUrl && (
              <div className="rounded-xl border p-2 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Zoom</span>
                  <Tooltip text="Magnify the image so you can click precisely on the colour to change."><input type="range" min="1" max="6" step="1" value={recolorZoom} onChange={e => setRecolorZoom(e.target.value)} className="flex-1 min-w-[80px]" /></Tooltip>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-muted)' }}>{recolorZoom}x</span>
                  <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    <span className="inline-block h-4 w-4 rounded border" style={{ background: recolorHoverHex || 'transparent', borderColor: 'var(--color-border)' }} />
                    {recolorHoverHex || '—'}
                  </span>
                </div>
                <div ref={recolorScrollRef} style={{ overflow: 'auto', maxHeight: 360 }}>
                  <Tooltip text="Click a pixel to pick it as the colour to change; drag to pan when zoomed in."><canvas
                    ref={recolorCanvasRef}
                    onMouseDown={handleRecolorMouseDown}
                    onMouseMove={handleRecolorMouseMove}
                    onMouseUp={handleRecolorMouseUp}
                    onMouseLeave={handleRecolorMouseLeave}
                    className="rounded-lg"
                    style={{ display: 'block', width: `${Number(recolorZoom) * 100}%`, imageRendering: Number(recolorZoom) > 1 ? 'pixelated' : 'auto', cursor: Number(recolorZoom) > 1 ? 'grab' : 'crosshair' }}
                  /></Tooltip>
                </div>
                <div className="flex items-center gap-3">
                  <canvas
                    ref={loupeCanvasRef}
                    width={104}
                    height={104}
                    className="rounded border flex-shrink-0"
                    style={{ width: 104, height: 104, borderColor: 'var(--color-border)', background: 'var(--color-bg)', visibility: loupeVisible ? 'visible' : 'hidden' }}
                  />
                  <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    <p>Hover to magnify, click to set the colour. When zoomed, drag to pan.</p>
                    <p className="mt-1 inline-flex items-center gap-1">
                      Selected:
                      <span className="inline-block h-4 w-4 rounded border align-middle" style={{ background: recolorSrcColor, borderColor: 'var(--color-border)' }} />
                      {recolorSrcColor}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour to change</label>
                <div className="flex items-center gap-2">
                  <Tooltip text="The colour in the image that will be replaced (or click the image above to sample it)."><input type="color" value={recolorSrcColor} onChange={e => setRecolorSrcColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                  <Tooltip text="Hex code of the colour that will be replaced."><input type="text" value={recolorSrcColor} onChange={e => setRecolorSrcColor(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>New colour</label>
                <div className="flex items-center gap-2">
                  <Tooltip text="The colour the matched pixels will be changed to."><input type="color" value={recolorTargetColor} onChange={e => setRecolorTargetColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                  <Tooltip text="Hex code of the new colour."><input type="text" value={recolorTargetColor} onChange={e => setRecolorTargetColor(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Replacement style</label>
              <Tooltip text="Whether to shift brightness toward the new colour, or only change hue and keep the original shading."><select
                value={recolorMode}
                onChange={e => setRecolorMode(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="match">Match new colour (brighten / darken to target)</option>
                <option value="preserve">Preserve original shading (hue only)</option>
              </select></Tooltip>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
                {recolorMode === 'match'
                  ? 'Shifts brightness toward the new colour so dark items can become light. Keeps relative shading.'
                  : 'Only changes the hue/saturation and keeps each pixel as bright as the original.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Match tolerance: {recolorTolerance}</label>
              <Tooltip text="How close a pixel's colour must be to the source colour to get recoloured — higher picks up more shades."><input type="range" min="0" max="100" value={recolorTolerance} onChange={e => setRecolorTolerance(e.target.value)} className="w-full" /></Tooltip>
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Higher = recolours a wider range of similar colours.</p>
            </div>

            {recolorError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{recolorError}</div>
            )}

            <Tooltip text="Apply the recolour with the settings above."><button
              type="button"
              onClick={runRecolor}
              disabled={recoloring || !recolorSource?.imageDataUrl}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {recoloring ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('palette', { size: 15 })}
              {recoloring ? 'Recolouring...' : 'Apply recolour'}
            </button></Tooltip>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {recolorResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(recolorSource?.imageDataUrl, recolorResult?.imageDataUrl)}
                  {renderSendTo(recolorResult.imageDataUrl, 'recoloured.png', 'recolor')}
                  {renderExport(recolorResult.imageDataUrl, 'recoloured')}
                  <Tooltip text="Save the recoloured image to your device."><button onClick={downloadRecolor} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {recolorResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(recolorSource?.imageDataUrl, recolorResult, { alt: 'recoloured' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    Recoloured {recolorResult.matchedPct}% of pixels ({recolorResult.matchedPixels?.toLocaleString?.() || recolorResult.matchedPixels} px)
                  </p>
                </>
              ) : (
                <ResultPlaceholder src={recolorSource?.imageDataUrl} message="Your recoloured image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
