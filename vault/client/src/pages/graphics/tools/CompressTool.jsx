import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, formatBytes } from '../shared';

export default function CompressTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [compressFiles, setCompressFiles] = useState([]);
  const [compressQuality, setCompressQuality] = useState('75');
  const [compressing, setCompressing] = useState(false);

  const handleCompressFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const items = await Promise.all(files.map(async (file) => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        return { id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: dataUrl, originalBytes: file.size, status: 'ready', result: null, error: '' };
      } catch {
        return { id: `${file.name}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: null, originalBytes: file.size, status: 'error', result: null, error: 'Could not read file' };
      }
    }));
    setCompressFiles(prev => [...prev, ...items]);
  };

  const removeCompressFile = (id) => {
    setCompressFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearCompressFiles = () => setCompressFiles([]);

  const compressOne = async (item) => {
    const res = await api.post('/api/graphics/compress', {
      imageDataUrl: item.imageDataUrl,
      quality: Number(compressQuality),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Compression failed');
    return data;
  };

  const runCompressAll = async () => {
    const pending = compressFiles.filter(f => f.imageDataUrl && f.status !== 'done');
    if (!pending.length) return;
    setCompressing(true);
    for (const item of pending) {
      setCompressFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'working', error: '' } : f));
      try {
        const data = await compressOne(item);
        setCompressFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', result: data } : f));
      } catch (err) {
        setCompressFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', error: err.message || 'Compression failed' } : f));
      }
    }
    setCompressing(false);
  };

  const downloadCompressed = (item) => {
    if (!item?.result?.imageDataUrl) return;
    const base = item.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = item.result.imageDataUrl;
    a.download = `${base}-compressed.${item.result.ext || 'img'}`;
    a.click();
  };

  const compressTotals = compressFiles.reduce((acc, f) => {
    if (f.result) {
      acc.original += f.result.originalBytes || 0;
      acc.compressed += f.result.compressedBytes || 0;
      acc.done += 1;
    }
    return acc;
  }, { original: 0, compressed: 0, done: 0 });

  const compressTotalSavedPct = compressTotals.original > 0
    ? (((compressTotals.original - compressTotals.compressed) / compressTotals.original) * 100).toFixed(1)
    : null;

  useProcessingWhile(compressing ? 'Compressing…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Compress images</h2>
            <button type="button" onClick={() => setHelpTool('compress')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Reduce file size by re-encoding one or more images at a lower quality. The original format is kept. Drop the quality for bigger savings.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Add images</label>
              <Tooltip text="Choose one or more image files to compress."><input
                type="file"
                accept="image/*"
                multiple
                onChange={e => { handleCompressFiles(e.target.files); e.target.value = ''; }}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              /></Tooltip>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality</label>
              <Tooltip text="How much to compress — lower quality gives a smaller file but more visible loss of detail."><select
                value={compressQuality}
                onChange={e => setCompressQuality(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="90">High (90)</option>
                <option value="75">Balanced (75)</option>
                <option value="60">Small (60)</option>
                <option value="40">Smallest (40)</option>
              </select></Tooltip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Compress every added image that hasn't been compressed yet."><button
              type="button"
              onClick={runCompressAll}
              disabled={compressing || !compressFiles.some(f => f.imageDataUrl && f.status !== 'done')}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {compressing ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('archive', { size: 15 })}
              {compressing ? 'Compressing...' : 'Compress all'}
            </button></Tooltip>
            {compressFiles.length > 0 && (
              <Tooltip text="Remove all added images from this list."><button
                type="button"
                onClick={clearCompressFiles}
                disabled={compressing}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
              >
                Clear
              </button></Tooltip>
            )}
            {compressTotalSavedPct != null && (
              <span className="text-xs ml-auto" style={{ color: 'var(--color-muted)' }}>
                {compressTotals.done} file{compressTotals.done === 1 ? '' : 's'} · {formatBytes(compressTotals.original)} → {formatBytes(compressTotals.compressed)} ·{' '}
                <span style={{ color: Number(compressTotalSavedPct) > 0 ? '#047857' : 'var(--color-muted)' }}>
                  {Number(compressTotalSavedPct) > 0 ? `saved ${compressTotalSavedPct}%` : 'no reduction'}
                </span>
              </span>
            )}
          </div>

          {compressFiles.length === 0 ? (
            <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              Add one or more images to compress.
            </div>
          ) : (
            <div className="space-y-2">
              {compressFiles.map(item => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  {item.imageDataUrl && (
                    <img src={item.imageDataUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" style={{ border: '1px solid var(--color-border)' }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                      {item.status === 'done' && item.result ? (
                        <>
                          {formatBytes(item.result.originalBytes)} → {formatBytes(item.result.compressedBytes)} ·{' '}
                          <span style={{ color: item.result.savedPct > 0 ? '#047857' : 'var(--color-muted)' }}>
                            {item.result.savedPct > 0 ? `saved ${item.result.savedPct}%` : 'no reduction'}
                          </span>
                        </>
                      ) : item.status === 'working' ? 'Compressing...'
                        : item.status === 'error' ? <span style={{ color: '#ef4444' }}>{item.error}</span>
                        : formatBytes(item.originalBytes)}
                    </p>
                  </div>
                  {item.status === 'done' && item.result?.imageDataUrl && (
                    <Tooltip text="Save this compressed image to your device."><button
                      type="button"
                      onClick={() => downloadCompressed(item)}
                      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 flex-shrink-0"
                      style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                    >
                      Download
                    </button></Tooltip>
                  )}
                  <Tooltip text="Remove this image from the list."><button
                    type="button"
                    onClick={() => removeCompressFile(item.id)}
                    disabled={compressing}
                    className="text-xs hover:opacity-70 flex-shrink-0 disabled:opacity-40"
                    style={{ color: '#ef4444' }}
                  >
                    Remove
                  </button></Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
