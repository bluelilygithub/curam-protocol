import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, formatBytes, downloadDataUrl } from '../shared';

export default function BatchTextTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  // Batch text
  const [btImages, setBtImages] = useState([]);

  const [btText, setBtText] = useState('{filename}');
  const [btPosition, setBtPosition] = useState('bottom-right');
  const [btColor, setBtColor] = useState('#ffffff');
  const [btFontSize, setBtFontSize] = useState(36);
  const [btOpacity, setBtOpacity] = useState(0.85);
  const [btBg, setBtBg] = useState('');
  const [btBusy, setBtBusy] = useState(false);
  const [btResults, setBtResults] = useState([]);
  const [btError, setBtError] = useState('');

  // Batch text handlers.
  const addBtImages = async (fileList) => {
    const files = Array.from(fileList || []);
    const loaded = await Promise.all(files.map(async (f) => {
      try {
        const dataUrl = await readFileAsDataUrl(f);
        return { name: f.name, imageDataUrl: dataUrl };
      } catch { return null; }
    }));
    setBtImages(prev => [...prev, ...loaded.filter(Boolean)].slice(0, 20));
  };

  const runBatchText = async () => {
    if (!btImages.length) return;
    setBtBusy(true);
    setBtError('');
    setBtResults([]);
    try {
      const res = await api.post('/api/graphics/batch-text', {
        images: btImages,
        text: btText,
        position: btPosition,
        color: btColor,
        fontSize: btFontSize,
        opacity: btOpacity,
        background: btBg || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch text failed');
      setBtResults(data.results || []);
    } catch (err) {
      setBtError(err.message || 'Batch text failed');
    } finally {
      setBtBusy(false);
    }
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Batch text</h2>
            <button type="button" onClick={() => setHelpTool('batchtext')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Stamp a text label onto many images at once. Use <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{filename}'}</code>, <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{index}'}</code>, <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{n}'}</code> or <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{date}'}</code> as template variables.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Images (up to 20)</label>
              <Tooltip text="Choose up to 20 images to stamp the same text label onto."><input type="file" accept="image/*" multiple onChange={e => addBtImages(e.target.files)} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              {btImages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {btImages.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.imageDataUrl} alt={img.name} className="h-12 w-12 rounded-lg border object-cover" style={{ borderColor: 'var(--color-border)' }} title={img.name} />
                      <Tooltip text="Remove this image from the batch."><button type="button" onClick={() => setBtImages(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: '#ef4444', color: '#fff' }}>×</button></Tooltip>
                    </div>
                  ))}
                  <Tooltip text="Remove all added images."><button type="button" onClick={() => setBtImages([])} className="text-xs px-2 py-1 rounded-lg border self-center hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: '#ef4444' }}>Clear all</button></Tooltip>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Text template</label>
              <Tooltip text="Text to stamp on every image — use {filename}, {index}, {n} or {date} to insert per-image values."><input type="text" value={btText} onChange={e => setBtText(e.target.value)} placeholder="{filename}" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Position</label>
                <Tooltip text="Where the label sits on each image."><select value={btPosition} onChange={e => setBtPosition(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-right">Top right</option>
                  <option value="top-left">Top left</option>
                  <option value="center">Centre</option>
                  <option value="bottom">Bottom centre</option>
                  <option value="top">Top centre</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Font size: {btFontSize}px</label>
                <Tooltip text="Size of the label text."><input type="range" min="8" max="120" step="2" value={btFontSize} onChange={e => setBtFontSize(Number(e.target.value))} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Text colour</label>
                <Tooltip text="Colour of the label text."><input type="color" value={btColor} onChange={e => setBtColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)' }} /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(btOpacity * 100)}%</label>
                <Tooltip text="How see-through the label is."><input type="range" min="0.1" max="1" step="0.05" value={btOpacity} onChange={e => setBtOpacity(Number(e.target.value))} className="w-full" /></Tooltip>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background colour (optional — adds a backing rectangle)</label>
                <div className="flex items-center gap-2">
                  <Tooltip text="Colour of an optional solid panel behind the label, to keep it readable."><input type="color" value={btBg || '#000000'} onChange={e => setBtBg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)' }} /></Tooltip>
                  {btBg ? <Tooltip text="Remove the background panel — show text only."><button type="button" onClick={() => setBtBg('')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Remove</button></Tooltip> : <span className="text-xs" style={{ color: 'var(--color-muted)' }}>None (text only)</span>}
                </div>
              </div>
            </div>
            {btError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{btError}</div>}
            <Tooltip text="Stamp the text label onto every added image."><button type="button" onClick={runBatchText} disabled={btBusy || !btImages.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {btBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('text', { size: 15 })}
              {btBusy ? `Processing ${btImages.length} image${btImages.length !== 1 ? 's' : ''}…` : `Apply to ${btImages.length || '0'} image${btImages.length !== 1 ? 's' : ''}`}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Results</span>
              {btResults.length > 0 && <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{btResults.filter(r => !r.error).length} of {btResults.length} succeeded</span>}
            </div>
            <div className="p-4">
              {btResults.length > 0 ? (
                <div className="space-y-3">
                  {btResults.map((r, i) => (
                    <div key={i} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      {r.imageDataUrl ? (
                        <img src={r.imageDataUrl} alt={r.name} className="h-14 w-14 rounded-lg border object-cover flex-shrink-0" style={{ borderColor: 'var(--color-border)' }} />
                      ) : (
                        <div className="h-14 w-14 rounded-lg border flex items-center justify-center flex-shrink-0" style={{ borderColor: 'var(--color-border)', background: '#fee2e2' }}>
                          <span className="text-[10px] text-center" style={{ color: '#991b1b' }}>error</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.name}</p>
                        {r.error ? (
                          <p className="text-xs mt-0.5" style={{ color: '#991b1b' }}>{r.error}</p>
                        ) : (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Label: {r.label} · {formatBytes(r.bytes)}</p>
                        )}
                      </div>
                      {r.imageDataUrl && (
                        <Tooltip text="Save this labelled image to your device."><button onClick={() => downloadDataUrl(r.imageDataUrl, r.name)} className="text-xs px-2 py-1 rounded-lg border flex-shrink-0 hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>↓</button></Tooltip>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-sm text-center px-6" style={{ color: 'var(--color-muted)' }}>
                  Add images, configure the label, then apply to see results here.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
