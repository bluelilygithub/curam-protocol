// Pure pdf-lib helpers behind the extra PDF Tools routes in routes/pdf.js: crop, header/footer,
// N-up, extract embedded JPEGs, and the invisible OCR text layer. Buffers in, buffers out, no I/O.
const { PDFDocument, StandardFonts, rgb, PDFName, PDFRawStream, PDFArray, PDFNumber, PDFString, PDFHexString, PDFBool, decodePDFRawStream } = require('pdf-lib');
const JSZip = require('jszip');
const sharp = require('sharp');

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

// ── Extract images ──────────────────────────────────────────────────────────
// Copies the pictures out of a PDF. JPEG photos are copied byte for byte (no re-compression). Pictures a PDF stores as raw pixel
// data (Flate/LZW/ASCII85 compressed: screenshots, logos, charts, scanned pages saved as pictures, with or without a soft-mask
// transparency layer) are rebuilt as PNG. JPEG 2000 pictures are copied unchanged as .jp2 (browsers cannot show them, image editors
// can). Fax/JBIG2 bitonal pictures, stencil masks and exotic colour spaces are counted as skipped, with the reason.
const MAX_IMAGES = 500;
const MIN_EDGE = 8; // anything smaller is a bullet, a rule or a mask, not a picture
const MAX_LOOP_PIXELS = 16e6; // pictures that need a per-pixel conversion stay under this so a big scan cannot stall the server
const MAX_PIXELS = 60e6;

const GENERIC_FILTERS = new Set(['/FlateDecode', '/Fl', '/LZWDecode', '/LZW', '/ASCII85Decode', '/A85', '/RunLengthDecode', '/RL', '/ASCIIHexDecode', '/AHx']);

function csInfo(cs, ctx, depth = 0) {
  if (!cs || depth > 3) return null;
  if (cs instanceof PDFName) {
    const n = String(cs);
    if (/^\/(DeviceGray|CalGray|G)$/.test(n)) return { type: 'gray', n: 1 };
    if (/^\/(DeviceRGB|CalRGB|RGB)$/.test(n)) return { type: 'rgb', n: 3 };
    if (/^\/(DeviceCMYK|CMYK)$/.test(n)) return { type: 'cmyk', n: 4 };
    return null;
  }
  if (cs instanceof PDFArray && cs.size() > 0) {
    const head = String(cs.lookup(0));
    if (head === '/ICCBased') {
      const stream = cs.lookup(1);
      const n = stream && stream.dict ? stream.dict.lookup(PDFName.of('N')) : null;
      const count = n instanceof PDFNumber ? n.asNumber() : 0;
      return count === 1 ? { type: 'gray', n: 1 } : count === 3 ? { type: 'rgb', n: 3 } : count === 4 ? { type: 'cmyk', n: 4 } : null;
    }
    if (head === '/CalGray') return { type: 'gray', n: 1 };
    if (head === '/CalRGB') return { type: 'rgb', n: 3 };
    if (head === '/Indexed' || head === '/I') {
      const base = csInfo(cs.lookup(1), ctx, depth + 1);
      const hiObj = cs.lookup(2);
      const hival = hiObj instanceof PDFNumber ? hiObj.asNumber() : -1;
      const lookup = cs.lookup(3);
      if (!base || base.type === 'indexed' || hival < 0 || hival > 255) return null;
      let table = null;
      if (lookup instanceof PDFString || lookup instanceof PDFHexString) table = lookup.asBytes();
      else if (lookup && lookup.dict) table = streamBytes(lookup);
      if (!table) return null;
      const palette = new Uint8Array((hival + 1) * 3);
      for (let i = 0; i <= hival; i++) {
        const o = i * base.n;
        const [r, g, b] = base.type === 'gray' ? [table[o], table[o], table[o]]
          : base.type === 'rgb' ? [table[o], table[o + 1], table[o + 2]]
            : cmykToRgb(table[o], table[o + 1], table[o + 2], table[o + 3]);
        palette[i * 3] = r || 0; palette[i * 3 + 1] = g || 0; palette[i * 3 + 2] = b || 0;
      }
      return { type: 'indexed', n: 1, palette, hival };
    }
  }
  return null;
}

const cmykToRgb = (c, m, y, k) => [255 * (1 - c / 255) * (1 - k / 255), 255 * (1 - m / 255) * (1 - k / 255), 255 * (1 - y / 255) * (1 - k / 255)].map((v) => Math.round(v));

// The stream's bytes with its compression undone (Flate, LZW, ASCII85, RunLength, predictors). Raw streams pass straight through.
function streamBytes(stream) {
  const filters = filterNames(stream.dict);
  if (!filters.length) return stream.contents;
  return decodePDFRawStream(stream).decode();
}

