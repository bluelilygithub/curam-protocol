import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function VectorizeTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [svgSource, setSvgSource] = useState(null);
  const [svgColors, setSvgColors] = useState('16');
  const [svgDetail, setSvgDetail] = useState('medium');
  const [svgBusy, setSvgBusy] = useState(false);
  const [svgResult, setSvgResult] = useState(null);
  const [svgError, setSvgError] = useState('');

  const runVectorize = async () => {
    if (!svgSource?.imageDataUrl) return;
    setSvgBusy(true);
    setSvgError('');
    try {
      const res = await api.post('/api/graphics/vectorize', {
        imageDataUrl: svgSource.imageDataUrl,
        colors: Number(svgColors),
        detail: svgDetail,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Vectorize failed');
      setSvgResult(data);
    } catch (err) {
      setSvgError(err.message || 'Vectorize failed');
    } finally {
      setSvgBusy(false);
    }
  };

  useProcessingWhile(svgBusy ? 'Tracing to SVG…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Vectorize to SVG</h2>
            <button type="button" onClick={() => setHelpTool('svg')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to trace into an SVG."><input type="file" accept="image/*" onChange={e => { setSvgResult(null); setSvgError(''); loadImageInto(setSvgSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {svgSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={svgSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colours: {svgColors}</label>
                <Tooltip text="How many distinct colours the traced SVG can use — more colours captures more shading but adds complexity."><input type="range" min="2" max="64" value={svgColors} onChange={e => setSvgColors(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Detail</label>
                <Tooltip text="How closely the vector shapes follow the original edges — more detail means more anchor points and a larger file."><select value={svgDetail} onChange={e => setSvgDetail(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="smooth">Smooth (fewer points)</option>
                  <option value="medium">Medium</option>
                  <option value="detailed">Detailed (more points)</option>
                </select></Tooltip>
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Traces the image into scalable vector paths. Best for logos, icons and flat clipart — photos become a stylised, posterised look. Large images are scaled down before tracing for speed.</p>
            {svgError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{svgError}</div>}
            <Tooltip text="Trace the image into an SVG with the settings above."><button type="button" onClick={runVectorize} disabled={svgBusy || !svgSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {svgBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('shapes', { size: 15 })}
              {svgBusy ? 'Tracing…' : 'Convert to SVG'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>SVG result</span>
              {svgResult?.imageDataUrl && (
                <Tooltip text="Save the traced SVG file to your device."><button onClick={() => downloadDataUrl(svgResult.imageDataUrl, 'vectorized.svg')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download SVG</button></Tooltip>
              )}
            </div>
            <div className="p-4">
              {svgResult?.imageDataUrl ? (
                <>
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                    <img src={svgResult.imageDataUrl} alt="svg" className="w-full" />
                  </div>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{svgResult.width}×{svgResult.height} · {svgResult.colors} colours · {formatBytes(svgResult.bytes)} SVG</p>
                </>
              ) : (
                <ResultPlaceholder src={svgSource?.imageDataUrl} message="Your SVG will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
