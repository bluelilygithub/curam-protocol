import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, loadImageEl, formatBytes } from '../shared';

export default function FileInfoTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [fileInfo, setFileInfo] = useState(null);
  const [fileInfoError, setFileInfoError] = useState('');

  const inspectFile = async (file) => {
    if (!file) return;
    setFileInfo(null);
    setFileInfoError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const info = {
        name: file.name,
        bytes: file.size,
        type: file.type || 'unknown',
        ext: (file.name.split('.').pop() || '').toUpperCase(),
        lastModified: file.lastModified ? new Date(file.lastModified) : null,
        imageDataUrl: dataUrl,
        width: null,
        height: null,
      };
      try {
        const img = await loadImageEl(dataUrl);
        info.width = img.naturalWidth;
        info.height = img.naturalHeight;
      } catch {
        /* not a raster image (e.g. SVG without intrinsic size) */
      }
      setFileInfo(info);
    } catch {
      setFileInfoError('Could not read that file.');
    }
  };

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  const aspectRatio = (w, h) => {
    if (!w || !h) return '—';
    const d = gcd(w, h);
    return `${w / d}:${h / d}`;
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>File info</h2>
            <button type="button" onClick={() => setHelpTool('fileinfo')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Inspect a file’s size, type, dimensions and other details. Nothing is uploaded — everything is read in your browser.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Choose file</label>
              <Tooltip text="Choose an image file to inspect its details."><input type="file" accept="image/*" onChange={e => inspectFile(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {fileInfo?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={fileInfo.imageDataUrl} alt="preview" className="max-h-56 mx-auto rounded-lg" />
              </div>
            )}
            {fileInfoError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{fileInfoError}</div>}
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Details</span>
            </div>
            <div className="p-4">
              {fileInfo ? (
                <dl className="text-sm">
                  {[
                    ['Name', fileInfo.name],
                    ['Type', fileInfo.type],
                    ['Format', fileInfo.ext || '—'],
                    ['Size', `${formatBytes(fileInfo.bytes)} (${fileInfo.bytes.toLocaleString()} bytes)`],
                    ['Dimensions', fileInfo.width ? `${fileInfo.width} × ${fileInfo.height} px` : '—'],
                    ['Aspect ratio', aspectRatio(fileInfo.width, fileInfo.height)],
                    ['Megapixels', fileInfo.width ? `${((fileInfo.width * fileInfo.height) / 1e6).toFixed(2)} MP` : '—'],
                    ['Last modified', fileInfo.lastModified ? fileInfo.lastModified.toLocaleString() : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                      <dt className="shrink-0" style={{ color: 'var(--color-muted)' }}>{k}</dt>
                      <dd className="text-right break-all" style={{ color: 'var(--color-text)' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose a file to see its details.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
