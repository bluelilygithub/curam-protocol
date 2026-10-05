/**
 * Scanner I/O: turn a PDF / image / pasted text into scan-ready pages, plus the exports.
 * Everything runs in the browser; nothing is uploaded.
 *
 * Page shape: { index, source: 'text'|'ocr'|'paste', ocr: bool, lines, imageUrl?, width?, height?, meanConf? }
 */
import { openPdf, extractPageText, renderPageCanvas, imageFileToCanvas } from '../../utils/pdfPages';
import { createOcrEngine } from '../../utils/ocrEngine';
import { getUnit, unitShort } from '../../utils/units/registry.mjs';

const TEXT_PAGE_MIN_CHARS = 25; // below this a PDF page is treated as scanned and OCR'd
const OCR_DPI = 300;

export function pastedTextPages(text) {
  const lines = String(text || '').split(/\r?\n/).map((t) => ({ text: t }));
  return [{ index: 0, source: 'paste', ocr: false, lines }];
}

/**
 * Load a File into pages. onStatus({ stage, page, total, progress, message }) drives the progress bar.
 * `cancelRef.current = true` aborts between pages. Returns { pages, ocrPages }.
 */
export async function loadDocumentPages(file, { onStatus, cancelRef, lang = 'eng' }) {
  const pages = [];
  let ocr = null;
  const getOcr = async () => {
    if (!ocr) { onStatus({ stage: 'model', message: 'Loading text-recognition model (first time only)…' }); ocr = await createOcrEngine({ lang }); }
    return ocr;
  };
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      const buf = await file.arrayBuffer();
      const { doc, lib, numPages } = await openPdf(buf);
      for (let i = 1; i <= numPages; i += 1) {
        if (cancelRef.current) throw new Error('cancelled');
        onStatus({ stage: 'read', page: i, total: numPages, progress: 0, message: `Reading page ${i} of ${numPages}…` });
        const page = await doc.getPage(i);
        const text = await extractPageText(lib, page, 1.5);
        if (text.charCount >= TEXT_PAGE_MIN_CHARS) {
          const { canvas } = await renderPageCanvas(page, { scale: 1.5 });
          pages.push({ index: i - 1, source: 'text', ocr: false, lines: text.lines, imageUrl: canvas.toDataURL('image/jpeg', 0.8), width: canvas.width, height: canvas.height });
        } else {
          onStatus({ stage: 'ocr', page: i, total: numPages, progress: 0, message: `Page ${i} of ${numPages} is scanned — recognising text on this device…` });
          const { canvas } = await renderPageCanvas(page, { scale: OCR_DPI / 72 });
          const engine = await getOcr();
          const res = await engine.recognize(canvas, { onProgress: (p) => onStatus({ stage: 'ocr', page: i, total: numPages, progress: p, message: `Recognising page ${i} of ${numPages}… ${Math.round(p * 100)}%` }) });
          pages.push({ index: i - 1, source: 'ocr', ocr: true, lines: res.lines, meanConf: res.meanConf, imageUrl: canvas.toDataURL('image/jpeg', 0.7), width: canvas.width, height: canvas.height });
        }
        page.cleanup?.();
      }
    } else {
      onStatus({ stage: 'ocr', page: 1, total: 1, progress: 0, message: 'Recognising text on this device…' });
      const canvas = await imageFileToCanvas(file);
      const engine = await getOcr();
      const res = await engine.recognize(canvas, { onProgress: (p) => onStatus({ stage: 'ocr', page: 1, total: 1, progress: p, message: `Recognising text… ${Math.round(p * 100)}%` }) });
      pages.push({ index: 0, source: 'ocr', ocr: true, lines: res.lines, meanConf: res.meanConf, imageUrl: canvas.toDataURL('image/jpeg', 0.8), width: canvas.width, height: canvas.height });
    }
  } finally {
    if (ocr) await ocr.terminate().catch(() => {});
  }
  return pages;
}

