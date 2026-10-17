// Pure pdf-lib helpers behind the extra PDF Tools routes in routes/pdf.js: crop, header/footer,
// N-up, extract embedded JPEGs, and the invisible OCR text layer. Buffers in, buffers out, no I/O.
const { PDFDocument, StandardFonts, rgb, PDFName, PDFRawStream, PDFArray, PDFNumber } = require('pdf-lib');
const JSZip = require('jszip');

const MM = 72 / 25.4; // PDF points per millimetre

function load(buf) {
  return PDFDocument.load(buf, { ignoreEncryption: true });
}

// ── Crop ────────────────────────────────────────────────────────────────────
// Margins are what the person sees (top is the top of the page as displayed), in millimetres.
// A rotated page stores its box unrotated, so map the visual margins back onto the stored box.
function storedMargins(rotation, m) {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 90) return { top: m.right, right: m.bottom, bottom: m.left, left: m.top };
  if (r === 180) return { top: m.bottom, right: m.left, bottom: m.top, left: m.right };
  if (r === 270) return { top: m.left, right: m.top, bottom: m.right, left: m.bottom };
  return m;
}

async function cropPdf(buf, { pages, marginsMm }) {
  const doc = await load(buf);
  const all = doc.getPages();
  const targets = pages && pages.length ? pages : all.map((_, i) => i);
  const m = {
    top: Math.max(0, Number(marginsMm?.top) || 0) * MM,
    right: Math.max(0, Number(marginsMm?.right) || 0) * MM,
    bottom: Math.max(0, Number(marginsMm?.bottom) || 0) * MM,
    left: Math.max(0, Number(marginsMm?.left) || 0) * MM,
  };
  let cropped = 0;
  for (const i of targets) {
    const page = all[i];
    if (!page) continue;
    const s = storedMargins(page.getRotation().angle, m);
    const box = page.getMediaBox();
    const w = box.width - s.left - s.right;
    const h = box.height - s.top - s.bottom;
    if (w < 10 || h < 10) throw new Error(`Page ${i + 1}: those margins leave nothing of the page.`);
    const x = box.x + s.left;
    const y = box.y + s.bottom;
    // Both boxes: viewers honour CropBox, but later tools (page numbers, watermark) measure the MediaBox.
    page.setCropBox(x, y, w, h);
    page.setMediaBox(x, y, w, h);
    cropped++;
  }
  return { bytes: await doc.save(), cropped, pageCount: all.length };
}

