import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, downloadDataUrl, formatBytes } from '../shared';

export default function AnimateTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [animFrames, setAnimFrames] = useState([]);
  const [animDelay, setAnimDelay] = useState('200');
  const [animLoop, setAnimLoop] = useState(true);
  const [animBusy, setAnimBusy] = useState(false);
  const [animResult, setAnimResult] = useState(null);
  const [animError, setAnimError] = useState('');

  // Animate: assemble multiple frames into one animated GIF on the server.
  const handleAnimFrames = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const items = await Promise.all(files.map(async (file) => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        return { id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: dataUrl };
      } catch {
        return null;
      }
    }));
    setAnimFrames(prev => [...prev, ...items.filter(Boolean)]);
  };

  const removeAnimFrame = (id) => setAnimFrames(prev => prev.filter(f => f.id !== id));

  const moveAnimFrame = (id, dir) => setAnimFrames(prev => {
    const i = prev.findIndex(f => f.id === id);
    if (i < 0) return prev;
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const copy = [...prev];
    const [x] = copy.splice(i, 1);
    copy.splice(j, 0, x);
    return copy;
  });

  const clearAnimFrames = () => { setAnimFrames([]); setAnimResult(null); setAnimError(''); };

  const runAnimate = async () => {
    if (animFrames.length < 2) { setAnimError('Add at least 2 frames'); return; }
    setAnimBusy(true);
    setAnimError('');
    setAnimResult(null);
    try {
      const res = await api.post('/api/graphics/animate', {
        frames: animFrames.map(f => f.imageDataUrl),
        delay: Number(animDelay),
        loop: animLoop,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Animation failed');
      setAnimResult(data);
    } catch (err) {
      setAnimError(err.message || 'Animation failed');
    } finally {
      setAnimBusy(false);
    }
  };

  useProcessingWhile(animBusy ? 'Building animation…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Animate (GIF)</h2>
            <button type="button" onClick={() => setHelpTool('animate')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Combine several images into an animated GIF. Frames play in the order shown (the first frame sets the size — others are cropped to fit).</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Add frames</label>
              <Tooltip text="Choose two or more images to combine into an animated GIF."><input type="file" accept="image/*" multiple onChange={e => { handleAnimFrames(e.target.files); e.target.value = ''; }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Frame delay: {animDelay}ms</label>
                <Tooltip text="How long each frame is shown before advancing to the next, in milliseconds."><input type="range" min="20" max="2000" step="10" value={animDelay} onChange={e => setAnimDelay(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                <Tooltip text="Repeat the animation endlessly instead of playing once."><input type="checkbox" checked={animLoop} onChange={e => setAnimLoop(e.target.checked)} /></Tooltip> Loop forever
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Combine the frames above into an animated GIF."><button type="button" onClick={runAnimate} disabled={animBusy || animFrames.length < 2} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {animBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('film', { size: 15 })}
                {animBusy ? 'Building...' : 'Build GIF'}
              </button></Tooltip>
              {animFrames.length > 0 && (
                <Tooltip text="Remove all added frames."><button type="button" onClick={clearAnimFrames} disabled={animBusy} className="px-3 py-2 rounded-xl text-sm border disabled:opacity-50 hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Clear</button></Tooltip>
              )}
            </div>
            {animError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{animError}</div>}
            {animFrames.length === 0 ? (
              <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Add 2 or more frames to animate.</div>
            ) : (
              <div className="space-y-2">
                {animFrames.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <span className="text-[11px] w-5 text-center" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                    <img src={item.imageDataUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" style={{ border: '1px solid var(--color-border)' }} />
                    <p className="text-xs font-medium truncate flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>{item.name}</p>
                    <Tooltip text="Move this frame earlier in the sequence."><button type="button" onClick={() => moveAnimFrame(item.id, -1)} disabled={i === 0} className="text-xs px-1.5 py-1 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↑</button></Tooltip>
                    <Tooltip text="Move this frame later in the sequence."><button type="button" onClick={() => moveAnimFrame(item.id, 1)} disabled={i === animFrames.length - 1} className="text-xs px-1.5 py-1 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↓</button></Tooltip>
                    <Tooltip text="Remove this frame."><button type="button" onClick={() => removeAnimFrame(item.id)} disabled={animBusy} className="text-xs hover:opacity-70 disabled:opacity-40" style={{ color: '#ef4444' }}>Remove</button></Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {animResult?.imageDataUrl && <Tooltip text="Save the animated GIF to your device."><button onClick={() => downloadDataUrl(animResult.imageDataUrl, `animation-${Date.now()}.gif`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>}
            </div>
            <div className="p-4">
              {animResult?.imageDataUrl ? (
                <>
                  <img src={animResult.imageDataUrl} alt="animation" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{animResult.frames} frames · {animResult.width}×{animResult.height} · {formatBytes(animResult.bytes)}</p>
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Your animated GIF will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
