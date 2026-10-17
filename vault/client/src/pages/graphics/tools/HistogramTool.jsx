import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, loadImageEl, readFileAsDataUrl, UrlImportRow } from '../shared';

export default function HistogramTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();
  const mode = active ? 'histogram' : null;

  const [histSource, setHistSource] = useState(null);
  const [histData, setHistData] = useState(null);
  const [histChannel, setHistChannel] = useState('rgb');
  const [histError, setHistError] = useState('');
  const histCanvasRef = useRef(null);

  // Histogram: draw the image to an offscreen canvas (capped) and tally per-channel
  // and luminance counts entirely in the browser — nothing is uploaded.
  const computeHistogram = async (dataUrl) => {
    const img = await loadImageEl(dataUrl);
    const maxDim = 1000;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);
    const lum = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      r[data[i]] += 1;
      g[data[i + 1]] += 1;
      b[data[i + 2]] += 1;
      lum[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])] += 1;
    }
    return { r, g, b, lum, total: data.length / 4, width: img.naturalWidth, height: img.naturalHeight };
  };

  const loadHistogram = async (src) => {
    if (!src?.imageDataUrl) return;
    setHistError('');
    setHistData(null);
    setHistSource(src);
    try {
      setHistData(await computeHistogram(src.imageDataUrl));
    } catch {
      setHistError('Could not read that image.');
    }
  };

  // Render the histogram onto its canvas whenever the data or channel changes.
  useEffect(() => {
    if (mode !== 'histogram') return;
    const canvas = histCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(0, 0, W, H);
    if (!histData) return;
    const channels = histChannel === 'rgb'
      ? [['r', 'rgba(239,68,68,0.7)'], ['g', 'rgba(34,197,94,0.7)'], ['b', 'rgba(59,130,246,0.7)']]
      : histChannel === 'lum'
        ? [['lum', 'rgba(229,231,235,0.9)']]
        : [[histChannel, histChannel === 'r' ? 'rgba(239,68,68,0.9)' : histChannel === 'g' ? 'rgba(34,197,94,0.9)' : 'rgba(59,130,246,0.9)']];
    let max = 1;
    channels.forEach(([ch]) => { const arr = histData[ch]; for (let i = 0; i < 256; i += 1) if (arr[i] > max) max = arr[i]; });
    ctx.globalCompositeOperation = histChannel === 'rgb' ? 'lighter' : 'source-over';
    const bw = W / 256;
    channels.forEach(([ch, color]) => {
      const arr = histData[ch];
      ctx.fillStyle = color;
      for (let i = 0; i < 256; i += 1) {
        const bh = (arr[i] / max) * (H - 2);
        ctx.fillRect(i * bw, H - bh, Math.ceil(bw), bh);
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  }, [histData, histChannel, mode]);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Histogram</h2>
            <button type="button" onClick={() => setHelpTool('histogram')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_520px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>See the tonal distribution of an image. Nothing is uploaded — pixels are read in your browser.</p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to analyse the tonal distribution of."><input type="file" accept="image/*" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const d = await readFileAsDataUrl(f); loadHistogram({ imageDataUrl: d, name: f.name }); } catch { setHistError('Could not read that image.'); } }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setHistError(err); } else { loadHistogram(src); } })} />
            </div>
            {histSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={histSource.imageDataUrl} alt="source" className="max-h-48 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Channel</label>
              <Tooltip text="Which colour channel (or combined/luminance) to graph."><select value={histChannel} onChange={e => setHistChannel(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="rgb">RGB (combined)</option>
                <option value="lum">Luminance</option>
                <option value="r">Red</option>
                <option value="g">Green</option>
                <option value="b">Blue</option>
              </select></Tooltip>
            </div>
            {histError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{histError}</div>}
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Distribution</span>
            </div>
            <div className="p-4">
              {histData ? (
                <>
                  <canvas ref={histCanvasRef} width={512} height={240} className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                  <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    <span>0 (shadows)</span>
                    <span>{histData.total.toLocaleString()} px · {histData.width}×{histData.height}</span>
                    <span>255 (highlights)</span>
                  </div>
                </>
              ) : <div className="aspect-video rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose an image to see its histogram.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
