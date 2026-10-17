import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, readFileAsDataUrl, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function RemoveMetaTool({ active }) {
  const getIcon = useIcon();
  const { renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();

  const [metaSource, setMetaSource] = useState(null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaResult, setMetaResult] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [metaInfo, setMetaInfo] = useState(null);

  const loadMetaInfo = async (dataUrl) => {
    setMetaInfo(null);
    if (!dataUrl) return;
    try {
      const res = await api.post('/api/graphics/metadata', { imageDataUrl: dataUrl });
      const data = await res.json();
      if (res.ok) setMetaInfo(data);
    } catch {
      /* metadata read is best-effort; ignore failures */
    }
  };

  const runStripMetadata = async () => {
    if (!metaSource?.imageDataUrl) return;
    setMetaBusy(true);
    setMetaError('');
    try {
      const res = await api.post('/api/graphics/strip-metadata', { imageDataUrl: metaSource.imageDataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Metadata removal failed');
      setMetaResult(data);
    } catch (err) {
      setMetaError(err.message || 'Metadata removal failed');
    } finally {
      setMetaBusy(false);
    }
  };

  useProcessingWhile(metaBusy ? 'Stripping metadata…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Remove metadata</h2>
            <button type="button" onClick={() => setHelpTool('metadata')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Strips EXIF, GPS location, camera info, timestamps and colour profiles. Orientation is baked in so the image still displays correctly.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to check and clean of hidden metadata."><input type="file" accept="image/*" onChange={async e => {
                const file = e.target.files?.[0];
                setMetaResult(null); setMetaError(''); setMetaInfo(null);
                if (!file) return;
                const dataUrl = await readFileAsDataUrl(file).catch(() => null);
                if (!dataUrl) { setMetaError('Could not read that image file.'); return; }
                setMetaSource({ imageDataUrl: dataUrl, name: file.name });
                loadMetaInfo(dataUrl);
              }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {metaSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={metaSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            {metaSource?.imageDataUrl && metaInfo && (
              <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Current metadata</p>
                {metaInfo.basics?.length > 0 && (
                  <dl className="text-xs">
                    {metaInfo.basics.map((f) => (
                      <div key={f.label} className="flex items-start justify-between gap-3 py-1">
                        <dt style={{ color: 'var(--color-muted)' }}>{f.label}</dt>
                        <dd className="text-right break-all" style={{ color: 'var(--color-text)' }}>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {metaInfo.hasExif ? (
                  <dl className="text-xs border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
                    {metaInfo.exif.map((f) => (
                      <div key={f.label} className="flex items-start justify-between gap-3 py-1">
                        <dt style={{ color: f.label === 'GPS' ? '#b45309' : 'var(--color-muted)' }}>{f.label}</dt>
                        <dd className="text-right break-all" style={{ color: f.label === 'GPS' ? '#b45309' : 'var(--color-text)' }}>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-xs border-t pt-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>No EXIF camera/GPS data found — this image is already clean.</p>
                )}
              </div>
            )}
            {metaError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{metaError}</div>}
            <Tooltip text="Strip all hidden metadata (EXIF, GPS, camera info, colour profile) from this image."><button type="button" onClick={runStripMetadata} disabled={metaBusy || !metaSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {metaBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('shield', { size: 15 })}
              {metaBusy ? 'Cleaning...' : 'Remove metadata'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Cleaned image</span>
              {metaResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(metaSource?.imageDataUrl, metaResult?.imageDataUrl)}
                  {renderSendTo(metaResult.imageDataUrl, `clean.${metaResult.format}`, 'metadata')}
                  {renderExport(metaResult.imageDataUrl, 'clean')}
                  <Tooltip text="Save the cleaned image to your device."><button onClick={() => downloadDataUrl(metaResult.imageDataUrl, `clean-${Date.now()}.${metaResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {metaResult ? (
                <>
                  {renderResultMedia(metaSource?.imageDataUrl, metaResult, { alt: 'cleaned' })}
                  <div className="mt-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {metaResult.hadMetadata ? (
                      <>
                        <p className="font-medium" style={{ color: '#047857' }}>Removed:</p>
                        <ul className="mt-1 space-y-0.5">{metaResult.removed.map((r, i) => <li key={i}>- {r}</li>)}</ul>
                      </>
                    ) : <p>No removable metadata was found — the image was already clean.</p>}
                    <p className="mt-2">{formatBytes(metaResult.originalBytes)} → {formatBytes(metaResult.cleanedBytes)}</p>
                  </div>
                </>
              ) : <ResultPlaceholder src={metaSource?.imageDataUrl} message="The cleaned image and a report of what was removed will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
