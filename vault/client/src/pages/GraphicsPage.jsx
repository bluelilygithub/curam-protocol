import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import IconLibraryGenerator from '../components/IconLibraryGenerator';
import useProcessingStore from '../store/processingStore';

const CR_ASPECTS = [
  { id: 'free', label: 'Free', v: null },
  { id: '1:1', label: 'Square 1:1', v: 1 },
  { id: '4:5', label: 'Portrait 4:5', v: 4 / 5 },
  { id: '9:16', label: 'Story 9:16', v: 9 / 16 },
  { id: '16:9', label: 'Wide 16:9', v: 16 / 9 },
  { id: '1.91:1', label: 'Landscape 1.91:1', v: 1.91 },
  { id: '3:2', label: 'Photo 3:2', v: 3 / 2 },
  { id: '2:3', label: 'Photo 2:3', v: 2 / 3 },
];

const CR_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CR_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const ANN_GOOGLE_FONTS = [
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

const loadGoogleFont = (family) => {
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

const fontFamilyFor = (family) => (family ? `"${family}", sans-serif` : 'system-ui, sans-serif');

// Build a centred crop box (fractions of the image) for the given aspect ratio.
function makeCenteredCrop(ratio, nat) {
  if (!ratio || !nat?.w || !nat?.h) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  let pxW = 0.9 * nat.w;
  let pxH = pxW / ratio;
  if (pxH > 0.9 * nat.h) { pxH = 0.9 * nat.h; pxW = pxH * ratio; }
  const wf = pxW / nat.w;
  const hf = pxH / nat.h;
  return { x: (1 - wf) / 2, y: (1 - hf) / 2, w: wf, h: hf };
}

// Compute a new crop rect (fractions) from a drag. `d` carries the drag origin,
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

const STYLE_PRESETS = [
  { id: 'editorial', label: 'Editorial illustration', suffix: 'editorial illustration, clean composition, article header image' },
  { id: 'photo', label: 'Photographic', suffix: 'photorealistic image, natural lighting, realistic camera depth of field, documentary photography style' },
  { id: 'storybook', label: 'Storybook', suffix: 'storybook illustration, warm, detailed, narrative scene' },
  { id: 'cinematic', label: 'Cinematic', suffix: 'cinematic concept art, dramatic lighting, high detail' },
  { id: 'minimal', label: 'Minimal graphic', suffix: 'minimal vector-style graphic, simple shapes, clean background' },
];

const CONVERT_FALLBACK_FORMATS = [
  { id: 'png', label: 'PNG', ext: 'png', lossy: false },
  { id: 'jpeg', label: 'JPG / JPEG', ext: 'jpg', lossy: true },
  { id: 'webp', label: 'WebP', ext: 'webp', lossy: true },
  { id: 'gif', label: 'GIF', ext: 'gif', lossy: false },
  { id: 'avif', label: 'AVIF', ext: 'avif', lossy: true },
  { id: 'tiff', label: 'TIFF', ext: 'tiff', lossy: false },
  { id: 'ico', label: 'ICO (favicon)', ext: 'ico', lossy: false },
];

const MODES = [
  { id: 'generate', label: 'Generate', icon: 'sparkles' },
  { id: 'animate', label: 'Animate (GIF)', icon: 'film' },
  { id: 'upscale', label: 'Upscale', icon: 'image' },
  { id: 'convert', label: 'Convert', icon: 'refresh-cw' },
  { id: 'compress', label: 'Compress', icon: 'archive' },
  { id: 'batch', label: 'Batch', icon: 'file-stack' },
  { id: 'pdf2img', label: 'PDF → Images', icon: 'file-text' },
  { id: 'autoenhance', label: 'Auto-enhance', icon: 'zap' },
  { id: 'cropresize', label: 'Crop / Resize', icon: 'crop' },
  { id: 'extend', label: 'Canvas Extend', icon: 'frame' },
  { id: 'perspective', label: 'Perspective Correct', icon: 'trapezoid' },
  { id: 'smartcrop', label: 'Smart Crop', icon: 'aim' },
  { id: 'effects', label: 'Effects', icon: 'wand' },
  { id: 'adjust', label: 'Adjust', icon: 'sliders' },
  { id: 'colorgrade', label: 'Color Grading', icon: 'palette-2' },
  { id: 'pipeline', label: 'Pipeline', icon: 'workflow' },
  { id: 'annotate', label: 'Annotate', icon: 'pen-line' },
  { id: 'watermark', label: 'Watermark', icon: 'droplets' },
  { id: 'batchtext', label: 'Batch Text', icon: 'text' },
  { id: 'collage', label: 'Collage', icon: 'grid' },
  { id: 'favicon', label: 'Favicon / Icons', icon: 'app-window' },
  { id: 'svg', label: 'Vectorize (SVG)', icon: 'shapes' },
  { id: 'iconlib', label: 'AI Icon Library', icon: 'layout-grid' },
  { id: 'background', label: 'Background', icon: 'scissors' },
  { id: 'recolor', label: 'Recolor', icon: 'palette' },
  { id: 'redact', label: 'Redact', icon: 'eye-off' },
  { id: 'inpaint', label: 'Inpaint / Remove', icon: 'eraser' },
  { id: 'picker', label: 'Picker', icon: 'eye' },
  { id: 'histogram', label: 'Histogram', icon: 'bar-chart' },
  { id: 'contrast', label: 'Contrast (WCAG)', icon: 'contrast' },
  { id: 'palette', label: 'Palette', icon: 'swatch' },
  { id: 'ocr', label: 'Extract Text', icon: 'type' },
  { id: 'blurdetect', label: 'Blur Detection', icon: 'focus' },
  { id: 'diff', label: 'Image Diff', icon: 'layers' },
  { id: 'metadata', label: 'Remove Meta', icon: 'shield' },
  { id: 'fileinfo', label: 'File Info', icon: 'info' },
];

const SIZE_PRESETS = [
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

const MODE_GROUPS = [
  { label: 'Create', ids: ['generate', 'animate'] },
  { label: 'Optimise', ids: ['upscale', 'convert', 'compress', 'batch', 'pdf2img', 'autoenhance'] },
  { label: 'Transform', ids: ['cropresize', 'extend', 'perspective', 'smartcrop'] },
  { label: 'Enhance', ids: ['effects', 'adjust', 'colorgrade', 'pipeline'] },
  { label: 'Compose', ids: ['annotate', 'watermark', 'batchtext', 'collage', 'favicon', 'svg', 'iconlib'] },
  { label: 'Retouch', ids: ['background', 'recolor', 'redact', 'inpaint'] },
  { label: 'Analyse', ids: ['picker', 'histogram', 'contrast', 'palette', 'ocr', 'blurdetect', 'diff', 'metadata', 'fileinfo'] },
];

// Re-encode helpers used by the export panel (all client-side via canvas).
const loadImageEl = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => {
  canvas.toBlob((b) => resolve(b), type, quality);
});

async function renderToCanvas(dataUrl, { maxDim, bg, type }) {
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

// WCAG relative-luminance + contrast-ratio helpers (sRGB, per WCAG 2.x).
function hexToRgbTriple(hex) {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 0, g: 0, b: 0 };
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fgHex, bgHex) {
  const l1 = relativeLuminance(hexToRgbTriple(fgHex));
  const l2 = relativeLuminance(hexToRgbTriple(bgHex));
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Inline "…or paste an image URL" row, wired to POST /api/graphics/fetch-url.
function UrlImportRow({ onImport, importing }) {
  const [url, setUrl] = useState('');
  const go = () => { const u = url.trim(); if (u) onImport(u); };
  return (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
        placeholder="…or paste an image URL"
        className="flex-1 min-w-0 px-3 py-2 rounded-xl border text-sm"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      />
      <button
        type="button"
        onClick={go}
        disabled={importing || !url.trim()}
        className="px-3 py-2 rounded-xl text-sm border disabled:opacity-50 hover:opacity-80 whitespace-nowrap"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'transparent' }}
      >
        {importing ? 'Importing…' : 'Import'}
      </button>
    </div>
  );
}

// Compact "Export…" popover: format, quality, max size, target file size.
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
      <button type="button" onClick={() => setOpen(o => !o)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Export…</button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 w-60 rounded-xl border p-3 space-y-2 shadow-lg" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Format</label>
            <select value={format} onChange={e => setFormat(e.target.value)} className="w-full text-xs px-2 py-1 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="image/png">PNG (lossless)</option>
              <option value="image/jpeg">JPG</option>
              <option value="image/webp">WebP</option>
              <option value="image/avif">AVIF</option>
            </select>
          </div>
          {lossy && !targetKb && (
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality: {quality}</label>
              <input type="range" min="10" max="100" value={quality} onChange={e => setQuality(Number(e.target.value))} className="w-full" />
            </div>
          )}
          <div className="flex gap-2">
            <div className="grow">
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Max side (px)</label>
              <input type="number" min="1" placeholder="orig" value={maxDim} onChange={e => setMaxDim(e.target.value)} className="w-full text-xs px-2 py-1 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            <div className="grow">
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Target (KB)</label>
              <input type="number" min="1" placeholder={lossy ? 'auto' : 'n/a'} disabled={!lossy} value={targetKb} onChange={e => setTargetKb(e.target.value)} className="w-full text-xs px-2 py-1 rounded-lg border disabled:opacity-40" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </div>
          </div>
          {format === 'image/jpeg' && (
            <div className="flex items-center gap-2">
              <label className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Background</label>
              <input type="color" value={bg} onChange={e => setBg(e.target.value)} className="h-7 w-9 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
              <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>(fills transparency)</span>
            </div>
          )}
          {err && <p className="text-[11px]" style={{ color: '#b91c1c' }}>{err}</p>}
          <button type="button" onClick={doExport} disabled={busy} className="w-full text-xs px-2 py-1.5 rounded-lg text-white font-medium disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{busy ? 'Exporting…' : 'Download'}</button>
        </div>
      )}
    </div>
  );
}

// Draggable before/after comparison slider. `before` is revealed on the left,
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
    <div
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
    </div>
  );
}

// Result-panel placeholder: shows the chosen source image (badged "Original")
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

