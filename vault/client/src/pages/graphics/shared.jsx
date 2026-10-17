import Tooltip from '../../components/Tooltip';
import api from '../../utils/apiClient';
import useProcessingStore from '../../store/processingStore';
import React, { useState, useRef, useEffect } from 'react';

export const CR_ASPECTS = [
  { id: 'free', label: 'Free', v: null },
  { id: '1:1', label: 'Square 1:1', v: 1 },
  { id: '4:5', label: 'Portrait 4:5', v: 4 / 5 },
  { id: '9:16', label: 'Story 9:16', v: 9 / 16 },
  { id: '16:9', label: 'Wide 16:9', v: 16 / 9 },
  { id: '1.91:1', label: 'Landscape 1.91:1', v: 1.91 },
  { id: '3:2', label: 'Photo 3:2', v: 3 / 2 },
  { id: '2:3', label: 'Photo 2:3', v: 2 / 3 },
];

export const CR_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const CR_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

export const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const ANN_GOOGLE_FONTS = [
  { label: 'System default', family: '' },
  { label: 'Inter', family: 'Inter' },
  { label: 'Roboto', family: 'Roboto' },
  { label: 'Open Sans', family: 'Open Sans' },
  { label: 'Lato', family: 'Lato' },
  { label: 'Montserrat', family: 'Montserrat' },
  { label: 'Poppins', family: 'Poppins' },
  { label: 'Nunito', family: 'Nunito' },
  { label: 'Raleway', family: 'Raleway' },
  { label: 'Oswald', family: 'Oswald' },
  { label: 'Bebas Neue', family: 'Bebas Neue' },
  { label: 'Anton', family: 'Anton' },
  { label: 'Playfair Display', family: 'Playfair Display' },
  { label: 'Merriweather', family: 'Merriweather' },
  { label: 'Lora', family: 'Lora' },
  { label: 'PT Serif', family: 'PT Serif' },
  { label: 'Pacifico', family: 'Pacifico' },
  { label: 'Dancing Script', family: 'Dancing Script' },
  { label: 'Caveat', family: 'Caveat' },
  { label: 'Roboto Mono', family: 'Roboto Mono' },
  { label: 'Space Mono', family: 'Space Mono' },
];

export const loadGoogleFont = (family) => {
  if (!family) return Promise.resolve();
  const id = `gf-${family.replace(/\s+/g, '-')}`;
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }
  return document.fonts.ready;
};

export const fontFamilyFor = (family) => (family ? `"${family}", sans-serif` : 'system-ui, sans-serif');

export // Build a centred crop box (fractions of the image) for the given aspect ratio.
function makeCenteredCrop(ratio, nat) {
  if (!ratio || !nat?.w || !nat?.h) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  let pxW = 0.9 * nat.w;
  let pxH = pxW / ratio;
  if (pxH > 0.9 * nat.h) { pxH = 0.9 * nat.h; pxW = pxH * ratio; }
  const wf = pxW / nat.w;
  const hf = pxH / nat.h;
  return { x: (1 - wf) / 2, y: (1 - hf) / 2, w: wf, h: hf };
}