function numberOf(dict, name, fallback = 0) {
  const v = dict.lookup(PDFName.of(name));
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

// Raw samples (any bits per component) -> 8-bit values, one byte per sample, rows unpadded.
function unpackSamples(data, width, height, n, bpc) {
  const samplesPerRow = width * n;
  const out = new Uint8Array(samplesPerRow * height);
  if (bpc === 8) {
    if (data.length >= out.length) return data.subarray(0, out.length);
    out.set(data); return out;
  }
  const rowBytes = Math.ceil((samplesPerRow * bpc) / 8);
  const max = (1 << bpc) - 1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let s = 0; s < samplesPerRow; s++) {
      let v;
      if (bpc === 16) v = (data[rowStart + s * 2] || 0); // keep the high byte
      else {
        const bit = s * bpc;
        const byte = data[rowStart + (bit >> 3)] || 0;
        v = (byte >> (8 - bpc - (bit & 7))) & max;
      }
      out[y * samplesPerRow + s] = bpc === 16 ? v : v; // low depths stay as raw levels; scaled by the caller
    }
  }
  return out;
}

// One picture -> { bytes, ext, mime, format } or a reason it was skipped.
async function rebuildRaster(obj, doc) {
  const dict = obj.dict;
  const width = numberOf(dict, 'Width');
  const height = numberOf(dict, 'Height');
  if (!width || !height) return { skip: 'invalid' };
  if (width * height > MAX_PIXELS) return { skip: 'tooBig' };
  if (dict.lookup(PDFName.of('ImageMask')) === PDFBool.True) return { skip: 'mask' };
  const cs = csInfo(dict.get(PDFName.of('ColorSpace')), doc.context);
  if (!cs) return { skip: 'colourSpace' };
  const bpc = numberOf(dict, 'BitsPerComponent', 8);
  if (![1, 2, 4, 8, 16].includes(bpc)) return { skip: 'colourSpace' };
  const needsLoop = cs.type === 'indexed' || cs.type === 'cmyk' || bpc !== 8 || dict.get(PDFName.of('SMask')) || dict.get(PDFName.of('Decode'));
  if (needsLoop && width * height > MAX_LOOP_PIXELS) return { skip: 'tooBig' };

  let data;
  try { data = streamBytes(obj); } catch { return { skip: 'invalid' }; }
  let samples = unpackSamples(data, width, height, cs.n, bpc);

  // /Decode [1 0 ...] means inverted samples
  const decode = dict.lookup(PDFName.of('Decode'));
  let inverted = false;
  if (decode instanceof PDFArray && decode.size() >= 2) {
    const a = decode.lookup(0); const b = decode.lookup(1);
    inverted = a instanceof PDFNumber && b instanceof PDFNumber && a.asNumber() > b.asNumber();
  }
  const levels = bpc === 16 ? 255 : (1 << bpc) - 1;
  const px = width * height;
  let channels; let rgb;
  if (cs.type === 'indexed') {
    channels = 3; rgb = Buffer.allocUnsafe(px * 3);
    for (let i = 0; i < px; i++) {
      let idx = samples[i]; if (inverted) idx = levels - idx;
      if (idx > cs.hival) idx = cs.hival;
      rgb[i * 3] = cs.palette[idx * 3]; rgb[i * 3 + 1] = cs.palette[idx * 3 + 1]; rgb[i * 3 + 2] = cs.palette[idx * 3 + 2];
    }
  } else if (cs.type === 'gray') {
    channels = 1;
    if (bpc === 8 && !inverted) rgb = Buffer.from(samples.buffer, samples.byteOffset, px);
    else { rgb = Buffer.allocUnsafe(px); for (let i = 0; i < px; i++) { let v = samples[i]; if (inverted) v = levels - v; rgb[i] = Math.round((v * 255) / levels); } }
  } else if (cs.type === 'rgb') {
    channels = 3;
    if (bpc === 8 && !inverted) rgb = Buffer.from(samples.buffer, samples.byteOffset, px * 3);
    else { rgb = Buffer.allocUnsafe(px * 3); for (let i = 0; i < px * 3; i++) { let v = samples[i]; if (inverted) v = levels - v; rgb[i] = Math.round((v * 255) / levels); } }
  } else { // cmyk
    channels = 3; rgb = Buffer.allocUnsafe(px * 3);
    for (let i = 0; i < px; i++) {
      let c = samples[i * 4]; let m = samples[i * 4 + 1]; let y = samples[i * 4 + 2]; let k = samples[i * 4 + 3];
      if (inverted) { c = levels - c; m = levels - m; y = levels - y; k = levels - k; }
      const sc = 255 / levels;
      const [r, g, b] = cmykToRgb(c * sc, m * sc, y * sc, k * sc);
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    }
  }

  // Soft mask = transparency layer (a grey picture of its own, maybe at a different size)
  const sm = dict.lookup(PDFName.of('SMask'));
  let alpha = null;
  if (sm && sm.dict) {
    try {
      const sw = numberOf(sm.dict, 'Width'); const sh = numberOf(sm.dict, 'Height'); const sb = numberOf(sm.dict, 'BitsPerComponent', 8);
      if (sw && sh && sw * sh <= MAX_LOOP_PIXELS && [1, 2, 4, 8, 16].includes(sb)) {
        const sdata = unpackSamples(streamBytes(sm), sw, sh, 1, sb);
        const slevels = sb === 16 ? 255 : (1 << sb) - 1;
        let plane = Buffer.allocUnsafe(sw * sh);
        for (let i = 0; i < sw * sh; i++) plane[i] = Math.round((sdata[i] * 255) / slevels);
        if (sw !== width || sh !== height) plane = await sharp(plane, { raw: { width: sw, height: sh, channels: 1 } }).resize(width, height).raw().toBuffer();
        alpha = plane;
      }
    } catch { alpha = null; }
  }

  let outCh = channels;
  let finalBuf = rgb;
  if (alpha) {
    outCh = channels + 1;
    finalBuf = Buffer.allocUnsafe(px * outCh);
    for (let i = 0; i < px; i++) {
      for (let c = 0; c < channels; c++) finalBuf[i * outCh + c] = rgb[i * channels + c];
      finalBuf[i * outCh + channels] = alpha[i];
    }
  }
  const png = await sharp(finalBuf, { raw: { width, height, channels: outCh } }).png({ compressionLevel: 6 }).toBuffer();
  return { bytes: png, ext: 'png', mime: 'image/png', format: 'png', width, height };
}

