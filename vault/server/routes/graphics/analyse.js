'use strict';

// Analyse tools: Image Diff, Remove Meta, Blur Detection. (Picker, Histogram,
// Contrast, Palette, Extract Text and File Info are browser-only and have no
// server routes.)

const express = require('express');
const router = express.Router();
const sharp = require('sharp');
const exifReader = require('exif-reader');
const { dataUrlToBuffer, clampInt, outputFormatFor } = require('./shared');

router.post('/diff', async (req, res) => {
  try {
    const a = dataUrlToBuffer(req.body?.imageA || '');
    const b = dataUrlToBuffer(req.body?.imageB || '');
    if (!a || !b) return res.status(400).json({ error: 'Two valid images are required' });
    const am = await sharp(a).rotate().metadata();
    const W = am.width;
    const H = am.height;
    const ra = await sharp(a).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rb = await sharp(b).rotate().resize(W, H, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const threshold = clampInt(req.body?.threshold, 0, 255, 25);
    const da = ra.data;
    const db = rb.data;
    const out = Buffer.alloc(W * H * 4);
    let diffCount = 0;
    for (let i = 0; i < da.length; i += 4) {
      const maxd = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (maxd > threshold) {
        out[i] = 255; out[i + 1] = 16; out[i + 2] = 64; out[i + 3] = 255;
        diffCount += 1;
      } else {
        const gray = (da[i] + da[i + 1] + da[i + 2]) / 3;
        const dim = Math.round(gray * 0.45 + 130); // washed-out context
        out[i] = dim; out[i + 1] = dim; out[i + 2] = dim; out[i + 3] = 255;
      }
    }
    const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const total = W * H;
    res.json({
      ok: true,
      width: W,
      height: H,
      threshold,
      diffPixels: diffCount,
      diffPct: total > 0 ? Number(((diffCount / total) * 100).toFixed(2)) : 0,
      imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Diff failed' });
  }
});
function gpsToDecimal(parts, ref) {
  if (!Array.isArray(parts) || parts.length < 3) return null;
  const [d, m, s] = parts.map(Number);
  let dec = d + m / 60 + s / 3600;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return Number.isFinite(dec) ? dec : null;
}

function formatExif(buffer) {
  let parsed;
  try { parsed = exifReader(buffer); } catch { return []; }
  if (!parsed) return [];
  const image = parsed.Image || {};
  const photo = parsed.Photo || {};
  const gps = parsed.GPSInfo || parsed.GPS || {};
  const fields = [];
  const push = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    fields.push({ label, value: value instanceof Date ? value.toISOString().replace('T', ' ').replace(/\..+/, '') : String(value) });
  };
  push('Camera make', image.Make);
  push('Camera model', image.Model);
  push('Lens', photo.LensModel);
  push('Software', image.Software);
  if (photo.FNumber) push('Aperture', `f/${photo.FNumber}`);
  if (photo.ExposureTime) push('Shutter', photo.ExposureTime < 1 ? `1/${Math.round(1 / photo.ExposureTime)} s` : `${photo.ExposureTime} s`);
  const iso = Array.isArray(photo.ISOSpeedRatings) ? photo.ISOSpeedRatings[0] : photo.ISOSpeedRatings;
  if (iso) push('ISO', iso);
  if (photo.FocalLength) push('Focal length', `${photo.FocalLength} mm`);
  push('Taken', photo.DateTimeOriginal || image.DateTime);
  const lat = gpsToDecimal(gps.GPSLatitude, gps.GPSLatitudeRef);
  const lon = gpsToDecimal(gps.GPSLongitude, gps.GPSLongitudeRef);
  if (lat != null && lon != null) push('GPS', `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  return fields;
}

router.post('/metadata', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const basics = [];
    basics.push({ label: 'Format', value: String(meta.format || '').toUpperCase() });
    if (meta.width && meta.height) basics.push({ label: 'Dimensions', value: `${meta.width} × ${meta.height} px` });
    if (meta.space) basics.push({ label: 'Colour space', value: meta.space });
    if (meta.channels) basics.push({ label: 'Channels', value: `${meta.channels}${meta.hasAlpha ? ' (with alpha)' : ''}` });
    if (meta.density) basics.push({ label: 'Density', value: `${meta.density} DPI` });
    if (meta.orientation) basics.push({ label: 'Orientation', value: meta.orientation });
    const exif = meta.exif ? formatExif(meta.exif) : [];
    res.json({
      ok: true,
      basics,
      exif,
      hasExif: exif.length > 0,
      flags: {
        exif: Boolean(meta.exif),
        gps: Boolean(meta.exif && Buffer.isBuffer(meta.exif) && meta.exif.includes('GPS')),
        xmp: Boolean(meta.xmp),
        iptc: Boolean(meta.iptc),
        icc: Boolean(meta.icc),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read metadata' });
  }
});

router.post('/strip-metadata', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const meta = await sharp(buffer).metadata();
    const removed = [];
    if (meta.exif) removed.push('EXIF (camera, settings, timestamps)');
    if (meta.exif && Buffer.isBuffer(meta.exif) && meta.exif.includes('GPS')) removed.push('GPS location');
    if (meta.xmp) removed.push('XMP');
    if (meta.iptc) removed.push('IPTC');
    if (meta.icc) removed.push('ICC colour profile');
    const fmt = outputFormatFor(meta);
    // sharp drops metadata unless withMetadata() is called; rotate() bakes in the
    // EXIF orientation first so the cleaned image isn't left mis-rotated.
    const out = await sharp(buffer).rotate().toFormat(fmt).toBuffer();
    res.json({
      ok: true,
      removed,
      hadMetadata: removed.length > 0,
      width: meta.width || null,
      height: meta.height || null,
      format: fmt,
      originalBytes: buffer.length,
      cleanedBytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Metadata removal failed' });
  }
});
// Blur detection using Laplacian variance. Lower variance = blurrier image.
router.post('/blur-detect', async (req, res) => {
  try {
    const buf = dataUrlToBuffer(req.body?.imageDataUrl || '');
    if (!buf) return res.status(400).json({ error: 'No valid image provided' });

    const img = sharp(buf).rotate();
    const meta = await img.metadata();
    let w = meta.width || 1;
    let h = meta.height || 1;
    
    // Cap analysis at 800px for speed.
    const cap = 800;
    if (Math.max(w, h) > cap) {
      const s = cap / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }

    // Convert to grayscale for edge detection.
    const gray = await img
      .resize(w, h, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Apply 3x3 Laplacian kernel for edge detection.
    const data = gray.data;
    const stride = gray.info.width;
    let lapSum = 0;
    let count = 0;

    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * stride + x;
        const lap = 
          -1 * data[i - stride - 1] + -1 * data[i - stride] + -1 * data[i - stride + 1]
          + -1 * data[i - 1] + 8 * data[i] + -1 * data[i + 1]
          + -1 * data[i + stride - 1] + -1 * data[i + stride] + -1 * data[i + stride + 1];
        lapSum += lap * lap;
        count += 1;
      }
    }

    const variance = count > 0 ? lapSum / count : 0;
    let status = 'sharp';
    if (variance < 100) status = 'blurry';
    else if (variance < 500) status = 'soft';

    res.json({
      ok: true,
      variance: Number(variance.toFixed(2)),
      status,
      width: meta.width,
      height: meta.height,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Blur detection failed' });
  }
});

module.exports = router;
