import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, downloadDataUrl } from '../shared';

export default function CollageTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool, setPreviewImage } = useGraphics();

  const [collageFiles, setCollageFiles] = useState([]);
  const [collageColumns, setCollageColumns] = useState('2');
  const [collageSpacing, setCollageSpacing] = useState('12');
  const [collageBg, setCollageBg] = useState('#ffffff');
  const [collageBusy, setCollageBusy] = useState(false);
  const [collageResult, setCollageResult] = useState(null);
  const [collageError, setCollageError] = useState('');

  const handleCollageFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const items = await Promise.all(files.map(async (file) => {
      const dataUrl = await readFileAsDataUrl(file).catch(() => null);
      return dataUrl ? { id: `${file.name}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: dataUrl } : null;
    }));
    setCollageFiles(prev => [...prev, ...items.filter(Boolean)].slice(0, 9));
  };

  const runCollage = async () => {
    if (collageFiles.length < 2) { setCollageError('Add at least 2 images'); return; }
    setCollageBusy(true);
    setCollageError('');
    try {
      const res = await api.post('/api/graphics/collage', {
        images: collageFiles.map(f => f.imageDataUrl),
        columns: Number(collageColumns),
        spacing: Number(collageSpacing),
        background: collageBg,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Collage failed');
      setCollageResult(data);
    } catch (err) {
      setCollageError(err.message || 'Collage failed');
    } finally {
      setCollageBusy(false);
    }
  };

  useProcessingWhile(collageBusy ? 'Building collage…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Collage / grid maker</h2>
            <button type="button" onClick={() => setHelpTool('collage')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Images (2–9)</label>
              <Tooltip text="Choose 2 to 9 images to arrange into a grid."><input type="file" accept="image/*" multiple onChange={e => { setCollageResult(null); setCollageError(''); handleCollageFiles(e.target.files); e.target.value = ''; }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {collageFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {collageFiles.map(f => (
                  <div key={f.id} className="relative">
                    <img src={f.imageDataUrl} alt="" className="h-14 w-14 rounded object-cover border" style={{ borderColor: 'var(--color-border)' }} />
                    <Tooltip text="Remove this image from the collage."><button type="button" onClick={() => setCollageFiles(prev => prev.filter(x => x.id !== f.id))} className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full text-[10px] leading-none text-white" style={{ background: '#ef4444' }}>×</button></Tooltip>
                  </div>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Columns</label>
                <Tooltip text="How many images to place per row in the grid."><select value={collageColumns} onChange={e => setCollageColumns(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  {[1, 2, 3, 4, 5].map(c => <option key={c} value={c}>{c}</option>)}
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Spacing: {collageSpacing}px</label>
                <Tooltip text="Gap between images in the grid, in pixels."><input type="range" min="0" max="60" value={collageSpacing} onChange={e => setCollageSpacing(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background</label>
                <Tooltip text="Colour that fills the gaps and any empty space between images."><input type="color" value={collageBg} onChange={e => setCollageBg(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
              </div>
            </div>
            {collageError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{collageError}</div>}
            <Tooltip text="Arrange the added images into a grid with these settings."><button type="button" onClick={runCollage} disabled={collageBusy || collageFiles.length < 2} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {collageBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('grid', { size: 15 })}
              {collageBusy ? 'Building...' : 'Make collage'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {collageResult?.imageDataUrl && <Tooltip text="Save the collage to your device."><button onClick={() => downloadDataUrl(collageResult.imageDataUrl, `collage-${Date.now()}.png`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>}
            </div>
            <div className="p-4">
              {collageResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(collageResult)} className="block w-full"><img src={collageResult.imageDataUrl} alt="collage" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{collageResult.count} images · {collageResult.columns}×{collageResult.rows} · {collageResult.width}×{collageResult.height}</p>
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Your collage will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