async function extractImages(buf) {
  const doc = await load(buf);
  const images = [];
  const skippedReasons = {};
  const skip = (why) => { skippedReasons[why] = (skippedReasons[why] || 0) + 1; };
  // A picture's transparency layer is an image object of its own; it belongs to its picture, so it is not listed separately.
  const maskStreams = new Set();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || String(obj.dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    for (const key of ['SMask', 'Mask']) { const m = obj.dict.lookup(PDFName.of(key)); if (m && m.dict) maskStreams.add(m); }
  }
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (String(dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    if (maskStreams.has(obj)) { skip('mask'); continue; }
    if (images.length >= MAX_IMAGES) { skip('tooMany'); continue; }
    const width = numberOf(dict, 'Width'); const height = numberOf(dict, 'Height');
    if (width < MIN_EDGE || height < MIN_EDGE) { skip('tiny'); continue; }
    const filters = filterNames(dict);
    let made = null;
    try {
      if (filters.length === 1 && filters[0] === '/DCTDecode') {
        const cs = String(dict.get(PDFName.of('ColorSpace')) || '');
        if (/CMYK/i.test(cs) || numberOf(dict, 'Colors', 0) === 4) {
          // CMYK JPEGs show wrongly in browsers; convert once to an ordinary RGB JPEG
          const bytes = await sharp(Buffer.from(obj.contents)).toColourspace('srgb').jpeg({ quality: 92 }).toBuffer();
          made = { bytes, ext: 'jpg', mime: 'image/jpeg', format: 'jpeg', width, height, converted: true };
        } else made = { bytes: Buffer.from(obj.contents), ext: 'jpg', mime: 'image/jpeg', format: 'jpeg', width, height };
      } else if (filters.length === 1 && filters[0] === '/JPXDecode') {
        made = { bytes: Buffer.from(obj.contents), ext: 'jp2', mime: 'image/jp2', format: 'jp2', width, height };
      } else if (filters.every((f) => GENERIC_FILTERS.has(f))) {
        const r = await rebuildRaster(obj, doc);
        if (r.skip) { skip(r.skip); continue; }
        made = r;
      } else { skip(filters.some((f) => /CCITT|JBIG2/.test(f)) ? 'bitonal' : 'filter'); continue; }
    } catch { skip('invalid'); continue; }
    images.push(made);
  }
  const skipped = Object.values(skippedReasons).reduce((a, b) => a + b, 0) - (skippedReasons.tiny || 0) - (skippedReasons.mask || 0);
  return { images, skipped, skippedReasons };
}

// Older name, kept so existing callers keep working.
const extractJpegImages = extractImages;

async function zipImages(images) {
  const zip = new JSZip();
  images.forEach((img, i) => zip.file(`image-${String(i + 1).padStart(3, '0')}.${img.ext || 'jpg'}`, img.bytes));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

// Small picture for the on-screen list (the zip carries the originals). JPEG 2000 cannot be shown, so it gets none.
async function imagePreview(img) {
  if (img.format === 'jp2') return null;
  try {
    const out = await sharp(img.bytes).resize({ height: 128, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch { return null; }
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

module.exports = { cropPdf, headerFooterPdf, nupPdf, extractImages, extractJpegImages, zipImages, imagePreview, ocrLayerPdf, MM };
