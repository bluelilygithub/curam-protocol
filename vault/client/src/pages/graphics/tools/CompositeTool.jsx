import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, renderExport, downloadDataUrl, ResultPlaceholder } from '../shared';

export default function CompositeTool({ active }) {
  const getIcon = useIcon();
  const { brandKit, renderCompareToggle, renderResultMedia, setHelpTool } = useGraphics();

  // Composite (multi-layer: base image + ordered text/logo overlays).
  const [cmSource, setCmSource] = useState(null);

  const [cmLayers, setCmLayers] = useState([]);
  const [cmBusy, setCmBusy] = useState(false);
  const [cmResult, setCmResult] = useState(null);
  const [cmError, setCmError] = useState('');

  // Composite: a small, fixed v1 layer stack — one text layer and one logo/image
  // layer, each with its own position — rather than a full reorderable editor.
  const addCmTextLayer = () => setCmLayers(prev => ([...prev, {
    id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'text',
    text: 'New text layer',
    color: '#ffffff',
    backgroundColor: '',
    fontWeight: 'bold',
    align: 'center',
    maxWidth: 90,
    position: 'center',
    opacity: 1,
  }]));

  const addCmImageLayer = () => setCmLayers(prev => ([...prev, {
    id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'image',
    imageDataUrl: null,
    scale: 25,
    position: 'bottom-right',
    opacity: 1,
  }]));

  const updateCmLayer = (id, patch) => setCmLayers(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));

  const addCmBrandLogoLayer = () => brandKit?.logoDataUrl && setCmLayers(prev => ([...prev, {
    id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'image',
    imageDataUrl: brandKit.logoDataUrl,
    scale: 25,
    position: 'bottom-right',
    opacity: 1,
  }]));

  const removeCmLayer = (id) => setCmLayers(prev => prev.filter(l => l.id !== id));

  const runComposite = async () => {
    if (!cmSource?.imageDataUrl || !cmLayers.length) return;
    setCmBusy(true);
    setCmError('');
    try {
      const overlays = cmLayers.map(l => {
        if (l.type === 'text') {
          return {
            type: 'text',
            text: l.text,
            color: l.color,
            backgroundColor: l.backgroundColor || 'transparent',
            fontWeight: l.fontWeight,
            align: l.align,
            maxWidth: Number(l.maxWidth) || 90,
            position: l.position,
            opacity: Number(l.opacity),
          };
        }
        return {
          type: 'image',
          imageDataUrl: l.imageDataUrl,
          scale: Number(l.scale) || 25,
          position: l.position,
          opacity: Number(l.opacity),
        };
      });
      if (overlays.some(o => o.type === 'image' && !o.imageDataUrl)) {
        throw new Error('Add an image for every logo/image layer');
      }
      const res = await api.post('/api/graphics/composite', { imageDataUrl: cmSource.imageDataUrl, overlays });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Composite failed');
      setCmResult(data);
    } catch (err) {
      setCmError(err.message || 'Composite failed');
    } finally {
      setCmBusy(false);
    }
  };

  useProcessingWhile(cmBusy ? 'Building composite…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Composite</h2>
            <button type="button" onClick={() => setHelpTool('composite')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Base image</label>
              <Tooltip text="Choose the base image that all layers will be stacked on top of."><input type="file" accept="image/*" onChange={e => { setCmResult(null); setCmError(''); loadImageInto(setCmSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {cmSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={cmSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="flex gap-2">
              <Tooltip text="Add a new text layer on top of the base image (up to 8 layers total)."><button type="button" onClick={addCmTextLayer} disabled={cmLayers.length >= 8} className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:opacity-80 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>+ Text layer</button></Tooltip>
              <Tooltip text="Add a new logo or image layer on top of the base image (up to 8 layers total)."><button type="button" onClick={addCmImageLayer} disabled={cmLayers.length >= 8} className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:opacity-80 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>+ Logo / image layer</button></Tooltip>
              {brandKit?.logoDataUrl && (
                <Tooltip text="Add your saved Brand Kit logo as a new layer.">
                  <button type="button" onClick={addCmBrandLogoLayer} disabled={cmLayers.length >= 8} className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:opacity-80 disabled:opacity-40 inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                    {getIcon('briefcase', { size: 12 })} + Logo from Brand Kit
                  </button>
                </Tooltip>
              )}
              <span className="text-[11px] self-center" style={{ color: 'var(--color-muted)' }}>{cmLayers.length}/8 layers</span>
            </div>

            {cmLayers.length === 0 ? (
              <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
                Add a text or logo layer to build your composite.
              </div>
            ) : (
              <div className="space-y-3">
                {cmLayers.map((layer, idx) => (
                  <div key={layer.id} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                        Layer {idx + 1} · {layer.type === 'text' ? 'Text' : 'Logo / image'}
                      </span>
                      <Tooltip text="Remove this layer from the composite."><button type="button" onClick={() => removeCmLayer(layer.id)} className="text-xs hover:opacity-70" style={{ color: '#ef4444' }}>Remove</button></Tooltip>
                    </div>
                    {layer.type === 'text' ? (
                      <>
                        <Tooltip text="Text to show for this layer."><input type="text" value={layer.text} onChange={e => updateCmLayer(layer.id, { text: e.target.value })} placeholder="Layer text" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex items-center gap-1.5">
                            <Tooltip text="Colour of this text layer."><input type="color" value={layer.color} onChange={e => updateCmLayer(layer.id, { color: e.target.value })} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                            {brandKit?.colors?.map((c, i) => (
                              <Tooltip key={i} text={`Use brand colour ${i + 1}.`}>
                                <button type="button" onClick={() => updateCmLayer(layer.id, { color: c })} className="h-6 w-6 rounded-full border flex-shrink-0" style={{ background: c, borderColor: 'var(--color-border)' }} />
                              </Tooltip>
                            ))}
                          </div>
                          <Tooltip text="How bold this text layer appears."><select value={layer.fontWeight} onChange={e => updateCmLayer(layer.id, { fontWeight: e.target.value })} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            <option value="bold">Bold</option>
                            <option value="normal">Normal</option>
                          </select></Tooltip>
                        </div>
                      </>
                    ) : (
                      <>
                        <Tooltip text="Choose the logo or image for this layer."><input type="file" accept="image/*" onChange={e => loadImageInto((src) => updateCmLayer(layer.id, { imageDataUrl: src?.imageDataUrl || null }))(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
                        <div>
                          <label className="block text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>Size: {layer.scale}% of image width</label>
                          <Tooltip text="How large this layer's image is, as a percentage of the base image's width."><input type="range" min="5" max="100" value={layer.scale} onChange={e => updateCmLayer(layer.id, { scale: e.target.value })} className="w-full" /></Tooltip>
                        </div>
                      </>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Tooltip text="Where this layer sits on the base image."><select value={layer.position} onChange={e => updateCmLayer(layer.id, { position: e.target.value })} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                        <option value="center">Centre</option>
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                        <option value="top-left">Top left</option>
                        <option value="top-right">Top right</option>
                        <option value="bottom-left">Bottom left</option>
                        <option value="bottom-right">Bottom right</option>
                      </select></Tooltip>
                      <div>
                        <label className="block text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(Number(layer.opacity) * 100)}%</label>
                        <Tooltip text="How see-through this layer is."><input type="range" min="0" max="1" step="0.05" value={layer.opacity} onChange={e => updateCmLayer(layer.id, { opacity: e.target.value })} className="w-full" /></Tooltip>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {cmError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{cmError}</div>}
            <Tooltip text="Render all layers onto the base image."><button type="button" onClick={runComposite} disabled={cmBusy || !cmSource?.imageDataUrl || !cmLayers.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {cmBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('combine', { size: 15 })}
              {cmBusy ? 'Compositing...' : 'Build composite'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {cmResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(cmSource?.imageDataUrl, cmResult?.imageDataUrl)}
                  {renderExport(cmResult.imageDataUrl, 'composite')}
                  <Tooltip text="Save the composited image to your device."><button onClick={() => downloadDataUrl(cmResult.imageDataUrl, `composite-${Date.now()}.${cmResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {cmResult?.imageDataUrl ? (
                renderResultMedia(cmSource?.imageDataUrl, cmResult, { alt: 'result' })
              ) : <ResultPlaceholder src={cmSource?.imageDataUrl} message="Your composited image will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
