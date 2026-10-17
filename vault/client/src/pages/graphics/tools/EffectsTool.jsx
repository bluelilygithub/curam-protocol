import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, useProcessingWhile, loadImageInto, UrlImportRow, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function EffectsTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  const [efSource, setEfSource] = useState(null);
  const [efEffect, setEfEffect] = useState('flip-h');
  const [efBorderWidth, setEfBorderWidth] = useState('24');
  const [efBorderColor, setEfBorderColor] = useState('#ffffff');
  const [efRadius, setEfRadius] = useState('40');
  const [efBlur, setEfBlur] = useState('25');
  const [efOffsetX, setEfOffsetX] = useState('0');
  const [efOffsetY, setEfOffsetY] = useState('18');
  const [efShadowColor, setEfShadowColor] = useState('#000000');
  const [efShadowOpacity, setEfShadowOpacity] = useState('0.45');
  const [efDuoShadow, setEfDuoShadow] = useState('#1e1440');
  const [efDuoHighlight, setEfDuoHighlight] = useState('#ffd278');
  const [efAngle, setEfAngle] = useState('0');
  const [efRotateTransparent, setEfRotateTransparent] = useState(false);
  const [efRotateBg, setEfRotateBg] = useState('#ffffff');
  const [efBusy, setEfBusy] = useState(false);
  const [efResult, setEfResult] = useState(null);
  const [efError, setEfError] = useState('');

  const runEffect = async () => {
    if (!efSource?.imageDataUrl) return;
    setEfBusy(true);
    setEfError('');
    try {
      const body = { imageDataUrl: efSource.imageDataUrl, effect: efEffect };
      if (efEffect === 'border') { body.borderWidth = Number(efBorderWidth); body.borderColor = efBorderColor; }
      if (efEffect === 'round') { body.radius = Number(efRadius); }
      if (efEffect === 'shadow') {
        body.blur = Number(efBlur);
        body.offsetX = Number(efOffsetX);
        body.offsetY = Number(efOffsetY);
        body.shadowColor = efShadowColor;
        body.shadowOpacity = Number(efShadowOpacity);
      }
      if (efEffect === 'duotone') { body.duoShadow = efDuoShadow; body.duoHighlight = efDuoHighlight; }
      if (efEffect === 'rotate-free') { body.angle = Number(efAngle); body.transparent = efRotateTransparent; body.background = efRotateBg; }
      const res = await api.post('/api/graphics/effect', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Effect failed');
      setEfResult(data);
    } catch (err) {
      setEfError(err.message || 'Effect failed');
    } finally {
      setEfBusy(false);
    }
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'effects' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setEfResult(null); setEfError(''); setEfSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(efBusy ? 'Applying effect…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Effects</h2>
            <button type="button" onClick={() => setHelpTool('effects')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to apply an effect to."><input type="file" accept="image/*" onChange={e => { setEfResult(null); setEfError(''); loadImageInto(setEfSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <div className="mt-2"><UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setEfError(err); } else { setEfResult(null); setEfError(''); setEfSource(src); } })} /></div>
            </div>
            {efSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={efSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Effect</label>
              <Tooltip text="Which transformation or filter to apply to the image."><select value={efEffect} onChange={e => setEfEffect(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="flip-h">Mirror (flip horizontal)</option>
                <option value="flip-v">Flip vertical</option>
                <option value="rotate-90">Rotate 90° right</option>
                <option value="rotate-270">Rotate 90° left</option>
                <option value="rotate-180">Rotate 180°</option>
                <option value="rotate-free">Rotate by angle…</option>
                <option value="border">Add border</option>
                <option value="round">Round corners</option>
                <option value="shadow">Drop shadow</option>
                <option value="grayscale">Grayscale</option>
                <option value="sepia">Sepia</option>
                <option value="invert">Invert colours</option>
                <option value="duotone">Duotone</option>
              </select></Tooltip>
            </div>
            {efEffect === 'rotate-free' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Angle: {efAngle}°</label>
                  <Tooltip text="Rotate the image by this many degrees — negative values rotate left."><input type="range" min="-180" max="180" step="1" value={efAngle} onChange={e => setEfAngle(e.target.value)} className="w-full" /></Tooltip>
                </div>
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                  <Tooltip text="Leave the corners exposed by rotation transparent instead of filling them with a colour."><input type="checkbox" checked={efRotateTransparent} onChange={e => setEfRotateTransparent(e.target.checked)} /></Tooltip>
                  Transparent corners (PNG)
                </label>
                {!efRotateTransparent && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Corner fill</label>
                    <Tooltip text="Colour used to fill the corners exposed by rotation."><input type="color" value={efRotateBg} onChange={e => setEfRotateBg(e.target.value)} className="h-8 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                  </div>
                )}
              </div>
            )}
            {efEffect === 'border' && (
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Border width: {efBorderWidth}px</label>
                  <Tooltip text="Thickness of the border in pixels."><input type="range" min="1" max="200" value={efBorderWidth} onChange={e => setEfBorderWidth(e.target.value)} className="w-full" /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour</label>
                  <Tooltip text="Colour of the border."><input type="color" value={efBorderColor} onChange={e => setEfBorderColor(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
              </div>
            )}
            {efEffect === 'round' && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Corner radius: {efRadius}px</label>
                <Tooltip text="How rounded the image's corners are, in pixels."><input type="range" min="0" max="300" value={efRadius} onChange={e => setEfRadius(e.target.value)} className="w-full" /></Tooltip>
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Exports a PNG with transparent corners.</p>
              </div>
            )}
            {efEffect === 'shadow' && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Blur: {efBlur}px</label>
                    <Tooltip text="How soft/spread-out the shadow's edge is."><input type="range" min="0" max="120" value={efBlur} onChange={e => setEfBlur(e.target.value)} className="w-full" /></Tooltip>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(Number(efShadowOpacity) * 100)}%</label>
                    <Tooltip text="How dark/visible the shadow is."><input type="range" min="0" max="1" step="0.05" value={efShadowOpacity} onChange={e => setEfShadowOpacity(e.target.value)} className="w-full" /></Tooltip>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Offset X: {efOffsetX}px</label>
                    <Tooltip text="Horizontal distance the shadow is cast, in pixels."><input type="range" min="-100" max="100" value={efOffsetX} onChange={e => setEfOffsetX(e.target.value)} className="w-full" /></Tooltip>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Offset Y: {efOffsetY}px</label>
                    <Tooltip text="Vertical distance the shadow is cast, in pixels."><input type="range" min="-100" max="100" value={efOffsetY} onChange={e => setEfOffsetY(e.target.value)} className="w-full" /></Tooltip>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Shadow colour</label>
                  <Tooltip text="Colour of the drop shadow."><input type="color" value={efShadowColor} onChange={e => setEfShadowColor(e.target.value)} className="h-8 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
              </div>
            )}
            {efEffect === 'duotone' && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Shadow colour</label>
                  <Tooltip text="Colour mapped onto the darkest parts of the image."><input type="color" value={efDuoShadow} onChange={e => setEfDuoShadow(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Highlight colour</label>
                  <Tooltip text="Colour mapped onto the lightest parts of the image."><input type="color" value={efDuoHighlight} onChange={e => setEfDuoHighlight(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
              </div>
            )}
            {efError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{efError}</div>}
            <Tooltip text="Apply the selected effect with the settings above."><button type="button" onClick={runEffect} disabled={efBusy || !efSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {efBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('wand', { size: 15 })}
              {efBusy ? 'Applying...' : 'Apply effect'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {efResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(efSource?.imageDataUrl, efResult?.imageDataUrl)}
                  {renderSendTo(efResult.imageDataUrl, `effect.${efResult.format}`, 'effects')}
                  {renderExport(efResult.imageDataUrl, 'effect')}
                  <Tooltip text="Save the result to your device."><button onClick={() => downloadDataUrl(efResult.imageDataUrl, `effect-${Date.now()}.${efResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {efResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(efSource?.imageDataUrl, efResult, { transparent: true, alt: 'result' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{efResult.width}×{efResult.height} · {String(efResult.format).toUpperCase()} · {formatBytes(efResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={efSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
