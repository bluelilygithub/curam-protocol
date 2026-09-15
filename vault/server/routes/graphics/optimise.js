'use strict';

// Optimise tools: Upscale, Convert, Compress, Batch, Export for Social,
// Print Ready, Auto-enhance. `runConvert`/`runCompress` are defined once here
// and reused by /batch; /batch and /export-social also reuse `runResize`
// (from ../transform) and `runWatermark` (from ../compose) so there is never
// duplicated single-image-vs-batch logic.

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const archiver = require('archiver');
const {
  runtimeConfig,
  comfyBaseUrl,
  fetchJson,
  uploadImageToComfy,
  loadImageDataUrl,
  buildUpscaleWorkflow,
  resolveUpscaleModel,
  listAvailableUpscaleModels,
  envReplicateUpscaleModel,
  HOSTED_UPSCALE_MODELS,
  clampScale,
  clampCreativity,
  upscaleWithReplicate,
  estimateUpscaleCost,
  logImageUsage,
  dataUrlToBuffer,
  isHeicBuffer,
  packIco,
  CONVERT_FORMATS,
  clampQuality,
  clampInt,
  SOCIAL_PRESETS,
} = require('./shared');
const { runResize } = require('./transform');
const { runWatermark } = require('./compose');

router.get('/upscale/info', async (req, res) => {
  try {
    if (runtimeConfig.isLocal) {
      const model = await resolveUpscaleModel(req.user.id);
      const available = await listAvailableUpscaleModels().catch(() => []);
      const models = available.map((m) => ({ id: m, label: m, kind: 'faithful' }));
      if (model && !models.some((m) => m.id === model)) {
        models.unshift({ id: model, label: model, kind: 'faithful' });
      }
      return res.json({
        provider: 'local-comfyui',
        model,
        models,
        scales: [2, 4],
        configured: true,
        apiUrl: comfyBaseUrl(),
      });
    }
    const model = envReplicateUpscaleModel();
    const configured = Boolean(process.env.REPLICATE_API_TOKEN);
    const models = [...HOSTED_UPSCALE_MODELS];
    if (!models.some((m) => m.id === model)) {
      models.unshift({ id: model, label: model, kind: 'custom' });
    }
    res.json({
      provider: 'replicate',
      model,
      models,
      scales: [2, 4, 8],
      configured,
      error: configured ? null : 'REPLICATE_API_TOKEN is not configured',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/graphics/upscale — fidelity-first upscale (ComfyUI local / Replicate prod)
router.post('/upscale', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A PNG, JPEG or WebP image is required' });
    }
    const scale = clampScale(req.body?.scale);
    const creativity = clampCreativity(req.body?.creativity);
    const requestedModel = String(req.body?.model || '').trim();

    const inputBuffer = dataUrlToBuffer(imageDataUrl);

    if (!runtimeConfig.isLocal) {
      const result = await upscaleWithReplicate({ imageDataUrl, scale, creativity, model: requestedModel });
      const cost = estimateUpscaleCost({ provider: 'replicate', inputBuffer, scale });
      logImageUsage({ userId: req.user.id, model: `replicate:${result.model}`, feature: 'graphics_upscale', costUsd: cost.usd });
      return res.json({
        ok: true,
        provider: result.provider,
        model: result.model,
        scale,
        cost,
        image: { provider: 'replicate', url: result.url },
        imageDataUrl: result.imageDataUrl,
      });
    }

    let upscaleModelName = await resolveUpscaleModel(req.user.id);
    if (requestedModel) {
      const available = await listAvailableUpscaleModels().catch(() => []);
      if (available.includes(requestedModel)) upscaleModelName = requestedModel;
    }
    const native = Number(process.env.LOCAL_UPSCALE_NATIVE) || 4;
    const scaleBy = scale / native;
    const imageName = await uploadImageToComfy(imageDataUrl);
    const clientId = randomUUID();
    const workflow = buildUpscaleWorkflow({ imageName, upscaleModelName, scaleBy });

    const queued = await fetchJson(`${comfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const image = await waitForImage(queued.prompt_id);
    const imageDataUrlOut = await loadImageDataUrl(image);

    res.json({
      ok: true,
      provider: 'local-comfyui',
      model: upscaleModelName,
      scale,
      cost: estimateUpscaleCost({ provider: 'local-comfyui', inputBuffer, scale }),
      image,
      imageDataUrl: imageDataUrlOut,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/convert/info', (req, res) => {
  res.json({ formats: CONVERT_FORMATS });
});

async function runConvert(params) {
  const imageDataUrl = String(params?.imageDataUrl || '');
  const buffer = dataUrlToBuffer(imageDataUrl);
  const heic = isHeicBuffer(buffer);
  if (!buffer || (!/^data:image\//i.test(imageDataUrl) && !heic)) {
    throw Object.assign(new Error('A valid image is required'), { status: 400 });
  }

  const requested = String(params?.format || '').trim().toLowerCase();
  const target = CONVERT_FORMATS.find((f) => f.id === requested || f.ext === requested || (requested === 'jpg' && f.id === 'jpeg'));
  if (!target) {
    throw Object.assign(new Error(`Unsupported target format. Choose one of: ${CONVERT_FORMATS.map((f) => f.id).join(', ')}`), { status: 400 });
  }

  // HEIC decoding depends on the installed libvips having an HEIF decoder.
  // Probe early so we can return a friendly message instead of a raw error.
  if (heic) {
    try {
      await sharp(buffer).metadata();
    } catch {
      throw Object.assign(new Error('This server build can’t read HEIC/HEIF images. Convert to JPG/PNG on your device first.'), { status: 415 });
    }
  }

  // ICO is packed by hand (sharp can't write it): render square PNGs at the
  // standard icon sizes and stitch them into one multi-resolution .ico.
  if (target.id === 'ico') {
    const oriented = await sharp(buffer).rotate().toBuffer();
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const pngs = [];
    for (const s of icoSizes) {
      // eslint-disable-next-line no-await-in-loop
      const png = await sharp(oriented).resize(s, s, { fit: 'cover', position: 'centre' }).png().toBuffer();
      pngs.push({ size: s, buf: png });
    }
    const ico = packIco(pngs);
    return {
      ok: true,
      format: 'ico',
      mime: target.mime,
      ext: target.ext,
      quality: null,
      width: 256,
      height: 256,
      bytes: ico.length,
      imageDataUrl: `data:${target.mime};base64,${ico.toString('base64')}`,
    };
  }

  const quality = clampQuality(params?.quality);
  const pipeline = sharp(buffer, { animated: true });
  const options = target.lossy ? { quality } : {};
  const outBuffer = await pipeline.toFormat(target.id, options).toBuffer();
  const meta = await sharp(outBuffer).metadata().catch(() => null);

  return {
    ok: true,
    format: target.id,
    mime: target.mime,
    ext: target.ext,
    quality: target.lossy ? quality : null,
    width: meta?.width || null,
    height: meta?.height || null,
    bytes: outBuffer.length,
    imageDataUrl: `data:${target.mime};base64,${outBuffer.toString('base64')}`,
  };
}

router.post('/convert', async (req, res) => {
  try {
    const result = await runConvert(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Conversion failed' });
  }
});

// Map a data URL mime to the sharp format id (the format we'll re-encode back to).
function detectImageFormat(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/([a-z0-9.+-]+);base64,/i);
  if (!m) return null;
  const sub = m[1].toLowerCase();
  if (sub === 'jpg' || sub === 'jpeg') return 'jpeg';
  if (sub === 'svg+xml') return 'png';
  if (['png', 'webp', 'gif', 'avif', 'tiff'].includes(sub)) return sub;
  return null;
}

// Compression options per format. Lossy formats honour quality; PNG uses palette
// quantization + max zlib for meaningful savings; GIF/TIFF use their own knobs.
function buildCompressOptions(format, quality) {
  switch (format) {
    case 'jpeg': return { quality, mozjpeg: true };
    case 'webp': return { quality, effort: 6 };
    case 'avif': return { quality, effort: 4 };
    case 'png': return { quality, compressionLevel: 9, palette: true, effort: 8 };
    case 'tiff': return { quality, compression: 'jpeg' };
    case 'gif': return { effort: 10 };
    default: return { quality };
  }
}

async function runCompress(params) {
  const imageDataUrl = String(params?.imageDataUrl || '');
  const buffer = dataUrlToBuffer(imageDataUrl);
  if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
    throw Object.assign(new Error('A valid image is required'), { status: 400 });
  }

  const format = detectImageFormat(imageDataUrl);
  if (!format) {
    throw Object.assign(new Error('Unsupported image type'), { status: 400 });
  }

  const fmtMeta = CONVERT_FORMATS.find((f) => f.id === format) || { mime: `image/${format}`, ext: format };
  const quality = clampQuality(params?.quality);
  const options = buildCompressOptions(format, quality);
  const outBuffer = await sharp(buffer, { animated: true }).toFormat(format, options).toBuffer();
  const meta = await sharp(outBuffer).metadata().catch(() => null);

  const originalBytes = buffer.length;
  const compressedBytes = outBuffer.length;
  const savedBytes = originalBytes - compressedBytes;
  const savedPct = originalBytes > 0 ? Number(((savedBytes / originalBytes) * 100).toFixed(1)) : 0;
  // Never hand back a larger file: keep the original if compression didn't help.
  const useOriginal = compressedBytes >= originalBytes;

  return {
    ok: true,
    format,
    mime: fmtMeta.mime,
    ext: fmtMeta.ext,
    quality: format === 'gif' ? null : quality,
    width: meta?.width || null,
    height: meta?.height || null,
    originalBytes,
    compressedBytes: useOriginal ? originalBytes : compressedBytes,
    savedBytes: useOriginal ? 0 : savedBytes,
    savedPct: useOriginal ? 0 : savedPct,
    noGain: useOriginal,
    imageDataUrl: useOriginal ? imageDataUrl : `data:${fmtMeta.mime};base64,${outBuffer.toString('base64')}`,
  };
}

router.post('/compress', async (req, res) => {
  try {
    const result = await runCompress(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Compression failed' });
  }
});

router.post('/export-social', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    if (!dataUrlToBuffer(imageDataUrl) || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const presetIds = Array.isArray(req.body?.presets) ? req.body.presets.map((p) => String(p)) : [];
    const presets = SOCIAL_PRESETS.filter((p) => presetIds.includes(p.id));
    if (!presets.length) {
      return res.status(400).json({ error: 'Select at least one preset to export' });
    }

    const options = req.body?.options && typeof req.body.options === 'object' ? req.body.options : {};
    const files = [];
    const items = [];
    for (const preset of presets) {
      const strategy = String(options[preset.id]?.strategy || 'smart');
      // eslint-disable-next-line no-await-in-loop
      const result = await runResize({ imageDataUrl, preset: preset.id, strategy });
      const buf = dataUrlToBuffer(result.imageDataUrl);
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;
      const name = `${preset.id}-${result.width}x${result.height}.${ext}`;
      files.push({ name, buf });
      items.push({
        id: preset.id,
        label: preset.label,
        strategy,
        width: result.width,
        height: result.height,
        bytes: buf.length,
        fileName: name,
        imageDataUrl: result.imageDataUrl,
      });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    files.forEach((f) => archive.append(f.buf, { name: f.name }));
    await archive.finalize();
    await done;

    const zip = Buffer.concat(chunks);
    res.json({
      ok: true,
      count: files.length,
      bytes: zip.length,
      zipDataUrl: `data:application/zip;base64,${zip.toString('base64')}`,
      items,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Export failed' });
  }
});
// ── Print Ready ──────────────────────────────────────────────────────────────

// Convert each RGB pixel to CMYK using the standard device-independent formula.
// Returns a Buffer of interleaved CMYK bytes (4 bytes per pixel).
function rgbToCmykBuffer(rgbData, pixelCount) {
  const out = Buffer.allocUnsafe(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const r = rgbData[i * 3] / 255;
    const g = rgbData[i * 3 + 1] / 255;
    const b = rgbData[i * 3 + 2] / 255;
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) {
      out[i * 4] = 0; out[i * 4 + 1] = 0; out[i * 4 + 2] = 0; out[i * 4 + 3] = 255;
    } else {
      const d = 1 - k;
      out[i * 4]     = Math.round(((1 - r - k) / d) * 255); // C
      out[i * 4 + 1] = Math.round(((1 - g - k) / d) * 255); // M
      out[i * 4 + 2] = Math.round(((1 - b - k) / d) * 255); // Y
      out[i * 4 + 3] = Math.round(k * 255);                  // K
    }
  }
  return out;
}

// Build a minimal uncompressed CMYK TIFF (PhotometricInterpretation=5).
// Accepted by all professional prepress and RIP software.
function buildCmykTiff(cmykData, width, height, dpi) {
  const N = 13; // IFD entry count
  const HEADER = 8;
  const IFD_SZ = 2 + N * 12 + 4;
  const EXTRA = HEADER + IFD_SZ; // extra data: BPS (8 bytes), XRES (8), YRES (8)
  const BPS_OFF  = EXTRA;
  const XRES_OFF = EXTRA + 8;
  const YRES_OFF = EXTRA + 16;
  const DATA_OFF = EXTRA + 24;

  const buf = Buffer.alloc(DATA_OFF + cmykData.length, 0);

  // TIFF LE header
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(HEADER, 4);

  let p = HEADER;
  buf.writeUInt16LE(N, p); p += 2;

  // type codes
  const SHORT = 3, LONG = 4, RATIONAL = 5;
  const ifd = (tag, type, count, val) => {
    buf.writeUInt16LE(tag,   p);
    buf.writeUInt16LE(type,  p + 2);
    buf.writeUInt32LE(count, p + 4);
    buf.writeUInt32LE(val,   p + 8);
    p += 12;
  };

  // IFD entries — must be in ascending tag order
  ifd(256, LONG,     1, width);           // ImageWidth
  ifd(257, LONG,     1, height);          // ImageLength
  ifd(258, SHORT,    4, BPS_OFF);         // BitsPerSample [8,8,8,8] — offset
  ifd(259, SHORT,    1, 1);               // Compression: none
  ifd(262, SHORT,    1, 5);               // PhotometricInterpretation: CMYK
  ifd(273, LONG,     1, DATA_OFF);        // StripOffsets
  ifd(277, SHORT,    1, 4);               // SamplesPerPixel
  ifd(278, LONG,     1, height);          // RowsPerStrip (one strip)
  ifd(279, LONG,     1, cmykData.length); // StripByteCounts
  ifd(282, RATIONAL, 1, XRES_OFF);        // XResolution — offset
  ifd(283, RATIONAL, 1, YRES_OFF);        // YResolution — offset
  ifd(284, SHORT,    1, 1);               // PlanarConfiguration: chunky
  ifd(296, SHORT,    1, 2);               // ResolutionUnit: inch
  buf.writeUInt32LE(0, p);                // next IFD offset = 0

  // BitsPerSample: 8 per channel × 4 channels
  for (let i = 0; i < 4; i++) buf.writeUInt16LE(8, BPS_OFF + i * 2);

  // XResolution and YResolution as RATIONAL (numerator / denominator)
  buf.writeUInt32LE(dpi, XRES_OFF);     buf.writeUInt32LE(1, XRES_OFF + 4);
  buf.writeUInt32LE(dpi, YRES_OFF);     buf.writeUInt32LE(1, YRES_OFF + 4);

  cmykData.copy(buf, DATA_OFF);
  return buf;
}

// Converts any raster image into a print-ready file: sets the target DPI in
// metadata, optionally flattens alpha transparency, optionally adds bleed
// padding, and outputs as TIFF/sRGB (LZW), TIFF/CMYK (uncompressed),
// PDF, or PNG.
router.post('/print-ready', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }

    const dpi = Math.min(1200, Math.max(72, Number(req.body?.dpi) || 300));
    const VALID_FORMATS = ['tiff', 'tiff-cmyk', 'pdf', 'png'];
    const format = VALID_FORMATS.includes(String(req.body?.format || '').toLowerCase())
      ? String(req.body.format).toLowerCase()
      : 'tiff';
    const background = String(req.body?.background || 'white').toLowerCase() === 'transparent'
      ? 'transparent'
      : 'white';
    const bleedMm = Math.min(25, Math.max(0, Number(req.body?.bleedMm) || 0));

    const meta = await sharp(buffer).metadata();
    const hasAlpha = (meta.channels === 4 || meta.hasAlpha);

    // Build the sharp pipeline (flatten + bleed apply to all output formats)
    let pipeline = sharp(buffer);

    if (background === 'white' && hasAlpha) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    if (bleedMm > 0) {
      const bleedPx = Math.round((bleedMm / 25.4) * dpi);
      const bleedColor = background === 'white'
        ? { r: 255, g: 255, b: 255, alpha: 1 }
        : { r: 255, g: 255, b: 255, alpha: 0 };
      pipeline = pipeline.extend({
        top: bleedPx, bottom: bleedPx, left: bleedPx, right: bleedPx,
        background: bleedColor,
      });
    }

    pipeline = pipeline.withMetadata({ density: dpi });

    let outputBuffer;
    let mimeType;
    let ext;
    let colorSpace = 'sRGB';
    let pxW, pxH;

    if (format === 'tiff-cmyk') {
      // Get raw RGB pixels from the processed pipeline, then convert to CMYK
      // and write a standards-compliant CMYK TIFF manually (sharp can't do CMYK)
      const { data: rgbData, info } = await pipeline
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      pxW = info.width;
      pxH = info.height;
      const cmykData = rgbToCmykBuffer(rgbData, pxW * pxH);
      outputBuffer = buildCmykTiff(cmykData, pxW, pxH, dpi);
      mimeType = 'image/tiff';
      ext = 'tiff';
      colorSpace = 'CMYK';
    } else if (format === 'tiff') {
      outputBuffer = await pipeline
        .tiff({ compression: 'lzw', xres: dpi / 25.4, yres: dpi / 25.4 })
        .toBuffer();
      mimeType = 'image/tiff';
      ext = 'tiff';
      const m = await sharp(outputBuffer).metadata();
      pxW = m.width; pxH = m.height;
    } else if (format === 'png') {
      outputBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      mimeType = 'image/png';
      ext = 'png';
      const m = await sharp(outputBuffer).metadata();
      pxW = m.width; pxH = m.height;
    } else {
      // PDF via pdf-lib
      const pngBuf = await pipeline.png().toBuffer();
      const m = await sharp(pngBuf).metadata();
      pxW = m.width; pxH = m.height;
      const { PDFDocument } = require('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const embedded = await pdfDoc.embedPng(pngBuf);
      const widthPt  = (pxW / dpi) * 72;
      const heightPt = (pxH / dpi) * 72;
      const page = pdfDoc.addPage([widthPt, heightPt]);
      page.drawImage(embedded, { x: 0, y: 0, width: widthPt, height: heightPt });
      outputBuffer = Buffer.from(await pdfDoc.save());
      mimeType = 'application/pdf';
      ext = 'pdf';
    }

    // Fall back to source dimensions if pipeline didn't set them
    if (!pxW) pxW = meta.width || 0;
    if (!pxH) pxH = meta.height || 0;

    const printWidthIn  = pxW / dpi;
    const printHeightIn = pxH / dpi;
    const printWidthMm  = Math.round(printWidthIn  * 25.4);
    const printHeightMm = Math.round(printHeightIn * 25.4);

    let qualityNote = '';
    if (pxW < dpi || pxH < dpi) {
      qualityNote = 'warning: image is smaller than 1×1 inch at this DPI — output may appear pixelated when printed';
    } else if (pxW < dpi * 2 || pxH < dpi * 2) {
      qualityNote = 'note: image is suitable for small print sizes only';
    }

    res.json({
      ok: true,
      imageDataUrl: `data:${mimeType};base64,${outputBuffer.toString('base64')}`,
      ext,
      format,
      colorSpace,
      dpi,
      bytes: outputBuffer.length,
      pixelWidth: pxW,
      pixelHeight: pxH,
      printWidthMm,
      printHeightMm,
      printWidthIn:  Math.round(printWidthIn  * 100) / 100,
      printHeightIn: Math.round(printHeightIn * 100) / 100,
      hasAlpha: hasAlpha && background === 'transparent',
      bleedMm,
      qualityNote,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Print-ready conversion failed' });
  }
});
// Auto-enhance: intelligently adjust brightness, contrast, saturation based on histogram.
router.post('/auto-enhance', async (req, res) => {
  try {
    const buf = dataUrlToBuffer(req.body?.imageDataUrl || '');
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    // Analyze histogram to determine optimal adjustments.
    const img = sharp(buf).rotate();
    const meta = await img.metadata();
    let w = meta.width || 1;
    let h = meta.height || 1;

    // Cap analysis at 800px.
    const cap = 800;
    if (Math.max(w, h) > cap) {
      const s = cap / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }

    // Get pixel data for histogram analysis.
    const raw = await img
      .resize(w, h, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = raw.data;
    const r = new Array(256).fill(0);
    const g = new Array(256).fill(0);
    const b = new Array(256).fill(0);

    // Tally per-channel histograms.
    for (let i = 0; i < data.length; i += 4) {
      r[data[i]] += 1;
      g[data[i + 1]] += 1;
      b[data[i + 2]] += 1;
    }

    // Find 5th and 95th percentiles for each channel to detect shadows/highlights.
    const percentile = (hist, p) => {
      const total = hist.reduce((a, v) => a + v, 0);
      const target = total * p;
      let sum = 0;
      for (let i = 0; i < 256; i += 1) {
        sum += hist[i];
        if (sum >= target) return i;
      }
      return 255;
    };

    const r5 = percentile(r, 0.05);
    const r95 = percentile(r, 0.95);
    const g5 = percentile(g, 0.05);
    const g95 = percentile(g, 0.95);
    const b5 = percentile(b, 0.05);
    const b95 = percentile(b, 0.95);

    // Compute adjustments: contrast stretches dark/light points, brightness shifts midtones.
    const rMid = (r5 + r95) / 2;
    const gMid = (g5 + g95) / 2;
    const bMid = (b5 + b95) / 2;
    const overall = (rMid + gMid + bMid) / 3;

    let brightness = 1;
    let contrast = 1;
    let saturation = 1;

    if (overall < 80) brightness = 1.2; // Image is dark
    else if (overall > 180) brightness = 0.9; // Image is bright

    const range = (r95 - r5 + g95 - g5 + b95 - b5) / 3;
    if (range < 100) contrast = 1.3; // Low contrast
    if (range > 200) saturation = 1.15; // Boost already-vibrant images

    // Apply adjustments via sharp: linear contrast, then manipulate saturation.
    const enhanced = await img
      .linear(contrast, Math.round(128 * (1 - contrast)))
      .modulate({ brightness, saturation })
      .png()
      .toBuffer();

    res.json({
      ok: true,
      imageDataUrl: `data:image/png;base64,${enhanced.toString('base64')}`,
      applied: { brightness: Number(brightness.toFixed(2)), contrast: Number(contrast.toFixed(2)), saturation: Number(saturation.toFixed(2)) },
      width: meta.width,
      height: meta.height,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Auto-enhance failed' });
  }
});
// Batch runner for the local sharp-only ops (no AI/model resolution involved).
// Each item merges over the shared `params`, then runs through the exact same
// function the single-image route calls, so behavior can never drift between
// the two paths. One bad item never aborts the rest of the batch.
const BATCH_OPS = { watermark: runWatermark, resize: runResize, convert: runConvert, compress: runCompress };
const BATCH_MAX_ITEMS = 25;

router.post('/batch', async (req, res) => {
  try {
    const op = String(req.body?.op || '').trim();
    const runner = BATCH_OPS[op];
    if (!runner) {
      return res.status(400).json({ error: `Unsupported batch op. Choose one of: ${Object.keys(BATCH_OPS).join(', ')}` });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'Add at least one item' });
    if (items.length > BATCH_MAX_ITEMS) {
      return res.status(400).json({ error: `Too many items (max ${BATCH_MAX_ITEMS})` });
    }
    const sharedParams = (req.body?.params && typeof req.body.params === 'object') ? req.body.params : {};

    const results = [];
    for (const item of items) {
      const merged = { ...sharedParams, ...(item && typeof item === 'object' ? item : {}) };
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await runner(merged);
        results.push(result);
      } catch (err) {
        results.push({ error: err.message || `${op} failed` });
      }
    }

    res.json({ ok: true, op, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Batch operation failed' });
  }
});

router.runConvert = runConvert;
router.runCompress = runCompress;

module.exports = router;
