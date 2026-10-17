import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function FaviconTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [favSource, setFavSource] = useState(null);
  const [favBusy, setFavBusy] = useState(false);
  const [favResult, setFavResult] = useState(null);
  const [favError, setFavError] = useState('');

  const runFavicon = async () => {
    if (!favSource?.imageDataUrl) return;
    setFavBusy(true);
    setFavError('');
    try {
      const res = await api.post('/api/graphics/favicon', { imageDataUrl: favSource.imageDataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Favicon generation failed');
      setFavResult(data);
    } catch (err) {
      setFavError(err.message || 'Favicon generation failed');
    } finally {
      setFavBusy(false);
    }
  };

  useProcessingWhile(favBusy ? 'Building icon set…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Favicon / app icons</h2>
            <button type="button" onClick={() => setHelpTool('favicon')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image (square works best)</label>
              <Tooltip text="Choose a square image to generate the full icon set from."><input type="file" accept="image/*" onChange={e => { setFavResult(null); setFavError(''); loadImageInto(setFavSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {favSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={favSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Generates PNG icons at 16, 32, 48, 64, 180, 192, 256 and 512 px, an <strong>apple-touch-icon</strong>, a <strong>site.webmanifest</strong> and a ready-to-paste <strong>&lt;head&gt;</strong> snippet — bundled as a ZIP.
            </p>
            {favError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{favError}</div>}
            <Tooltip text="Generate the full icon set, manifest and head snippet as a downloadable ZIP."><button type="button" onClick={runFavicon} disabled={favBusy || !favSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {favBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('app-window', { size: 15 })}
              {favBusy ? 'Generating…' : 'Generate icon set'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Icon set</span>
              {favResult?.zipDataUrl && (
                <Tooltip text="Download the ZIP containing every icon size, the manifest and the head snippet."><button onClick={() => downloadDataUrl(favResult.zipDataUrl, 'favicons.zip')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download ZIP</button></Tooltip>
              )}
            </div>
            <div className="p-4">
              {favResult?.zipDataUrl ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    {favResult.sizes.map(s => (
                      <div key={s} className="flex flex-col items-center gap-1">
                        <img src={favSource?.imageDataUrl} alt={`${s}px`} style={{ width: Math.min(64, s), height: Math.min(64, s), objectFit: 'cover', borderRadius: 4, border: '1px solid var(--color-border)' }} />
                        <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{s}px</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{favResult.count} icons · {formatBytes(favResult.bytes)} ZIP</p>
                </div>
              ) : (
                <ResultPlaceholder src={favSource?.imageDataUrl} message="Your icon set will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
