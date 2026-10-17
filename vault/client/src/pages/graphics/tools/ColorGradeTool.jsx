import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, loadImageInto, UrlImportRow, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function ColorGradeTool({ active }) {
  const getIcon = useIcon();
  const { renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  // Color grading
  const [cgSource, setCgSource] = useState(null);

  const [cgPreset, setCgPreset] = useState('warm');
  const [cgBusy, setCgBusy] = useState(false);
  const [cgResult, setCgResult] = useState(null);
  const [cgError, setCgError] = useState('');

  // Color grading handlers.
  const runColorGrade = async () => {
    if (!cgSource?.imageDataUrl) return;
    setCgBusy(true);
    setCgError('');
    try {
      const res = await api.post('/api/graphics/colorgrade', {
        imageDataUrl: cgSource.imageDataUrl,
        preset: cgPreset,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Color grading failed');
      setCgResult(data);
    } catch (err) {
      setCgError(err.message || 'Color grading failed');
    } finally {
      setCgBusy(false);
    }
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Color grading</h2>
            <button type="button" onClick={() => setHelpTool('colorgrade')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Apply a cinematic colour look via channel recombination and tone mapping. Non-destructive — re-run with a different preset any time.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to apply a colour grade to."><input type="file" accept="image/*" onChange={async e => { setCgError(''); setCgResult(null); loadImageInto(setCgSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setCgError(err); } else { setCgResult(null); setCgError(''); setCgSource(src); } })} />
            </div>
            {cgSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={cgSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Preset</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: 'warm', label: 'Warm' },
                  { id: 'cool', label: 'Cool' },
                  { id: 'cinematic', label: 'Cinematic' },
                  { id: 'vintage', label: 'Vintage' },
                  { id: 'fade', label: 'Fade' },
                  { id: 'matte', label: 'Matte' },
                  { id: 'vivid', label: 'Vivid' },
                  { id: 'noir', label: 'Noir (B&W)' },
                  { id: 'golden', label: 'Golden hour' },
                  { id: 'teal_orange', label: 'Teal & orange' },
                ].map(p => (
                  <button key={p.id} type="button" onClick={() => setCgPreset(p.id)} className="px-3 py-2 rounded-xl text-xs font-medium border text-left" style={{ background: cgPreset === p.id ? 'var(--color-primary)' : 'var(--color-bg)', color: cgPreset === p.id ? '#fff' : 'var(--color-text)', borderColor: cgPreset === p.id ? 'var(--color-primary)' : 'var(--color-border)' }} title={`Select the "${p.label}" cinematic colour look.`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {cgError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{cgError}</div>}
            <Tooltip text="Apply the selected colour grade to the image."><button type="button" onClick={runColorGrade} disabled={cgBusy || !cgSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {cgBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('palette-2', { size: 15 })}
              {cgBusy ? 'Grading…' : 'Apply grade'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {cgResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(cgSource?.imageDataUrl, cgResult?.imageDataUrl)}
                  {renderSendTo(cgResult.imageDataUrl, `graded.${cgResult.format}`, 'colorgrade')}
                  {renderExport(cgResult.imageDataUrl, 'graded')}
                  <Tooltip text="Save the graded image to your device."><button onClick={() => downloadDataUrl(cgResult.imageDataUrl, `graded-${Date.now()}.${cgResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {cgResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(cgSource?.imageDataUrl, cgResult, { alt: 'graded' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{cgResult.presetLabel} · {cgResult.width}×{cgResult.height} · {String(cgResult.format).toUpperCase()} · {formatBytes(cgResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={cgSource?.imageDataUrl} message="Pick a preset and apply to see the result." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
