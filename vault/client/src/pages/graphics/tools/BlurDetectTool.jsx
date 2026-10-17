import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, readFileAsDataUrl, UrlImportRow } from '../shared';

export default function BlurDetectTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  // Blur detection
  const [blurSource, setBlurSource] = useState(null);

  const [blurBusy, setBlurBusy] = useState(false);
  const [blurResult, setBlurResult] = useState(null);
  const [blurError, setBlurError] = useState('');

  const handleBlurFile = async (file) => {
    if (!file) return;
    setBlurError('');
    setBlurResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setBlurSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setBlurError('Could not read that image file.');
    }
  };

  const runBlurDetect = async () => {
    if (!blurSource?.imageDataUrl) return;
    setBlurBusy(true);
    setBlurError('');
    try {
      const res = await api.post('/api/graphics/blur-detect', {
        imageDataUrl: blurSource.imageDataUrl,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Blur detection failed');
      setBlurResult(data);
    } catch (err) {
      setBlurError(err.message || 'Blur detection failed');
    } finally {
      setBlurBusy(false);
    }
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Blur detection</h2>
            <button type="button" onClick={() => setHelpTool('blurdetect')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Analyse image sharpness using Laplacian edge detection. Nothing is uploaded — analysis happens in your browser.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to check for sharpness."><input type="file" accept="image/*" onChange={async e => handleBlurFile(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setBlurError(err); } else { setBlurSource(src); } })} />
            </div>
            {blurSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={blurSource.imageDataUrl} alt="source" className="max-h-48 mx-auto rounded-lg" />
              </div>
            )}
            {blurError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{blurError}</div>}
            <Tooltip text="Analyse the image's sharpness and classify it as Sharp, Soft or Blurry."><button type="button" onClick={runBlurDetect} disabled={blurBusy || !blurSource?.imageDataUrl} className="w-full px-4 py-2 rounded-xl font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{blurBusy ? 'Analysing…' : 'Analyse'}</button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
            </div>
            <div className="p-4">
              {blurResult ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>{blurResult.variance}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Laplacian variance</div>
                  </div>
                  <div className="rounded-xl border p-3 text-center" style={{ borderColor: 'var(--color-border)', background: blurResult.status === 'sharp' ? '#dcfce7' : blurResult.status === 'soft' ? '#fef3c7' : '#fee2e2' }}>
                    <div className="text-sm font-semibold" style={{ color: blurResult.status === 'sharp' ? '#166534' : blurResult.status === 'soft' ? '#92400e' : '#991b1b' }}>{blurResult.status === 'sharp' ? '📸 Sharp' : blurResult.status === 'soft' ? '⚠️ Soft' : '🌫️ Blurry'}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{blurResult.width}×{blurResult.height} px</div>
                  </div>
                </div>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Upload and analyse an image to see its blur score.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
