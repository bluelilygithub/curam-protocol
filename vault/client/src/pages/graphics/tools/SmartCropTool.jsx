import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, loadImageInto, UrlImportRow, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function SmartCropTool({ active }) {
  const getIcon = useIcon();
  const { renderSendTo, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  // Smart crop
  const [scSource, setScSource] = useState(null);

  const [scWidth, setScWidth] = useState('');
  const [scHeight, setScHeight] = useState('');
  const [scAspect, setScAspect] = useState('');
  const [scFocus, setScFocus] = useState('attention');
  const [scBusy, setScBusy] = useState(false);
  const [scResult, setScResult] = useState(null);
  const [scError, setScError] = useState('');

  // Smart crop handlers.
  const runSmartCrop = async () => {
    if (!scSource?.imageDataUrl) return;
    setScBusy(true);
    setScError('');
    try {
      const res = await api.post('/api/graphics/smart-crop', {
        imageDataUrl: scSource.imageDataUrl,
        width: scWidth ? Number(scWidth) : undefined,
        height: scHeight ? Number(scHeight) : undefined,
        aspect: scAspect || undefined,
        focus: scFocus,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Smart crop failed');
      setScResult(data);
    } catch (err) {
      setScError(err.message || 'Smart crop failed');
    } finally {
      setScBusy(false);
    }
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Smart crop</h2>
            <button type="button" onClick={() => setHelpTool('smartcrop')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Crop to a target size or aspect ratio. The focus strategy determines which part of the image is kept — <strong>Attention</strong> uses saliency detection, <strong>Entropy</strong> keeps the region with the most visual detail.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to crop."><input type="file" accept="image/*" onChange={async e => { setScError(''); setScResult(null); loadImageInto(setScSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setScError(err); } else { setScResult(null); setScError(''); setScSource(src); } })} />
            </div>
            {scSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={scSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Focus strategy</label>
                <Tooltip text="Which part of the image to keep when cropping — Attention finds the main subject automatically."><select value={scFocus} onChange={e => setScFocus(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="attention">Attention (saliency — recommended)</option>
                  <option value="entropy">Entropy (highest detail region)</option>
                  <option value="centre">Centre</option>
                  <option value="north">Top</option>
                  <option value="south">Bottom</option>
                  <option value="west">Left</option>
                  <option value="east">Right</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Aspect ratio (e.g. 16:9, 1:1, 4:5)</label>
                <Tooltip text="Crop to this width:height ratio instead of an exact pixel size."><input type="text" value={scAspect} onChange={e => setScAspect(e.target.value)} placeholder="Leave blank to use width × height" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Width (px)</label>
                  <Tooltip text="Exact target width in pixels."><input type="number" min="1" max="8000" value={scWidth} onChange={e => setScWidth(e.target.value)} placeholder="e.g. 1080" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Height (px)</label>
                  <Tooltip text="Exact target height in pixels."><input type="number" min="1" max="8000" value={scHeight} onChange={e => setScHeight(e.target.value)} placeholder="e.g. 1080" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                </div>
              </div>
            </div>
            {scError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{scError}</div>}
            <Tooltip text="Crop the image with the settings above."><button type="button" onClick={runSmartCrop} disabled={scBusy || !scSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {scBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('aim', { size: 15 })}
              {scBusy ? 'Cropping…' : 'Smart crop'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {scResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(scResult.imageDataUrl, `cropped.${scResult.format}`, 'smartcrop')}
                  {renderExport(scResult.imageDataUrl, 'cropped')}
                  <Tooltip text="Save the cropped image to your device."><button onClick={() => downloadDataUrl(scResult.imageDataUrl, `smartcrop-${Date.now()}.${scResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {scResult?.imageDataUrl ? (
                <>
                  <img src={scResult.imageDataUrl} alt="cropped" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{scResult.width}×{scResult.height} · {String(scResult.format).toUpperCase()} · {formatBytes(scResult.bytes)} · focus: {scResult.focus}</p>
                </>
              ) : <ResultPlaceholder src={scSource?.imageDataUrl} message="Choose a target size or aspect ratio, then crop." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
