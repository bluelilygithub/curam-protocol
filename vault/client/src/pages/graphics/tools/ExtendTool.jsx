import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function ExtendTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderSendTo, setHelpTool, setPreviewImage } = useGraphics();

  const [extSource, setExtSource] = useState(null);
  const [extTop, setExtTop] = useState('40');
  const [extRight, setExtRight] = useState('40');
  const [extBottom, setExtBottom] = useState('40');
  const [extLeft, setExtLeft] = useState('40');
  const [extLink, setExtLink] = useState(true);
  const [extTransparent, setExtTransparent] = useState(false);
  const [extColor, setExtColor] = useState('#ffffff');
  const [extBusy, setExtBusy] = useState(false);
  const [extResult, setExtResult] = useState(null);
  const [extError, setExtError] = useState('');

  const setExtAll = (val) => { setExtTop(val); setExtRight(val); setExtBottom(val); setExtLeft(val); };

  const runExtend = async () => {
    if (!extSource?.imageDataUrl) return;
    setExtBusy(true);
    setExtError('');
    try {
      const res = await api.post('/api/graphics/extend', {
        imageDataUrl: extSource.imageDataUrl,
        top: Number(extTop) || 0,
        right: Number(extRight) || 0,
        bottom: Number(extBottom) || 0,
        left: Number(extLeft) || 0,
        transparent: extTransparent,
        background: extColor,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Canvas extend failed');
      setExtResult(data);
    } catch (err) {
      setExtError(err.message || 'Canvas extend failed');
    } finally {
      setExtBusy(false);
    }
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'extend' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setExtResult(null); setExtError(''); setExtSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(extBusy ? 'Extending canvas…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Canvas extend</h2>
            <button type="button" onClick={() => setHelpTool('extend')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to add padding around."><input type="file" accept="image/*" onChange={e => { setExtResult(null); setExtError(''); loadImageInto(setExtSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {extSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={extSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <Tooltip text="Use one padding amount for all four sides instead of setting each separately."><input type="checkbox" checked={extLink} onChange={e => setExtLink(e.target.checked)} /></Tooltip>
              Same padding on all sides
            </label>
            {extLink ? (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Padding (all sides): {extTop}px</label>
                <Tooltip text="How many pixels of padding to add around every edge of the image."><input type="range" min="0" max="400" value={extTop} onChange={e => setExtAll(e.target.value)} className="w-full" /></Tooltip>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Top (px)</label>
                  <Tooltip text="Padding to add above the image, in pixels."><input type="number" min="0" value={extTop} onChange={e => setExtTop(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Right (px)</label>
                  <Tooltip text="Padding to add to the right of the image, in pixels."><input type="number" min="0" value={extRight} onChange={e => setExtRight(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Bottom (px)</label>
                  <Tooltip text="Padding to add below the image, in pixels."><input type="number" min="0" value={extBottom} onChange={e => setExtBottom(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Left (px)</label>
                  <Tooltip text="Padding to add to the left of the image, in pixels."><input type="number" min="0" value={extLeft} onChange={e => setExtLeft(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                <Tooltip text="Make the new padding transparent instead of a solid colour (saves as PNG)."><input type="checkbox" checked={extTransparent} onChange={e => setExtTransparent(e.target.checked)} /></Tooltip>
                Transparent padding (PNG)
              </label>
              {!extTransparent && (
                <div className="flex items-center gap-2">
                  <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Fill colour</label>
                  <Tooltip text="Colour used to fill the new padding."><input type="color" value={extColor} onChange={e => setExtColor(e.target.value)} className="h-8 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
              )}
            </div>
            {extError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{extError}</div>}
            <Tooltip text="Add the padding with the settings above."><button type="button" onClick={runExtend} disabled={extBusy || !extSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {extBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('frame', { size: 15 })}
              {extBusy ? 'Working...' : 'Add padding'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {extResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}.${extResult.format}`, 'extend')}
                  {renderExport(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}`)}
                  <Tooltip text="Save the padded image to your device."><button onClick={() => downloadDataUrl(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}.${extResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {extResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(extResult)} className="block w-full rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                    <img src={extResult.imageDataUrl} alt="result" className="w-full" />
                  </button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{extResult.width}×{extResult.height} · {String(extResult.format).toUpperCase()} · {formatBytes(extResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={extSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
