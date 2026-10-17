import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, readFileAsDataUrl, UrlImportRow, ResultPlaceholder, renderExport } from '../shared';

export default function AutoEnhanceTool({ active }) {
  const getIcon = useIcon();
  const { renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  // Auto-enhance
  const [aeSource, setAeSource] = useState(null);

  const [aeBusy, setAeBusy] = useState(false);
  const [aeResult, setAeResult] = useState(null);
  const [aeError, setAeError] = useState('');

  const handleAeFile = async (file) => {
    if (!file) return;
    setAeError('');
    setAeResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAeSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setAeError('Could not read that image file.');
    }
  };

  const runAutoEnhance = async () => {
    if (!aeSource?.imageDataUrl) return;
    setAeBusy(true);
    setAeError('');
    try {
      const res = await api.post('/api/graphics/auto-enhance', {
        imageDataUrl: aeSource.imageDataUrl,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-enhance failed');
      setAeResult(data);
    } catch (err) {
      setAeError(err.message || 'Auto-enhance failed');
    } finally {
      setAeBusy(false);
    }
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Auto-enhance</h2>
            <button type="button" onClick={() => setHelpTool('autoenhance')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>One-click intelligent brightness, contrast and saturation adjustments based on image analysis.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to auto-enhance."><input type="file" accept="image/*" onChange={async e => handleAeFile(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setAeError(err); } else { setAeSource(src); } })} />
            </div>
            {aeSource?.imageDataUrl && (
              <ResultPlaceholder src={aeSource.imageDataUrl} message={aeBusy ? 'Enhancing…' : 'Ready to enhance'} />
            )}
            {aeError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{aeError}</div>}
            <Tooltip text="Automatically fix brightness, contrast and saturation based on the image's histogram."><button type="button" onClick={runAutoEnhance} disabled={aeBusy || !aeSource?.imageDataUrl} className="w-full px-4 py-2 rounded-xl font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{aeBusy ? 'Enhancing…' : 'Enhance'}</button></Tooltip>
          </div>
          {aeResult && (
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
                  {renderCompareToggle(aeSource?.imageDataUrl, aeResult?.imageDataUrl)}
                </div>
              </div>
              <div className="p-4 space-y-4">
                {renderResultMedia(aeSource?.imageDataUrl, aeResult, { alt: 'enhanced' })}
                <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ color: 'var(--color-text)' }}>
                  <div className="px-2 py-1.5 rounded-lg text-center" style={{ background: 'var(--color-bg)' }}>
                    <div className="font-semibold">Brightness</div>
                    <div style={{ color: 'var(--color-muted)' }}>{aeResult.applied?.brightness}×</div>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg text-center" style={{ background: 'var(--color-bg)' }}>
                    <div className="font-semibold">Contrast</div>
                    <div style={{ color: 'var(--color-muted)' }}>{aeResult.applied?.contrast}×</div>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg text-center" style={{ background: 'var(--color-bg)' }}>
                    <div className="font-semibold">Saturation</div>
                    <div style={{ color: 'var(--color-muted)' }}>{aeResult.applied?.saturation}×</div>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {renderExport(aeResult?.imageDataUrl, 'enhanced')}
                  {renderSendTo(aeResult?.imageDataUrl, 'enhanced', 'autoenhance')}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
