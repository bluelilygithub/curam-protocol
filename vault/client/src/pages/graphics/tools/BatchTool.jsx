import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, formatBytes } from '../shared';

export default function BatchTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [batchFiles, setBatchFiles] = useState([]);
  const [batchOp, setBatchOp] = useState('convert');
  const [batchFormat, setBatchFormat] = useState('webp');
  const [batchQuality, setBatchQuality] = useState('82');
  const [batchWidth, setBatchWidth] = useState('1600');
  const [batchHeight, setBatchHeight] = useState('');
  const [batchFit, setBatchFit] = useState('inside');
  const [batchRunning, setBatchRunning] = useState(false);

  // Batch (extended): watermark / compress param panels + social presets list.
  const [batchWmText, setBatchWmText] = useState('© My Brand');

  const [batchWmColor, setBatchWmColor] = useState('#ffffff');
  const [batchWmPosition, setBatchWmPosition] = useState('bottom-right');
  const [batchWmOpacity, setBatchWmOpacity] = useState('0.5');
  const [batchCompressQuality, setBatchCompressQuality] = useState('75');

  const handleBatchFiles = async (fileList) => {
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
    setBatchFiles(prev => [...prev, ...items]);
  };

  const removeBatchFile = (id) => setBatchFiles(prev => prev.filter(f => f.id !== id));

  const clearBatchFiles = () => setBatchFiles([]);

  // Params for the ops that go through the single-call POST /api/graphics/batch
  // endpoint (convert/resize/watermark/compress). 'strip' has no server batch
  // support yet, so it still loops per-file below.
  const buildBatchParams = () => {
    if (batchOp === 'convert') return { format: batchFormat, quality: Number(batchQuality) };
    if (batchOp === 'resize') {
      const params = { op: 'resize', fit: batchFit };
      if (batchWidth) params.width = Number(batchWidth);
      if (batchHeight) params.height = Number(batchHeight);
      return params;
    }
    if (batchOp === 'watermark') {
      return { type: 'text', text: batchWmText, color: batchWmColor, position: batchWmPosition, opacity: Number(batchWmOpacity) };
    }
    if (batchOp === 'compress') return { quality: Number(batchCompressQuality) };
    return {};
  };

  const runBatchAll = async () => {
    const pending = batchFiles.filter(f => f.imageDataUrl && f.status !== 'done');
    if (!pending.length) return;
    if (batchOp === 'resize' && !batchWidth && !batchHeight) return;
    if (batchOp === 'watermark' && !batchWmText.trim()) return;
    setBatchRunning(true);
    setBatchFiles(prev => prev.map(f => (pending.some(p => p.id === f.id) ? { ...f, status: 'working', error: '' } : f)));

    if (batchOp === 'strip') {
      for (const item of pending) {
        try {
          const res = await api.post('/api/graphics/strip-metadata', { imageDataUrl: item.imageDataUrl }); // eslint-disable-line no-await-in-loop
          const data = await res.json(); // eslint-disable-line no-await-in-loop
          if (!res.ok) throw new Error(data.error || 'Operation failed');
          setBatchFiles(prev => prev.map(f => (f.id === item.id ? { ...f, status: 'done', result: data } : f)));
        } catch (err) {
          setBatchFiles(prev => prev.map(f => (f.id === item.id ? { ...f, status: 'error', error: err.message || 'Operation failed' } : f)));
        }
      }
      setBatchRunning(false);
      return;
    }

    try {
      const res = await api.post('/api/graphics/batch', {
        op: batchOp,
        items: pending.map(item => ({ imageDataUrl: item.imageDataUrl })),
        params: buildBatchParams(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch operation failed');
      setBatchFiles(prev => prev.map(f => {
        const idx = pending.findIndex(p => p.id === f.id);
        if (idx === -1) return f;
        const itemResult = data.results?.[idx];
        if (!itemResult || itemResult.error) return { ...f, status: 'error', error: itemResult?.error || 'Operation failed' };
        return { ...f, status: 'done', result: itemResult };
      }));
    } catch (err) {
      setBatchFiles(prev => prev.map(f => (pending.some(p => p.id === f.id) ? { ...f, status: 'error', error: err.message || 'Batch operation failed' } : f)));
    }
    setBatchRunning(false);
  };

  const downloadBatchItem = (item) => {
    if (!item?.result?.imageDataUrl) return;
    const base = item.name.replace(/\.[^.]+$/, '');
    const ext = item.result.ext || item.result.format || 'img';
    const suffixes = { convert: '', resize: '-resized', watermark: '-watermarked', compress: '-compressed', strip: '-clean' };
    const suffix = suffixes[batchOp] ?? '-clean';
    const a = document.createElement('a');
    a.href = item.result.imageDataUrl;
    a.download = `${base}${suffix}.${ext}`;
    a.click();
  };

  const downloadBatchAll = () => {
    batchFiles.filter(f => f.result?.imageDataUrl).forEach((item, i) => {
      setTimeout(() => downloadBatchItem(item), i * 150);
    });
  };

  useProcessingWhile(batchRunning ? 'Processing batch…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Batch process</h2>
            <button type="button" onClick={() => setHelpTool('batch')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Apply the same operation to many images at once — convert formats, resize, or strip metadata. Each file is processed and downloadable individually.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Add images</label>
              <Tooltip text="Choose up to 25 image files to process together."><input
                type="file"
                accept="image/*"
                multiple
                onChange={e => { handleBatchFiles(e.target.files); e.target.value = ''; }}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              /></Tooltip>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Operation</label>
              <Tooltip text="Which edit to apply to every image in this batch."><select
                value={batchOp}
                onChange={e => setBatchOp(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="convert">Convert format</option>
                <option value="resize">Resize</option>
                <option value="watermark">Add text watermark</option>
                <option value="compress">Compress</option>
                <option value="strip">Strip metadata</option>
              </select></Tooltip>
            </div>
          </div>

          {batchOp === 'convert' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Target format</label>
                <Tooltip text="File format every image in the batch will be converted to."><select value={batchFormat} onChange={e => setBatchFormat(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPG / JPEG</option>
                  <option value="webp">WebP</option>
                  <option value="gif">GIF</option>
                  <option value="avif">AVIF</option>
                  <option value="tiff">TIFF</option>
                  <option value="ico">ICO (favicon)</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality (lossy formats): {batchQuality}</label>
                <Tooltip text="Compression quality for formats that support it — lower gives smaller files but reduces image quality."><input type="range" min="1" max="100" value={batchQuality} onChange={e => setBatchQuality(e.target.value)} className="w-full" /></Tooltip>
              </div>
            </div>
          )}

          {batchOp === 'resize' && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Width (px)</label>
                <Tooltip text="Target width in pixels for every image. Leave blank to size automatically from the height."><input type="number" min="1" value={batchWidth} onChange={e => setBatchWidth(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Height (px)</label>
                <Tooltip text="Target height in pixels for every image. Leave blank to size automatically from the width."><input type="number" min="1" value={batchHeight} onChange={e => setBatchHeight(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fit</label>
                <Tooltip text="How each image should be fitted into the target size when its proportions don't match."><select value={batchFit} onChange={e => setBatchFit(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="inside">Inside (fit within)</option>
                  <option value="cover">Cover (fill + crop)</option>
                  <option value="contain">Contain (letterbox)</option>
                  <option value="fill">Fill (stretch)</option>
                  <option value="outside">Outside (cover area)</option>
                </select></Tooltip>
              </div>
            </div>
          )}

          {batchOp === 'watermark' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Watermark text</label>
                <Tooltip text="Text to stamp onto every image in the batch."><input type="text" value={batchWmText} onChange={e => setBatchWmText(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour</label>
                  <Tooltip text="Colour of the watermark text."><input type="color" value={batchWmColor} onChange={e => setBatchWmColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Position</label>
                  <Tooltip text="Where the watermark text sits on each image."><select value={batchWmPosition} onChange={e => setBatchWmPosition(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="top-right">Top right</option>
                    <option value="top-left">Top left</option>
                    <option value="center">Centre</option>
                  </select></Tooltip>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(Number(batchWmOpacity) * 100)}%</label>
                <Tooltip text="How see-through the watermark text is."><input type="range" min="0" max="1" step="0.05" value={batchWmOpacity} onChange={e => setBatchWmOpacity(e.target.value)} className="w-full" /></Tooltip>
              </div>
            </div>
          )}

          {batchOp === 'compress' && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality: {batchCompressQuality}</label>
              <Tooltip text="How much to compress every image — lower gives smaller files but more visible loss of detail."><input type="range" min="1" max="100" value={batchCompressQuality} onChange={e => setBatchCompressQuality(e.target.value)} className="w-full" /></Tooltip>
            </div>
          )}

          {batchOp === 'strip' && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Removes EXIF, GPS, XMP, IPTC and ICC data from every image. Format and dimensions are preserved.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Apply the chosen operation to every added image that hasn't been processed yet."><button
              type="button"
              onClick={runBatchAll}
              disabled={batchRunning || !batchFiles.some(f => f.imageDataUrl && f.status !== 'done') || (batchOp === 'resize' && !batchWidth && !batchHeight) || (batchOp === 'watermark' && !batchWmText.trim())}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {batchRunning ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('file-stack', { size: 15 })}
              {batchRunning ? 'Processing...' : 'Process all'}
            </button></Tooltip>
            {batchFiles.some(f => f.result?.imageDataUrl) && (
              <Tooltip text="Download every processed result at once."><button
                type="button"
                onClick={downloadBatchAll}
                disabled={batchRunning}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'transparent' }}
              >
                Download all
              </button></Tooltip>
            )}
            {batchFiles.length > 0 && (
              <Tooltip text="Remove all added images from this list."><button
                type="button"
                onClick={clearBatchFiles}
                disabled={batchRunning}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
              >
                Clear
              </button></Tooltip>
            )}
          </div>

          {batchFiles.length === 0 ? (
            <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              Add one or more images to process.
            </div>
          ) : (
            <div className="space-y-2">
              {batchFiles.map(item => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  {item.imageDataUrl && (
                    <img src={item.result?.imageDataUrl || item.imageDataUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" style={{ border: '1px solid var(--color-border)' }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                      {item.status === 'done' && item.result ? (
                        <span style={{ color: '#047857' }}>
                          Done · {item.result.width && item.result.height ? `${item.result.width}×${item.result.height} · ` : ''}{(item.result.format || item.result.ext || '').toUpperCase()} · {formatBytes(item.result.bytes || item.result.cleanedBytes || 0)}
                        </span>
                      ) : item.status === 'working' ? 'Processing...'
                        : item.status === 'error' ? <span style={{ color: '#ef4444' }}>{item.error}</span>
                        : formatBytes(item.originalBytes)}
                    </p>
                  </div>
                  {item.status === 'done' && item.result?.imageDataUrl && (
                    <Tooltip text="Save this processed image to your device."><button
                      type="button"
                      onClick={() => downloadBatchItem(item)}
                      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 flex-shrink-0"
                      style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                    >
                      Download
                    </button></Tooltip>
                  )}
                  <Tooltip text="Remove this image from the list."><button
                    type="button"
                    onClick={() => removeBatchFile(item.id)}
                    disabled={batchRunning}
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
