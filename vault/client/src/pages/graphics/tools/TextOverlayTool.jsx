import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, renderExport, downloadDataUrl, ResultPlaceholder } from '../shared';

export default function TextOverlayTool({ active }) {
  const getIcon = useIcon();
  const { brandKit, handoff, renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();

  // Text overlay (headline/caption) — distinct from watermark's small text mode.
  const [txSource, setTxSource] = useState(null);

  const [txText, setTxText] = useState('Your headline here');
  const [txFontSize, setTxFontSize] = useState('');
  const [txColor, setTxColor] = useState('#ffffff');
  const [txBackground, setTxBackground] = useState('');
  const [txAlign, setTxAlign] = useState('center');
  const [txFontWeight, setTxFontWeight] = useState('bold');
  const [txMaxWidth, setTxMaxWidth] = useState('90');
  const [txStrokeColor, setTxStrokeColor] = useState('');
  const [txStrokeWidth, setTxStrokeWidth] = useState('2');
  const [txPosition, setTxPosition] = useState('center');
  const [txBusy, setTxBusy] = useState(false);
  const [txResult, setTxResult] = useState(null);
  const [txError, setTxError] = useState('');

  const runTextOverlay = async () => {
    if (!txSource?.imageDataUrl || !txText.trim()) return;
    setTxBusy(true);
    setTxError('');
    try {
      const body = {
        imageDataUrl: txSource.imageDataUrl,
        text: txText,
        color: txColor,
        backgroundColor: txBackground ? txBackground : 'transparent',
        align: txAlign,
        fontWeight: txFontWeight,
        maxWidth: Number(txMaxWidth),
        position: txPosition,
      };
      if (txFontSize) body.fontSize = Number(txFontSize);
      if (txStrokeColor) { body.strokeColor = txStrokeColor; body.strokeWidth = Number(txStrokeWidth); }
      const res = await api.post('/api/graphics/text', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Text overlay failed');
      setTxResult(data);
    } catch (err) {
      setTxError(err.message || 'Text overlay failed');
    } finally {
      setTxBusy(false);
    }
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'textoverlay' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setTxResult(null); setTxError(''); setTxSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(txBusy ? 'Applying text overlay…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Text overlay</h2>
            <button type="button" onClick={() => setHelpTool('textoverlay')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to add headline or caption text to."><input type="file" accept="image/*" onChange={e => { setTxResult(null); setTxError(''); loadImageInto(setTxSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {txSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={txSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Headline / caption text</label>
              <Tooltip text="The text to overlay on the image — it wraps automatically to fit the max width."><textarea value={txText} onChange={e => setTxText(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Text colour</label>
                <div className="flex items-center gap-1.5">
                  <Tooltip text="Colour of the overlay text."><input type="color" value={txColor} onChange={e => setTxColor(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                  {brandKit?.colors?.map((c, i) => (
                    <Tooltip key={i} text={`Use brand colour ${i + 1}.`}>
                      <button type="button" onClick={() => setTxColor(c)} className="h-6 w-6 rounded-full border flex-shrink-0" style={{ background: c, borderColor: 'var(--color-border)' }} />
                    </Tooltip>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background pill</label>
                <div className="flex items-center gap-2">
                  <Tooltip text="Add a solid colour panel behind the text so it stays readable over busy images."><input type="checkbox" checked={!!txBackground} onChange={e => setTxBackground(e.target.checked ? '#000000' : '')} /></Tooltip>
                  <Tooltip text="Colour of the background panel behind the text."><input type="color" value={txBackground || '#000000'} disabled={!txBackground} onChange={e => setTxBackground(e.target.value)} className="h-9 w-full rounded border disabled:opacity-40" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Font size (px)</label>
                <Tooltip text="Text size in pixels. Leave blank to size it automatically to fit."><input type="number" min="8" max="600" value={txFontSize} onChange={e => setTxFontSize(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Align</label>
                <Tooltip text="How the text lines are aligned within their block."><select value={txAlign} onChange={e => setTxAlign(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Weight</label>
                <Tooltip text="How bold the overlay text appears."><select value={txFontWeight} onChange={e => setTxFontWeight(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="bold">Bold</option>
                  <option value="normal">Normal</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Max width: {txMaxWidth}%</label>
                <Tooltip text="How wide the text block can grow before wrapping, as a percentage of the image width."><input type="range" min="10" max="100" value={txMaxWidth} onChange={e => setTxMaxWidth(e.target.value)} className="w-full" /></Tooltip>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Position</label>
                <Tooltip text="Where on the image the text block is placed."><select value={txPosition} onChange={e => setTxPosition(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="center">Centre</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="top-left">Top left</option>
                  <option value="top-right">Top right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-right">Bottom right</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Outline colour</label>
                <div className="flex items-center gap-2">
                  <Tooltip text="Add an outline around the text so it stands out against the image behind it."><input type="checkbox" checked={!!txStrokeColor} onChange={e => setTxStrokeColor(e.target.checked ? '#000000' : '')} /></Tooltip>
                  <Tooltip text="Colour of the text outline."><input type="color" value={txStrokeColor || '#000000'} disabled={!txStrokeColor} onChange={e => setTxStrokeColor(e.target.value)} className="h-9 w-full rounded border disabled:opacity-40" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Outline width</label>
                <Tooltip text="Thickness of the text outline in pixels."><input type="number" min="1" max="40" disabled={!txStrokeColor} value={txStrokeWidth} onChange={e => setTxStrokeWidth(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm disabled:opacity-40" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
            </div>
            {txError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{txError}</div>}
            <Tooltip text="Apply the text overlay with the settings above."><button type="button" onClick={runTextOverlay} disabled={txBusy || !txSource?.imageDataUrl || !txText.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {txBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('text', { size: 15 })}
              {txBusy ? 'Applying...' : 'Add text'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {txResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(txSource?.imageDataUrl, txResult?.imageDataUrl)}
                  {renderSendTo(txResult.imageDataUrl, `text-overlay.${txResult.format}`, 'textoverlay')}
                  {renderExport(txResult.imageDataUrl, 'text-overlay')}
                  <Tooltip text="Save the image with the text overlay to your device."><button onClick={() => downloadDataUrl(txResult.imageDataUrl, `text-overlay-${Date.now()}.${txResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {txResult?.imageDataUrl ? (
                renderResultMedia(txSource?.imageDataUrl, txResult, { alt: 'result' })
              ) : <ResultPlaceholder src={txSource?.imageDataUrl} message="Your image with the text overlay will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