/** Bounding box of a hit in page-image pixels (interpolated inside the text runs that hold it). */
export function hitBox(page, hit) {
  const line = page?.lines?.[hit.line];
  if (!line?.segs) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const s of line.segs) {
    if (s.end <= hit.start || s.start >= hit.end) continue;
    const len = Math.max(1, s.end - s.start);
    const a = (Math.max(hit.start, s.start) - s.start) / len;
    const b = (Math.min(hit.end, s.end) - s.start) / len;
    x0 = Math.min(x0, s.bbox.x + s.bbox.w * a);
    x1 = Math.max(x1, s.bbox.x + s.bbox.w * b);
    y0 = Math.min(y0, s.bbox.y);
    y1 = Math.max(y1, s.bbox.y + s.bbox.h);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
}

// ── exports ───────────────────────────────────────────────────────────────────
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(rows) {
  const head = ['Page', 'Original', 'Kind', 'Unit', 'Group', 'Converted', 'Confidence', 'OCR confidence %', 'Status', 'Flags', 'Context'];
  const lines = [head.join(',')];
  for (const r of rows) {
    const h = r.hit;
    const units = [...new Set(h.unitIds.filter(Boolean))].map((id) => getUnit(id)?.name).join(' / ');
    lines.push([
      h.page + 1, h.raw, h.kind, units, h.groupId || '', r.proposal?.status === 'convert' ? r.proposal.text : '',
      h.confidence, h.ocrConf === null || h.ocrConf === undefined ? '' : Math.round(h.ocrConf), r.status,
      h.flags.map((f) => f.message).join(' | '), `${h.before}[${h.raw}]${h.after}`.replace(/\s+/g, ' ').trim(),
    ].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const WIN_ANSI_SAFE = /[^\x20-\x7E -ÿ–—‘’“”•]/g;
const pdfSafe = (s) => String(s).replace(/→/g, '->').replace(WIN_ANSI_SAFE, '?');

/** Annotated PDF: each page image with boxes around hits and the converted value beside them (pdf-lib, in the browser). */
export async function buildAnnotatedPdf(pages, rows) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colour = { high: rgb(0.09, 0.64, 0.29), medium: rgb(0.96, 0.62, 0.04), low: rgb(0.94, 0.27, 0.27) };
  for (const pg of pages) {
    if (!pg.imageUrl) continue;
    const bytes = Uint8Array.from(atob(pg.imageUrl.split(',')[1]), (c) => c.charCodeAt(0));
    const img = await pdf.embedJpg(bytes);
    const W = 595;
    const k = W / pg.width;
    const H = pg.height * k;
    const page = pdf.addPage([W, H]);
    page.drawImage(img, { x: 0, y: 0, width: W, height: H });
    for (const r of rows.filter((x) => x.hit.page === pg.index && x.status !== 'ignored')) {
      const b = hitBox(pg, r.hit);
      if (!b) continue;
      const c = r.status === 'accepted' ? rgb(0.09, 0.64, 0.29) : colour[r.hit.confidence];
      page.drawRectangle({ x: b.x * k - 1, y: H - (b.y + b.h) * k - 1, width: b.w * k + 2, height: b.h * k + 2, borderColor: c, borderWidth: 1, color: c, opacity: 0.12, borderOpacity: 0.9 });
      if (r.proposal?.status === 'convert') {
        const label = pdfSafe(`= ${r.proposal.text}`);
        const size = 7;
        const tw = bold.widthOfTextAtSize(label, size);
        const lx = Math.max(2, Math.min(W - tw - 4, b.x * k));
        const ly = Math.min(H - 9, H - b.y * k + 2);
        page.drawRectangle({ x: lx - 1, y: ly - 1.5, width: tw + 4, height: size + 3, color: rgb(1, 1, 0.85), opacity: 0.95, borderColor: c, borderWidth: 0.5 });
        page.drawText(label, { x: lx + 1, y: ly, size, font: bold, color: rgb(0.1, 0.1, 0.1) });
      }
    }
    page.drawText(pdfSafe(`Page ${pg.index + 1} - measurements found by Vault (check before relying on conversions)`), { x: 6, y: 4, size: 6, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return pdf.save();
}

export { unitShort };
