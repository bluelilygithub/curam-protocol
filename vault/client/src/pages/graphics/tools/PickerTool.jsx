import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { loadImageInto } from '../shared';

export default function PickerTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();
  const mode = active ? 'picker' : null;

  const [pickerSource, setPickerSource] = useState(null);
  const [pickerZoom, setPickerZoom] = useState('1');
  const [pickerHex, setPickerHex] = useState(null);
  const [pickerCopied, setPickerCopied] = useState('');
  const pickerCanvasRef = useRef(null);
  const pickerScrollRef = useRef(null);
  const pickerDragRef = useRef(null);

  useEffect(() => {
    if (mode !== 'picker' || !pickerSource?.imageDataUrl) return;
    const canvas = pickerCanvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = pickerSource.imageDataUrl;
  }, [mode, pickerSource]);

  const getPickerPixel = (e) => {
    const canvas = pickerCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const py = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
    try {
      const [r, g, b] = canvas.getContext('2d').getImageData(px, py, 1, 1).data;
      return { r, g, b, hex: `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}` };
    } catch {
      return null;
    }
  };

  const handlePickerMouseDown = (e) => {
    const sc = pickerScrollRef.current;
    if (sc) pickerDragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: sc.scrollLeft, scrollTop: sc.scrollTop, moved: false };
  };

  const handlePickerMouseMove = (e) => {
    const d = pickerDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true;
    if (d.moved) {
      const sc = pickerScrollRef.current;
      if (sc) { sc.scrollLeft = d.scrollLeft - dx; sc.scrollTop = d.scrollTop - dy; }
    }
  };

  const handlePickerMouseUp = (e) => {
    const d = pickerDragRef.current;
    pickerDragRef.current = null;
    if (d && !d.moved) {
      const p = getPickerPixel(e);
      if (p) { setPickerHex(p); setPickerCopied(''); }
    }
  };

  const copyPicker = (text, which) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    setPickerCopied(which);
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Colour picker</h2>
            <button type="button" onClick={() => setHelpTool('picker')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Image</label>
              <Tooltip text="Choose the image to sample a colour from."><input type="file" accept="image/*" onChange={e => { setPickerHex(null); loadImageInto(setPickerSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {pickerSource?.imageDataUrl && (
              <div className="rounded-xl border p-2 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Zoom</span>
                  <Tooltip text="Magnify the image so you can click a precise pixel."><input type="range" min="1" max="6" step="1" value={pickerZoom} onChange={e => setPickerZoom(e.target.value)} className="flex-1" /></Tooltip>
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{pickerZoom}x</span>
                </div>
                <div ref={pickerScrollRef} style={{ overflow: 'auto', maxHeight: 360 }}>
                  <Tooltip text="Click to read this pixel's colour; drag to pan when zoomed in."><canvas
                    ref={pickerCanvasRef}
                    onMouseDown={handlePickerMouseDown}
                    onMouseMove={handlePickerMouseMove}
                    onMouseUp={handlePickerMouseUp}
                    className="rounded-lg"
                    style={{ display: 'block', width: `${Number(pickerZoom) * 100}%`, imageRendering: Number(pickerZoom) > 1 ? 'pixelated' : 'auto', cursor: Number(pickerZoom) > 1 ? 'grab' : 'crosshair' }}
                  /></Tooltip>
                </div>
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Click to sample a colour. When zoomed, drag to pan.</p>
              </div>
            )}
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Sampled colour</span>
            </div>
            <div className="p-4">
              {pickerHex ? (
                <div className="space-y-4">
                  <div className="h-24 rounded-xl border" style={{ background: pickerHex.hex, borderColor: 'var(--color-border)' }} />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-sm" style={{ color: 'var(--color-text)' }}>{pickerHex.hex}</code>
                      <Tooltip text="Copy the hex code."><button type="button" onClick={() => copyPicker(pickerHex.hex, 'hex')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{pickerCopied === 'hex' ? 'Copied' : 'Copy'}</button></Tooltip>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-sm" style={{ color: 'var(--color-text)' }}>rgb({pickerHex.r}, {pickerHex.g}, {pickerHex.b})</code>
                      <Tooltip text="Copy the RGB value."><button type="button" onClick={() => copyPicker(`rgb(${pickerHex.r}, ${pickerHex.g}, ${pickerHex.b})`, 'rgb')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{pickerCopied === 'rgb' ? 'Copied' : 'Copy'}</button></Tooltip>
                    </div>
                  </div>
                </div>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Click the image to read a colour.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
