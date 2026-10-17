import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, downloadDataUrl } from '../shared';

export default function ImageDiffTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool, setPreviewImage } = useGraphics();

  const [diffA, setDiffA] = useState(null);
  const [diffB, setDiffB] = useState(null);
  const [diffThreshold, setDiffThreshold] = useState('25');
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffResult, setDiffResult] = useState(null);
  const [diffError, setDiffError] = useState('');

  const runDiff = async () => {
    if (!diffA?.imageDataUrl || !diffB?.imageDataUrl) { setDiffError('Add both images'); return; }
    setDiffBusy(true);
    setDiffError('');
    try {
      const res = await api.post('/api/graphics/diff', {
        imageA: diffA.imageDataUrl,
        imageB: diffB.imageDataUrl,
        threshold: Number(diffThreshold),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diff failed');
      setDiffResult(data);
    } catch (err) {
      setDiffError(err.message || 'Diff failed');
    } finally {
      setDiffBusy(false);
    }
  };

  useProcessingWhile(diffBusy ? 'Comparing images…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Image diff</h2>
            <button type="button" onClick={() => setHelpTool('diff')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Differences are highlighted in red over a faded version of the first image. The second image is scaled to match the first.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Image A (base)</label>
                <Tooltip text="Choose the original / reference image."><input type="file" accept="image/*" onChange={e => { setDiffResult(null); setDiffError(''); loadImageInto(setDiffA)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
                {diffA?.imageDataUrl && <img src={diffA.imageDataUrl} alt="A" className="mt-2 max-h-28 rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Image B (compare)</label>
                <Tooltip text="Choose the image to compare against image A."><input type="file" accept="image/*" onChange={e => { setDiffResult(null); setDiffError(''); loadImageInto(setDiffB)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
                {diffB?.imageDataUrl && <img src={diffB.imageDataUrl} alt="B" className="mt-2 max-h-28 rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Sensitivity (threshold): {diffThreshold}</label>
              <Tooltip text="How different two pixels must be before they're flagged as changed."><input type="range" min="0" max="100" value={diffThreshold} onChange={e => setDiffThreshold(e.target.value)} className="w-full" /></Tooltip>
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Lower = more sensitive (flags smaller changes).</p>
            </div>
            {diffError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{diffError}</div>}
            <Tooltip text="Compare the two images and highlight what changed."><button type="button" onClick={runDiff} disabled={diffBusy || !diffA?.imageDataUrl || !diffB?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {diffBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('layers', { size: 15 })}
              {diffBusy ? 'Comparing...' : 'Compare images'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Difference</span>
              {diffResult?.imageDataUrl && <Tooltip text="Save the difference map to your device."><button onClick={() => downloadDataUrl(diffResult.imageDataUrl, `diff-${Date.now()}.png`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>}
            </div>
            <div className="p-4">
              {diffResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(diffResult)} className="block w-full"><img src={diffResult.imageDataUrl} alt="diff" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {diffResult.diffPct}% of pixels differ ({diffResult.diffPixels?.toLocaleString?.() || diffResult.diffPixels} px)
                  </p>
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>The difference map will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