// ── Header & footer ─────────────────────────────────────────────────────────
// Characters Helvetica (WinAnsi) can't draw would throw; swap them for '?' instead of failing the file.
function safeText(font, text) {
  let out = '';
  for (const ch of String(text)) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

function fillTokens(template, { n, total, date, name }) {
  return String(template)
    .replace(/\{n\}/g, String(n))
    .replace(/\{total\}/g, String(total))
    .replace(/\{date\}/g, date)
    .replace(/\{filename\}/g, name || '');
}

async function headerFooterPdf(buf, { pages, header, footer, fontSize, marginMm, startAt, date, name }) {
  const doc = await load(buf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = doc.getPages();
  const total = all.length;
  const targets = new Set(pages && pages.length ? pages : all.map((_, i) => i));
  const size = Math.min(36, Math.max(6, Number(fontSize) || 10));
  const margin = Math.max(5, Number(marginMm) || 10) * MM;
  const first = Math.max(1, Number(startAt) || 1);
  let stamped = 0;
  all.forEach((page, i) => {
    if (!targets.has(i)) return;
    const { x: ox, y: oy, width, height } = page.getCropBox();
    const ctx = { n: i + first, total, date, name };
    const rows = [
      { cells: header, y: oy + height - margin - size },
      { cells: footer, y: oy + margin },
    ];
    for (const { cells, y } of rows) {
      if (!cells) continue;
      for (const pos of ['left', 'center', 'right']) {
        const raw = cells[pos];
        if (!raw || !String(raw).trim()) continue;
        const text = safeText(font, fillTokens(raw, ctx));
        const tw = font.widthOfTextAtSize(text, size);
        const x = pos === 'left' ? ox + margin : pos === 'right' ? ox + width - margin - tw : ox + (width - tw) / 2;
        page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
      }
    }
    stamped++;
  });
  return { bytes: await doc.save(), stamped, pageCount: total };
}

// ── N-up ────────────────────────────────────────────────────────────────────
const SHEETS = { A4: [595.28, 841.89], Letter: [612, 792] };

async function nupPdf(buf, { perSheet, sheet, landscape, gapMm, border }) {
  const cols = perSheet === 4 ? 2 : perSheet === 2 ? 2 : perSheet === 6 ? 3 : perSheet === 9 ? 3 : 0;
  const rows = perSheet === 4 ? 2 : perSheet === 2 ? 1 : perSheet === 6 ? 2 : perSheet === 9 ? 3 : 0;
  if (!cols) throw Object.assign(new Error('Pages per sheet must be 2, 4, 6 or 9.'), { status: 400 });
  const src = await load(buf);
  const srcPages = src.getPages();
  const out = await PDFDocument.create();
  let [sw, sh] = SHEETS[sheet] || SHEETS.A4;
  // 2-up reads best on a landscape sheet (two portrait pages side by side); the rest default to portrait.
  const wantLandscape = landscape === undefined || landscape === null ? perSheet === 2 || perSheet === 6 : !!landscape;
  if (wantLandscape && sw < sh) [sw, sh] = [sh, sw];
  if (!wantLandscape && sw > sh) [sw, sh] = [sh, sw];
  const gap = Math.max(0, Number(gapMm) || 4) * MM;
  const cellW = (sw - gap * (cols + 1)) / cols;
  const cellH = (sh - gap * (rows + 1)) / rows;
  // pdf-lib refuses to embed a page with no content stream (a truly blank page), so those keep their
  // place on the sheet as an empty cell, sized like the page they stand for.
  const embedded = [];
  for (const p of srcPages) {
    const { width, height } = p.getSize();
    embedded.push(p.node.Contents() ? { page: (await out.embedPages([p]))[0] } : { blank: true, width, height });
  }
  let sheets = 0;
  for (let start = 0; start < embedded.length; start += perSheet) {
    const page = out.addPage([sw, sh]);
    sheets++;
    for (let k = 0; k < perSheet && start + k < embedded.length; k++) {
      const item = embedded[start + k];
      const e = item.page || item;
      const scale = Math.min(cellW / e.width, cellH / e.height);
      const w = e.width * scale;
      const h = e.height * scale;
      const col = k % cols;
      const row = Math.floor(k / cols);
      const x = gap + col * (cellW + gap) + (cellW - w) / 2;
      const y = sh - gap - (row + 1) * cellH - row * gap + (cellH - h) / 2;
      if (item.page) page.drawPage(e, { x, y, width: w, height: h });
      if (border) page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
    }
  }
  return { bytes: await out.save(), sheets, pageCount: srcPages.length };
}

// ── Extract embedded images (JPEG only) ─────────────────────────────────────
// A DCTDecode stream IS a JPEG file, so its bytes can be written out untouched. Anything else
// (Flate, CMYK, indexed, JPX, masks) is counted as skipped rather than re-encoded.
function filterNames(dict) {
  const f = dict.get(PDFName.of('Filter'));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map((x) => String(x));
  return [String(f)];
}

async function extractJpegImages(buf) {
  const doc = await load(buf);
  const images = [];
  let skipped = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (String(dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    const filters = filterNames(dict);
    const cs = String(dict.get(PDFName.of('ColorSpace')) || '');
    const isJpeg = filters.length === 1 && filters[0] === '/DCTDecode';
    if (!isJpeg || /CMYK/i.test(cs)) { skipped++; continue; }
    const wObj = dict.lookup(PDFName.of('Width'));
    const hObj = dict.lookup(PDFName.of('Height'));
    images.push({
      bytes: Buffer.from(obj.contents),
      width: wObj instanceof PDFNumber ? wObj.asNumber() : 0,
      height: hObj instanceof PDFNumber ? hObj.asNumber() : 0,
    });
  }
  return { images, skipped };
}

async function zipImages(images) {
  const zip = new JSZip();
  images.forEach((img, i) => zip.file(`image-${String(i + 1).padStart(3, '0')}.jpg`, img.bytes));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

// ── OCR text layer ──────────────────────────────────────────────────────────
// The browser does the recognition and sends word boxes in canvas pixels (origin top-left). Each
// word is drawn invisibly (opacity 0) at its box, so the page looks identical but can be searched,
// selected and copied. `pages[].canvasWidth/Height` give the pixel size the boxes were measured on.
async function ocrLayerPdf(buf, ocrPages) {
  const doc = await load(buf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = doc.getPages();
  let words = 0;
  let pagesDone = 0;
  for (const op of ocrPages) {
    const page = all[op.page - 1];
    if (!page || !op.canvasWidth || !op.canvasHeight) continue;
    const box = page.getCropBox();
    const sx = box.width / op.canvasWidth;
    const sy = box.height / op.canvasHeight;
    for (const w of op.words || []) {
      const text = safeText(font, String(w.text || '').trim());
      if (!text || !(w.w > 0) || !(w.h > 0)) continue;
      const boxH = w.h * sy;
      const boxW = w.w * sx;
      // Size by height, then squeeze/stretch horizontally so selection highlights the whole word.
      let size = Math.max(4, boxH * 0.85);
      const natural = font.widthOfTextAtSize(text, size);
      if (natural > 0 && natural > boxW * 1.05) size = Math.max(3, size * (boxW / natural));
      page.drawText(text, {
        x: box.x + w.x * sx,
        y: box.y + box.height - (w.y + w.h) * sy + boxH * 0.15,
        size,
        font,
        opacity: 0,
      });
      words++;
    }
    pagesDone++;
  }
  return { bytes: await doc.save(), words, pagesDone };
}

module.exports = { cropPdf, headerFooterPdf, nupPdf, extractJpegImages, zipImages, ocrLayerPdf, MM };
