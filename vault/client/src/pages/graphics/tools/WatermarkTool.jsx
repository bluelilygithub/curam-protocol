import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, renderExport, downloadDataUrl, ResultPlaceholder } from '../shared';

export default function WatermarkTool({ active }) {
  const getIcon = useIcon();
  const { brandKit, handoff, renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();

  const [wmSource, setWmSource] = useState(null);
  const [wmType, setWmType] = useState('text');
  const [wmText, setWmText] = useState('© My Brand');
  const [wmColor, setWmColor] = useState('#ffffff');
  const [wmImage, setWmImage] = useState(null);
  const [wmPosition, setWmPosition] = useState('bottom-right');
  const [wmOpacity, setWmOpacity] = useState('0.5');
  const [wmScale, setWmScale] = useState('25');
  const [wmTile, setWmTile] = useState(false);
  const [wmBusy, setWmBusy] = useState(false);
  const [wmResult, setWmResult] = useState(null);
  const [wmError, setWmError] = useState('');

  const runWatermark = async () => {
    if (!wmSource?.imageDataUrl) return;
    setWmBusy(true);
    setWmError('');
    try {
      const body = {
        imageDataUrl: wmSource.imageDataUrl,
        type: wmType,
        position: wmPosition,
        opacity: Number(wmOpacity),
        tile: wmTile,
      };
      if (wmType === 'text') {
        body.text = wmText;
        body.color = wmColor;
      } else {
        if (!wmImage?.imageDataUrl) throw new Error('Add a watermark image');
        body.watermarkDataUrl = wmImage.imageDataUrl;
        body.scale = Number(wmScale);
      }
      const res = await api.post('/api/graphics/watermark', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Watermark failed');
      setWmResult(data);
    } catch (err) {
      setWmError(err.message || 'Watermark failed');
    } finally {
      setWmBusy(false);
    }
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'watermark' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setWmResult(null); setWmError(''); setWmSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(wmBusy ? 'Applying watermark…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Watermark</h2>
            <button type="button" onClick={() => setHelpTool('watermark')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to add a watermark to."><input type="file" accept="image/*" onChange={e => { setWmResult(null); setWmError(''); loadImageInto(setWmSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {wmSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={wmSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="flex gap-2">
              {['text', 'image'].map(t => (
                <button key={t} type="button" onClick={() => setWmType(t)} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: wmType === t ? 'var(--color-primary)' : 'transparent', color: wmType === t ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }} title={t === 'text' ? 'Stamp a line of text as the watermark.' : 'Stamp a logo or image as the watermark.'}>
                  {t === 'text' ? 'Text' : 'Image'}
                </button>
              ))}
            </div>
            {wmType === 'text' ? (
              <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Watermark text</label>
                  <Tooltip text="Text to stamp onto the image, e.g. a name or copyright notice."><input type="text" value={wmText} onChange={e => setWmText(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour</label>
                  <div className="flex items-center gap-1.5">
                    <Tooltip text="Colour of the watermark text."><input type="color" value={wmColor} onChange={e => setWmColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                    {brandKit?.colors?.map((c, i) => (
                      <Tooltip key={i} text={`Use brand colour ${i + 1}.`}>
                        <button type="button" onClick={() => setWmColor(c)} className="h-6 w-6 rounded-full border flex-shrink-0" style={{ background: c, borderColor: 'var(--color-border)' }} />
                      </Tooltip>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Watermark image (PNG)</label>
                  <Tooltip text="Choose a logo or image to stamp onto the source image."><input type="file" accept="image/*" onChange={e => loadImageInto(setWmImage)(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Size: {wmScale}% of width</label>
                  <Tooltip text="How large the watermark image is, as a percentage of the source image's width."><input type="range" min="5" max="100" value={wmScale} onChange={e => setWmScale(e.target.value)} className="w-full" /></Tooltip>
                </div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Position</label>
                <Tooltip text="Where the watermark sits on the image."><select value={wmPosition} onChange={e => setWmPosition(e.target.value)} disabled={wmTile} className="w-full px-3 py-2 rounded-xl border text-sm disabled:opacity-50" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-right">Top right</option>
                  <option value="top-left">Top left</option>
                  <option value="center">Centre</option>
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(Number(wmOpacity) * 100)}%</label>
                <Tooltip text="How see-through the watermark is."><input type="range" min="0" max="1" step="0.05" value={wmOpacity} onChange={e => setWmOpacity(e.target.value)} className="w-full" /></Tooltip>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <Tooltip text="Repeat the watermark in a grid across the whole image instead of placing it once."><input type="checkbox" checked={wmTile} onChange={e => setWmTile(e.target.checked)} /></Tooltip> Tile across the whole image
            </label>
            {wmError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{wmError}</div>}
            <Tooltip text="Apply the watermark with the settings above."><button type="button" onClick={runWatermark} disabled={wmBusy || !wmSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {wmBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('droplets', { size: 15 })}
              {wmBusy ? 'Applying...' : 'Add watermark'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {wmResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(wmSource?.imageDataUrl, wmResult?.imageDataUrl)}
                  {renderSendTo(wmResult.imageDataUrl, `watermarked.${wmResult.format}`, 'watermark')}
                  {renderExport(wmResult.imageDataUrl, 'watermarked')}
                  <Tooltip text="Save the watermarked image to your device."><button onClick={() => downloadDataUrl(wmResult.imageDataUrl, `watermarked-${Date.now()}.${wmResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {wmResult?.imageDataUrl ? (
                renderResultMedia(wmSource?.imageDataUrl, wmResult, { alt: 'result' })
              ) : <ResultPlaceholder src={wmSource?.imageDataUrl} message="Your watermarked image will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