export default function GraphicsPage() {
  const getIcon = useIcon();
  const startProcessing = useProcessingStore((s) => s.startProcessing);
  const stopProcessing = useProcessingStore((s) => s.stopProcessing);
  const [mode, setMode] = useState('generate');
  const [compareOn, setCompareOn] = useState(false);
  const [openGroup, setOpenGroup] = useState('Create');
  const [hoveredTool, setHoveredTool] = useState(null);
  const [toolSearch, setToolSearch] = useState('');
  const toolSearchRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('editorial');
  const [size, setSize] = useState('512x512');
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [augmenting, setAugmenting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [refinedPrompt, setRefinedPrompt] = useState('');
  const [augmentPrompt, setAugmentPrompt] = useState('');
  const [denoise, setDenoise] = useState('0.45');
  const [gallery, setGallery] = useState([]);
  const [saving, setSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [restrictionWarning, setRestrictionWarning] = useState(null);
  const [upscaleInfo, setUpscaleInfo] = useState(null);
  const [upscaleSource, setUpscaleSource] = useState(null);
  const [upscaleScale, setUpscaleScale] = useState('4');
  const [upscaleModel, setUpscaleModel] = useState('');
  const [upscaleFidelity, setUpscaleFidelity] = useState('-8');
  const [upscaling, setUpscaling] = useState(false);
  const [upscaleResult, setUpscaleResult] = useState(null);
  const [upscaleError, setUpscaleError] = useState('');
  const [convertFormats, setConvertFormats] = useState(CONVERT_FALLBACK_FORMATS);
  const [convertSource, setConvertSource] = useState(null);
  const [convertFormat, setConvertFormat] = useState('png');
  const [convertQuality, setConvertQuality] = useState('90');
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState(null);
  const [convertError, setConvertError] = useState('');
  const [favSource, setFavSource] = useState(null);
  const [favBusy, setFavBusy] = useState(false);
  const [favResult, setFavResult] = useState(null);
  const [favError, setFavError] = useState('');
  const [svgSource, setSvgSource] = useState(null);
  const [svgColors, setSvgColors] = useState('16');
  const [svgDetail, setSvgDetail] = useState('medium');
  const [svgBusy, setSvgBusy] = useState(false);
  const [svgResult, setSvgResult] = useState(null);
  const [svgError, setSvgError] = useState('');
  const [compressFiles, setCompressFiles] = useState([]);
  const [compressQuality, setCompressQuality] = useState('75');
  const [compressing, setCompressing] = useState(false);
  const [batchFiles, setBatchFiles] = useState([]);
  const [batchOp, setBatchOp] = useState('convert');
  const [batchFormat, setBatchFormat] = useState('webp');
  const [batchQuality, setBatchQuality] = useState('82');
  const [batchWidth, setBatchWidth] = useState('1600');
  const [batchHeight, setBatchHeight] = useState('');
  const [batchFit, setBatchFit] = useState('inside');
  const [batchRunning, setBatchRunning] = useState(false);
  const [bgSource, setBgSource] = useState(null);
  const [bgMode, setBgMode] = useState('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [bgColor2, setBgColor2] = useState('#2563eb');
  const [bgGradientDir, setBgGradientDir] = useState('to-bottom');
  const [bgImage, setBgImage] = useState(null);
  const [bgProcessing, setBgProcessing] = useState(false);
  const [bgResult, setBgResult] = useState(null);
  const [bgError, setBgError] = useState('');
  const [recolorSource, setRecolorSource] = useState(null);
  const [recolorSrcColor, setRecolorSrcColor] = useState('#cc3333');
  const [recolorTargetColor, setRecolorTargetColor] = useState('#3377ee');
  const [recolorTolerance, setRecolorTolerance] = useState('20');
  const [recolorMode, setRecolorMode] = useState('match');
  const [recoloring, setRecoloring] = useState(false);
  const [recolorResult, setRecolorResult] = useState(null);
  const [recolorError, setRecolorError] = useState('');
  const [recolorZoom, setRecolorZoom] = useState('1');
  const [recolorHoverHex, setRecolorHoverHex] = useState(null);
  const [loupeVisible, setLoupeVisible] = useState(false);
  const recolorCanvasRef = useRef(null);
  const loupeCanvasRef = useRef(null);
  const recolorScrollRef = useRef(null);
  const dragRef = useRef(null);
  const [crSource, setCrSource] = useState(null);
  const [crOp, setCrOp] = useState('resize');
  const [crWidth, setCrWidth] = useState('');
  const [crHeight, setCrHeight] = useState('');
  const [crFit, setCrFit] = useState('inside');
  const [crAspect, setCrAspect] = useState('free');
  const [crBusy, setCrBusy] = useState(false);
  const [crResult, setCrResult] = useState(null);
  const [crError, setCrError] = useState('');
  const [crCrop, setCrCrop] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [crNat, setCrNat] = useState(null);
  const crImgRef = useRef(null);
  const crDragRef = useRef(null);
  const [metaSource, setMetaSource] = useState(null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaResult, setMetaResult] = useState(null);
  const [metaError, setMetaError] = useState('');

  const [fileInfo, setFileInfo] = useState(null);
  const [fileInfoError, setFileInfoError] = useState('');
  const [metaInfo, setMetaInfo] = useState(null);
  const [histSource, setHistSource] = useState(null);
  const [histData, setHistData] = useState(null);
  const [histChannel, setHistChannel] = useState('rgb');
  const [histError, setHistError] = useState('');
  const histCanvasRef = useRef(null);
  const [contrastFg, setContrastFg] = useState('#1f2937');
  const [contrastBg, setContrastBg] = useState('#ffffff');
  const [animFrames, setAnimFrames] = useState([]);
  const [animDelay, setAnimDelay] = useState('200');
  const [animLoop, setAnimLoop] = useState(true);
  const [animBusy, setAnimBusy] = useState(false);
  const [animResult, setAnimResult] = useState(null);
  const [animError, setAnimError] = useState('');
  const [urlImporting, setUrlImporting] = useState(false);
  const [pdfPages, setPdfPages] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfScale, setPdfScale] = useState('2');
  const [pdfName, setPdfName] = useState('');
  const [pipeSource, setPipeSource] = useState(null);
  const [pipeSteps, setPipeSteps] = useState([]);
  const [pipeStepOp, setPipeStepOp] = useState('grayscale');
  const [pipeBusy, setPipeBusy] = useState(false);
  const [pipeResult, setPipeResult] = useState(null);
  const [pipeError, setPipeError] = useState('');
  const [inpaintSource, setInpaintSource] = useState(null);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [inpaintBrush, setInpaintBrush] = useState('40');
  const [inpaintBusy, setInpaintBusy] = useState(false);
  const [inpaintResult, setInpaintResult] = useState(null);
  const [inpaintError, setInpaintError] = useState('');
  const inpaintCanvasRef = useRef(null);
  const inpaintMaskRef = useRef(null);
  const inpaintImgRef = useRef(null);
  const inpaintDrawing = useRef(false);
  const [inpaintHasMask, setInpaintHasMask] = useState(false);
  const [adjPresets, setAdjPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('graphics.adjustPresets') || '[]'); } catch { return []; }
  });
  const [adjPresetName, setAdjPresetName] = useState('');
  const [wmSource, setWmSource] = useState(null);
  const [wmType, setWmType] = useState('text');
  const [wmText, setWmText] = useState('© My Brand');
  const [wmColor, setWmColor] = useState('#ffffff');
  const [wmImage, setWmImage] = useState(null);
  const [wmPosition, setWmPosition] = useState('bottom-right');
  const [wmOpacity, setWmOpacity] = useState('0.5');
  const [wmScale, setWmScale] = useState('25');
  const [wmTile, setWmTile] = useState(false);
  const [wmBusy, setWmBusy] = useState(false);
  const [wmResult, setWmResult] = useState(null);
  const [wmError, setWmError] = useState('');
  const [collageFiles, setCollageFiles] = useState([]);
  const [collageColumns, setCollageColumns] = useState('2');
  const [collageSpacing, setCollageSpacing] = useState('12');
  const [collageBg, setCollageBg] = useState('#ffffff');
  const [collageBusy, setCollageBusy] = useState(false);
  const [collageResult, setCollageResult] = useState(null);
  const [collageError, setCollageError] = useState('');
  const [efSource, setEfSource] = useState(null);
  const [efEffect, setEfEffect] = useState('flip-h');
  const [efBorderWidth, setEfBorderWidth] = useState('24');
  const [efBorderColor, setEfBorderColor] = useState('#ffffff');
  const [efRadius, setEfRadius] = useState('40');
  const [efBlur, setEfBlur] = useState('25');
  const [efOffsetX, setEfOffsetX] = useState('0');
  const [efOffsetY, setEfOffsetY] = useState('18');
  const [efShadowColor, setEfShadowColor] = useState('#000000');
  const [efShadowOpacity, setEfShadowOpacity] = useState('0.45');
  const [efDuoShadow, setEfDuoShadow] = useState('#1e1440');
  const [efDuoHighlight, setEfDuoHighlight] = useState('#ffd278');
  const [efAngle, setEfAngle] = useState('0');
  const [efRotateTransparent, setEfRotateTransparent] = useState(false);
  const [efRotateBg, setEfRotateBg] = useState('#ffffff');
  const [efBusy, setEfBusy] = useState(false);
  const [efResult, setEfResult] = useState(null);
  const [efError, setEfError] = useState('');
  const [extSource, setExtSource] = useState(null);
  const [extTop, setExtTop] = useState('40');
  const [extRight, setExtRight] = useState('40');
  const [extBottom, setExtBottom] = useState('40');
  const [extLeft, setExtLeft] = useState('40');
  const [extLink, setExtLink] = useState(true);
  const [extTransparent, setExtTransparent] = useState(false);
  const [extColor, setExtColor] = useState('#ffffff');
  const [extBusy, setExtBusy] = useState(false);
  const [extResult, setExtResult] = useState(null);
  const [extError, setExtError] = useState('');
  const [annSource, setAnnSource] = useState(null);
  const [annTool, setAnnTool] = useState('select');
  const [annColor, setAnnColor] = useState('#ff3b30');
  const [annWidth, setAnnWidth] = useState(6);
  const [annFont, setAnnFont] = useState('');
  const [annShapes, setAnnShapes] = useState([]);
  const [annSelected, setAnnSelected] = useState(null);
  const [annEditing, setAnnEditing] = useState(null);
  const annCanvasRef = useRef(null);
  const annImgRef = useRef(null);
  const annDrawRef = useRef(null);
  const annDrawFnRef = useRef(null);
  const annInputRef = useRef(null);
  const [annPast, setAnnPast] = useState([]);
  const [annFuture, setAnnFuture] = useState([]);
  const annShapesRef = useRef([]);
  useEffect(() => { annShapesRef.current = annShapes; }, [annShapes]);
  const [diffA, setDiffA] = useState(null);
  const [diffB, setDiffB] = useState(null);
  const [diffThreshold, setDiffThreshold] = useState('25');
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffResult, setDiffResult] = useState(null);
  const [diffError, setDiffError] = useState('');
  const [pickerSource, setPickerSource] = useState(null);
  const [pickerZoom, setPickerZoom] = useState('1');
  const [pickerHex, setPickerHex] = useState(null);
  const [pickerCopied, setPickerCopied] = useState('');
  const pickerCanvasRef = useRef(null);
  const pickerScrollRef = useRef(null);
  const pickerDragRef = useRef(null);
  const [adjSource, setAdjSource] = useState(null);
  const [adjBrightness, setAdjBrightness] = useState(1);
  const [adjContrast, setAdjContrast] = useState(1);
  const [adjSaturation, setAdjSaturation] = useState(1);
  const [adjHue, setAdjHue] = useState(0);
  const [adjSharpness, setAdjSharpness] = useState(0);
  const [adjBlackPoint, setAdjBlackPoint] = useState(0);
  const [adjWhitePoint, setAdjWhitePoint] = useState(255);
  const [adjGamma, setAdjGamma] = useState(1);
  const [adjBlur, setAdjBlur] = useState(0);
  const [adjDenoise, setAdjDenoise] = useState(0);
  const [adjTemperature, setAdjTemperature] = useState(0);
  const [adjVignette, setAdjVignette] = useState(0);
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjResult, setAdjResult] = useState(null);
  const [adjError, setAdjError] = useState('');
  const [redactSource, setRedactSource] = useState(null);
  const [redactRects, setRedactRects] = useState([]);
  const [redactMode, setRedactMode] = useState('pixelate');
  const [redactStrength, setRedactStrength] = useState(16);
  const [redactExport, setRedactExport] = useState(null);
  const redactCanvasRef = useRef(null);
  const redactImgRef = useRef(null);
  const redactDrawRef = useRef(null);
  const redactDrawFnRef = useRef(null);
  const [redactPast, setRedactPast] = useState([]);
  const [redactFuture, setRedactFuture] = useState([]);
  const redactRectsRef = useRef([]);
  useEffect(() => { redactRectsRef.current = redactRects; }, [redactRects]);
  const [ocrSource, setOcrSource] = useState(null);
  const [ocrLang, setOcrLang] = useState('eng');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrText, setOcrText] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [ocrCopied, setOcrCopied] = useState(false);
  const [palSource, setPalSource] = useState(null);
  const [palCount, setPalCount] = useState(8);
  const [palBusy, setPalBusy] = useState(false);
  const [palColors, setPalColors] = useState([]);
  const [palError, setPalError] = useState('');
  const [palCopied, setPalCopied] = useState('');
  // Blur detection
  const [blurSource, setBlurSource] = useState(null);
  const [blurBusy, setBlurBusy] = useState(false);
  const [blurResult, setBlurResult] = useState(null);
  const [blurError, setBlurError] = useState('');
  // Auto-enhance
  const [aeSource, setAeSource] = useState(null);
  const [aeBusy, setAeBusy] = useState(false);
  const [aeResult, setAeResult] = useState(null);
  const [aeError, setAeError] = useState('');
  // Perspective correct
  const [persSource, setPersSource] = useState(null);
  const [persHSkew, setPersHSkew] = useState(0);
  const [persVSkew, setPersVSkew] = useState(0);
  const [persBg, setPersBg] = useState('transparent');
  const [persBusy, setPersBusy] = useState(false);
  const [persResult, setPersResult] = useState(null);
  const [persError, setPersError] = useState('');
  // Smart crop
  const [scSource, setScSource] = useState(null);
  const [scWidth, setScWidth] = useState('');
  const [scHeight, setScHeight] = useState('');
  const [scAspect, setScAspect] = useState('');
  const [scFocus, setScFocus] = useState('attention');
  const [scBusy, setScBusy] = useState(false);
  const [scResult, setScResult] = useState(null);
  const [scError, setScError] = useState('');
  // Color grading
  const [cgSource, setCgSource] = useState(null);
  const [cgPreset, setCgPreset] = useState('warm');
  const [cgBusy, setCgBusy] = useState(false);
  const [cgResult, setCgResult] = useState(null);
  const [cgError, setCgError] = useState('');
  // Batch text
  const [btImages, setBtImages] = useState([]);
  const [btText, setBtText] = useState('{filename}');
  const [btPosition, setBtPosition] = useState('bottom-right');
  const [btColor, setBtColor] = useState('#ffffff');
  const [btFontSize, setBtFontSize] = useState(36);
  const [btOpacity, setBtOpacity] = useState(0.85);
  const [btBg, setBtBg] = useState('');
  const [btBusy, setBtBusy] = useState(false);
  const [btResults, setBtResults] = useState([]);
  const [btError, setBtError] = useState('');
  const isHostedProvider = status?.hosted || (status?.provider && status.provider !== 'local-comfyui');
  // Image-to-image augmentation is supported on local ComfyUI and on FAL (via its
  // /image-to-image endpoint). Other hosted providers don't support it yet.
  const augmentSupported = !isHostedProvider || status?.provider === 'fal';
  const serviceLabel = isHostedProvider
    ? `${status?.provider || 'Hosted'} ready: ${status?.model || 'model not selected'}`
    : `ComfyUI ready: ${status?.model}`;
  const statusLabel = !status
    ? 'Checking graphics provider...'
    : status.ok
      ? serviceLabel
      : `${isHostedProvider ? status?.provider || 'Graphics provider' : 'ComfyUI'} not ready`;

  useEffect(() => {
    api.get('/api/graphics/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ok: false, hosted: true, provider: 'Graphics provider', error: 'Unable to check graphics service' }));
    api.get('/api/graphics/upscale/info')
      .then(r => r.json())
      .then(info => {
        setUpscaleInfo(info);
        if (Array.isArray(info?.scales) && !info.scales.includes(Number(upscaleScale))) {
          setUpscaleScale(String(info.scales[0]));
        }
        if (info?.model) setUpscaleModel(info.model);
      })
      .catch(() => {});
    api.get('/api/graphics/convert/info')
      .then(r => r.json())
      .then(info => {
        if (Array.isArray(info?.formats) && info.formats.length) setConvertFormats(info.formats);
      })
      .catch(() => {});
    loadGallery();
  }, []);

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleUpscaleFile = async (file) => {
    if (!file) return;
    setUpscaleError('');
    setUpscaleResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setUpscaleSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setUpscaleError('Could not read that image file.');
    }
  };

  const useResultForUpscale = () => {
    if (!result?.imageDataUrl) return;
    setUpscaleError('');
    setUpscaleResult(null);
    setUpscaleSource({ imageDataUrl: result.imageDataUrl, name: 'current result' });
  };

  const runUpscale = async () => {
    if (!upscaleSource?.imageDataUrl) return;
    setUpscaling(true);
    setUpscaleError('');
    try {
      const res = await api.post('/api/graphics/upscale', {
        imageDataUrl: upscaleSource.imageDataUrl,
        scale: Number(upscaleScale),
        creativity: Number(upscaleFidelity),
        model: upscaleModel || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upscale failed');
      setUpscaleResult(data);
    } catch (err) {
      setUpscaleError(err.message || 'Upscale failed');
    } finally {
      setUpscaling(false);
    }
  };

  const downloadUpscaled = () => {
    if (!upscaleResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = upscaleResult.imageDataUrl;
    a.download = `upscaled-${upscaleResult.scale || ''}x-${Date.now()}.png`;
    a.click();
  };

  const activeConvertFormat = convertFormats.find(f => f.id === convertFormat);

  const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleConvertFile = async (file) => {
    if (!file) return;
    setConvertError('');
    setConvertResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setConvertSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setConvertError('Could not read that image file.');
    }
  };

  const useResultForConvert = () => {
    if (!result?.imageDataUrl) return;
    setConvertError('');
    setConvertResult(null);
    setConvertSource({ imageDataUrl: result.imageDataUrl, name: 'current result' });
  };

  const runConvert = async () => {
    if (!convertSource?.imageDataUrl) return;
    setConverting(true);
    setConvertError('');
    try {
      const res = await api.post('/api/graphics/convert', {
        imageDataUrl: convertSource.imageDataUrl,
        format: convertFormat,
        quality: Number(convertQuality),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed');
      setConvertResult(data);
    } catch (err) {
      setConvertError(err.message || 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const downloadConverted = () => {
    if (!convertResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = convertResult.imageDataUrl;
    a.download = `converted-${Date.now()}.${convertResult.ext || 'img'}`;
    a.click();
  };

  const runFavicon = async () => {
    if (!favSource?.imageDataUrl) return;
    setFavBusy(true);
    setFavError('');
    try {
      const res = await api.post('/api/graphics/favicon', { imageDataUrl: favSource.imageDataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Favicon generation failed');
      setFavResult(data);
    } catch (err) {
      setFavError(err.message || 'Favicon generation failed');
    } finally {
      setFavBusy(false);
    }
  };

  const runVectorize = async () => {
    if (!svgSource?.imageDataUrl) return;
    setSvgBusy(true);
    setSvgError('');
    try {
      const res = await api.post('/api/graphics/vectorize', {
        imageDataUrl: svgSource.imageDataUrl,
        colors: Number(svgColors),
        detail: svgDetail,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Vectorize failed');
      setSvgResult(data);
    } catch (err) {
      setSvgError(err.message || 'Vectorize failed');
    } finally {
      setSvgBusy(false);
    }
  };

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

  const batchOne = async (item) => {
    let endpoint = '/api/graphics/convert';
    let body = { imageDataUrl: item.imageDataUrl };
    if (batchOp === 'convert') {
      body.format = batchFormat;
      body.quality = Number(batchQuality);
    } else if (batchOp === 'resize') {
      endpoint = '/api/graphics/resize';
      body.op = 'resize';
      if (batchWidth) body.width = Number(batchWidth);
      if (batchHeight) body.height = Number(batchHeight);
      body.fit = batchFit;
    } else if (batchOp === 'strip') {
      endpoint = '/api/graphics/strip-metadata';
    }
    const res = await api.post(endpoint, body);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Operation failed');
    return data;
  };

  const runBatchAll = async () => {
    const pending = batchFiles.filter(f => f.imageDataUrl && f.status !== 'done');
    if (!pending.length) return;
    if (batchOp === 'resize' && !batchWidth && !batchHeight) return;
    setBatchRunning(true);
    for (const item of pending) {
      setBatchFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'working', error: '' } : f));
      try {
        const data = await batchOne(item);
        setBatchFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', result: data } : f));
      } catch (err) {
        setBatchFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', error: err.message || 'Operation failed' } : f));
      }
    }
    setBatchRunning(false);
  };

  const downloadBatchItem = (item) => {
    if (!item?.result?.imageDataUrl) return;
    const base = item.name.replace(/\.[^.]+$/, '');
    const ext = item.result.ext || item.result.format || 'img';
    const suffix = batchOp === 'convert' ? '' : (batchOp === 'resize' ? '-resized' : '-clean');
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

  const handleBgFile = async (file) => {
    if (!file) return;
    setBgError('');
    setBgResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setBgSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setBgError('Could not read that image file.');
    }
  };

  const runRemoveBg = async () => {
    if (!bgSource?.imageDataUrl) return;
    if (bgMode === 'image' && !bgImage?.imageDataUrl) { setBgError('Choose a background image'); return; }
    setBgProcessing(true);
    setBgError('');
    try {
      const body = {
        imageDataUrl: bgSource.imageDataUrl,
        background: bgMode === 'color' ? bgColor : 'transparent',
      };
      if (bgMode === 'image') body.backgroundImageDataUrl = bgImage.imageDataUrl;
      if (bgMode === 'gradient') body.gradient = { from: bgColor, to: bgColor2, direction: bgGradientDir };
      const res = await api.post('/api/graphics/background', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Background change failed');
      setBgResult(data);
    } catch (err) {
      setBgError(err.message || 'Background change failed');
    } finally {
      setBgProcessing(false);
    }
  };

  const downloadBg = () => {
    if (!bgResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = bgResult.imageDataUrl;
    a.download = `background-${Date.now()}.png`;
    a.click();
  };

  const handleRecolorFile = async (file) => {
    if (!file) return;
    setRecolorError('');
    setRecolorResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setRecolorSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setRecolorError('Could not read that image file.');
    }
  };

  useEffect(() => {
    if (mode !== 'recolor' || !recolorSource?.imageDataUrl) return;
    const canvas = recolorCanvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
    img.src = recolorSource.imageDataUrl;
  }, [mode, recolorSource]);

  const getRecolorPixel = (e) => {
    const canvas = recolorCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const py = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
    try {
      // Average a small 3x3 block so compression noise doesn't skew the pick.
      const sx = Math.max(0, px - 1);
      const sy = Math.max(0, py - 1);
      const w = Math.min(3, canvas.width - sx);
      const h = Math.min(3, canvas.height - sy);
      const { data } = canvas.getContext('2d').getImageData(sx, sy, w, h);
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
      }
      if (n === 0) return null;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
      return { px, py, hex };
    } catch {
      return null;
    }
  };

  const drawLoupe = (px, py) => {
    const canvas = recolorCanvasRef.current;
    const loupe = loupeCanvasRef.current;
    if (!canvas || !loupe) return;
    const lctx = loupe.getContext('2d');
    lctx.imageSmoothingEnabled = false;
    const crop = 9; // source pixels across the loupe (smaller = stronger magnification)
    lctx.clearRect(0, 0, loupe.width, loupe.height);
    lctx.drawImage(canvas, px - (crop - 1) / 2, py - (crop - 1) / 2, crop, crop, 0, 0, loupe.width, loupe.height);
    const cell = loupe.width / crop;
    const c = (crop - 1) / 2;
    lctx.strokeStyle = 'rgba(255,255,255,0.95)';
    lctx.lineWidth = 1;
    lctx.strokeRect(c * cell, c * cell, cell, cell);
    lctx.strokeStyle = 'rgba(0,0,0,0.95)';
    lctx.strokeRect(c * cell - 1, c * cell - 1, cell + 2, cell + 2);
  };

  const handleRecolorHover = (e) => {
    const p = getRecolorPixel(e);
    if (!p) { setLoupeVisible(false); return; }
    setRecolorHoverHex(p.hex);
    setLoupeVisible(true);
    drawLoupe(p.px, p.py);
  };

  const handleRecolorMouseDown = (e) => {
    const sc = recolorScrollRef.current;
    if (!sc) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: sc.scrollLeft, scrollTop: sc.scrollTop, moved: false };
  };

  const handleRecolorMouseMove = (e) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        d.moved = true;
        setLoupeVisible(false);
      }
      if (d.moved) {
        const sc = recolorScrollRef.current;
        if (sc) {
          sc.scrollLeft = d.scrollLeft - dx;
          sc.scrollTop = d.scrollTop - dy;
        }
      }
      return;
    }
    handleRecolorHover(e);
  };

  const handleRecolorMouseUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) {
      const p = getRecolorPixel(e);
      if (p) setRecolorSrcColor(p.hex);
    }
  };

  const handleRecolorMouseLeave = () => {
    setLoupeVisible(false);
    dragRef.current = null;
  };

  const runRecolor = async () => {
    if (!recolorSource?.imageDataUrl) return;
    setRecoloring(true);
    setRecolorError('');
    try {
      const res = await api.post('/api/graphics/recolor', {
        imageDataUrl: recolorSource.imageDataUrl,
        sourceColor: recolorSrcColor,
        targetColor: recolorTargetColor,
        tolerance: Number(recolorTolerance),
        mode: recolorMode,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recolour failed');
      setRecolorResult(data);
    } catch (err) {
      setRecolorError(err.message || 'Recolour failed');
    } finally {
      setRecoloring(false);
    }
  };

  const downloadRecolor = () => {
    if (!recolorResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = recolorResult.imageDataUrl;
    a.download = `recolored-${Date.now()}.png`;
    a.click();
  };

  const downloadDataUrl = (dataUrl, name) => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    a.click();
  };

  const loadImageInto = (setter) => async (file) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setter({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      /* ignore */
    }
  };

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

  const downloadAeEnhanced = () => {
    if (!aeResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = aeResult.imageDataUrl;
    a.download = `enhanced-${Date.now()}.png`;
    a.click();
  };

  // Perspective correct handlers.
  const runPerspective = async () => {
    if (!persSource?.imageDataUrl) return;
    setPersBusy(true);
    setPersError('');
    try {
      const res = await api.post('/api/graphics/perspective', {
        imageDataUrl: persSource.imageDataUrl,
        hSkew: persHSkew,
        vSkew: persVSkew,
        background: persBg,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Perspective correction failed');
      setPersResult(data);
    } catch (err) {
      setPersError(err.message || 'Perspective correction failed');
    } finally {
      setPersBusy(false);
    }
  };

  // Smart crop handlers.
  const runSmartCrop = async () => {
    if (!scSource?.imageDataUrl) return;
    setScBusy(true);
    setScError('');
    try {
      const res = await api.post('/api/graphics/smart-crop', {
        imageDataUrl: scSource.imageDataUrl,
        width: scWidth ? Number(scWidth) : undefined,
        height: scHeight ? Number(scHeight) : undefined,
        aspect: scAspect || undefined,
        focus: scFocus,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Smart crop failed');
      setScResult(data);
    } catch (err) {
      setScError(err.message || 'Smart crop failed');
    } finally {
      setScBusy(false);
    }
  };

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

  // Batch text handlers.
  const addBtImages = async (fileList) => {
    const files = Array.from(fileList || []);
    const loaded = await Promise.all(files.map(async (f) => {
      try {
        const dataUrl = await readFileAsDataUrl(f);
        return { name: f.name, imageDataUrl: dataUrl };
      } catch { return null; }
    }));
    setBtImages(prev => [...prev, ...loaded.filter(Boolean)].slice(0, 20));
  };

  const runBatchText = async () => {
    if (!btImages.length) return;
    setBtBusy(true);
    setBtError('');
    setBtResults([]);
    try {
      const res = await api.post('/api/graphics/batch-text', {
        images: btImages,
        text: btText,
        position: btPosition,
        color: btColor,
        fontSize: btFontSize,
        opacity: btOpacity,
        background: btBg || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch text failed');
      setBtResults(data.results || []);
    } catch (err) {
      setBtError(err.message || 'Batch text failed');
    } finally {
      setBtBusy(false);
    }
  };

  // Animate: assemble multiple frames into one animated GIF on the server.
  const handleAnimFrames = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const items = await Promise.all(files.map(async (file) => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        return { id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: dataUrl };
      } catch {
        return null;
      }
    }));
    setAnimFrames(prev => [...prev, ...items.filter(Boolean)]);
  };

  const removeAnimFrame = (id) => setAnimFrames(prev => prev.filter(f => f.id !== id));
  const moveAnimFrame = (id, dir) => setAnimFrames(prev => {
    const i = prev.findIndex(f => f.id === id);
    if (i < 0) return prev;
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const copy = [...prev];
    const [x] = copy.splice(i, 1);
    copy.splice(j, 0, x);
    return copy;
  });
  const clearAnimFrames = () => { setAnimFrames([]); setAnimResult(null); setAnimError(''); };

  const runAnimate = async () => {
    if (animFrames.length < 2) { setAnimError('Add at least 2 frames'); return; }
    setAnimBusy(true);
    setAnimError('');
    setAnimResult(null);
    try {
      const res = await api.post('/api/graphics/animate', {
        frames: animFrames.map(f => f.imageDataUrl),
        delay: Number(animDelay),
        loop: animLoop,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Animation failed');
      setAnimResult(data);
    } catch (err) {
      setAnimError(err.message || 'Animation failed');
    } finally {
      setAnimBusy(false);
    }
  };

  // PDF → images: render each page to a PNG in the browser via pdfjs-dist.
  const handlePdfFile = async (file) => {
    if (!file) return;
    setPdfError('');
    setPdfPages([]);
    setPdfName(file.name?.replace(/\.pdf$/i, '') || 'page');
    setPdfBusy(true);
    try {
      const pdfjsLib = await import('pdfjs-dist');
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
      }
      const buffer = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const scale = Math.max(1, Math.min(4, Number(pdfScale) || 2));
      const pages = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // eslint-disable-next-line no-await-in-loop
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push({ id: `p${n}`, page: n, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        setPdfPages([...pages]);
      }
    } catch (err) {
      setPdfError(err.message || 'Could not read that PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadPdfPage = (item) => downloadDataUrl(item.dataUrl, `${pdfName || 'page'}-${item.page}.png`);
  const downloadPdfAll = () => pdfPages.forEach((item, i) => setTimeout(() => downloadPdfPage(item), i * 150));

  // Pipeline builder: ordered list of whitelisted ops applied server-side.
  const PIPE_OP_DEFS = {
    grayscale: { label: 'Grayscale', param: null },
    sepia: { label: 'Sepia', param: null },
    invert: { label: 'Invert', param: null },
    flip: { label: 'Flip vertical', param: null },
    flop: { label: 'Mirror horizontal', param: null },
    blur: { label: 'Blur', param: { min: 0.3, max: 60, step: 0.5, def: 5 } },
    sharpen: { label: 'Sharpen', param: { min: 0.3, max: 10, step: 0.1, def: 2 } },
    brightness: { label: 'Brightness', param: { min: 0.3, max: 2, step: 0.01, def: 1 } },
    contrast: { label: 'Contrast', param: { min: 0.3, max: 2, step: 0.01, def: 1 } },
    saturation: { label: 'Saturation', param: { min: 0, max: 2, step: 0.01, def: 1 } },
    gamma: { label: 'Gamma', param: { min: 1, max: 3, step: 0.01, def: 1 } },
    temperature: { label: 'Temperature', param: { min: -100, max: 100, step: 1, def: 0 } },
    rotate: { label: 'Rotate (angle)', param: { min: -180, max: 180, step: 1, def: 90 } },
    border: { label: 'Border', param: { min: 0, max: 200, step: 1, def: 24 }, color: true },
    resize: { label: 'Resize (width px)', param: { min: 16, max: 8000, step: 1, def: 1200 }, resize: true },
  };

  const addPipeStep = () => {
    const def = PIPE_OP_DEFS[pipeStepOp];
    const step = { id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`, op: pipeStepOp };
    if (def?.param) step.value = def.param.def;
    if (def?.color) step.color = '#ffffff';
    if (def?.resize) { step.width = def.param.def; step.fit = 'inside'; }
    setPipeSteps(prev => [...prev, step]);
  };
  const updatePipeStep = (id, patch) => setPipeSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const removePipeStep = (id) => setPipeSteps(prev => prev.filter(s => s.id !== id));
  const movePipeStep = (id, dir) => setPipeSteps(prev => {
    const i = prev.findIndex(s => s.id === id);
    if (i < 0) return prev;
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const copy = [...prev];
    const [x] = copy.splice(i, 1);
    copy.splice(j, 0, x);
    return copy;
  });

  const runPipeline = async () => {
    if (!pipeSource?.imageDataUrl || !pipeSteps.length) return;
    setPipeBusy(true);
    setPipeError('');
    setPipeResult(null);
    try {
      const steps = pipeSteps.map(s => {
        const out = { op: s.op };
        if (s.value !== undefined) out.value = Number(s.value);
        if (s.color) out.color = s.color;
        if (s.op === 'resize') { out.width = Number(s.width) || undefined; out.fit = s.fit || 'inside'; }
        return out;
      });
      const res = await api.post('/api/graphics/pipeline', { imageDataUrl: pipeSource.imageDataUrl, steps });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Pipeline failed');
      setPipeResult(data);
    } catch (err) {
      setPipeError(err.message || 'Pipeline failed');
    } finally {
      setPipeBusy(false);
    }
  };

  // Adjust presets (localStorage).
  const persistAdjPresets = (next) => {
    setAdjPresets(next);
    try { localStorage.setItem('graphics.adjustPresets', JSON.stringify(next)); } catch { /* ignore quota */ }
  };
  const saveAdjPreset = () => {
    const name = adjPresetName.trim();
    if (!name) return;
    const preset = {
      name,
      values: {
        brightness: adjBrightness, contrast: adjContrast, saturation: adjSaturation, hue: adjHue,
        sharpness: adjSharpness, temperature: adjTemperature, vignette: adjVignette,
        blackPoint: adjBlackPoint, whitePoint: adjWhitePoint, gamma: adjGamma, blur: adjBlur, denoise: adjDenoise,
      },
    };
    const next = [...adjPresets.filter(p => p.name !== name), preset];
    persistAdjPresets(next);
    setAdjPresetName('');
  };
  const applyAdjPreset = (name) => {
    const p = adjPresets.find(x => x.name === name);
    if (!p) return;
    const v = p.values;
    setAdjBrightness(v.brightness); setAdjContrast(v.contrast); setAdjSaturation(v.saturation); setAdjHue(v.hue);
    setAdjSharpness(v.sharpness); setAdjTemperature(v.temperature); setAdjVignette(v.vignette);
    setAdjBlackPoint(v.blackPoint ?? 0); setAdjWhitePoint(v.whitePoint ?? 255); setAdjGamma(v.gamma ?? 1); setAdjBlur(v.blur ?? 0); setAdjDenoise(v.denoise ?? 0);
  };
  const deleteAdjPreset = (name) => persistAdjPresets(adjPresets.filter(p => p.name !== name));

  // Inpaint: paint a white mask (red overlay on screen) over the area to change.
  const drawInpaintBase = () => {
    const disp = inpaintCanvasRef.current;
    const mask = inpaintMaskRef.current;
    const img = inpaintImgRef.current;
    if (!disp || !mask || !img) return;
    const cap = 1024;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (Math.max(w, h) > cap) { const s = cap / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    disp.width = w; disp.height = h; mask.width = w; mask.height = h;
    disp.getContext('2d').drawImage(img, 0, 0, w, h);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#000';
    mctx.fillRect(0, 0, w, h);
    setInpaintHasMask(false);
  };

  const loadInpaint = (src) => { setInpaintError(''); setInpaintResult(null); setInpaintSource(src); };

  const inpaintPos = (e) => {
    const c = inpaintCanvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const inpaintPaint = (x, y) => {
    const disp = inpaintCanvasRef.current;
    const mask = inpaintMaskRef.current;
    if (!disp || !mask) return;
    const rect = disp.getBoundingClientRect();
    const scale = disp.width / (rect.width || disp.width);
    const r = Math.max(2, Number(inpaintBrush) * scale);
    const dctx = disp.getContext('2d');
    dctx.fillStyle = 'rgba(239,68,68,0.5)';
    dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill();
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
  };
  const onInpaintDown = (e) => { inpaintDrawing.current = true; const { x, y } = inpaintPos(e); inpaintPaint(x, y); setInpaintHasMask(true); };
  const onInpaintMove = (e) => { if (!inpaintDrawing.current) return; const { x, y } = inpaintPos(e); inpaintPaint(x, y); };
  const onInpaintUp = () => { inpaintDrawing.current = false; };
  const clearInpaintMask = () => drawInpaintBase();

  const runInpaint = async () => {
    const mask = inpaintMaskRef.current;
    const img = inpaintImgRef.current;
    if (!mask || !img) { setInpaintError('Load an image first'); return; }
    if (!inpaintHasMask) { setInpaintError('Paint over the area you want to change'); return; }
    if (!inpaintPrompt.trim()) { setInpaintError('Describe what should fill the masked area'); return; }
    setInpaintBusy(true);
    setInpaintError('');
    setInpaintResult(null);
    try {
      const tmp = document.createElement('canvas');
      tmp.width = mask.width;
      tmp.height = mask.height;
      tmp.getContext('2d').drawImage(img, 0, 0, tmp.width, tmp.height);
      const res = await api.post('/api/graphics/inpaint', {
        imageDataUrl: tmp.toDataURL('image/png'),
        maskDataUrl: mask.toDataURL('image/png'),
        prompt: inpaintPrompt.trim(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Inpainting failed');
      setInpaintResult(data);
    } catch (err) {
      setInpaintError(err.message || 'Inpainting failed');
    } finally {
      setInpaintBusy(false);
    }
  };

  useEffect(() => { setCompareOn(false); }, [mode]);

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

  // Load the inpaint source onto the canvas (and reset the mask) when it changes.
  useEffect(() => {
    if (mode !== 'inpaint' || !inpaintSource?.imageDataUrl) return undefined;
    let cancelled = false;
    loadImageEl(inpaintSource.imageDataUrl)
      .then((img) => { if (!cancelled) { inpaintImgRef.current = img; drawInpaintBase(); } })
      .catch(() => { if (!cancelled) setInpaintError('Could not load that image.'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inpaintSource, mode]);

  // Global keyboard shortcuts: "/" focuses tool search, Esc closes the preview /
  // clears search, and Cmd/Ctrl+Z / Shift+Z drive undo-redo in Annotate & Redact.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        toolSearchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (previewImage) setPreviewImage(null);
        else if (typing && el === toolSearchRef.current) setToolSearch('');
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'z' || e.key === 'Z') && !typing) {
        if (mode === 'annotate') { e.preventDefault(); if (e.shiftKey) redoAnn(); else undoAnn(); }
        else if (mode === 'redact') { e.preventDefault(); if (e.shiftKey) redoRedact(); else undoRedact(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, previewImage]);

  // Tools an edited image can be handed straight to, without re-uploading.
  const SEND_TARGETS = [
    { mode: 'cropresize', label: 'Crop / Resize' },
    { mode: 'extend', label: 'Canvas Extend' },
    { mode: 'annotate', label: 'Annotate' },
    { mode: 'effects', label: 'Effects' },
    { mode: 'adjust', label: 'Adjust' },
    { mode: 'watermark', label: 'Watermark' },
    { mode: 'background', label: 'Background' },
    { mode: 'recolor', label: 'Recolour' },
    { mode: 'convert', label: 'Convert' },
    { mode: 'upscale', label: 'Upscale' },
    { mode: 'pipeline', label: 'Pipeline' },
    { mode: 'inpaint', label: 'Inpaint' },
  ];

  const sendImageTo = (targetMode, dataUrl, name = 'image.png') => {
    if (!dataUrl) return;
    const src = { imageDataUrl: dataUrl, name };
    switch (targetMode) {
      case 'cropresize': setCrResult(null); setCrNat(null); setCrSource(src); break;
      case 'extend': setExtResult(null); setExtError(''); setExtSource(src); break;
      case 'annotate': setAnnShapes([]); setAnnSelected(null); setAnnEditing(null); setAnnPast([]); setAnnFuture([]); annImgRef.current = null; setAnnSource(src); break;
      case 'effects': setEfResult(null); setEfError(''); setEfSource(src); break;
      case 'adjust': setAdjResult(null); setAdjError(''); setAdjSource(src); break;
      case 'watermark': setWmResult(null); setWmError(''); setWmSource(src); break;
      case 'background': setBgResult(null); setBgError(''); setBgSource(src); break;
      case 'recolor': setRecolorResult(null); setRecolorError(''); setRecolorSource(src); break;
      case 'convert': setConvertResult(null); setConvertError(''); setConvertSource(src); break;
      case 'upscale': setUpscaleResult(null); setUpscaleError(''); setUpscaleSource(src); break;
      case 'pipeline': setPipeResult(null); setPipeError(''); setPipeSource(src); break;
      case 'inpaint': loadInpaint(src); break;
      default: return;
    }
    setCompareOn(false);
    setMode(targetMode);
  };

  // Compact "Use result in…" dropdown shown in a result header.
  const renderSendTo = (dataUrl, name, excludeMode) => (
    <select
      value=""
      onChange={(e) => { if (e.target.value) sendImageTo(e.target.value, dataUrl, name); e.target.value = ''; }}
      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 cursor-pointer"
      style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)', background: 'transparent' }}
      title="Continue editing this result in another tool"
    >
      <option value="">Use in…</option>
      {SEND_TARGETS.filter(t => t.mode !== excludeMode).map(t => (
        <option key={t.mode} value={t.mode}>{t.label}</option>
      ))}
    </select>
  );

  const renderExport = (dataUrl, baseName) => (dataUrl ? <ExportMenu dataUrl={dataUrl} baseName={baseName} /> : null);

  // Compare toggle for a result header (only meaningful with both images).
  const renderCompareToggle = (hasSource, hasResult) => {
    if (!hasSource || !hasResult) return null;
    return (
      <button
        type="button"
        onClick={() => setCompareOn(v => !v)}
        className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
        style={{ color: compareOn ? '#fff' : 'var(--color-primary)', background: compareOn ? 'var(--color-primary)' : 'transparent', borderColor: 'var(--color-border)' }}
      >
        {compareOn ? 'Result' : 'Compare'}
      </button>
    );
  };

  // Result media: a before/after slider when Compare is on, otherwise the
  // clickable result image (with optional transparency checkerboard).
  const renderResultMedia = (source, result, { transparent = false, alt = 'result' } = {}) => {
    if (compareOn && source && result?.imageDataUrl) {
      return <BeforeAfter before={source} after={result.imageDataUrl} transparent={transparent} />;
    }
    const checker = transparent ? {
      backgroundColor: '#fff',
      backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%)',
      backgroundSize: '16px 16px',
      backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
    } : {};
    return (
      <button type="button" onClick={() => setPreviewImage(result)} className="block w-full rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', ...checker }}>
        <img src={result.imageDataUrl} alt={alt} className="w-full" />
      </button>
    );
  };

  const runCropResize = async () => {
    if (!crSource?.imageDataUrl) return;
    setCrBusy(true);
    setCrError('');
    try {
      const body = { imageDataUrl: crSource.imageDataUrl, op: crOp };
      if (crOp === 'resize') {
        body.width = crWidth ? Number(crWidth) : undefined;
        body.height = crHeight ? Number(crHeight) : undefined;
        body.fit = crFit;
      } else {
        if (!crNat) throw new Error('Image is still loading');
        body.rect = {
          x: Math.round(crCrop.x * crNat.w),
          y: Math.round(crCrop.y * crNat.h),
          w: Math.round(crCrop.w * crNat.w),
          h: Math.round(crCrop.h * crNat.h),
        };
      }
      const res = await api.post('/api/graphics/resize', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Operation failed');
      setCrResult(data);
    } catch (err) {
      setCrError(err.message || 'Operation failed');
    } finally {
      setCrBusy(false);
    }
  };

  const onCrImgLoad = (e) => {
    const img = e.currentTarget;
    const nat = { w: img.naturalWidth, h: img.naturalHeight };
    setCrNat(nat);
    const ratio = CR_ASPECTS.find(a => a.id === crAspect)?.v ?? null;
    setCrCrop(makeCenteredCrop(ratio, nat));
  };

  const onCrAspectChange = (id) => {
    setCrAspect(id);
    const ratio = CR_ASPECTS.find(a => a.id === id)?.v ?? null;
    if (crNat) setCrCrop(makeCenteredCrop(ratio, crNat));
  };

  const onCrDragMove = useCallback((e) => {
    const d = crDragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.imgW;
    const dy = (e.clientY - d.startY) / d.imgH;
    setCrCrop(computeCropRect(d, dx, dy));
  }, []);

  const endCrDrag = useCallback(() => {
    crDragRef.current = null;
    window.removeEventListener('mousemove', onCrDragMove);
    window.removeEventListener('mouseup', endCrDrag);
  }, [onCrDragMove]);

  const beginCrDrag = (type) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const img = crImgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    crDragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...crCrop },
      imgW: r.width,
      imgH: r.height,
      ratio: CR_ASPECTS.find(a => a.id === crAspect)?.v ?? null,
      natW: crNat?.w || 0,
      natH: crNat?.h || 0,
    };
    window.addEventListener('mousemove', onCrDragMove);
    window.addEventListener('mouseup', endCrDrag);
  };

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

  const runWatermark = async () => {
    if (!wmSource?.imageDataUrl) return;
    setWmBusy(true);
    setWmError('');
    try {
      const body = {
        imageDataUrl: wmSource.imageDataUrl,
        type: wmType,
        position: wmPosition,
        opacity: Number(wmOpacity),
        tile: wmTile,
      };
      if (wmType === 'text') {
        body.text = wmText;
        body.color = wmColor;
      } else {
        if (!wmImage?.imageDataUrl) throw new Error('Add a watermark image');
        body.watermarkDataUrl = wmImage.imageDataUrl;
        body.scale = Number(wmScale);
      }
      const res = await api.post('/api/graphics/watermark', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Watermark failed');
      setWmResult(data);
    } catch (err) {
      setWmError(err.message || 'Watermark failed');
    } finally {
      setWmBusy(false);
    }
  };

  const handleCollageFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const items = await Promise.all(files.map(async (file) => {
      const dataUrl = await readFileAsDataUrl(file).catch(() => null);
      return dataUrl ? { id: `${file.name}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: dataUrl } : null;
    }));
    setCollageFiles(prev => [...prev, ...items.filter(Boolean)].slice(0, 9));
  };

  const runCollage = async () => {
    if (collageFiles.length < 2) { setCollageError('Add at least 2 images'); return; }
    setCollageBusy(true);
    setCollageError('');
    try {
      const res = await api.post('/api/graphics/collage', {
        images: collageFiles.map(f => f.imageDataUrl),
        columns: Number(collageColumns),
        spacing: Number(collageSpacing),
        background: collageBg,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Collage failed');
      setCollageResult(data);
    } catch (err) {
      setCollageError(err.message || 'Collage failed');
    } finally {
      setCollageBusy(false);
    }
  };

  const runEffect = async () => {
    if (!efSource?.imageDataUrl) return;
    setEfBusy(true);
    setEfError('');
    try {
      const body = { imageDataUrl: efSource.imageDataUrl, effect: efEffect };
      if (efEffect === 'border') { body.borderWidth = Number(efBorderWidth); body.borderColor = efBorderColor; }
      if (efEffect === 'round') { body.radius = Number(efRadius); }
      if (efEffect === 'shadow') {
        body.blur = Number(efBlur);
        body.offsetX = Number(efOffsetX);
        body.offsetY = Number(efOffsetY);
        body.shadowColor = efShadowColor;
        body.shadowOpacity = Number(efShadowOpacity);
      }
      if (efEffect === 'duotone') { body.duoShadow = efDuoShadow; body.duoHighlight = efDuoHighlight; }
      if (efEffect === 'rotate-free') { body.angle = Number(efAngle); body.transparent = efRotateTransparent; body.background = efRotateBg; }
      const res = await api.post('/api/graphics/effect', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Effect failed');
      setEfResult(data);
    } catch (err) {
      setEfError(err.message || 'Effect failed');
    } finally {
      setEfBusy(false);
    }
  };

  const setExtAll = (val) => { setExtTop(val); setExtRight(val); setExtBottom(val); setExtLeft(val); };

  const runExtend = async () => {
    if (!extSource?.imageDataUrl) return;
    setExtBusy(true);
    setExtError('');
    try {
      const res = await api.post('/api/graphics/extend', {
        imageDataUrl: extSource.imageDataUrl,
        top: Number(extTop) || 0,
        right: Number(extRight) || 0,
        bottom: Number(extBottom) || 0,
        left: Number(extLeft) || 0,
        transparent: extTransparent,
        background: extColor,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Canvas extend failed');
      setExtResult(data);
    } catch (err) {
      setExtError(err.message || 'Canvas extend failed');
    } finally {
      setExtBusy(false);
    }
  };

  // Annotate: draw the image plus every shape; `preview` is the in-progress shape.
  const renderAnnShape = (ctx, s, W, H) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.widthPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.type === 'pen') {
      if (!s.points?.length) return;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * W, s.points[0].y * H);
      for (let i = 1; i < s.points.length; i += 1) ctx.lineTo(s.points[i].x * W, s.points[i].y * H);
      ctx.stroke();
    } else if (s.type === 'rect') {
      ctx.strokeRect(s.x * W, s.y * H, s.w * W, s.h * H);
    } else if (s.type === 'arrow') {
      const ax1 = s.x1 * W;
      const ay1 = s.y1 * H;
      const ax2 = s.x2 * W;
      const ay2 = s.y2 * H;
      ctx.beginPath();
      ctx.moveTo(ax1, ay1);
      ctx.lineTo(ax2, ay2);
      ctx.stroke();
      const ang = Math.atan2(ay2 - ay1, ax2 - ax1);
      const head = Math.max(8, s.widthPx * 4);
      ctx.beginPath();
      ctx.moveTo(ax2, ay2);
      ctx.lineTo(ax2 - head * Math.cos(ang - Math.PI / 6), ay2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(ax2 - head * Math.cos(ang + Math.PI / 6), ay2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (s.type === 'text') {
      ctx.font = `bold ${s.fontPx}px ${fontFamilyFor(s.fontFamily)}`;
      ctx.textBaseline = 'top';
      const lines = String(s.text).split('\n');
      const lh = s.fontPx * 1.25;
      lines.forEach((line, i) => ctx.fillText(line, s.x * W, s.y * H + i * lh));
    }
  };

  const annShapeBBox = (s, ctx, W, H) => {
    if (s.type === 'text') {
      ctx.font = `bold ${s.fontPx}px ${fontFamilyFor(s.fontFamily)}`;
      const lines = String(s.text || '').split('\n');
      const w = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
      const lh = s.fontPx * 1.25;
      return { x: s.x * W, y: s.y * H, w, h: lh * lines.length };
    }
    if (s.type === 'rect') {
      return { x: Math.min(s.x, s.x + s.w) * W, y: Math.min(s.y, s.y + s.h) * H, w: Math.abs(s.w) * W, h: Math.abs(s.h) * H };
    }
    if (s.type === 'arrow') {
      const x1 = s.x1 * W; const y1 = s.y1 * H; const x2 = s.x2 * W; const y2 = s.y2 * H;
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    if (s.type === 'pen') {
      const xs = s.points.map(p => p.x * W); const ys = s.points.map(p => p.y * H);
      const minx = Math.min(...xs); const miny = Math.min(...ys);
      return { x: minx, y: miny, w: Math.max(...xs) - minx, h: Math.max(...ys) - miny };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  };

  const drawAnnotate = (preview) => {
    const canvas = annCanvasRef.current;
    const img = annImgRef.current;
    if (!canvas || !img) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    annShapes.forEach((s, i) => {
      if (annEditing && annEditing.editIndex === i) return; // hidden while editing
      renderAnnShape(ctx, s, W, H);
    });
    if (preview) renderAnnShape(ctx, preview, W, H);
    if (annTool === 'select' && annSelected != null && !annEditing && annShapes[annSelected]) {
      const b = annShapeBBox(annShapes[annSelected], ctx, W, H);
      const pad = Math.max(6, W / 250);
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = Math.max(1.5, W / 600);
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.restore();
    }
  };
  annDrawFnRef.current = drawAnnotate;

  useEffect(() => {
    if (!annFont) return;
    loadGoogleFont(annFont).then(() => annDrawFnRef.current?.(null));
  }, [annFont]);

  useEffect(() => {
    if (mode !== 'annotate' || !annSource?.imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      annImgRef.current = img;
      const canvas = annCanvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      annDrawFnRef.current?.(null);
    };
    img.src = annSource.imageDataUrl;
  }, [mode, annSource]);

  useEffect(() => {
    annDrawFnRef.current?.(null);
  }, [annShapes, annSelected, annTool, annEditing]);

  useEffect(() => {
    if (annEditing?.editId && annInputRef.current) {
      const el = annInputRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [annEditing?.editId]);

  const annSizes = () => {
    const canvas = annCanvasRef.current;
    const scale = canvas ? canvas.width / 1000 : 1;
    return { widthPx: Number(annWidth) * scale, fontPx: Number(annWidth) * 6 * scale };
  };

  const annDisplayScale = () => {
    const canvas = annCanvasRef.current;
    if (!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    return rect.width / canvas.width;
  };

  const translateAnnShape = (s, dx, dy) => {
    if (s.type === 'text' || s.type === 'rect') return { ...s, x: s.x + dx, y: s.y + dy };
    if (s.type === 'arrow') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    if (s.type === 'pen') return { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    return s;
  };

  const annHitTest = (cx, cy) => {
    const canvas = annCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const W = canvas.width; const H = canvas.height;
    const pxX = cx * W; const pxY = cy * H;
    for (let i = annShapes.length - 1; i >= 0; i -= 1) {
      const b = annShapeBBox(annShapes[i], ctx, W, H);
      const pad = Math.max(10, annShapes[i].widthPx || 0);
      if (pxX >= b.x - pad && pxX <= b.x + b.w + pad && pxY >= b.y - pad && pxY <= b.y + b.h + pad) return i;
    }
    return null;
  };

  const recordAnn = (snapshot) => {
    setAnnPast(p => [...p, snapshot].slice(-20));
    setAnnFuture([]);
  };
  const undoAnn = () => {
    if (!annPast.length) return;
    const prev = annPast[annPast.length - 1];
    setAnnFuture(f => [annShapesRef.current, ...f].slice(0, 20));
    setAnnPast(p => p.slice(0, -1));
    setAnnShapes(prev);
    setAnnSelected(null);
    setAnnEditing(null);
  };
  const redoAnn = () => {
    if (!annFuture.length) return;
    const next = annFuture[0];
    setAnnPast(p => [...p, annShapesRef.current].slice(-20));
    setAnnFuture(f => f.slice(1));
    setAnnShapes(next);
    setAnnSelected(null);
    setAnnEditing(null);
  };

  const recordRedact = (snapshot) => {
    setRedactPast(p => [...p, snapshot].slice(-20));
    setRedactFuture([]);
  };
  const undoRedact = () => {
    if (!redactPast.length) return;
    const prev = redactPast[redactPast.length - 1];
    setRedactFuture(f => [redactRectsRef.current, ...f].slice(0, 20));
    setRedactPast(p => p.slice(0, -1));
    setRedactRects(prev);
  };
  const redoRedact = () => {
    if (!redactFuture.length) return;
    const next = redactFuture[0];
    setRedactPast(p => [...p, redactRectsRef.current].slice(-20));
    setRedactFuture(f => f.slice(1));
    setRedactRects(next);
  };

  const commitAnnEditing = () => {
    const cur = annEditing;
    if (!cur) return;
    const val = (cur.value || '').replace(/^\n+|\n+$/g, '').trim();
    if (cur.editIndex != null || val) recordAnn(annShapesRef.current);
    setAnnShapes(prev => {
      if (cur.editIndex != null) {
        if (!val) return prev.filter((_, i) => i !== cur.editIndex);
        return prev.map((s, i) => (i === cur.editIndex ? { ...s, text: val, color: cur.color, fontFamily: cur.fontFamily !== undefined ? cur.fontFamily : s.fontFamily } : s));
      }
      if (!val) return prev;
      return [...prev, { type: 'text', x: cur.x, y: cur.y, text: val, color: cur.color, fontPx: cur.fontPx, fontFamily: cur.fontFamily || '', widthPx: Math.max(2, cur.fontPx * 0.08) }];
    });
    setAnnEditing(null);
    if (val) {
      // After placing/editing text, switch to Select / Move so it can be dragged straight away.
      const idx = cur.editIndex != null ? cur.editIndex : annShapes.length;
      setAnnTool('select');
      setAnnSelected(idx);
    }
  };

  const openAnnTextEditor = (x, y, { editIndex = null, value = '', fontPx, color, fontFamily } = {}) => {
    const sizes = annSizes();
    setAnnSelected(null);
    setAnnEditing({ editId: Date.now(), x, y, value, editIndex, fontPx: fontPx || sizes.fontPx, color: color || annColor, fontFamily: fontFamily !== undefined ? fontFamily : annFont, scale: annDisplayScale() });
  };

  const onAnnMove = useCallback((e) => {
    const d = annDrawRef.current;
    const canvas = annCanvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    if (d.tool === 'select') {
      if (!d.snapped) {
        const before = d.before;
        setAnnPast(p => [...p, before].slice(-20));
        setAnnFuture([]);
        d.snapped = true;
      }
      d.moved = true;
      const dx = cx - d.startX;
      const dy = cy - d.startY;
      setAnnShapes(prev => prev.map((s, i) => (i === d.idx ? translateAnnShape(d.orig, dx, dy) : s)));
      return;
    }
    let preview;
    if (d.tool === 'pen') {
      d.points.push({ x: cx, y: cy });
      preview = { type: 'pen', points: d.points, color: d.color, widthPx: d.widthPx };
    } else if (d.tool === 'arrow') {
      preview = { type: 'arrow', x1: d.startX, y1: d.startY, x2: cx, y2: cy, color: d.color, widthPx: d.widthPx };
    } else {
      preview = { type: 'rect', x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w: Math.abs(cx - d.startX), h: Math.abs(cy - d.startY), color: d.color, widthPx: d.widthPx };
    }
    annDrawFnRef.current?.(preview);
  }, []);

  const onAnnUp = useCallback((e) => {
    const d = annDrawRef.current;
    annDrawRef.current = null;
    window.removeEventListener('mousemove', onAnnMove);
    window.removeEventListener('mouseup', onAnnUp);
    const canvas = annCanvasRef.current;
    if (!d || !canvas) return;
    if (d.tool === 'select') return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    let shape = null;
    if (d.tool === 'pen') {
      if (d.points.length > 1) shape = { type: 'pen', points: d.points, color: d.color, widthPx: d.widthPx };
    } else if (d.tool === 'arrow') {
      if (Math.abs(cx - d.startX) > 0.005 || Math.abs(cy - d.startY) > 0.005) shape = { type: 'arrow', x1: d.startX, y1: d.startY, x2: cx, y2: cy, color: d.color, widthPx: d.widthPx };
    } else {
      const w = Math.abs(cx - d.startX);
      const h = Math.abs(cy - d.startY);
      if (w > 0.005 && h > 0.005) shape = { type: 'rect', x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w, h, color: d.color, widthPx: d.widthPx };
    }
    if (shape) {
      const before = d.before;
      setAnnPast(p => [...p, before].slice(-20));
      setAnnFuture([]);
      setAnnShapes(prev => [...prev, shape]);
    } else annDrawFnRef.current?.(null);
  }, [onAnnMove]);

  const onAnnDown = (e) => {
    const canvas = annCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = { x: clampNum((e.clientX - rect.left) / rect.width, 0, 1), y: clampNum((e.clientY - rect.top) / rect.height, 0, 1) };
    e.preventDefault();
    if (annEditing) commitAnnEditing();
    const { widthPx } = annSizes();
    if (annTool === 'text') {
      openAnnTextEditor(p.x, p.y, {});
      return;
    }
    if (annTool === 'select') {
      const idx = annHitTest(p.x, p.y);
      setAnnSelected(idx);
      if (idx == null) return;
      annDrawRef.current = { tool: 'select', idx, startX: p.x, startY: p.y, orig: annShapes[idx], moved: false, snapped: false, before: annShapesRef.current };
      window.addEventListener('mousemove', onAnnMove);
      window.addEventListener('mouseup', onAnnUp);
      return;
    }
    annDrawRef.current = { tool: annTool, startX: p.x, startY: p.y, points: [p], color: annColor, widthPx, before: annShapesRef.current };
    window.addEventListener('mousemove', onAnnMove);
    window.addEventListener('mouseup', onAnnUp);
  };

  const onAnnDoubleClick = (e) => {
    const canvas = annCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = { x: clampNum((e.clientX - rect.left) / rect.width, 0, 1), y: clampNum((e.clientY - rect.top) / rect.height, 0, 1) };
    const idx = annHitTest(p.x, p.y);
    if (idx != null && annShapes[idx].type === 'text') {
      const s = annShapes[idx];
      openAnnTextEditor(s.x, s.y, { editIndex: idx, value: s.text, fontPx: s.fontPx, color: s.color, fontFamily: s.fontFamily });
    }
  };

  const deleteAnnSelected = () => {
    if (annSelected == null) return;
    recordAnn(annShapesRef.current);
    setAnnShapes(prev => prev.filter((_, i) => i !== annSelected));
    setAnnSelected(null);
  };

  const exportAnnotate = () => {
    if (annEditing) commitAnnEditing();
    const canvas = annCanvasRef.current;
    if (!canvas) return;
    const prevSel = annSelected;
    setAnnSelected(null);
    requestAnimationFrame(() => {
      drawAnnotate(null);
      const url = canvas.toDataURL('image/png');
      downloadDataUrl(url, `annotated-${Date.now()}.png`);
      setAnnSelected(prevSel);
    });
  };

  const runDiff = async () => {
    if (!diffA?.imageDataUrl || !diffB?.imageDataUrl) { setDiffError('Add both images'); return; }
    setDiffBusy(true);
    setDiffError('');
    try {
      const res = await api.post('/api/graphics/diff', {
        imageA: diffA.imageDataUrl,
        imageB: diffB.imageDataUrl,
        threshold: Number(diffThreshold),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Diff failed');
      setDiffResult(data);
    } catch (err) {
      setDiffError(err.message || 'Diff failed');
    } finally {
      setDiffBusy(false);
    }
  };

  useEffect(() => {
    if (mode !== 'picker' || !pickerSource?.imageDataUrl) return;
    const canvas = pickerCanvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = pickerSource.imageDataUrl;
  }, [mode, pickerSource]);

  const getPickerPixel = (e) => {
    const canvas = pickerCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
    const py = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
    try {
      const [r, g, b] = canvas.getContext('2d').getImageData(px, py, 1, 1).data;
      return { r, g, b, hex: `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}` };
    } catch {
      return null;
    }
  };

  const handlePickerMouseDown = (e) => {
    const sc = pickerScrollRef.current;
    if (sc) pickerDragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: sc.scrollLeft, scrollTop: sc.scrollTop, moved: false };
  };

  const handlePickerMouseMove = (e) => {
    const d = pickerDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true;
    if (d.moved) {
      const sc = pickerScrollRef.current;
      if (sc) { sc.scrollLeft = d.scrollLeft - dx; sc.scrollTop = d.scrollTop - dy; }
    }
  };

  const handlePickerMouseUp = (e) => {
    const d = pickerDragRef.current;
    pickerDragRef.current = null;
    if (d && !d.moved) {
      const p = getPickerPixel(e);
      if (p) { setPickerHex(p); setPickerCopied(''); }
    }
  };

  const copyPicker = (text, which) => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    setPickerCopied(which);
  };

  const runAdjust = async () => {
    if (!adjSource?.imageDataUrl) return;
    setAdjBusy(true);
    setAdjError('');
    try {
      const res = await api.post('/api/graphics/adjust', {
        imageDataUrl: adjSource.imageDataUrl,
        brightness: Number(adjBrightness),
        contrast: Number(adjContrast),
        saturation: Number(adjSaturation),
        hue: Number(adjHue),
        sharpness: Number(adjSharpness),
        temperature: Number(adjTemperature),
        vignette: Number(adjVignette),
        blackPoint: Number(adjBlackPoint),
        whitePoint: Number(adjWhitePoint),
        gamma: Number(adjGamma),
        blur: Number(adjBlur),
        denoise: Number(adjDenoise),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Adjust failed');
      setAdjResult(data);
    } catch (err) {
      setAdjError(err.message || 'Adjust failed');
    } finally {
      setAdjBusy(false);
    }
  };

  const resetAdjust = () => {
    setAdjBrightness(1); setAdjContrast(1); setAdjSaturation(1); setAdjHue(0);
    setAdjSharpness(0); setAdjTemperature(0); setAdjVignette(0); setAdjResult(null);
    setAdjBlackPoint(0); setAdjWhitePoint(255); setAdjGamma(1); setAdjBlur(0); setAdjDenoise(0);
  };

  // Redact: render the image with each rectangle blurred or pixelated. `preview`
  // is the in-progress drag rect (drawn as a dashed outline only).
  const drawRedact = (preview) => {
    const canvas = redactCanvasRef.current;
    const img = redactImgRef.current;
    if (!canvas || !img) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    for (const r of redactRects) {
      const rx = Math.round(r.x * W);
      const ry = Math.round(r.y * H);
      const rw = Math.round(r.w * W);
      const rh = Math.round(r.h * H);
      if (rw < 1 || rh < 1) continue;
      if (redactMode === 'blur') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
        ctx.filter = `blur(${Math.max(1, Number(redactStrength))}px)`;
        ctx.drawImage(img, 0, 0, W, H);
        ctx.restore();
        ctx.filter = 'none';
      } else {
        const block = Math.max(2, Number(redactStrength));
        const tw = Math.max(1, Math.round(rw / block));
        const th = Math.max(1, Math.round(rh / block));
        const tmp = document.createElement('canvas');
        tmp.width = tw;
        tmp.height = th;
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(img, rx, ry, rw, rh, 0, 0, tw, th);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, tw, th, rx, ry, rw, rh);
        ctx.imageSmoothingEnabled = true;
      }
    }
    if (preview) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(2, W / 400);
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(preview.x * W, preview.y * H, preview.w * W, preview.h * H);
      ctx.restore();
    }
  };
  redactDrawFnRef.current = drawRedact;

  useEffect(() => {
    if (mode !== 'redact' || !redactSource?.imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      redactImgRef.current = img;
      const canvas = redactCanvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      redactDrawFnRef.current?.(null);
    };
    img.src = redactSource.imageDataUrl;
  }, [mode, redactSource]);

  useEffect(() => {
    redactDrawFnRef.current?.(null);
  }, [redactRects, redactMode, redactStrength]);

  const redactPointFromEvent = (e) => {
    const canvas = redactCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clampNum((e.clientX - rect.left) / rect.width, 0, 1),
      y: clampNum((e.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const onRedactDrawMove = useCallback((e) => {
    const d = redactDrawRef.current;
    const canvas = redactCanvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    const pr = { x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w: Math.abs(cx - d.startX), h: Math.abs(cy - d.startY) };
    redactDrawFnRef.current?.(pr);
  }, []);

  const onRedactDrawUp = useCallback((e) => {
    const d = redactDrawRef.current;
    redactDrawRef.current = null;
    window.removeEventListener('mousemove', onRedactDrawMove);
    window.removeEventListener('mouseup', onRedactDrawUp);
    const canvas = redactCanvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    const pr = { x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w: Math.abs(cx - d.startX), h: Math.abs(cy - d.startY) };
    if (pr.w > 0.01 && pr.h > 0.01) {
      const before = redactRectsRef.current;
      setRedactPast(p => [...p, before].slice(-20));
      setRedactFuture([]);
      setRedactRects(prev => [...prev, pr]);
    } else redactDrawFnRef.current?.(null);
  }, [onRedactDrawMove]);

  const onRedactDown = (e) => {
    const p = redactPointFromEvent(e);
    if (!p) return;
    e.preventDefault();
    redactDrawRef.current = { startX: p.x, startY: p.y };
    window.addEventListener('mousemove', onRedactDrawMove);
    window.addEventListener('mouseup', onRedactDrawUp);
  };

  const exportRedact = () => {
    const canvas = redactCanvasRef.current;
    if (!canvas) return;
    drawRedact(null);
    const url = canvas.toDataURL('image/png');
    setRedactExport(url);
    downloadDataUrl(url, `redacted-${Date.now()}.png`);
  };

  const runOcr = async () => {
    if (!ocrSource?.imageDataUrl) return;
    setOcrBusy(true);
    setOcrError('');
    setOcrText('');
    setOcrProgress(0);
    try {
      const Tesseract = (await import('tesseract.js')).default;
      const result = await Tesseract.recognize(ocrSource.imageDataUrl, ocrLang, {
        logger: (m) => { if (m.status === 'recognizing text') setOcrProgress(Math.round(m.progress * 100)); },
      });
      const text = (result?.data?.text || '').trim();
      setOcrText(text);
      if (!text) setOcrError('No readable text was found in this image.');
    } catch (err) {
      setOcrError(err.message || 'Text extraction failed');
    } finally {
      setOcrBusy(false);
    }
  };

  const copyOcr = () => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(ocrText).catch(() => {});
    setOcrCopied(true);
    setTimeout(() => setOcrCopied(false), 1500);
  };

  const downloadOcr = () => {
    const blob = new Blob([ocrText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted-text-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const loadGallery = () => {
    api.get('/api/graphics/gallery')
      .then(r => r.json())
      .then(d => setGallery(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const formatCost = (cost) => {
    if (!cost) return null;
    if (cost.local) return 'Cost: local (free) · no tokens';
    if (cost.usd == null) return 'Cost: estimate unavailable';
    const mp = cost.megapixels ? ` · ${cost.megapixels} MP` : '';
    return `Cost: ${cost.estimate ? '~' : ''}$${Number(cost.usd).toFixed(4)}${mp} · no tokens (per-image billing)`;
  };

  const buildPrompt = () => {
    const preset = STYLE_PRESETS.find(s => s.id === style);
    return [prompt.trim(), preset?.suffix].filter(Boolean).join(', ');
  };

  const refinePrompt = async () => {
    if (!prompt.trim()) return '';
    setRefining(true);
    setError('');
    try {
      const res = await api.post('/api/graphics/refine', { prompt: buildPrompt() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Prompt refinement failed');
      setRefinedPrompt(data.refinedPrompt || buildPrompt());
      return data.refinedPrompt || buildPrompt();
    } catch (err) {
      setError(err.message || 'Prompt refinement failed');
      return '';
    } finally {
      setRefining(false);
    }
  };

  const checkRestrictions = async (promptText) => {
    const res = await api.post('/api/graphics/preflight', { prompt: promptText });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Content restriction check failed');
    return data;
  };

  const performGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError('');
    setRestrictionWarning(null);
    try {
      setRefinedPrompt('');
      setPreviewImage(null);
      const [genW, genH] = String(size).split('x').map(Number);
      const res = await api.post('/api/graphics/generate', {
        prompt: buildPrompt(),
        width: genW || 512,
        height: genH || 512,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image generation failed');
      setResult(data);
      setRefinedPrompt(data.refinedPrompt || data.prompt || buildPrompt());
    } catch (err) {
      setError(err.message || 'Image generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const generate = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setError('');
    try {
      const preflight = await checkRestrictions(buildPrompt());
      if (preflight.restricted) {
        setRestrictionWarning(preflight);
        return;
      }
      await performGenerate();
    } catch (err) {
      setError(err.message || 'Content restriction check failed');
    }
  };

  const downloadImage = () => {
    if (!result?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = result.imageDataUrl;
    a.download = `graphic-${Date.now()}.png`;
    a.click();
  };

  const selectResult = (item, { openPreview = false } = {}) => {
    if (!item) return;
    setResult(item);
    setRefinedPrompt(item.refinedPrompt || item.prompt || '');
    if (openPreview) setPreviewImage(item);
  };

  const augmentImage = async () => {
    if (!result?.imageDataUrl || !augmentPrompt.trim()) return;
    setAugmenting(true);
    setError('');
    setPreviewImage(null);
    try {
      const res = await api.post('/api/graphics/augment', {
        imageDataUrl: result.imageDataUrl,
        prompt: augmentPrompt.trim(),
        denoise: Number(denoise),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image augmentation failed');
      setResult(data);
      setRefinedPrompt(data.refinedPrompt || data.prompt || '');
      setAugmentPrompt('');
    } catch (err) {
      setError(err.message || 'Image augmentation failed');
    } finally {
      setAugmenting(false);
    }
  };

  const saveToGallery = async () => {
    if (!result?.imageDataUrl) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/api/graphics/gallery', {
        prompt: result.refinedPrompt || result.prompt,
        imageDataUrl: result.imageDataUrl,
        model: result.model,
        seed: result.seed,
        width: result.width,
        height: result.height,
        metadata: {
          image: result.image,
          denoise: result.denoise || null,
          originalPrompt: result.prompt || null,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save image');
      setGallery(prev => [data, ...prev]);
    } catch (err) {
      setError(err.message || 'Failed to save image');
    } finally {
      setSaving(false);
    }
  };

  const deleteGalleryImage = async (id) => {
    await api.delete(`/api/graphics/gallery/${id}`).catch(() => {});
    setGallery(prev => prev.filter(item => item.id !== id));
  };

  const busyStates = [
    [generating, 'Generating image…'],
    [refining, 'Refining image…'],
    [augmenting, 'Creating variations…'],
    [saving, 'Saving…'],
    [upscaling, 'Upscaling…'],
    [converting, 'Converting…'],
    [favBusy, 'Building icon set…'],
    [svgBusy, 'Tracing to SVG…'],
    [compressing, 'Compressing…'],
    [batchRunning, 'Processing batch…'],
    [animBusy, 'Building animation…'],
    [pdfBusy, 'Rendering PDF…'],
    [pipeBusy, 'Running pipeline…'],
    [inpaintBusy, 'Inpainting…'],
    [bgProcessing, 'Updating background…'],
    [recoloring, 'Recolouring…'],
    [crBusy, 'Processing image…'],
    [metaBusy, 'Stripping metadata…'],
    [wmBusy, 'Applying watermark…'],
    [collageBusy, 'Building collage…'],
    [efBusy, 'Applying effect…'],
    [extBusy, 'Extending canvas…'],
    [diffBusy, 'Comparing images…'],
    [adjBusy, 'Applying adjustments…'],
    [ocrBusy, 'Extracting text…'],
    [palBusy, 'Extracting palette…'],
  ];
  const activeBusy = busyStates.find(([flag]) => flag);
  const activeBusyLabel = activeBusy?.[1] || null;

  useEffect(() => {
    if (activeBusyLabel) startProcessing(activeBusyLabel);
    else stopProcessing();
    return () => stopProcessing();
  }, [activeBusyLabel, startProcessing, stopProcessing]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('image', { size: 20 })}
            Graphics
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {mode === 'generate' && 'Generate local article and story support images from a prompt.'}
            {mode === 'upscale' && 'Enlarge artwork and small images while preserving detail.'}
            {mode === 'convert' && 'Convert an image to PNG, JPG, WebP, GIF, AVIF, TIFF or ICO (HEIC input supported where available).'}
            {mode === 'favicon' && 'Generate a full favicon / app-icon set with manifest from one image.'}
            {mode === 'svg' && 'Trace a raster image into a scalable SVG — best for logos, icons and clipart.'}
            {mode === 'iconlib' && 'Generate a cohesive set of custom SVG icons from a subject and reference styles.'}
            {mode === 'compress' && 'Reduce image file sizes and see the savings.'}
            {mode === 'batch' && 'Convert, resize or strip metadata across many images at once.'}
            {mode === 'background' && 'Remove or replace an image background with one click.'}
            {mode === 'recolor' && 'Change the colour of a specific item in an image.'}
            {mode === 'cropresize' && 'Resize by dimensions, or drag the box to crop exactly what you want.'}
            {mode === 'metadata' && 'Strip GPS, camera and timestamp metadata before sharing.'}
            {mode === 'watermark' && 'Add a text or image watermark.'}
            {mode === 'collage' && 'Arrange several images into a grid.'}
            {mode === 'extend' && 'Add padding around the image (white, a colour, or transparent).'}
            {mode === 'annotate' && 'Click to type text right on the image, draw arrows/boxes/freehand, move anything, then save a PNG.'}
            {mode === 'effects' && 'Flip, rotate (90° or any angle), border, round corners, shadow, or a filter (grayscale, sepia, invert, duotone).'}
            {mode === 'adjust' && 'Tune brightness, contrast, colour, levels, gamma, sharpness, blur, noise reduction and vignette.'}
            {mode === 'redact' && 'Draw boxes to blur or pixelate faces, plates or sensitive text.'}
            {mode === 'ocr' && 'Extract text from screenshots, scans and receipts.'}
            {mode === 'palette' && 'Pull the dominant colours out of an image.'}
            {mode === 'diff' && 'Highlight the pixel differences between two images.'}
            {mode === 'picker' && 'Click anywhere on an image to read its colour.'}
            {mode === 'histogram' && 'See the tonal distribution (RGB and luminance) of an image.'}
            {mode === 'contrast' && 'Check colour contrast against WCAG AA / AAA thresholds.'}
            {mode === 'animate' && 'Combine several images into an animated GIF.'}
            {mode === 'pdf2img' && 'Render each page of a PDF to a PNG image.'}
            {mode === 'pipeline' && 'Chain several edits into one repeatable sequence.'}
            {mode === 'inpaint' && 'Paint over an area and let AI fill or replace it.'}
            {mode === 'perspective' && 'Correct keystone / trapezoid distortion with horizontal and vertical shear sliders.'}
            {mode === 'smartcrop' && 'Crop to a target size or aspect ratio, with content-aware focus (attention, entropy, or a fixed direction).'}
            {mode === 'colorgrade' && 'Apply a cinematic colour grade — warm, cool, vintage, fade, noir, and more — in one click.'}
            {mode === 'batchtext' && 'Stamp a text label (with {filename}, {index}, {date} variables) onto many images at once.'}
          </p>
        </div>
        {(mode === 'generate' || mode === 'upscale') && (
          <div
            className="text-xs px-3 py-1.5 rounded-full border"
            style={{
              color: status?.ok ? '#047857' : '#b45309',
              borderColor: status?.ok ? '#bbf7d0' : '#fde68a',
              background: status?.ok ? '#ecfdf5' : '#fffbeb',
            }}
          >
            {statusLabel}
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <aside className="w-full md:w-52 md:shrink-0 md:sticky md:top-6">
          <div className="relative mb-3">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }}>
              {getIcon('search', { size: 14 })}
            </span>
            <input
              ref={toolSearchRef}
              type="text"
              value={toolSearch}
              onChange={e => setToolSearch(e.target.value)}
              placeholder="Search tools...  ( / )"
              className="w-full pl-8 pr-7 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            {toolSearch && (
              <button type="button" onClick={() => setToolSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
                {getIcon('x', { size: 14 })}
              </button>
            )}
          </div>
          <nav className="flex md:block gap-4 md:gap-0 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
            {MODE_GROUPS.map(group => {
              const q = toolSearch.trim().toLowerCase();
              const ids = group.ids.filter(id => {
                const m = MODES.find(x => x.id === id);
                return m && (!q || m.label.toLowerCase().includes(q));
              });
              if (!ids.length) return null;
              const collapsed = q ? false : openGroup !== group.label;
              return (
              <div key={group.label} className="mb-0 md:mb-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setOpenGroup(prev => (prev === group.label ? null : group.label))}
                  className="flex items-center gap-1 w-full px-2 mb-1.5 text-sm font-bold uppercase tracking-wide hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--color-primary)' }}
                >
                  <span style={{ display: 'inline-flex', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>
                    {getIcon('chevron-down', { size: 15 })}
                  </span>
                  {group.label}
                </button>
                {!collapsed && (
                <div className="flex md:flex-col gap-1 md:pl-3 md:ml-1 md:border-l" style={{ borderColor: 'var(--color-border)' }}>
                  {ids.map(id => {
                    const m = MODES.find(x => x.id === id);
                    if (!m) return null;
                    const active = mode === m.id;
                    const hovered = hoveredTool === m.id && !active;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMode(m.id)}
                        onMouseEnter={() => setHoveredTool(m.id)}
                        onMouseLeave={() => setHoveredTool(prev => (prev === m.id ? null : prev))}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors text-left"
                        style={{
                          color: active ? '#fff' : hovered ? 'var(--color-primary)' : 'var(--color-text)',
                          background: active ? 'var(--color-primary)' : hovered ? 'var(--color-bg)' : 'transparent',
                        }}
                      >
                        {getIcon(m.icon, { size: 15 })}
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                )}
              </div>
              );
            })}
          </nav>
          {toolSearch.trim() && !MODES.some(m => m.label.toLowerCase().includes(toolSearch.trim().toLowerCase())) && (
            <p className="px-2 text-xs" style={{ color: 'var(--color-muted)' }}>No tools match “{toolSearch}”.</p>
          )}
        </aside>

        <main className="min-w-0 flex-1 w-full">

      {mode === 'generate' && (
      <div className="grid lg:grid-cols-[1fr_420px] gap-6">
        <form onSubmit={generate} className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
              Image prompt
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={7}
              placeholder="Describe the image you want for the story or article..."
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Style</label>
              <select
                value={style}
                onChange={e => setStyle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {STYLE_PRESETS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Size</label>
              <select
                value={size}
                onChange={e => setSize(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="512x512">Square · 512 × 512 (fastest)</option>
                <option value="768x768">Square · 768 × 768</option>
                <option value="1024x768">Landscape 4:3 · 1024 × 768</option>
                <option value="768x1024">Portrait 4:3 · 768 × 1024</option>
                <option value="1024x576">Landscape 16:9 · 1024 × 576</option>
                <option value="576x1024">Portrait 9:16 · 576 × 1024</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>
              {error}
            </div>
          )}

          {status && !status.ok && (
            <div className="text-xs px-3 py-2 rounded-xl" style={{ color: '#92400e', background: '#fef3c7' }}>
              {status.error || (isHostedProvider ? 'Check the hosted graphics provider configuration before generating images.' : 'Start ComfyUI locally on http://127.0.0.1:8188 before generating images.')}
            </div>
          )}

          <button
            type="submit"
            disabled={generating || !prompt.trim() || status?.ok === false}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity inline-flex items-center gap-2"
            style={{ background: 'var(--color-primary)' }}
          >
            {generating ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sparkles', { size: 15 })}
            {generating ? 'Refining + generating...' : 'Generate Image'}
          </button>
          <button
            type="button"
            onClick={refinePrompt}
            disabled={refining || generating || !prompt.trim()}
            className="ml-2 px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
          >
            {refining ? 'Refining...' : 'Refine Prompt'}
          </button>

          <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Refined prompt sent to image model</p>
            <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
              {refinedPrompt || (prompt.trim() ? 'Click Refine Prompt or Generate Image to create the refined prompt.' : 'Enter a prompt and choose a style.')}
            </p>
          </div>
        </form>

        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
            {result?.imageDataUrl && (
              <div className="flex gap-2">
                <button
                  onClick={saveToGallery}
                  disabled={saving}
                  className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-50"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={downloadImage}
                  className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Download
                </button>
              </div>
            )}
          </div>
          <div className="p-4">
            {result?.imageDataUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => setPreviewImage(result)}
                  className="block w-full"
                >
                  <img
                    src={result.imageDataUrl}
                    alt={result.refinedPrompt || result.prompt}
                    className="w-full rounded-xl border"
                    style={{ borderColor: 'var(--color-border)' }}
                  />
                </button>
                <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                  Seed: {result.seed} · Model: {result.model}
                </p>
                {result.cost && (
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                    {formatCost(result.cost)}
                  </p>
                )}
                {!augmentSupported ? (
                  <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      Variations (image-to-image) require the local ComfyUI provider or a FAL model, so this step is unavailable on the current provider.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 border-t pt-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
                        Augment this image
                      </label>
                      <textarea
                        value={augmentPrompt}
                        onChange={e => setAugmentPrompt(e.target.value)}
                        rows={3}
                        placeholder="e.g. make it more photographic, add sunset lighting, change background..."
                        className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Change strength</label>
                      <select
                        value={denoise}
                        onChange={e => setDenoise(e.target.value)}
                        className="px-2 py-1 rounded-lg border text-xs"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >
                        <option value="0.3">Subtle</option>
                        <option value="0.45">Medium</option>
                        <option value="0.65">Strong</option>
                      </select>
                      <button
                        type="button"
                        onClick={augmentImage}
                        disabled={augmenting || !augmentPrompt.trim()}
                        className="ml-auto text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                        style={{ background: 'var(--color-primary)' }}
                      >
                        {augmenting ? 'Augmenting...' : 'Augment'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
                Your generated image will appear here.
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {mode === 'upscale' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upscale</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {upscaleInfo
              ? `${upscaleInfo.provider === 'local-comfyui' ? 'Local' : 'Hosted'}: ${upscaleModel || upscaleInfo.model || 'not configured'}`
              : 'Checking upscaler...'}
          </span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Fidelity-first upscaling for artwork and small images. Detail is preserved, not invented.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpscaleFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
              {result?.imageDataUrl && (
                <button
                  type="button"
                  onClick={useResultForUpscale}
                  className="mt-2 text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Use current result
                </button>
              )}
            </div>

            {upscaleSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={upscaleSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>{upscaleSource.name}</p>
              </div>
            )}

            {(upscaleInfo?.models?.length > 1) && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Model</label>
                <select
                  value={upscaleModel}
                  onChange={e => setUpscaleModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {upscaleInfo.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
                  Faithful models only sharpen; enhanced models add invented detail.
                </p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Scale</label>
                <select
                  value={upscaleScale}
                  onChange={e => setUpscaleScale(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {(upscaleInfo?.scales || [2, 4]).map(s => <option key={s} value={s}>{s}x</option>)}
                </select>
              </div>
              {/clarity/i.test(upscaleModel) && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fidelity</label>
                  <select
                    value={upscaleFidelity}
                    onChange={e => setUpscaleFidelity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-sm"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="-8">Maximum fidelity</option>
                    <option value="0">Balanced</option>
                    <option value="5">Add detail</option>
                  </select>
                </div>
              )}
            </div>

            {upscaleInfo && !upscaleInfo.configured && (
              <div className="text-xs px-3 py-2 rounded-xl" style={{ color: '#92400e', background: '#fef3c7' }}>
                {upscaleInfo.error || 'Upscaler is not configured.'}
              </div>
            )}
            {upscaleError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>
                {upscaleError}
              </div>
            )}

            <button
              type="button"
              onClick={runUpscale}
              disabled={upscaling || !upscaleSource?.imageDataUrl || upscaleInfo?.configured === false}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {upscaling ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sparkles', { size: 15 })}
              {upscaling ? 'Upscaling...' : 'Upscale image'}
            </button>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upscaled result</span>
              {upscaleResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(upscaleSource?.imageDataUrl, upscaleResult?.imageDataUrl)}
                  {renderSendTo(upscaleResult.imageDataUrl, 'upscaled.png', 'upscale')}
                  {renderExport(upscaleResult.imageDataUrl, 'upscaled')}
                  <button
                    onClick={downloadUpscaled}
                    className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                    style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
            <div className="p-4">
              {upscaleResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(upscaleSource?.imageDataUrl, upscaleResult, { alt: 'upscaled' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {upscaleResult.scale}x · {upscaleResult.model}
                  </p>
                  {upscaleResult.cost && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      {formatCost(upscaleResult.cost)}
                    </p>
                  )}
                </>
              ) : (
                <ResultPlaceholder src={upscaleSource?.imageDataUrl} message="Your upscaled image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'convert' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Convert format</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Convert an image to another format — PNG, JPG, WebP, GIF, AVIF, TIFF or a multi-size ICO. HEIC/HEIF uploads work where the server supports them. Pixels are preserved; only the container changes.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                onChange={e => handleConvertFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setConvertError(err); } else { setConvertResult(null); setConvertError(''); setConvertSource(src); } })} />
              {result?.imageDataUrl && (
                <button
                  type="button"
                  onClick={useResultForConvert}
                  className="mt-1 text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Use current result
                </button>
              )}
            </div>

            {convertSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={convertSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>{convertSource.name}</p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Convert to</label>
                <select
                  value={convertFormat}
                  onChange={e => setConvertFormat(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {convertFormats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              {activeConvertFormat?.lossy && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality</label>
                  <select
                    value={convertQuality}
                    onChange={e => setConvertQuality(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-sm"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="100">Maximum (100)</option>
                    <option value="90">High (90)</option>
                    <option value="80">Balanced (80)</option>
                    <option value="60">Smaller file (60)</option>
                  </select>
                </div>
              )}
            </div>

            {convertError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>
                {convertError}
              </div>
            )}

            <button
              type="button"
              onClick={runConvert}
              disabled={converting || !convertSource?.imageDataUrl}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {converting ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('refresh-cw', { size: 15 })}
              {converting ? 'Converting...' : 'Convert image'}
            </button>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Converted result</span>
              {convertResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(convertSource?.imageDataUrl, convertResult?.imageDataUrl)}
                  {renderSendTo(convertResult.imageDataUrl, `converted.${convertResult.format || 'png'}`, 'convert')}
                  {renderExport(convertResult.imageDataUrl, 'converted')}
                  <button
                    onClick={downloadConverted}
                    className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                    style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
            <div className="p-4">
              {convertResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(convertSource?.imageDataUrl, convertResult, { alt: 'converted' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {String(convertResult.format || '').toUpperCase()}
                    {convertResult.width && convertResult.height ? ` · ${convertResult.width}×${convertResult.height}` : ''}
                    {convertResult.quality != null ? ` · quality ${convertResult.quality}` : ''}
                    {convertResult.bytes != null ? ` · ${formatBytes(convertResult.bytes)}` : ''}
                  </p>
                </>
              ) : (
                <ResultPlaceholder src={convertSource?.imageDataUrl} message="Your converted image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'favicon' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Favicon / app icons</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image (square works best)</label>
              <input type="file" accept="image/*" onChange={e => { setFavResult(null); setFavError(''); loadImageInto(setFavSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {favSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={favSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Generates PNG icons at 16, 32, 48, 64, 180, 192, 256 and 512 px, an <strong>apple-touch-icon</strong>, a <strong>site.webmanifest</strong> and a ready-to-paste <strong>&lt;head&gt;</strong> snippet — bundled as a ZIP.
            </p>
            {favError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{favError}</div>}
            <button type="button" onClick={runFavicon} disabled={favBusy || !favSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {favBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('app-window', { size: 15 })}
              {favBusy ? 'Generating…' : 'Generate icon set'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Icon set</span>
              {favResult?.zipDataUrl && (
                <button onClick={() => downloadDataUrl(favResult.zipDataUrl, 'favicons.zip')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download ZIP</button>
              )}
            </div>
            <div className="p-4">
              {favResult?.zipDataUrl ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    {favResult.sizes.map(s => (
                      <div key={s} className="flex flex-col items-center gap-1">
                        <img src={favSource?.imageDataUrl} alt={`${s}px`} style={{ width: Math.min(64, s), height: Math.min(64, s), objectFit: 'cover', borderRadius: 4, border: '1px solid var(--color-border)' }} />
                        <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{s}px</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{favResult.count} icons · {formatBytes(favResult.bytes)} ZIP</p>
                </div>
              ) : (
                <ResultPlaceholder src={favSource?.imageDataUrl} message="Your icon set will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'svg' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Vectorize to SVG</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setSvgResult(null); setSvgError(''); loadImageInto(setSvgSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {svgSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={svgSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colours: {svgColors}</label>
                <input type="range" min="2" max="64" value={svgColors} onChange={e => setSvgColors(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Detail</label>
                <select value={svgDetail} onChange={e => setSvgDetail(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="smooth">Smooth (fewer points)</option>
                  <option value="medium">Medium</option>
                  <option value="detailed">Detailed (more points)</option>
                </select>
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Traces the image into scalable vector paths. Best for logos, icons and flat clipart — photos become a stylised, posterised look. Large images are scaled down before tracing for speed.</p>
            {svgError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{svgError}</div>}
            <button type="button" onClick={runVectorize} disabled={svgBusy || !svgSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {svgBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('shapes', { size: 15 })}
              {svgBusy ? 'Tracing…' : 'Convert to SVG'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>SVG result</span>
              {svgResult?.imageDataUrl && (
                <button onClick={() => downloadDataUrl(svgResult.imageDataUrl, 'vectorized.svg')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download SVG</button>
              )}
            </div>
            <div className="p-4">
              {svgResult?.imageDataUrl ? (
                <>
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                    <img src={svgResult.imageDataUrl} alt="svg" className="w-full" />
                  </div>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{svgResult.width}×{svgResult.height} · {svgResult.colors} colours · {formatBytes(svgResult.bytes)} SVG</p>
                </>
              ) : (
                <ResultPlaceholder src={svgSource?.imageDataUrl} message="Your SVG will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'iconlib' && (
        <IconLibraryGenerator getIcon={getIcon} />
      )}

      {mode === 'compress' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Compress images</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Reduce file size by re-encoding one or more images at a lower quality. The original format is kept. Drop the quality for bigger savings.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Add images</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={e => { handleCompressFiles(e.target.files); e.target.value = ''; }}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality</label>
              <select
                value={compressQuality}
                onChange={e => setCompressQuality(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="90">High (90)</option>
                <option value="75">Balanced (75)</option>
                <option value="60">Small (60)</option>
                <option value="40">Smallest (40)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runCompressAll}
              disabled={compressing || !compressFiles.some(f => f.imageDataUrl && f.status !== 'done')}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {compressing ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('archive', { size: 15 })}
              {compressing ? 'Compressing...' : 'Compress all'}
            </button>
            {compressFiles.length > 0 && (
              <button
                type="button"
                onClick={clearCompressFiles}
                disabled={compressing}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
              >
                Clear
              </button>
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
                    <button
                      type="button"
                      onClick={() => downloadCompressed(item)}
                      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 flex-shrink-0"
                      style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                    >
                      Download
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeCompressFile(item.id)}
                    disabled={compressing}
                    className="text-xs hover:opacity-70 flex-shrink-0 disabled:opacity-40"
                    style={{ color: '#ef4444' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      {mode === 'batch' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Batch process</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Apply the same operation to many images at once — convert formats, resize, or strip metadata. Each file is processed and downloadable individually.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Add images</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={e => { handleBatchFiles(e.target.files); e.target.value = ''; }}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Operation</label>
              <select
                value={batchOp}
                onChange={e => setBatchOp(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="convert">Convert format</option>
                <option value="resize">Resize</option>
                <option value="strip">Strip metadata</option>
              </select>
            </div>
          </div>

          {batchOp === 'convert' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Target format</label>
                <select value={batchFormat} onChange={e => setBatchFormat(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPG / JPEG</option>
                  <option value="webp">WebP</option>
                  <option value="gif">GIF</option>
                  <option value="avif">AVIF</option>
                  <option value="tiff">TIFF</option>
                  <option value="ico">ICO (favicon)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality (lossy formats): {batchQuality}</label>
                <input type="range" min="1" max="100" value={batchQuality} onChange={e => setBatchQuality(e.target.value)} className="w-full" />
              </div>
            </div>
          )}

          {batchOp === 'resize' && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Width (px)</label>
                <input type="number" min="1" value={batchWidth} onChange={e => setBatchWidth(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Height (px)</label>
                <input type="number" min="1" value={batchHeight} onChange={e => setBatchHeight(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fit</label>
                <select value={batchFit} onChange={e => setBatchFit(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="inside">Inside (fit within)</option>
                  <option value="cover">Cover (fill + crop)</option>
                  <option value="contain">Contain (letterbox)</option>
                  <option value="fill">Fill (stretch)</option>
                  <option value="outside">Outside (cover area)</option>
                </select>
              </div>
            </div>
          )}

          {batchOp === 'strip' && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Removes EXIF, GPS, XMP, IPTC and ICC data from every image. Format and dimensions are preserved.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runBatchAll}
              disabled={batchRunning || !batchFiles.some(f => f.imageDataUrl && f.status !== 'done') || (batchOp === 'resize' && !batchWidth && !batchHeight)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {batchRunning ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('file-stack', { size: 15 })}
              {batchRunning ? 'Processing...' : 'Process all'}
            </button>
            {batchFiles.some(f => f.result?.imageDataUrl) && (
              <button
                type="button"
                onClick={downloadBatchAll}
                disabled={batchRunning}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'transparent' }}
              >
                Download all
              </button>
            )}
            {batchFiles.length > 0 && (
              <button
                type="button"
                onClick={clearBatchFiles}
                disabled={batchRunning}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
              >
                Clear
              </button>
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
                    <button
                      type="button"
                      onClick={() => downloadBatchItem(item)}
                      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 flex-shrink-0"
                      style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                    >
                      Download
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeBatchFile(item.id)}
                    disabled={batchRunning}
                    className="text-xs hover:opacity-70 flex-shrink-0 disabled:opacity-40"
                    style={{ color: '#ef4444' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      {mode === 'background' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Remove / replace background</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{status?.provider === 'local-comfyui' || !isHostedProvider ? 'Local AI' : 'Replicate'}</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              AI cut-out of the foreground subject. Leave the background transparent (PNG) or flatten it onto a solid colour.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input
                type="file"
                accept="image/*"
                onChange={e => handleBgFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setBgError(err); } else { setBgResult(null); setBgError(''); setBgSource(src); } })} />
            </div>

            {bgSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={bgSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>{bgSource.name}</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background</label>
              <div className="flex items-center gap-3">
                <select
                  value={bgMode}
                  onChange={e => setBgMode(e.target.value)}
                  className="px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="transparent">Transparent</option>
                  <option value="color">Solid colour</option>
                  <option value="gradient">Blended colours</option>
                  <option value="image">Image</option>
                </select>
                {bgMode === 'color' && (
                  <>
                    <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                    <input
                      type="text"
                      value={bgColor}
                      onChange={e => setBgColor(e.target.value)}
                      className="w-24 px-2 py-2 rounded-xl border text-sm"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                  </>
                )}
              </div>
              {bgMode === 'gradient' && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>From</span>
                      <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>To</span>
                      <input type="color" value={bgColor2} onChange={e => setBgColor2(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                    </div>
                    <select
                      value={bgGradientDir}
                      onChange={e => setBgGradientDir(e.target.value)}
                      className="px-3 py-2 rounded-xl border text-sm"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      <option value="to-bottom">Top → bottom</option>
                      <option value="to-top">Bottom → top</option>
                      <option value="to-right">Left → right</option>
                      <option value="to-left">Right → left</option>
                      <option value="to-bottom-right">Diagonal ↘</option>
                      <option value="to-bottom-left">Diagonal ↙</option>
                      <option value="radial">Radial</option>
                    </select>
                  </div>
                  <div
                    className="h-12 rounded-xl border"
                    style={{
                      borderColor: 'var(--color-border)',
                      background: bgGradientDir === 'radial'
                        ? `radial-gradient(circle, ${bgColor}, ${bgColor2})`
                        : `linear-gradient(${{ 'to-bottom': 'to bottom', 'to-top': 'to top', 'to-right': 'to right', 'to-left': 'to left', 'to-bottom-right': 'to bottom right', 'to-bottom-left': 'to bottom left' }[bgGradientDir]}, ${bgColor}, ${bgColor2})`,
                    }}
                  />
                </div>
              )}
              {bgMode === 'image' && (
                <div className="mt-2 space-y-2">
                  <input type="file" accept="image/*" onChange={e => { setBgError(''); loadImageInto(setBgImage)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
                  {bgImage?.imageDataUrl && (
                    <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <img src={bgImage.imageDataUrl} alt="background" className="max-h-28 mx-auto rounded-lg" />
                      <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>Background — scaled to cover the subject</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {bgError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{bgError}</div>
            )}

            <button
              type="button"
              onClick={runRemoveBg}
              disabled={bgProcessing || !bgSource?.imageDataUrl}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {bgProcessing ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon(bgMode === 'transparent' ? 'scissors' : 'refresh-cw', { size: 15 })}
              {bgProcessing
                ? (bgMode === 'transparent' ? 'Removing...' : 'Updating...')
                : (bgMode === 'transparent' ? 'Remove background' : 'Update background')}
            </button>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {bgResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(bgSource?.imageDataUrl, bgResult?.imageDataUrl)}
                  {renderSendTo(bgResult.imageDataUrl, 'cutout.png', 'background')}
                  {renderExport(bgResult.imageDataUrl, 'cutout')}
                  <button onClick={downloadBg} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {bgResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(bgSource?.imageDataUrl, bgResult, { transparent: true, alt: 'result' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {bgResult.background === 'transparent' ? 'Transparent PNG' : `Background ${bgResult.background}`}
                    {bgResult.width && bgResult.height ? ` · ${bgResult.width}×${bgResult.height}` : ''}
                  </p>
                  {bgResult.cost && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{formatCost(bgResult.cost)}</p>
                  )}
                </>
              ) : (
                <ResultPlaceholder src={bgSource?.imageDataUrl} message="Your cut-out image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'recolor' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Recolor an item</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Shift the colour of a specific item. Pick the colour to change (click the image to sample it), set how broad the match is, and choose the new colour. Shading is preserved.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input
                type="file"
                accept="image/*"
                onChange={e => handleRecolorFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
            </div>

            {recolorSource?.imageDataUrl && (
              <div className="rounded-xl border p-2 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Zoom</span>
                  <input type="range" min="1" max="6" step="1" value={recolorZoom} onChange={e => setRecolorZoom(e.target.value)} className="flex-1 min-w-[80px]" />
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-muted)' }}>{recolorZoom}x</span>
                  <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    <span className="inline-block h-4 w-4 rounded border" style={{ background: recolorHoverHex || 'transparent', borderColor: 'var(--color-border)' }} />
                    {recolorHoverHex || '—'}
                  </span>
                </div>
                <div ref={recolorScrollRef} style={{ overflow: 'auto', maxHeight: 360 }}>
                  <canvas
                    ref={recolorCanvasRef}
                    onMouseDown={handleRecolorMouseDown}
                    onMouseMove={handleRecolorMouseMove}
                    onMouseUp={handleRecolorMouseUp}
                    onMouseLeave={handleRecolorMouseLeave}
                    className="rounded-lg"
                    style={{ display: 'block', width: `${Number(recolorZoom) * 100}%`, imageRendering: Number(recolorZoom) > 1 ? 'pixelated' : 'auto', cursor: Number(recolorZoom) > 1 ? 'grab' : 'crosshair' }}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <canvas
                    ref={loupeCanvasRef}
                    width={104}
                    height={104}
                    className="rounded border flex-shrink-0"
                    style={{ width: 104, height: 104, borderColor: 'var(--color-border)', background: 'var(--color-bg)', visibility: loupeVisible ? 'visible' : 'hidden' }}
                  />
                  <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    <p>Hover to magnify, click to set the colour. When zoomed, drag to pan.</p>
                    <p className="mt-1 inline-flex items-center gap-1">
                      Selected:
                      <span className="inline-block h-4 w-4 rounded border align-middle" style={{ background: recolorSrcColor, borderColor: 'var(--color-border)' }} />
                      {recolorSrcColor}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour to change</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={recolorSrcColor} onChange={e => setRecolorSrcColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                  <input type="text" value={recolorSrcColor} onChange={e => setRecolorSrcColor(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>New colour</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={recolorTargetColor} onChange={e => setRecolorTargetColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                  <input type="text" value={recolorTargetColor} onChange={e => setRecolorTargetColor(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Replacement style</label>
              <select
                value={recolorMode}
                onChange={e => setRecolorMode(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="match">Match new colour (brighten / darken to target)</option>
                <option value="preserve">Preserve original shading (hue only)</option>
              </select>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
                {recolorMode === 'match'
                  ? 'Shifts brightness toward the new colour so dark items can become light. Keeps relative shading.'
                  : 'Only changes the hue/saturation and keeps each pixel as bright as the original.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Match tolerance: {recolorTolerance}</label>
              <input type="range" min="0" max="100" value={recolorTolerance} onChange={e => setRecolorTolerance(e.target.value)} className="w-full" />
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Higher = recolours a wider range of similar colours.</p>
            </div>

            {recolorError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{recolorError}</div>
            )}

            <button
              type="button"
              onClick={runRecolor}
              disabled={recoloring || !recolorSource?.imageDataUrl}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {recoloring ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('palette', { size: 15 })}
              {recoloring ? 'Recolouring...' : 'Apply recolour'}
            </button>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {recolorResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(recolorSource?.imageDataUrl, recolorResult?.imageDataUrl)}
                  {renderSendTo(recolorResult.imageDataUrl, 'recoloured.png', 'recolor')}
                  {renderExport(recolorResult.imageDataUrl, 'recoloured')}
                  <button onClick={downloadRecolor} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {recolorResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(recolorSource?.imageDataUrl, recolorResult, { alt: 'recoloured' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    Recoloured {recolorResult.matchedPct}% of pixels ({recolorResult.matchedPixels?.toLocaleString?.() || recolorResult.matchedPixels} px)
                  </p>
                </>
              ) : (
                <ResultPlaceholder src={recolorSource?.imageDataUrl} message="Your recoloured image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'cropresize' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Crop / Resize</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="grow min-w-[220px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
            <input type="file" accept="image/*" onChange={e => { setCrResult(null); setCrError(''); setCrNat(null); loadImageInto(setCrSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            <div className="mt-2"><UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setCrError(err); } else { setCrResult(null); setCrError(''); setCrNat(null); setCrSource(src); } })} /></div>
          </div>
          <div className="flex gap-2 self-end">
            {['resize', 'crop'].map(o => (
              <button key={o} type="button" onClick={() => setCrOp(o)} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: crOp === o ? 'var(--color-primary)' : 'transparent', color: crOp === o ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>
                {o === 'resize' ? 'Resize' : 'Crop'}
              </button>
            ))}
          </div>
        </div>

        {crOp === 'resize' ? (
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            {crSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={crSource.imageDataUrl} alt="source" className="max-h-56 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Preset size</label>
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [w, h] = e.target.value.split('x');
                  setCrWidth(w);
                  setCrHeight(h);
                  setCrFit('cover');
                  e.target.value = '';
                }}
                className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="">Choose a social / web size…</option>
                {SIZE_PRESETS.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map(it => <option key={it.label} value={`${it.w}x${it.h}`}>{it.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Width (px)</label>
                <input type="number" value={crWidth} onChange={e => setCrWidth(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Height (px)</label>
                <input type="number" value={crHeight} onChange={e => setCrHeight(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fit</label>
                <select value={crFit} onChange={e => setCrFit(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="inside">Inside (keep aspect)</option>
                  <option value="cover">Cover (fill, crop)</option>
                  <option value="contain">Contain (letterbox)</option>
                  <option value="fill">Fill (stretch)</option>
                </select>
              </div>
            </div>
            {crError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{crError}</div>}
            <button type="button" onClick={runCropResize} disabled={crBusy || !crSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {crBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('crop', { size: 15 })}
              {crBusy ? 'Working...' : 'Resize image'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {crResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(crResult.imageDataUrl, `image-${crResult.width}x${crResult.height}.${crResult.format}`, 'cropresize')}
                  {renderExport(crResult.imageDataUrl, `image-${crResult.width}x${crResult.height}`)}
                  <button onClick={() => downloadDataUrl(crResult.imageDataUrl, `image-${crResult.width}x${crResult.height}.${crResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {crResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(crResult)} className="block w-full"><img src={crResult.imageDataUrl} alt="result" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{crResult.width}×{crResult.height} · {String(crResult.format).toUpperCase()} · {formatBytes(crResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={crSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
        ) : (
        <div className="space-y-4">
          {!crSource?.imageDataUrl ? (
            <div className="rounded-2xl border flex items-center justify-center text-sm text-center px-6 py-20" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose a source image above to start cropping.</div>
          ) : (
            <>
              <div className="rounded-2xl border p-3 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Lock ratio</label>
                  <select value={crAspect} onChange={e => onCrAspectChange(e.target.value)} className="px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    {CR_ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => onCrAspectChange(crAspect)} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset selection</button>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Selection: {crNat ? `${Math.round(crCrop.w * crNat.w)} × ${Math.round(crCrop.h * crNat.h)} px` : '…'}
                </span>
                <div className="grow" />
                {crError && <span className="text-xs" style={{ color: '#dc2626' }}>{crError}</span>}
                <button type="button" onClick={runCropResize} disabled={crBusy || !crNat} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                  {crBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('crop', { size: 15 })}
                  {crBusy ? 'Cropping...' : 'Crop image'}
                </button>
              </div>

              <div className="rounded-2xl border p-4 flex justify-center" style={{ borderColor: 'var(--color-border)', background: '#1e1e1e' }}>
                <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, maxWidth: '100%' }}>
                  <img
                    ref={crImgRef}
                    src={crSource.imageDataUrl}
                    alt="crop source"
                    onLoad={onCrImgLoad}
                    draggable={false}
                    style={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', userSelect: 'none', borderRadius: 6 }}
                  />
                  {/* Dim overlay outside the selection */}
                  <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: `${crCrop.y * 100}%`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: 0, top: `${(crCrop.y + crCrop.h) * 100}%`, width: '100%', bottom: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: 0, top: `${crCrop.y * 100}%`, width: `${crCrop.x * 100}%`, height: `${crCrop.h * 100}%`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: `${(crCrop.x + crCrop.w) * 100}%`, top: `${crCrop.y * 100}%`, right: 0, height: `${crCrop.h * 100}%`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  {/* Selection box */}
                  <div
                    onMouseDown={beginCrDrag('move')}
                    style={{
                      position: 'absolute',
                      left: `${crCrop.x * 100}%`,
                      top: `${crCrop.y * 100}%`,
                      width: `${crCrop.w * 100}%`,
                      height: `${crCrop.h * 100}%`,
                      border: '2px solid #fff',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.4)',
                      cursor: 'move',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* rule-of-thirds guides */}
                    <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    {CR_HANDLES.filter(hn => crAspect === 'free' || hn.length === 2).map(hn => {
                      const left = hn.includes('w') ? '0%' : hn.includes('e') ? '100%' : '50%';
                      const top = hn.includes('n') ? '0%' : hn.includes('s') ? '100%' : '50%';
                      return (
                        <div
                          key={hn}
                          onMouseDown={beginCrDrag(hn)}
                          style={{
                            position: 'absolute',
                            left,
                            top,
                            width: 16,
                            height: 16,
                            transform: 'translate(-50%, -50%)',
                            background: '#fff',
                            border: '2px solid var(--color-primary)',
                            borderRadius: 3,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
                            cursor: CR_CURSOR[hn],
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              {crResult?.imageDataUrl && (
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result · {crResult.width}×{crResult.height} · {formatBytes(crResult.bytes)}</span>
                    <div className="flex items-center gap-2">
                      {renderSendTo(crResult.imageDataUrl, `crop-${crResult.width}x${crResult.height}.${crResult.format}`, 'cropresize')}
                      {renderExport(crResult.imageDataUrl, `crop-${crResult.width}x${crResult.height}`)}
                      <button onClick={() => downloadDataUrl(crResult.imageDataUrl, `crop-${crResult.width}x${crResult.height}.${crResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                    </div>
                  </div>
                  <div className="p-4">
                    <button type="button" onClick={() => setPreviewImage(crResult)} className="block max-w-full"><img src={crResult.imageDataUrl} alt="result" className="max-h-80 rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </section>
      )}

      {mode === 'metadata' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Remove metadata</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Strips EXIF, GPS location, camera info, timestamps and colour profiles. Orientation is baked in so the image still displays correctly.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={async e => {
                const file = e.target.files?.[0];
                setMetaResult(null); setMetaError(''); setMetaInfo(null);
                if (!file) return;
                const dataUrl = await readFileAsDataUrl(file).catch(() => null);
                if (!dataUrl) { setMetaError('Could not read that image file.'); return; }
                setMetaSource({ imageDataUrl: dataUrl, name: file.name });
                loadMetaInfo(dataUrl);
              }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
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
            <button type="button" onClick={runStripMetadata} disabled={metaBusy || !metaSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {metaBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('shield', { size: 15 })}
              {metaBusy ? 'Cleaning...' : 'Remove metadata'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Cleaned image</span>
              {metaResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(metaSource?.imageDataUrl, metaResult?.imageDataUrl)}
                  {renderSendTo(metaResult.imageDataUrl, `clean.${metaResult.format}`, 'metadata')}
                  {renderExport(metaResult.imageDataUrl, 'clean')}
                  <button onClick={() => downloadDataUrl(metaResult.imageDataUrl, `clean-${Date.now()}.${metaResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
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
      )}

      {mode === 'watermark' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Watermark</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setWmResult(null); setWmError(''); loadImageInto(setWmSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {wmSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={wmSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="flex gap-2">
              {['text', 'image'].map(t => (
                <button key={t} type="button" onClick={() => setWmType(t)} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: wmType === t ? 'var(--color-primary)' : 'transparent', color: wmType === t ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>
                  {t === 'text' ? 'Text' : 'Image'}
                </button>
              ))}
            </div>
            {wmType === 'text' ? (
              <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Watermark text</label>
                  <input type="text" value={wmText} onChange={e => setWmText(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour</label>
                  <input type="color" value={wmColor} onChange={e => setWmColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Watermark image (PNG)</label>
                  <input type="file" accept="image/*" onChange={e => loadImageInto(setWmImage)(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Size: {wmScale}% of width</label>
                  <input type="range" min="5" max="100" value={wmScale} onChange={e => setWmScale(e.target.value)} className="w-full" />
                </div>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Position</label>
                <select value={wmPosition} onChange={e => setWmPosition(e.target.value)} disabled={wmTile} className="w-full px-3 py-2 rounded-xl border text-sm disabled:opacity-50" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-right">Top right</option>
                  <option value="top-left">Top left</option>
                  <option value="center">Centre</option>
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(Number(wmOpacity) * 100)}%</label>
                <input type="range" min="0" max="1" step="0.05" value={wmOpacity} onChange={e => setWmOpacity(e.target.value)} className="w-full" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={wmTile} onChange={e => setWmTile(e.target.checked)} /> Tile across the whole image
            </label>
            {wmError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{wmError}</div>}
            <button type="button" onClick={runWatermark} disabled={wmBusy || !wmSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {wmBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('droplets', { size: 15 })}
              {wmBusy ? 'Applying...' : 'Add watermark'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {wmResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(wmSource?.imageDataUrl, wmResult?.imageDataUrl)}
                  {renderSendTo(wmResult.imageDataUrl, `watermarked.${wmResult.format}`, 'watermark')}
                  {renderExport(wmResult.imageDataUrl, 'watermarked')}
                  <button onClick={() => downloadDataUrl(wmResult.imageDataUrl, `watermarked-${Date.now()}.${wmResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {wmResult?.imageDataUrl ? (
                renderResultMedia(wmSource?.imageDataUrl, wmResult, { alt: 'result' })
              ) : <ResultPlaceholder src={wmSource?.imageDataUrl} message="Your watermarked image will appear here." />}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'collage' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Collage / grid maker</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Images (2–9)</label>
              <input type="file" accept="image/*" multiple onChange={e => { setCollageResult(null); setCollageError(''); handleCollageFiles(e.target.files); e.target.value = ''; }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {collageFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {collageFiles.map(f => (
                  <div key={f.id} className="relative">
                    <img src={f.imageDataUrl} alt="" className="h-14 w-14 rounded object-cover border" style={{ borderColor: 'var(--color-border)' }} />
                    <button type="button" onClick={() => setCollageFiles(prev => prev.filter(x => x.id !== f.id))} className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full text-[10px] leading-none text-white" style={{ background: '#ef4444' }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Columns</label>
                <select value={collageColumns} onChange={e => setCollageColumns(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  {[1, 2, 3, 4, 5].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Spacing: {collageSpacing}px</label>
                <input type="range" min="0" max="60" value={collageSpacing} onChange={e => setCollageSpacing(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background</label>
                <input type="color" value={collageBg} onChange={e => setCollageBg(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
              </div>
            </div>
            {collageError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{collageError}</div>}
            <button type="button" onClick={runCollage} disabled={collageBusy || collageFiles.length < 2} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {collageBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('grid', { size: 15 })}
              {collageBusy ? 'Building...' : 'Make collage'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {collageResult?.imageDataUrl && <button onClick={() => downloadDataUrl(collageResult.imageDataUrl, `collage-${Date.now()}.png`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>}
            </div>
            <div className="p-4">
              {collageResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(collageResult)} className="block w-full"><img src={collageResult.imageDataUrl} alt="collage" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{collageResult.count} images · {collageResult.columns}×{collageResult.rows} · {collageResult.width}×{collageResult.height}</p>
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Your collage will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'annotate' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Annotate</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free · never uploaded</span>
        </div>
        <div className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="grow min-w-[200px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
            <input type="file" accept="image/*" onChange={e => { setAnnShapes([]); setAnnSelected(null); setAnnEditing(null); setAnnPast([]); setAnnFuture([]); annImgRef.current = null; loadImageInto(setAnnSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
          </div>
          <div className="flex gap-2 self-end">
            {[['select', 'Select / Move'], ['text', 'Text'], ['arrow', 'Arrow'], ['rect', 'Box'], ['pen', 'Pen']].map(([t, label]) => (
              <button key={t} type="button" onClick={() => { setAnnTool(t); if (t !== 'select') setAnnSelected(null); }} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: annTool === t ? 'var(--color-primary)' : 'transparent', color: annTool === t ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>{label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 self-end">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Colour</label>
            <input type="color" value={annColor} onChange={e => { setAnnColor(e.target.value); setAnnEditing(cur => (cur ? { ...cur, color: e.target.value } : cur)); if (annSelected != null) setAnnShapes(prev => prev.map((s, i) => (i === annSelected ? { ...s, color: e.target.value } : s))); }} className="h-8 w-10 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
          </div>
          <div className="self-end min-w-[160px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Font</label>
            <select
              value={annFont}
              onChange={e => {
                const fam = e.target.value;
                setAnnFont(fam);
                loadGoogleFont(fam).then(() => annDrawFnRef.current?.(null));
                if (annSelected != null && annShapes[annSelected]?.type === 'text') {
                  setAnnShapes(prev => prev.map((s, i) => (i === annSelected ? { ...s, fontFamily: fam } : s)));
                }
              }}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', fontFamily: annFont ? `"${annFont}", sans-serif` : undefined }}
            >
              {ANN_GOOGLE_FONTS.map(f => (
                <option key={f.family} value={f.family}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="self-end min-w-[140px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{annTool === 'text' ? 'Text size' : 'Thickness'}: {annWidth}</label>
            <input type="range" min="1" max="24" value={annWidth} onChange={e => setAnnWidth(Number(e.target.value))} className="w-full" />
          </div>
          <div className="flex gap-2 self-end">
            <button type="button" onClick={deleteAnnSelected} disabled={annSelected == null} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Delete</button>
            <button type="button" onClick={undoAnn} disabled={!annPast.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Undo</button>
            <button type="button" onClick={redoAnn} disabled={!annFuture.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Redo</button>
            <button type="button" onClick={() => { if (!annShapes.length) return; recordAnn(annShapesRef.current); setAnnShapes([]); setAnnSelected(null); }} disabled={!annShapes.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Clear</button>
            <button type="button" onClick={exportAnnotate} disabled={!annSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {getIcon('download', { size: 15 })} Save PNG
            </button>
          </div>
        </div>
        {!annSource?.imageDataUrl ? (
          <div className="rounded-2xl border flex items-center justify-center text-sm text-center px-6 py-20" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose an image to start annotating.</div>
        ) : (
          <div className="rounded-2xl border p-4 flex justify-center" style={{ borderColor: 'var(--color-border)', background: '#1e1e1e' }}>
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
              <canvas
                ref={annCanvasRef}
                onMouseDown={onAnnDown}
                onDoubleClick={onAnnDoubleClick}
                style={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', borderRadius: 6, cursor: annTool === 'text' ? 'text' : annTool === 'select' ? 'move' : 'crosshair', touchAction: 'none' }}
              />
              {annEditing && (
                <textarea
                  ref={annInputRef}
                  rows={Math.max(1, (annEditing.value || '').split('\n').length)}
                  value={annEditing.value}
                  onChange={e => setAnnEditing(cur => (cur ? { ...cur, value: e.target.value } : cur))}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); setAnnEditing(null); }
                    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitAnnEditing(); }
                  }}
                  onBlur={commitAnnEditing}
                  placeholder="Type… (Enter = new line)"
                  spellCheck={false}
                  style={{
                    position: 'absolute',
                    left: `${annEditing.x * 100}%`,
                    top: `${annEditing.y * 100}%`,
                    transform: 'translateY(-2px)',
                    font: `bold ${Math.max(12, annEditing.fontPx * annEditing.scale)}px ${fontFamilyFor(annEditing.fontFamily)}`,
                    lineHeight: 1.25,
                    color: annEditing.color,
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px dashed #3b82f6',
                    borderRadius: 4,
                    padding: '0 4px',
                    outline: 'none',
                    minWidth: 80,
                    width: 'auto',
                    resize: 'none',
                    overflow: 'hidden',
                    whiteSpace: 'pre',
                  }}
                />
              )}
            </div>
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
          {annTool === 'text' && 'Text: click on the image and type. Enter adds a new line; click away (or ⌘/Ctrl+Enter) to place it — it stays selected so you can drag it straight away.'}
          {annTool === 'select' && 'Select / Move: click an item to select it, then drag to move. Double-click text to re-edit. Delete removes the selected item.'}
          {(annTool === 'arrow' || annTool === 'rect' || annTool === 'pen') && 'Drag on the image to draw. Switch to Select / Move to reposition anything.'}
          {' '}Save PNG flattens everything into an image — nothing leaves your browser.
        </p>
      </section>
      )}

      {mode === 'extend' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Canvas extend</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setExtResult(null); setExtError(''); loadImageInto(setExtSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {extSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={extSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={extLink} onChange={e => setExtLink(e.target.checked)} />
              Same padding on all sides
            </label>
            {extLink ? (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Padding (all sides): {extTop}px</label>
                <input type="range" min="0" max="400" value={extTop} onChange={e => setExtAll(e.target.value)} className="w-full" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Top (px)</label>
                  <input type="number" min="0" value={extTop} onChange={e => setExtTop(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Right (px)</label>
                  <input type="number" min="0" value={extRight} onChange={e => setExtRight(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Bottom (px)</label>
                  <input type="number" min="0" value={extBottom} onChange={e => setExtBottom(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Left (px)</label>
                  <input type="number" min="0" value={extLeft} onChange={e => setExtLeft(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={extTransparent} onChange={e => setExtTransparent(e.target.checked)} />
                Transparent padding (PNG)
              </label>
              {!extTransparent && (
                <div className="flex items-center gap-2">
                  <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Fill colour</label>
                  <input type="color" value={extColor} onChange={e => setExtColor(e.target.value)} className="h-8 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                </div>
              )}
            </div>
            {extError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{extError}</div>}
            <button type="button" onClick={runExtend} disabled={extBusy || !extSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {extBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('frame', { size: 15 })}
              {extBusy ? 'Working...' : 'Add padding'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {extResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}.${extResult.format}`, 'extend')}
                  {renderExport(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}`)}
                  <button onClick={() => downloadDataUrl(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}.${extResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {extResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(extResult)} className="block w-full rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                    <img src={extResult.imageDataUrl} alt="result" className="w-full" />
                  </button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{extResult.width}×{extResult.height} · {String(extResult.format).toUpperCase()} · {formatBytes(extResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={extSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'effects' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Effects</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setEfResult(null); setEfError(''); loadImageInto(setEfSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <div className="mt-2"><UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setEfError(err); } else { setEfResult(null); setEfError(''); setEfSource(src); } })} /></div>
            </div>
            {efSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={efSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Effect</label>
              <select value={efEffect} onChange={e => setEfEffect(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="flip-h">Mirror (flip horizontal)</option>
                <option value="flip-v">Flip vertical</option>
                <option value="rotate-90">Rotate 90° right</option>
                <option value="rotate-270">Rotate 90° left</option>
                <option value="rotate-180">Rotate 180°</option>
                <option value="rotate-free">Rotate by angle…</option>
                <option value="border">Add border</option>
                <option value="round">Round corners</option>
                <option value="shadow">Drop shadow</option>
                <option value="grayscale">Grayscale</option>
                <option value="sepia">Sepia</option>
                <option value="invert">Invert colours</option>
                <option value="duotone">Duotone</option>
              </select>
            </div>
            {efEffect === 'rotate-free' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Angle: {efAngle}°</label>
                  <input type="range" min="-180" max="180" step="1" value={efAngle} onChange={e => setEfAngle(e.target.value)} className="w-full" />
                </div>
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                  <input type="checkbox" checked={efRotateTransparent} onChange={e => setEfRotateTransparent(e.target.checked)} />
                  Transparent corners (PNG)
                </label>
                {!efRotateTransparent && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Corner fill</label>
                    <input type="color" value={efRotateBg} onChange={e => setEfRotateBg(e.target.value)} className="h-8 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                  </div>
                )}
              </div>
            )}
            {efEffect === 'border' && (
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Border width: {efBorderWidth}px</label>
                  <input type="range" min="1" max="200" value={efBorderWidth} onChange={e => setEfBorderWidth(e.target.value)} className="w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour</label>
                  <input type="color" value={efBorderColor} onChange={e => setEfBorderColor(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                </div>
              </div>
            )}
            {efEffect === 'round' && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Corner radius: {efRadius}px</label>
                <input type="range" min="0" max="300" value={efRadius} onChange={e => setEfRadius(e.target.value)} className="w-full" />
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Exports a PNG with transparent corners.</p>
              </div>
            )}
            {efEffect === 'shadow' && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Blur: {efBlur}px</label>
                    <input type="range" min="0" max="120" value={efBlur} onChange={e => setEfBlur(e.target.value)} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(Number(efShadowOpacity) * 100)}%</label>
                    <input type="range" min="0" max="1" step="0.05" value={efShadowOpacity} onChange={e => setEfShadowOpacity(e.target.value)} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Offset X: {efOffsetX}px</label>
                    <input type="range" min="-100" max="100" value={efOffsetX} onChange={e => setEfOffsetX(e.target.value)} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Offset Y: {efOffsetY}px</label>
                    <input type="range" min="-100" max="100" value={efOffsetY} onChange={e => setEfOffsetY(e.target.value)} className="w-full" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Shadow colour</label>
                  <input type="color" value={efShadowColor} onChange={e => setEfShadowColor(e.target.value)} className="h-8 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                </div>
              </div>
            )}
            {efEffect === 'duotone' && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Shadow colour</label>
                  <input type="color" value={efDuoShadow} onChange={e => setEfDuoShadow(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Highlight colour</label>
                  <input type="color" value={efDuoHighlight} onChange={e => setEfDuoHighlight(e.target.value)} className="h-9 w-full rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                </div>
              </div>
            )}
            {efError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{efError}</div>}
            <button type="button" onClick={runEffect} disabled={efBusy || !efSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {efBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('wand', { size: 15 })}
              {efBusy ? 'Applying...' : 'Apply effect'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {efResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(efSource?.imageDataUrl, efResult?.imageDataUrl)}
                  {renderSendTo(efResult.imageDataUrl, `effect.${efResult.format}`, 'effects')}
                  {renderExport(efResult.imageDataUrl, 'effect')}
                  <button onClick={() => downloadDataUrl(efResult.imageDataUrl, `effect-${Date.now()}.${efResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {efResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(efSource?.imageDataUrl, efResult, { transparent: true, alt: 'result' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{efResult.width}×{efResult.height} · {String(efResult.format).toUpperCase()} · {formatBytes(efResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={efSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'adjust' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Adjust</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setAdjResult(null); setAdjError(''); loadImageInto(setAdjSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <div className="mt-2"><UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setAdjError(err); } else { setAdjResult(null); setAdjError(''); setAdjSource(src); } })} /></div>
            </div>
            {adjSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={adjSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Brightness: {Number(adjBrightness).toFixed(2)}</label>
                <input type="range" min="0.3" max="2" step="0.01" value={adjBrightness} onChange={e => setAdjBrightness(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Contrast: {Number(adjContrast).toFixed(2)}</label>
                <input type="range" min="0.3" max="2" step="0.01" value={adjContrast} onChange={e => setAdjContrast(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Saturation: {Number(adjSaturation).toFixed(2)}</label>
                <input type="range" min="0" max="2" step="0.01" value={adjSaturation} onChange={e => setAdjSaturation(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Hue shift: {adjHue}°</label>
                <input type="range" min="0" max="360" step="1" value={adjHue} onChange={e => setAdjHue(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Sharpness: {Number(adjSharpness).toFixed(1)}</label>
                <input type="range" min="0" max="10" step="0.1" value={adjSharpness} onChange={e => setAdjSharpness(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Temperature: {adjTemperature > 0 ? `+${adjTemperature}` : adjTemperature}</label>
                <input type="range" min="-100" max="100" step="1" value={adjTemperature} onChange={e => setAdjTemperature(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Vignette: {adjVignette}%</label>
                <input type="range" min="0" max="100" step="1" value={adjVignette} onChange={e => setAdjVignette(e.target.value)} className="w-full" />
              </div>
              <div className="pt-2 mt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Levels</p>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Black point: {adjBlackPoint}</label>
                <input type="range" min="0" max="254" step="1" value={adjBlackPoint} onChange={e => setAdjBlackPoint(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>White point: {adjWhitePoint}</label>
                <input type="range" min="1" max="255" step="1" value={adjWhitePoint} onChange={e => setAdjWhitePoint(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Gamma (midtones): {Number(adjGamma).toFixed(2)}</label>
                <input type="range" min="1" max="3" step="0.01" value={adjGamma} onChange={e => setAdjGamma(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Blur: {Number(adjBlur).toFixed(1)}</label>
                <input type="range" min="0" max="30" step="0.5" value={adjBlur} onChange={e => setAdjBlur(e.target.value)} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Noise reduction: {adjDenoise > 0 ? `${adjDenoise % 2 === 0 ? Number(adjDenoise) + 1 : adjDenoise}px` : 'off'}</label>
                <input type="range" min="0" max="13" step="1" value={adjDenoise} onChange={e => setAdjDenoise(e.target.value)} className="w-full" />
              </div>
            </div>
            {adjError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{adjError}</div>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={runAdjust} disabled={adjBusy || !adjSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {adjBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sliders', { size: 15 })}
                {adjBusy ? 'Applying...' : 'Apply adjustments'}
              </button>
              <button type="button" onClick={resetAdjust} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset</button>
            </div>
            <div className="pt-3 mt-1 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Presets</p>
              <div className="flex items-center gap-2">
                <input type="text" value={adjPresetName} onChange={e => setAdjPresetName(e.target.value)} placeholder="Preset name" className="flex-1 min-w-0 px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                <button type="button" onClick={saveAdjPreset} disabled={!adjPresetName.trim()} className="px-3 py-2 rounded-xl text-sm border disabled:opacity-50 hover:opacity-80 whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Save current</button>
              </div>
              {adjPresets.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {adjPresets.map(p => (
                    <span key={p.name} className="inline-flex items-center gap-1 rounded-lg border text-xs" style={{ borderColor: 'var(--color-border)' }}>
                      <button type="button" onClick={() => applyAdjPreset(p.name)} className="pl-2 py-1 hover:opacity-70" style={{ color: 'var(--color-text)' }}>{p.name}</button>
                      <button type="button" onClick={() => deleteAdjPreset(p.name)} className="px-1.5 py-1 hover:opacity-70" style={{ color: '#ef4444' }}>×</button>
                    </span>
                  ))}
                </div>
              ) : <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Save the current sliders as a named preset to reuse later.</p>}
            </div>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {adjResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(adjSource?.imageDataUrl, adjResult?.imageDataUrl)}
                  {renderSendTo(adjResult.imageDataUrl, `adjusted.${adjResult.format}`, 'adjust')}
                  {renderExport(adjResult.imageDataUrl, 'adjusted')}
                  <button onClick={() => downloadDataUrl(adjResult.imageDataUrl, `adjusted-${Date.now()}.${adjResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {adjResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(adjSource?.imageDataUrl, adjResult, { alt: 'result' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{adjResult.width}×{adjResult.height} · {String(adjResult.format).toUpperCase()} · {formatBytes(adjResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={adjSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'redact' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Redact</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free · never uploaded</span>
        </div>
        <div className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="grow min-w-[200px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
            <input type="file" accept="image/*" onChange={e => { setRedactRects([]); setRedactExport(null); setRedactPast([]); setRedactFuture([]); redactImgRef.current = null; loadImageInto(setRedactSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
          </div>
          <div className="flex gap-2 self-end">
            {['pixelate', 'blur'].map(m => (
              <button key={m} type="button" onClick={() => setRedactMode(m)} className="px-3 py-1.5 rounded-lg text-xs font-medium border capitalize" style={{ background: redactMode === m ? 'var(--color-primary)' : 'transparent', color: redactMode === m ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>{m}</button>
            ))}
          </div>
          <div className="self-end min-w-[160px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{redactMode === 'blur' ? 'Blur' : 'Block size'}: {redactStrength}px</label>
            <input type="range" min="4" max="60" value={redactStrength} onChange={e => setRedactStrength(Number(e.target.value))} className="w-full" />
          </div>
          <div className="flex gap-2 self-end">
            <button type="button" onClick={undoRedact} disabled={!redactPast.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Undo</button>
            <button type="button" onClick={redoRedact} disabled={!redactFuture.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Redo</button>
            <button type="button" onClick={() => { if (!redactRects.length) return; recordRedact(redactRectsRef.current); setRedactRects([]); }} disabled={!redactRects.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Clear</button>
            <button type="button" onClick={exportRedact} disabled={!redactSource?.imageDataUrl || !redactRects.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {getIcon('download', { size: 15 })} Export PNG
            </button>
          </div>
        </div>
        {!redactSource?.imageDataUrl ? (
          <div className="rounded-2xl border flex items-center justify-center text-sm text-center px-6 py-20" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose an image, then drag boxes over anything you want to hide.</div>
        ) : (
          <div className="rounded-2xl border p-4 flex justify-center" style={{ borderColor: 'var(--color-border)', background: '#1e1e1e' }}>
            <canvas
              ref={redactCanvasRef}
              onMouseDown={onRedactDown}
              style={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', borderRadius: 6, cursor: 'crosshair', touchAction: 'none' }}
            />
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Drag to add a box. Switch between pixelate and blur and adjust strength at any time — all boxes update live. Everything is processed in your browser.</p>
      </section>
      )}

      {mode === 'ocr' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Extract text (OCR)</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setOcrText(''); setOcrError(''); loadImageInto(setOcrSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {ocrSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={ocrSource.imageDataUrl} alt="source" className="max-h-56 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Language</label>
              <select value={ocrLang} onChange={e => setOcrLang(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="eng">English</option>
                <option value="fra">French</option>
                <option value="spa">Spanish</option>
                <option value="deu">German</option>
                <option value="ita">Italian</option>
                <option value="por">Portuguese</option>
              </select>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>The language model (a few MB) downloads once on first use.</p>
            </div>
            {ocrError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{ocrError}</div>}
            <button type="button" onClick={runOcr} disabled={ocrBusy || !ocrSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {ocrBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('type', { size: 15 })}
              {ocrBusy ? (ocrProgress ? `Reading... ${ocrProgress}%` : 'Loading...') : 'Extract text'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden flex flex-col" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Extracted text</span>
              {ocrText && (
                <div className="flex gap-2">
                  <button onClick={copyOcr} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{ocrCopied ? 'Copied' : 'Copy'}</button>
                  <button onClick={downloadOcr} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>.txt</button>
                </div>
              )}
            </div>
            <div className="p-4 grow">
              <textarea value={ocrText} onChange={e => setOcrText(e.target.value)} placeholder="Extracted text will appear here. You can edit it before copying." className="w-full h-72 px-3 py-2 rounded-xl border text-sm resize-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'palette' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Palette</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setPalColors([]); setPalError(''); loadImageInto(setPalSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {palSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={palSource.imageDataUrl} alt="source" className="max-h-56 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Number of colours</label>
              <select value={palCount} onChange={e => setPalCount(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
                <option value={12}>12</option>
              </select>
            </div>
            {palError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{palError}</div>}
            <button type="button" onClick={runPalette} disabled={palBusy || !palSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {palBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('swatch', { size: 15 })}
              {palBusy ? 'Extracting...' : 'Extract palette'}
            </button>
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
                        <button type="button" onClick={() => copyPalette(c.hex)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{palCopied === c.hex ? 'Copied' : 'HEX'}</button>
                        <button type="button" onClick={() => copyPalette(`rgb(${c.r}, ${c.g}, ${c.b})`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{palCopied === `rgb(${c.r}, ${c.g}, ${c.b})` ? 'Copied' : 'RGB'}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Extracted colours will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'diff' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Image diff</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Differences are highlighted in red over a faded version of the first image. The second image is scaled to match the first.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Image A (base)</label>
                <input type="file" accept="image/*" onChange={e => { setDiffResult(null); setDiffError(''); loadImageInto(setDiffA)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
                {diffA?.imageDataUrl && <img src={diffA.imageDataUrl} alt="A" className="mt-2 max-h-28 rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Image B (compare)</label>
                <input type="file" accept="image/*" onChange={e => { setDiffResult(null); setDiffError(''); loadImageInto(setDiffB)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
                {diffB?.imageDataUrl && <img src={diffB.imageDataUrl} alt="B" className="mt-2 max-h-28 rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Sensitivity (threshold): {diffThreshold}</label>
              <input type="range" min="0" max="100" value={diffThreshold} onChange={e => setDiffThreshold(e.target.value)} className="w-full" />
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Lower = more sensitive (flags smaller changes).</p>
            </div>
            {diffError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{diffError}</div>}
            <button type="button" onClick={runDiff} disabled={diffBusy || !diffA?.imageDataUrl || !diffB?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {diffBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('layers', { size: 15 })}
              {diffBusy ? 'Comparing...' : 'Compare images'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Difference</span>
              {diffResult?.imageDataUrl && <button onClick={() => downloadDataUrl(diffResult.imageDataUrl, `diff-${Date.now()}.png`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>}
            </div>
            <div className="p-4">
              {diffResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(diffResult)} className="block w-full"><img src={diffResult.imageDataUrl} alt="diff" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {diffResult.diffPct}% of pixels differ ({diffResult.diffPixels?.toLocaleString?.() || diffResult.diffPixels} px)
                  </p>
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>The difference map will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'picker' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Colour picker</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Image</label>
              <input type="file" accept="image/*" onChange={e => { setPickerHex(null); loadImageInto(setPickerSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            {pickerSource?.imageDataUrl && (
              <div className="rounded-xl border p-2 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Zoom</span>
                  <input type="range" min="1" max="6" step="1" value={pickerZoom} onChange={e => setPickerZoom(e.target.value)} className="flex-1" />
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{pickerZoom}x</span>
                </div>
                <div ref={pickerScrollRef} style={{ overflow: 'auto', maxHeight: 360 }}>
                  <canvas
                    ref={pickerCanvasRef}
                    onMouseDown={handlePickerMouseDown}
                    onMouseMove={handlePickerMouseMove}
                    onMouseUp={handlePickerMouseUp}
                    className="rounded-lg"
                    style={{ display: 'block', width: `${Number(pickerZoom) * 100}%`, imageRendering: Number(pickerZoom) > 1 ? 'pixelated' : 'auto', cursor: Number(pickerZoom) > 1 ? 'grab' : 'crosshair' }}
                  />
                </div>
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Click to sample a colour. When zoomed, drag to pan.</p>
              </div>
            )}
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Sampled colour</span>
            </div>
            <div className="p-4">
              {pickerHex ? (
                <div className="space-y-4">
                  <div className="h-24 rounded-xl border" style={{ background: pickerHex.hex, borderColor: 'var(--color-border)' }} />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-sm" style={{ color: 'var(--color-text)' }}>{pickerHex.hex}</code>
                      <button type="button" onClick={() => copyPicker(pickerHex.hex, 'hex')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{pickerCopied === 'hex' ? 'Copied' : 'Copy'}</button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-sm" style={{ color: 'var(--color-text)' }}>rgb({pickerHex.r}, {pickerHex.g}, {pickerHex.b})</code>
                      <button type="button" onClick={() => copyPicker(`rgb(${pickerHex.r}, ${pickerHex.g}, ${pickerHex.b})`, 'rgb')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{pickerCopied === 'rgb' ? 'Copied' : 'Copy'}</button>
                    </div>
                  </div>
                </div>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Click the image to read a colour.</div>}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'fileinfo' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>File info</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Inspect a file’s size, type, dimensions and other details. Nothing is uploaded — everything is read in your browser.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Choose file</label>
              <input type="file" accept="image/*" onChange={e => inspectFile(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
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
      )}

      {mode === 'blurdetect' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Blur detection</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Analyse image sharpness using Laplacian edge detection. Nothing is uploaded — analysis happens in your browser.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={async e => handleBlurFile(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setBlurError(err); } else { setBlurSource(src); } })} />
            </div>
            {blurSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={blurSource.imageDataUrl} alt="source" className="max-h-48 mx-auto rounded-lg" />
              </div>
            )}
            {blurError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{blurError}</div>}
            <button type="button" onClick={runBlurDetect} disabled={blurBusy || !blurSource?.imageDataUrl} className="w-full px-4 py-2 rounded-xl font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{blurBusy ? 'Analysing…' : 'Analyse'}</button>
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
      )}

      {mode === 'autoenhance' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Auto-enhance</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>One-click intelligent brightness, contrast and saturation adjustments based on image analysis.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={async e => handleAeFile(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setAeError(err); } else { setAeSource(src); } })} />
            </div>
            {aeSource?.imageDataUrl && (
              <ResultPlaceholder src={aeSource.imageDataUrl} message={aeBusy ? 'Enhancing…' : 'Ready to enhance'} />
            )}
            {aeError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{aeError}</div>}
            <button type="button" onClick={runAutoEnhance} disabled={aeBusy || !aeSource?.imageDataUrl} className="w-full px-4 py-2 rounded-xl font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{aeBusy ? 'Enhancing…' : 'Enhance'}</button>
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
      )}

      {mode === 'perspective' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Perspective correct</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Fix keystone / trapezoid distortion by adjusting horizontal and vertical shear. Best for whiteboards, documents and architecture shots taken at an angle.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={async e => { setPersError(''); setPersResult(null); loadImageInto(setPersSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setPersError(err); } else { setPersResult(null); setPersError(''); setPersSource(src); } })} />
            </div>
            {persSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={persSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Horizontal skew: {persHSkew > 0 ? `+${persHSkew}` : persHSkew}</label>
                <input type="range" min="-50" max="50" step="1" value={persHSkew} onChange={e => setPersHSkew(Number(e.target.value))} className="w-full" />
                <div className="flex justify-between text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}><span>Left lean</span><span>0</span><span>Right lean</span></div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Vertical skew: {persVSkew > 0 ? `+${persVSkew}` : persVSkew}</label>
                <input type="range" min="-50" max="50" step="1" value={persVSkew} onChange={e => setPersVSkew(Number(e.target.value))} className="w-full" />
                <div className="flex justify-between text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}><span>Top lean</span><span>0</span><span>Bottom lean</span></div>
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Corner fill</label>
                  <select value={persBg} onChange={e => setPersBg(e.target.value)} className="px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="transparent">Transparent (PNG)</option>
                    <option value="#ffffff">White</option>
                    <option value="#000000">Black</option>
                  </select>
                </div>
                {persBg !== 'transparent' && (
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Custom colour</label>
                    <input type="color" value={persBg.startsWith('#') ? persBg : '#ffffff'} onChange={e => setPersBg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)' }} />
                  </div>
                )}
              </div>
            </div>
            {persError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{persError}</div>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={runPerspective} disabled={persBusy || !persSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {persBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('trapezoid', { size: 15 })}
                {persBusy ? 'Correcting…' : 'Apply correction'}
              </button>
              <button type="button" onClick={() => { setPersHSkew(0); setPersVSkew(0); }} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset</button>
            </div>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {persResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(persSource?.imageDataUrl, persResult?.imageDataUrl)}
                  {renderSendTo(persResult.imageDataUrl, 'corrected.png', 'perspective')}
                  {renderExport(persResult.imageDataUrl, 'corrected')}
                  <button onClick={() => downloadDataUrl(persResult.imageDataUrl, `perspective-${Date.now()}.png`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {persResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(persSource?.imageDataUrl, persResult, { alt: 'corrected' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{persResult.width}×{persResult.height} px</p>
                </>
              ) : <ResultPlaceholder src={persSource?.imageDataUrl} message="Apply correction to see the result." />}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'smartcrop' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Smart crop</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Crop to a target size or aspect ratio. The focus strategy determines which part of the image is kept — <strong>Attention</strong> uses saliency detection, <strong>Entropy</strong> keeps the region with the most visual detail.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={async e => { setScError(''); setScResult(null); loadImageInto(setScSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setScError(err); } else { setScResult(null); setScError(''); setScSource(src); } })} />
            </div>
            {scSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={scSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Focus strategy</label>
                <select value={scFocus} onChange={e => setScFocus(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="attention">Attention (saliency — recommended)</option>
                  <option value="entropy">Entropy (highest detail region)</option>
                  <option value="centre">Centre</option>
                  <option value="north">Top</option>
                  <option value="south">Bottom</option>
                  <option value="west">Left</option>
                  <option value="east">Right</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Aspect ratio (e.g. 16:9, 1:1, 4:5)</label>
                <input type="text" value={scAspect} onChange={e => setScAspect(e.target.value)} placeholder="Leave blank to use width × height" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Width (px)</label>
                  <input type="number" min="1" max="8000" value={scWidth} onChange={e => setScWidth(e.target.value)} placeholder="e.g. 1080" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Height (px)</label>
                  <input type="number" min="1" max="8000" value={scHeight} onChange={e => setScHeight(e.target.value)} placeholder="e.g. 1080" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
              </div>
            </div>
            {scError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{scError}</div>}
            <button type="button" onClick={runSmartCrop} disabled={scBusy || !scSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {scBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('aim', { size: 15 })}
              {scBusy ? 'Cropping…' : 'Smart crop'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {scResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(scResult.imageDataUrl, `cropped.${scResult.format}`, 'smartcrop')}
                  {renderExport(scResult.imageDataUrl, 'cropped')}
                  <button onClick={() => downloadDataUrl(scResult.imageDataUrl, `smartcrop-${Date.now()}.${scResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
                </div>
              )}
            </div>
            <div className="p-4">
              {scResult?.imageDataUrl ? (
                <>
                  <img src={scResult.imageDataUrl} alt="cropped" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{scResult.width}×{scResult.height} · {String(scResult.format).toUpperCase()} · {formatBytes(scResult.bytes)} · focus: {scResult.focus}</p>
                </>
              ) : <ResultPlaceholder src={scSource?.imageDataUrl} message="Choose a target size or aspect ratio, then crop." />}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'colorgrade' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Color grading</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Apply a cinematic colour look via channel recombination and tone mapping. Non-destructive — re-run with a different preset any time.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={async e => { setCgError(''); setCgResult(null); loadImageInto(setCgSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
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
                  <button key={p.id} type="button" onClick={() => setCgPreset(p.id)} className="px-3 py-2 rounded-xl text-xs font-medium border text-left" style={{ background: cgPreset === p.id ? 'var(--color-primary)' : 'var(--color-bg)', color: cgPreset === p.id ? '#fff' : 'var(--color-text)', borderColor: cgPreset === p.id ? 'var(--color-primary)' : 'var(--color-border)' }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {cgError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{cgError}</div>}
            <button type="button" onClick={runColorGrade} disabled={cgBusy || !cgSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {cgBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('palette-2', { size: 15 })}
              {cgBusy ? 'Grading…' : 'Apply grade'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {cgResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(cgSource?.imageDataUrl, cgResult?.imageDataUrl)}
                  {renderSendTo(cgResult.imageDataUrl, `graded.${cgResult.format}`, 'colorgrade')}
                  {renderExport(cgResult.imageDataUrl, 'graded')}
                  <button onClick={() => downloadDataUrl(cgResult.imageDataUrl, `graded-${Date.now()}.${cgResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>
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
      )}

      {mode === 'batchtext' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Batch text</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Stamp a text label onto many images at once. Use <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{filename}'}</code>, <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{index}'}</code>, <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{n}'}</code> or <code className="px-1 rounded" style={{ background: 'var(--color-bg)' }}>{'{date}'}</code> as template variables.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Images (up to 20)</label>
              <input type="file" accept="image/*" multiple onChange={e => addBtImages(e.target.files)} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              {btImages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {btImages.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.imageDataUrl} alt={img.name} className="h-12 w-12 rounded-lg border object-cover" style={{ borderColor: 'var(--color-border)' }} title={img.name} />
                      <button type="button" onClick={() => setBtImages(prev => prev.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: '#ef4444', color: '#fff' }}>×</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setBtImages([])} className="text-xs px-2 py-1 rounded-lg border self-center hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: '#ef4444' }}>Clear all</button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Text template</label>
              <input type="text" value={btText} onChange={e => setBtText(e.target.value)} placeholder="{filename}" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Position</label>
                <select value={btPosition} onChange={e => setBtPosition(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-right">Top right</option>
                  <option value="top-left">Top left</option>
                  <option value="center">Centre</option>
                  <option value="bottom">Bottom centre</option>
                  <option value="top">Top centre</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Font size: {btFontSize}px</label>
                <input type="range" min="8" max="120" step="2" value={btFontSize} onChange={e => setBtFontSize(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Text colour</label>
                <input type="color" value={btColor} onChange={e => setBtColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)' }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(btOpacity * 100)}%</label>
                <input type="range" min="0.1" max="1" step="0.05" value={btOpacity} onChange={e => setBtOpacity(Number(e.target.value))} className="w-full" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background colour (optional — adds a backing rectangle)</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={btBg || '#000000'} onChange={e => setBtBg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)' }} />
                  {btBg ? <button type="button" onClick={() => setBtBg('')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Remove</button> : <span className="text-xs" style={{ color: 'var(--color-muted)' }}>None (text only)</span>}
                </div>
              </div>
            </div>
            {btError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{btError}</div>}
            <button type="button" onClick={runBatchText} disabled={btBusy || !btImages.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {btBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('text', { size: 15 })}
              {btBusy ? `Processing ${btImages.length} image${btImages.length !== 1 ? 's' : ''}…` : `Apply to ${btImages.length || '0'} image${btImages.length !== 1 ? 's' : ''}`}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Results</span>
              {btResults.length > 0 && <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{btResults.filter(r => !r.error).length} of {btResults.length} succeeded</span>}
            </div>
            <div className="p-4">
              {btResults.length > 0 ? (
                <div className="space-y-3">
                  {btResults.map((r, i) => (
                    <div key={i} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      {r.imageDataUrl ? (
                        <img src={r.imageDataUrl} alt={r.name} className="h-14 w-14 rounded-lg border object-cover flex-shrink-0" style={{ borderColor: 'var(--color-border)' }} />
                      ) : (
                        <div className="h-14 w-14 rounded-lg border flex items-center justify-center flex-shrink-0" style={{ borderColor: 'var(--color-border)', background: '#fee2e2' }}>
                          <span className="text-[10px] text-center" style={{ color: '#991b1b' }}>error</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.name}</p>
                        {r.error ? (
                          <p className="text-xs mt-0.5" style={{ color: '#991b1b' }}>{r.error}</p>
                        ) : (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Label: {r.label} · {formatBytes(r.bytes)}</p>
                        )}
                      </div>
                      {r.imageDataUrl && (
                        <button onClick={() => downloadDataUrl(r.imageDataUrl, r.name)} className="text-xs px-2 py-1 rounded-lg border flex-shrink-0 hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>↓</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-sm text-center px-6" style={{ color: 'var(--color-muted)' }}>
                  Add images, configure the label, then apply to see results here.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'histogram' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Histogram</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_520px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>See the tonal distribution of an image. Nothing is uploaded — pixels are read in your browser.</p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const d = await readFileAsDataUrl(f); loadHistogram({ imageDataUrl: d, name: f.name }); } catch { setHistError('Could not read that image.'); } }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setHistError(err); } else { loadHistogram(src); } })} />
            </div>
            {histSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={histSource.imageDataUrl} alt="source" className="max-h-48 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Channel</label>
              <select value={histChannel} onChange={e => setHistChannel(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="rgb">RGB (combined)</option>
                <option value="lum">Luminance</option>
                <option value="r">Red</option>
                <option value="g">Green</option>
                <option value="b">Blue</option>
              </select>
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
      )}

      {mode === 'contrast' && (() => {
        const ratio = contrastRatio(contrastFg, contrastBg);
        const Badge = ({ label, threshold }) => {
          const pass = ratio >= threshold;
          return (
            <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
              <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ color: pass ? '#065f46' : '#991b1b', background: pass ? '#d1fae5' : '#fee2e2' }}>{pass ? 'Pass' : 'Fail'} · ≥{threshold}</span>
            </div>
          );
        };
        return (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Contrast checker</h2>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
          </div>
          <div className="grid lg:grid-cols-[1fr_420px] gap-6">
            <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Check a text/background colour pair against the WCAG 2.1 contrast thresholds.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Text / foreground</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={contrastFg} onChange={e => setContrastFg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                    <input type="text" value={contrastFg} onChange={e => setContrastFg(e.target.value)} className="flex-1 min-w-0 px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={contrastBg} onChange={e => setContrastBg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                    <input type="text" value={contrastBg} onChange={e => setContrastBg(e.target.value)} className="flex-1 min-w-0 px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => { setContrastFg(contrastBg); setContrastBg(contrastFg); }} className="text-xs px-3 py-2 rounded-xl border hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Swap colours</button>
              <div className="rounded-xl border p-5 space-y-2" style={{ background: contrastBg, borderColor: 'var(--color-border)' }}>
                <p style={{ color: contrastFg, fontSize: 24, fontWeight: 700, margin: 0 }}>Large text sample</p>
                <p style={{ color: contrastFg, fontSize: 15, margin: 0 }}>Normal body text sample — the quick brown fox jumps over the lazy dog.</p>
              </div>
            </div>
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              </div>
              <div className="p-4">
                <div className="text-center py-3">
                  <div className="text-4xl font-bold" style={{ color: 'var(--color-text)' }}>{ratio.toFixed(2)}:1</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>contrast ratio</div>
                </div>
                <Badge label="AA · normal text" threshold={4.5} />
                <Badge label="AA · large text (18pt+/14pt bold)" threshold={3} />
                <Badge label="AAA · normal text" threshold={7} />
                <Badge label="AAA · large text" threshold={4.5} />
              </div>
            </div>
          </div>
        </section>
        );
      })()}

      {mode === 'animate' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Animate (GIF)</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Combine several images into an animated GIF. Frames play in the order shown (the first frame sets the size — others are cropped to fit).</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Add frames</label>
              <input type="file" accept="image/*" multiple onChange={e => { handleAnimFrames(e.target.files); e.target.value = ''; }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Frame delay: {animDelay}ms</label>
                <input type="range" min="20" max="2000" step="10" value={animDelay} onChange={e => setAnimDelay(e.target.value)} className="w-full" />
              </div>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                <input type="checkbox" checked={animLoop} onChange={e => setAnimLoop(e.target.checked)} /> Loop forever
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={runAnimate} disabled={animBusy || animFrames.length < 2} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {animBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('film', { size: 15 })}
                {animBusy ? 'Building...' : 'Build GIF'}
              </button>
              {animFrames.length > 0 && (
                <button type="button" onClick={clearAnimFrames} disabled={animBusy} className="px-3 py-2 rounded-xl text-sm border disabled:opacity-50 hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Clear</button>
              )}
            </div>
            {animError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{animError}</div>}
            {animFrames.length === 0 ? (
              <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Add 2 or more frames to animate.</div>
            ) : (
              <div className="space-y-2">
                {animFrames.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <span className="text-[11px] w-5 text-center" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                    <img src={item.imageDataUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" style={{ border: '1px solid var(--color-border)' }} />
                    <p className="text-xs font-medium truncate flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>{item.name}</p>
                    <button type="button" onClick={() => moveAnimFrame(item.id, -1)} disabled={i === 0} className="text-xs px-1.5 py-1 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↑</button>
                    <button type="button" onClick={() => moveAnimFrame(item.id, 1)} disabled={i === animFrames.length - 1} className="text-xs px-1.5 py-1 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↓</button>
                    <button type="button" onClick={() => removeAnimFrame(item.id)} disabled={animBusy} className="text-xs hover:opacity-70 disabled:opacity-40" style={{ color: '#ef4444' }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {animResult?.imageDataUrl && <button onClick={() => downloadDataUrl(animResult.imageDataUrl, `animation-${Date.now()}.gif`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button>}
            </div>
            <div className="p-4">
              {animResult?.imageDataUrl ? (
                <>
                  <img src={animResult.imageDataUrl} alt="animation" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{animResult.frames} frames · {animResult.width}×{animResult.height} · {formatBytes(animResult.bytes)}</p>
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Your animated GIF will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'pdf2img' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>PDF → Images</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Render each page of a PDF to a PNG in your browser — nothing is uploaded. Higher resolution = larger, sharper images.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>PDF file</label>
              <input type="file" accept="application/pdf,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = ''; }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Resolution</label>
              <select value={pdfScale} onChange={e => setPdfScale(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="1">Screen (1×)</option>
                <option value="2">High (2×)</option>
                <option value="3">Very high (3×)</option>
                <option value="4">Print (4×)</option>
              </select>
            </div>
          </div>
          {pdfError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{pdfError}</div>}
          {pdfPages.length > 0 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={downloadPdfAll} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Download all ({pdfPages.length})</button>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{pdfBusy ? 'Rendering…' : `${pdfPages.length} page${pdfPages.length === 1 ? '' : 's'}`}</span>
            </div>
          )}
          {pdfPages.length === 0 ? (
            <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{pdfBusy ? 'Rendering pages…' : 'Choose a PDF to render its pages.'}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {pdfPages.map(item => (
                <div key={item.id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <button type="button" onClick={() => setPreviewImage({ imageDataUrl: item.dataUrl })} className="block w-full"><img src={item.dataUrl} alt={`page ${item.page}`} className="w-full" /></button>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Page {item.page}</span>
                    <button type="button" onClick={() => downloadPdfPage(item)} className="text-[11px] px-2 py-0.5 rounded border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Save</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      {mode === 'pipeline' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Pipeline</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Build a sequence of edits and apply them in order, in one pass. Up to 12 steps.</p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => { setPipeResult(null); setPipeError(''); loadImageInto(setPipeSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setPipeError(err); } else { setPipeResult(null); setPipeError(''); setPipeSource(src); } })} />
            </div>
            {pipeSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={pipeSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <select value={pipeStepOp} onChange={e => setPipeStepOp(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {Object.entries(PIPE_OP_DEFS).map(([id, d]) => <option key={id} value={id}>{d.label}</option>)}
              </select>
              <button type="button" onClick={addPipeStep} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80 whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>+ Add step</button>
            </div>
            {pipeSteps.length === 0 ? (
              <div className="rounded-xl border px-4 py-5 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>No steps yet — add one above.</div>
            ) : (
              <div className="space-y-2">
                {pipeSteps.map((s, i) => {
                  const def = PIPE_OP_DEFS[s.op] || {};
                  return (
                    <div key={s.id} className="rounded-xl border px-3 py-2 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] w-5 text-center" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                        <span className="text-sm font-medium flex-1" style={{ color: 'var(--color-text)' }}>{def.label || s.op}</span>
                        <button type="button" onClick={() => movePipeStep(s.id, -1)} disabled={i === 0} className="text-xs px-1.5 py-0.5 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↑</button>
                        <button type="button" onClick={() => movePipeStep(s.id, 1)} disabled={i === pipeSteps.length - 1} className="text-xs px-1.5 py-0.5 rounded border disabled:opacity-30 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>↓</button>
                        <button type="button" onClick={() => removePipeStep(s.id)} className="text-xs hover:opacity-70" style={{ color: '#ef4444' }}>Remove</button>
                      </div>
                      {def.param && (
                        <div className="flex items-center gap-2">
                          <input type="range" min={def.param.min} max={def.param.max} step={def.param.step} value={s.op === 'resize' ? s.width : s.value} onChange={e => updatePipeStep(s.id, s.op === 'resize' ? { width: e.target.value } : { value: e.target.value })} className="flex-1" />
                          <span className="text-[11px] w-12 text-right" style={{ color: 'var(--color-muted)' }}>{s.op === 'resize' ? `${s.width}px` : Number(s.value).toFixed(def.param.step < 1 ? 2 : 0)}</span>
                        </div>
                      )}
                      {def.color && (
                        <input type="color" value={s.color} onChange={e => updatePipeStep(s.id, { color: e.target.value })} className="h-7 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {pipeError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{pipeError}</div>}
            <button type="button" onClick={runPipeline} disabled={pipeBusy || !pipeSource?.imageDataUrl || !pipeSteps.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {pipeBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('workflow', { size: 15 })}
              {pipeBusy ? 'Running...' : 'Run pipeline'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {pipeResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(pipeResult.imageDataUrl, `pipeline.${pipeResult.format}`, 'pipeline')}
                  {renderExport(pipeResult.imageDataUrl, 'pipeline')}
                </div>
              )}
            </div>
            <div className="p-4">
              {pipeResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(pipeResult)} className="block w-full"><img src={pipeResult.imageDataUrl} alt="pipeline result" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{pipeResult.steps} step{pipeResult.steps === 1 ? '' : 's'} · {pipeResult.width}×{pipeResult.height} · {formatBytes(pipeResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={pipeSource?.imageDataUrl} message="Your processed image will appear here." />}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'inpaint' && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Inpaint / Remove</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Hosted (FAL) · paid</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Paint over an area, then describe what should be there. The model repaints just the masked region. Requires the FAL image provider.</p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <input type="file" accept="image/*" onChange={e => loadImageInto(loadInpaint)(e.target.files?.[0])} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} />
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setInpaintError(err); } else { loadInpaint(src); } })} />
            </div>
            {inpaintSource?.imageDataUrl && (
              <div className="space-y-2">
                <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <canvas
                    ref={inpaintCanvasRef}
                    onMouseDown={onInpaintDown}
                    onMouseMove={onInpaintMove}
                    onMouseUp={onInpaintUp}
                    onMouseLeave={onInpaintUp}
                    className="w-full rounded-lg"
                    style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
                  />
                  <canvas ref={inpaintMaskRef} style={{ display: 'none' }} />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Brush</span>
                  <input type="range" min="6" max="120" step="2" value={inpaintBrush} onChange={e => setInpaintBrush(e.target.value)} className="flex-1" />
                  <span className="text-[11px] w-8 text-right" style={{ color: 'var(--color-muted)' }}>{inpaintBrush}</span>
                  <button type="button" onClick={clearInpaintMask} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Clear mask</button>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>What should fill the area?</label>
              <textarea value={inpaintPrompt} onChange={e => setInpaintPrompt(e.target.value)} rows={2} placeholder="e.g. empty grass, clear blue sky, a wooden table" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>To remove an object, describe the background that should replace it.</p>
            </div>
            {inpaintError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{inpaintError}</div>}
            <button type="button" onClick={runInpaint} disabled={inpaintBusy || !inpaintSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {inpaintBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('eraser', { size: 15 })}
              {inpaintBusy ? 'Inpainting...' : 'Inpaint'}
            </button>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {inpaintResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(inpaintResult.imageDataUrl, 'inpainted.jpg', 'inpaint')}
                  {renderExport(inpaintResult.imageDataUrl, 'inpainted')}
                </div>
              )}
            </div>
            <div className="p-4">
              {inpaintResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(inpaintResult)} className="block w-full"><img src={inpaintResult.imageDataUrl} alt="inpainted" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  {inpaintResult.cost && <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{formatCost(inpaintResult.cost)}</p>}
                </>
              ) : <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Your inpainted image will appear here.</div>}
            </div>
          </div>
        </div>
      </section>
      )}

      {mode === 'generate' && (
      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Gallery</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{gallery.length} saved</span>
        </div>
        {gallery.length === 0 ? (
          <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Save generated images to collect useful article and story graphics here.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {gallery.map(item => (
              <div key={item.id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <button
                  type="button"
                  onClick={() => {
                    selectResult(item, { openPreview: true });
                  }}
                  className="block w-full"
                >
                  <img src={item.imageDataUrl} alt={item.prompt} className="w-full aspect-square object-cover" />
                </button>
                <div className="p-3">
                  <p className="text-xs line-clamp-2" style={{ color: 'var(--color-text)' }}>{item.prompt}</p>
                  <div className="flex justify-between items-center mt-3">
                    <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{item.model || 'local image'}</span>
                    <button
                      onClick={() => deleteGalleryImage(item.id)}
                      className="text-xs hover:opacity-70"
                      style={{ color: '#ef4444' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

        </main>
      </div>

      {restrictionWarning && !generating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-md rounded-2xl border p-5 shadow-xl" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              Content restriction detected
            </h2>
            <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
              This prompt appears to match admin restrictions. If you continue, the refined prompt may remove or redirect that content before image generation.
            </p>
            <div className="mt-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Matched restrictions</p>
              <ul className="text-sm space-y-1" style={{ color: 'var(--color-text)' }}>
                {restrictionWarning.matches?.map((match, index) => (
                  <li key={`${match.restriction}-${index}`}>- {match.restriction}</li>
                ))}
              </ul>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestrictionWarning(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performGenerate}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90"
                style={{ background: 'var(--color-primary)' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImage?.imageDataUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="w-full max-w-4xl max-h-full rounded-2xl border overflow-hidden shadow-xl"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Generated image
                </h2>
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  Seed: {previewImage.seed || 'n/a'} · Model: {previewImage.model || 'local image'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70"
                style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[80vh]">
              <img
                src={previewImage.imageDataUrl}
                alt={previewImage.refinedPrompt || previewImage.prompt}
                className="w-full rounded-xl border"
                style={{ borderColor: 'var(--color-border)' }}
              />
              <p className="text-xs mt-3 whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>
                {previewImage.refinedPrompt || previewImage.prompt}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
