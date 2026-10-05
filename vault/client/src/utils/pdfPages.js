/**
 * Browser-side PDF page helpers (pdfjs-dist): positioned text extraction and canvas rendering.
 * Used by the Measurements scanner; same pdfjs worker setup as PdfPage.jsx / GraphicsPage.jsx.
 */
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let pdfjsPromise = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(arrayBuffer) {
  const lib = await getPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  return { doc, lib, numPages: doc.numPages };
}

/**
 * Positioned text for one page, in viewport pixels at `scale`.
 * Returns { lines: [{ text, segs:[{start,end,bbox,conf:null}] }], charCount, width, height }.
 * Gaps wider than a few spaces become three spaces so table columns survive as cells.
 */
export async function extractPageText(lib, page, scale = 1.5) {
  const viewport = page.getViewport({ scale });
  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    if (!it.str || !it.str.trim()) { continue; }
    const tx = lib.Util.transform(viewport.transform, it.transform);
    const fontH = Math.hypot(tx[2], tx[3]) || 10;
    items.push({ str: it.str, x: tx[4], y: tx[5], w: it.width * scale, h: fontH });
  }
  // group into lines by baseline
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < Math.max(2, it.h * 0.45));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => a.y - b.y);
  const lines = [];
  let charCount = 0;
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let text = '';
    const segs = [];
    let prevEnd = null;
    for (const it of row.items) {
      const spaceW = it.h * 0.28;
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > spaceW * 3) text += '   ';
        else if (gap > spaceW * 0.5 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      }
      const start = text.length;
      text += it.str;
      segs.push({ start, end: text.length, bbox: { x: it.x, y: it.y - it.h, w: it.w, h: it.h * 1.15 }, conf: null });
      prevEnd = it.x + it.w;
    }
    charCount += text.replace(/\s/g, '').length;
    lines.push({ text, segs });
  }
  return { lines, charCount, width: viewport.width, height: viewport.height };
}

/** Render a page to a canvas at `scale` (1 = 72 dpi). Caps the longest side to `maxSide` px. */
export async function renderPageCanvas(page, { scale = 1.5, maxSide = 5200 } = {}) {
  let vp = page.getViewport({ scale });
  const longest = Math.max(vp.width, vp.height);
  if (longest > maxSide) vp = page.getViewport({ scale: scale * (maxSide / longest) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas, scale: vp.scale };
}

/** Load an image File into a canvas, shrinking very large photos for OCR speed. */
export function imageFileToCanvas(file, maxSide = 3600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