export // Compute a new crop rect (fractions) from a drag. `d` carries the drag origin,
// the handle type, the locked ratio (or null), and the image's natural size.
function computeCropRect(d, dx, dy) {
  const MIN = 0.02;
  const { x, y, w, h } = d.startRect;
  const t = d.type;
  if (t === 'move') {
    return { x: clampNum(x + dx, 0, 1 - w), y: clampNum(y + dy, 0, 1 - h), w, h };
  }
  if (d.ratio && d.natW && d.natH) {
    const ratio = d.ratio;
    const L = x;
    const T = y;
    const R = x + w;
    const B = y + h;
    let nx = L;
    let ny = T;
    let nw = w;
    let nh = h;
    if (t === 'se') {
      let pxW = clampNum((R + dx - L) * d.natW, MIN * d.natW, (1 - L) * d.natW);
      let pxH = pxW / ratio;
      if (T + pxH / d.natH > 1) { pxH = (1 - T) * d.natH; pxW = pxH * ratio; }
      nx = L; ny = T; nw = pxW / d.natW; nh = pxH / d.natH;
    } else if (t === 'nw') {
      let pxW = clampNum((R - (L + dx)) * d.natW, MIN * d.natW, R * d.natW);
      let pxH = pxW / ratio;
      if (B - pxH / d.natH < 0) { pxH = B * d.natH; pxW = pxH * ratio; }
      nw = pxW / d.natW; nh = pxH / d.natH; nx = R - nw; ny = B - nh;
    } else if (t === 'ne') {
      let pxW = clampNum((R + dx - L) * d.natW, MIN * d.natW, (1 - L) * d.natW);
      let pxH = pxW / ratio;
      if (B - pxH / d.natH < 0) { pxH = B * d.natH; pxW = pxH * ratio; }
      nw = pxW / d.natW; nh = pxH / d.natH; nx = L; ny = B - nh;
    } else if (t === 'sw') {
      let pxW = clampNum((R - (L + dx)) * d.natW, MIN * d.natW, R * d.natW);
      let pxH = pxW / ratio;
      if (T + pxH / d.natH > 1) { pxH = (1 - T) * d.natH; pxW = pxH * ratio; }
      nw = pxW / d.natW; nh = pxH / d.natH; nx = R - nw; ny = T;
    } else {
      return d.startRect; // edge handles disabled while ratio is locked
    }
    return { x: nx, y: ny, w: nw, h: nh };
  }
  // Free-form resize.
  let L = x;
  let T = y;
  let R = x + w;
  let B = y + h;
  if (t.includes('w')) L = x + dx;
  if (t.includes('e')) R = (x + w) + dx;
  if (t.includes('n')) T = y + dy;
  if (t.includes('s')) B = (y + h) + dy;
  L = clampNum(L, 0, R - MIN);
  R = clampNum(R, L + MIN, 1);
  T = clampNum(T, 0, B - MIN);
  B = clampNum(B, T + MIN, 1);
  return { x: L, y: T, w: R - L, h: B - T };
}

export const STYLE_PRESETS = [
  { id: 'editorial', label: 'Editorial illustration', suffix: 'editorial illustration, clean composition, article header image' },
  { id: 'photo', label: 'Photographic', suffix: 'photorealistic image, natural lighting, realistic camera depth of field, documentary photography style' },
  { id: 'storybook', label: 'Storybook', suffix: 'storybook illustration, warm, detailed, narrative scene' },
  { id: 'cinematic', label: 'Cinematic', suffix: 'cinematic concept art, dramatic lighting, high detail' },
  { id: 'minimal', label: 'Minimal graphic', suffix: 'minimal vector-style graphic, simple shapes, clean background' },
];

export const CONVERT_FALLBACK_FORMATS = [
  { id: 'png', label: 'PNG', ext: 'png', lossy: false },
  { id: 'jpeg', label: 'JPG / JPEG', ext: 'jpg', lossy: true },
  { id: 'webp', label: 'WebP', ext: 'webp', lossy: true },
  { id: 'gif', label: 'GIF', ext: 'gif', lossy: false },
  { id: 'avif', label: 'AVIF', ext: 'avif', lossy: true },
  { id: 'tiff', label: 'TIFF', ext: 'tiff', lossy: false },
  { id: 'ico', label: 'ICO (favicon)', ext: 'ico', lossy: false },
];

export const SIZE_PRESETS = [
  { group: 'Instagram', items: [
    { label: 'Square post 1080×1080', w: 1080, h: 1080 },
    { label: 'Portrait 1080×1350', w: 1080, h: 1350 },
    { label: 'Story / Reel 1080×1920', w: 1080, h: 1920 },
  ] },
  { group: 'Facebook', items: [
    { label: 'Post 1200×630', w: 1200, h: 630 },
    { label: 'Cover 820×312', w: 820, h: 312 },
  ] },
  { group: 'X / Twitter', items: [
    { label: 'Post 1600×900', w: 1600, h: 900 },
    { label: 'Header 1500×500', w: 1500, h: 500 },
  ] },
  { group: 'LinkedIn', items: [
    { label: 'Post 1200×627', w: 1200, h: 627 },
    { label: 'Cover 1584×396', w: 1584, h: 396 },
  ] },
  { group: 'YouTube', items: [
    { label: 'Thumbnail 1280×720', w: 1280, h: 720 },
    { label: 'Channel art 2560×1440', w: 2560, h: 1440 },
  ] },
  { group: 'Web', items: [
    { label: 'Open Graph 1200×630', w: 1200, h: 630 },
    { label: 'HD 1920×1080', w: 1920, h: 1080 },
  ] },
];

export // Re-encode helpers used by the export panel (all client-side via canvas).
const loadImageEl = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

export const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => {
  canvas.toBlob((b) => resolve(b), type, quality);
});

