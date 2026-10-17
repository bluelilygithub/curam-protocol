import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto } from '../shared';

export default function PaletteTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [palSource, setPalSource] = useState(null);
  const [palCount, setPalCount] = useState(8);
  const [palBusy, setPalBusy] = useState(false);
  const [palColors, setPalColors] = useState([]);
  const [palError, setPalError] = useState('');
  const [palCopied, setPalCopied] = useState('');

  const runPalette = async () => {
    if (!palSource?.imageDataUrl) return;
    setPalBusy(true);
    setPalError('');
    setPalColors([]);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not load image'));
        i.src = palSource.imageDataUrl;
      });
      const scale = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
      const cw = Math.max(1, Math.round(img.naturalWidth * scale));
      const ch = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      const { data } = ctx.getImageData(0, 0, cw, ch);
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        const b = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
        b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; b.n += 1;
        buckets.set(key, b);
      }
      const total = [...buckets.values()].reduce((s, b) => s + b.n, 0) || 1;
      const colors = [...buckets.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, Number(palCount))
        .map((b) => {
          const r = Math.round(b.r / b.n);
          const g = Math.round(b.g / b.n);
          const bl = Math.round(b.b / b.n);
          return {
            r, g, b: bl,
            hex: `#${[r, g, bl].map(v => v.toString(16).padStart(2, '0')).join('')}`,
            pct: Math.round((b.n / total) * 100),
          };
        });
      setPalColors(colors);
      if (!colors.length) setPalError('No colours could be extracted.');
    } catch (err) {
      setPalError(err.message || 'Palette extraction failed');
    } finally {
      setPalBusy(false);
    }
  };

  const copyPalette = (text) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    setPalCopied(text);
    setTimeout(() => setPalCopied(''), 1500);
  };

  useProcessingWhile(palBusy ? 'Extracting palette…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Palette</h2>
            <button type="button" onClick={() => setHelpTool('palette')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to pull dominant colours from."><input type="file" accept="image/*" onChange={e => { setPalColors([]); setPalError(''); loadImageInto(setPalSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {palSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={palSource.imageDataUrl} alt="source" className="max-h-56 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Number of colours</label>
              <Tooltip text="How many dominant colours to extract from the image."><select value={palCount} onChange={e => setPalCount(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
                <option value={12}>12</option>
              </select></Tooltip>
            </div>
            {palError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{palError}</div>}
            <Tooltip text="Analyse the image and extract its dominant colours."><button type="button" onClick={runPalette} disabled={palBusy || !palSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {palBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('swatch', { size: 15 })}
              {palBusy ? 'Extracting...' : 'Extract palette'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Dominant colours</span>
            </div>
            <div className="p-4">
              {palColors.length ? (
                <div className="space-y-2">
                  {palColors.map((c, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg border shrink-0" style={{ background: c.hex, borderColor: 'var(--color-border)' }} />
                      <div className="grow min-w-0">
                        <code className="text-sm block" style={{ color: 'var(--color-text)' }}>{c.hex}</code>
                        <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>rgb({c.r}, {c.g}, {c.b}) · {c.pct}%</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Tooltip text="Copy this colour's hex code."><button type="button" onClick={() => copyPalette(c.hex)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{palCopied === c.hex ? 'Copied' : 'HEX'}</button></Tooltip>
                        <Tooltip text="Copy this colour's RGB value."><button type="button" onClick={() => copyPalette(`rgb(${c.r}, ${c.g}, ${c.b})`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{palCopied === `rgb(${c.r}, ${c.g}, ${c.b})` ? 'Copied' : 'RGB'}</button></Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Extracted colours will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