export // Shared magic-wand flood-fill selection, used by the "Magic wand" mode in
// Inpaint, Eraser and Extract Element as an alternative to hand-painting a
// mask. Samples the clicked pixel from `img`, then flood-fills all
// 4-connected pixels within `tolerancePct` (0-100, checked as an RGB
// Euclidean distance) of that colour. Computed on a capped working buffer
// (long edge <= 1200px) for performance, then scaled up to `outW`x`outH` so
// it lines up with a tool's own display/mask canvas size. Returns a canvas
// with the selection painted opaque white, transparent everywhere else —
// each tool composites this onto its own mask/display canvases to match its
// own convention (see `tintSelectionCanvas` below).
function magicWandSelectionCanvas(img, outW, outH, clickX, clickY, tolerancePct) {
  const cap = 1200;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  let w = iw;
  let h = ih;
  if (Math.max(w, h) > cap) { const s = cap / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0, w, h);
  const { data } = sctx.getImageData(0, 0, w, h);
  const sx = Math.min(w - 1, Math.max(0, Math.round((clickX / outW) * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.round((clickY / outH) * h)));
  const seedIdx = (sy * w + sx) * 4;
  const r0 = data[seedIdx];
  const g0 = data[seedIdx + 1];
  const b0 = data[seedIdx + 2];
  const thresh = (Math.max(0, Math.min(100, Number(tolerancePct) || 0)) / 100) * 441.67; // max RGB distance
  const visited = new Uint8Array(w * h);
  const selected = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  visited[sy * w + sx] = 1;
  while (stack.length) {
    const p = stack.pop();
    const px = p % w;
    const i = p * 4;
    const dr = data[i] - r0;
    const dg = data[i + 1] - g0;
    const db = data[i + 2] - b0;
    if (Math.sqrt(dr * dr + dg * dg + db * db) > thresh) continue;
    selected[p] = 1;
    const candidates = [p - 1, p + 1, p - w, p + w];
    for (let k = 0; k < candidates.length; k++) {
      const n = candidates[k];
      if (n < 0 || n >= w * h) continue;
      if (px === 0 && n === p - 1) continue;
      if (px === w - 1 && n === p + 1) continue;
      if (visited[n]) continue;
      visited[n] = 1;
      stack.push(n);
    }
  }
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const imgData = octx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    if (selected[p]) {
      imgData.data[p * 4] = 255;
      imgData.data[p * 4 + 1] = 255;
      imgData.data[p * 4 + 2] = 255;
      imgData.data[p * 4 + 3] = 255;
    }
  }
  octx.putImageData(imgData, 0, 0);
  if (w === outW && h === outH) return out;
  const scaled = document.createElement('canvas');
  scaled.width = outW; scaled.height = outH;
  scaled.getContext('2d').drawImage(out, 0, 0, outW, outH);
  return scaled;
}

export // Recolours a white-selection canvas (from `magicWandSelectionCanvas`) to a
// solid rgba tint, keeping only the selected pixels opaque — used to paint a
// wand selection onto a display canvas with the same overlay colour/opacity
// each tool's brush already uses.
function tintSelectionCanvas(selCanvas, rgba) {
  const c = document.createElement('canvas');
  c.width = selCanvas.width; c.height = selCanvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(selCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = rgba;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export // Draws the source image, but only where the given selection canvas is
// opaque — used to "restore" original pixels within a wand selection
// (Eraser's restore mode, Extract's erase-mask mode).
function restoreWithinSelection(img, selCanvas, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(selCanvas, 0, 0);
  return c;
}

export async function renderToCanvas(dataUrl, { maxDim, bg, type }) {
  const img = await loadImageEl(dataUrl);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (maxDim && Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = bg || '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export // WCAG relative-luminance + contrast-ratio helpers (sRGB, per WCAG 2.x).
function hexToRgbTriple(hex) {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 0, g: 0, b: 0 };
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fgHex, bgHex) {
  const l1 = relativeLuminance(hexToRgbTriple(fgHex));
  const l2 = relativeLuminance(hexToRgbTriple(bgHex));
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

export // Inline "…or paste an image URL" row, wired to POST /api/graphics/fetch-url.
function UrlImportRow({ onImport, importing }) {
  const [url, setUrl] = useState('');
  const go = () => { const u = url.trim(); if (u) onImport(u); };
  return (
    <div className="flex items-center gap-2">
      <Tooltip text="Web address of an image to load directly, instead of uploading a file."><input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
        placeholder="…or paste an image URL"
        className="flex-1 min-w-0 px-3 py-2 rounded-xl border text-sm"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      /></Tooltip>
      <Tooltip text="Fetch the image from that URL and use it as the source."><button
        type="button"
        onClick={go}
        disabled={importing || !url.trim()}
        className="px-3 py-2 rounded-xl text-sm border disabled:opacity-50 hover:opacity-80 whitespace-nowrap"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'transparent' }}
      >
        {importing ? 'Importing…' : 'Import'}
      </button></Tooltip>
    </div>
  );
}

export // Compact "Export…" popover: format, quality, max size, target file size.
function ExportMenu({ dataUrl, baseName = 'image' }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState('image/png');
  const [quality, setQuality] = useState(90);
  const [maxDim, setMaxDim] = useState('');
  const [targetKb, setTargetKb] = useState('');
  const [bg, setBg] = useState('#ffffff');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const lossy = format === 'image/jpeg' || format === 'image/webp' || format === 'image/avif';
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' }[format] || 'png';

  const doExport = async () => {
    setBusy(true);
    setErr('');
    try {
      const canvas = await renderToCanvas(dataUrl, { maxDim: maxDim ? Number(maxDim) : 0, bg, type: format });
      let blob;
      const target = lossy && targetKb ? Number(targetKb) * 1024 : 0;
      if (target) {
        let lo = 0.3; let hi = 0.95; let best = null;
        for (let i = 0; i < 7; i += 1) {
          const q = (lo + hi) / 2;
          const b = await canvasToBlob(canvas, format, q); // eslint-disable-line no-await-in-loop
          if (!b) break;
          if (b.size <= target) { best = b; lo = q; } else { hi = q; }
        }
        blob = best || await canvasToBlob(canvas, format, 0.3);
      } else {
        blob = await canvasToBlob(canvas, format, lossy ? quality / 100 : undefined);
      }
      if (!blob) throw new Error('This browser can’t export that format');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setErr(e.message || 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <Tooltip text="Re-encode this image to a different format, size or file size before downloading."><button type="button" onClick={() => setOpen(o => !o)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Export…</button></Tooltip>
      {open && (
        <div className="absolute right-0 mt-1 z-20 w-60 rounded-xl border p-3 space-y-2 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Format</label>
            <Tooltip text="File format to save the exported image as."><select value={format} onChange={e => setFormat(e.target.value)} className="w-full text-xs px-2 py-1 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="image/png">PNG (lossless)</option>
              <option value="image/jpeg">JPG</option>
              <option value="image/webp">WebP</option>
              <option value="image/avif">AVIF</option>
            </select></Tooltip>
          </div>
          {lossy && !targetKb && (
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality: {quality}</label>
              <Tooltip text="Compression quality — lower makes a smaller file but adds visible artifacts."><input type="range" min="10" max="100" value={quality} onChange={e => setQuality(Number(e.target.value))} className="w-full" /></Tooltip>
            </div>
          )}
          <div className="flex gap-2">
            <div className="grow">
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Max side (px)</label>
              <Tooltip text="Shrink the image so its longer edge doesn't exceed this many pixels. Leave blank to keep the original size."><input type="number" min="1" placeholder="orig" value={maxDim} onChange={e => setMaxDim(e.target.value)} className="w-full text-xs px-2 py-1 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
            </div>
            <div className="grow">
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Target (KB)</label>
              <Tooltip text="Automatically adjust quality to land close to this file size in kilobytes."><input type="number" min="1" placeholder={lossy ? 'auto' : 'n/a'} disabled={!lossy} value={targetKb} onChange={e => setTargetKb(e.target.value)} className="w-full text-xs px-2 py-1 rounded-lg border disabled:opacity-40" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
            </div>
          </div>
          {format === 'image/jpeg' && (
            <div className="flex items-center gap-2">
              <label className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Background</label>
              <Tooltip text="Colour used to fill any transparent areas, since JPG doesn't support transparency."><input type="color" value={bg} onChange={e => setBg(e.target.value)} className="h-7 w-9 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
              <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>(fills transparency)</span>
            </div>
          )}
          {err && <p className="text-[11px]" style={{ color: '#b91c1c' }}>{err}</p>}
          <Tooltip text="Export the image with these settings and download it."><button type="button" onClick={doExport} disabled={busy} className="w-full text-xs px-2 py-1.5 rounded-lg text-white font-medium disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{busy ? 'Exporting…' : 'Download'}</button></Tooltip>
        </div>
      )}
    </div>
  );
}

export // Draggable before/after comparison slider. `before` is revealed on the left,
// `after` on the right of the handle.
function BeforeAfter({ before, after, transparent }) {
  const [pos, setPos] = useState(50);
  const ref = useRef(null);
  const dragging = useRef(false);

  const moveTo = (clientX) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  useEffect(() => {
    const onMove = (e) => { if (dragging.current) moveTo(e.touches ? e.touches[0].clientX : e.clientX); };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  const checker = transparent ? {
    backgroundColor: '#fff',
    backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
  } : {};

  return (
    <Tooltip text="Drag left or right to reveal more of the before or after image."><div
      ref={ref}
      className="relative w-full overflow-hidden rounded-xl border select-none"
      style={{ borderColor: 'var(--color-border)', cursor: 'ew-resize', ...checker }}
      onMouseDown={(e) => { dragging.current = true; moveTo(e.clientX); }}
      onTouchStart={(e) => { dragging.current = true; moveTo(e.touches[0].clientX); }}
    >
      <img src={before} alt="before" draggable={false} className="block w-full" />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <img src={after} alt="after" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div className="absolute top-0 bottom-0" style={{ left: `${pos}%`, width: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)', transform: 'translateX(-1px)' }} />
      <div className="absolute flex items-center justify-center rounded-full" style={{ left: `${pos}%`, top: '50%', width: 28, height: 28, transform: 'translate(-50%,-50%)', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', fontSize: 12, color: '#333' }}>⟺</div>
      <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>Before</span>
      <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>After</span>
    </div></Tooltip>
  );
}

export // Result-panel placeholder: shows the chosen source image (badged "Original")
// as soon as it's selected, falling back to a hint when nothing is loaded yet.
function ResultPlaceholder({ src, message }) {
  if (src) {
    return (
      <div>
        <div className="relative">
          <img src={src} alt="original" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
          <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>Original</span>
        </div>
        <p className="text-xs mt-3 text-center" style={{ color: 'var(--color-muted)' }}>{message}</p>
      </div>
    );
  }
  return (
    <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
      {message}
    </div>
  );
}

export const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const downloadDataUrl = (dataUrl, name) => {
  if (!dataUrl) return;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
};

export const loadImageInto = (setter) => async (file) => {
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    setter({ imageDataUrl: dataUrl, name: file.name });
  } catch {
    /* ignore */
  }
};

export const formatCost = (cost) => {
  if (!cost) return null;
  if (cost.local) return 'Cost: local (free) · no tokens';
  if (cost.usd == null) return 'Cost: estimate unavailable';
  const mp = cost.megapixels ? ` · ${cost.megapixels} MP` : '';
  return `Cost: ${cost.estimate ? '~' : ''}$${Number(cost.usd).toFixed(4)}${mp} · no tokens (per-image billing)`;
};

export const renderExport = (dataUrl, baseName) => (dataUrl ? <ExportMenu dataUrl={dataUrl} baseName={baseName} /> : null);


// "Import by URL" for a tool: its own busy flag, and the same call every tool made through the page before.
export function useUrlImport() {
  const [urlImporting, setUrlImporting] = useState(false);
  // Import an image by URL via the server (avoids browser CORS). onLoad receives
  // ({ imageDataUrl, name }) on success or (null, errorMessage) on failure.
  const importFromUrl = async (url, onLoad) => {
    const u = String(url || '').trim();
    if (!u) return;
    setUrlImporting(true);
    try {
      const res = await api.post('/api/graphics/fetch-url', { url: u });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      onLoad({ imageDataUrl: data.imageDataUrl, name: data.name || 'image' });
    } catch (err) {
      onLoad(null, err.message || 'Could not import that URL');
    } finally {
      setUrlImporting(false);
    }
  };
  return { urlImporting, importFromUrl };
}

// Social media sizes (Crop / Resize presets and Export for Social).
export function useSocialPresets() {
  const [socialPresets, setSocialPresets] = useState([]);
  useEffect(() => {
    api.get('/api/graphics/social-presets')
      .then(r => r.json())
      .then(info => { if (Array.isArray(info?.presets)) setSocialPresets(info.presets); })
      .catch(() => {});
  }, []);
  return socialPresets;
}

// Shows the page-wide "please wait" overlay while a tool has a job running (label = null when idle).
// Only touches the overlay when this tool started it, so tools do not cancel each other's.
export function useProcessingWhile(label) {
  const startProcessing = useProcessingStore((s) => s.startProcessing);
  const stopProcessing = useProcessingStore((s) => s.stopProcessing);
  const started = useRef(false);
  useEffect(() => {
    if (label) { startProcessing(label); started.current = true; } else if (started.current) { stopProcessing(); started.current = false; }
  }, [label, startProcessing, stopProcessing]);
  useEffect(() => () => { if (started.current) { stopProcessing(); started.current = false; } }, [stopProcessing]);
}

