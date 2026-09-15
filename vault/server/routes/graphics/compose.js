'use strict';

// Compose tools: Text Overlay, Composite, Watermark, Batch Text, Collage,
// Favicon / Icons, Vectorize (SVG), AI Icon Library. (Annotate, Eraser and
// Redact are browser-only and have no server routes.)
// `runWatermark` is defined once here and reused by ../optimise's /batch
// (watermark op) so there is exactly one watermark implementation.

const express = require('express');
const router = express.Router();
const sharp = require('sharp');
const archiver = require('archiver');
const ImageTracer = require('imagetracerjs');
const { callModel } = require('../../services/callModel');
const {
  dataUrlToBuffer,
  outputFormatFor,
  clampInt,
  GRAVITY_MAP,
  parseHexColor,
  ICON_MODEL,
  safeJsonParse,
  pickOneOf,
  sanitizeIconName,
  sanitizeSvgMarkup,
} = require('./shared');

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

async function runWatermark(params) {
  const imageDataUrl = String(params?.imageDataUrl || '');
  const buffer = dataUrlToBuffer(imageDataUrl);
  if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
    throw Object.assign(new Error('A valid image is required'), { status: 400 });
  }
  const meta = await sharp(buffer).metadata();
  const fmt = outputFormatFor(meta);
  const type = params?.type === 'image' ? 'image' : 'text';
  const opacity = Math.min(1, Math.max(0, Number(params?.opacity)));
  const op = Number.isFinite(opacity) ? opacity : 0.5;
  const tile = Boolean(params?.tile);
  const gravity = GRAVITY_MAP[params?.position] || 'southeast';

  let overlay;
  if (type === 'text') {
    const text = String(params?.text || '').slice(0, 200);
    if (!text) throw Object.assign(new Error('Watermark text is required'), { status: 400 });
    const color = parseHexColor(params?.color)?.hex || '#ffffff';
    const fontSize = clampInt(params?.fontSize, 8, 600, Math.max(16, Math.round(meta.width * 0.06)));
    const w = Math.ceil(text.length * fontSize * 0.62) + 24;
    const h = Math.ceil(fontSize * 1.5);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="50%" y="50%" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${color}" fill-opacity="${op}" text-anchor="middle" dominant-baseline="middle">${escapeXml(text)}</text></svg>`;
    overlay = Buffer.from(svg);
  } else {
    const wmBuf = dataUrlToBuffer(params?.watermarkDataUrl || '');
    if (!wmBuf) throw Object.assign(new Error('A watermark image is required'), { status: 400 });
    const scale = clampInt(params?.scale, 1, 100, 25) / 100;
    const targetW = Math.max(1, Math.round(meta.width * scale));
    const wm = await sharp(wmBuf).resize({ width: targetW, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < wm.data.length; i += 4) {
      wm.data[i + 3] = Math.round(wm.data[i + 3] * op);
    }
    overlay = await sharp(wm.data, { raw: { width: wm.info.width, height: wm.info.height, channels: 4 } }).png().toBuffer();
  }

  const composite = tile ? { input: overlay, tile: true } : { input: overlay, gravity };
  const out = await sharp(buffer).rotate().composite([composite]).toFormat(fmt).toBuffer();
  const m2 = await sharp(out).metadata().catch(() => null);
  return {
    ok: true,
    type,
    width: m2?.width || null,
    height: m2?.height || null,
    format: fmt,
    bytes: out.length,
    imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
  };
}

router.post('/watermark', async (req, res) => {
  try {
    const result = await runWatermark(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Watermark failed' });
  }
});
// ─── Text overlay + multi-layer composite ──────────────────────────────────
// Distinct from /watermark's text mode, which is deliberately small/corner/
// low-opacity. This is for real headline/caption text: full-size, wrappable,
// with an optional background pill and outline stroke for legibility.

// No real font metrics are available server-side, so wrapping uses the same
// crude character-width heuristic as /watermark's text sizing.
function estimateTextWidth(text, fontSize) {
  return String(text || '').length * fontSize * 0.62;
}

function wrapTextLines(text, fontSize, maxWidthPx) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(candidate, fontSize) > maxWidthPx) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// Builds a standalone SVG (as a Buffer) containing word-wrapped text, an
// optional background pill/box, and an optional stroke outline. Shared by
// /text and /composite so there is exactly one implementation.
function buildTextOverlaySvg({ text, fontSize, color, backgroundColor, align, maxWidthPx, fontWeight, strokeColor, strokeWidth }) {
  const lines = wrapTextLines(text, fontSize, maxWidthPx);
  const lineHeight = Math.ceil(fontSize * 1.25);
  const padding = Math.ceil(fontSize * 0.4);
  const widest = Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)), 1);
  const boxW = Math.ceil(Math.min(maxWidthPx, widest)) + padding * 2;
  const boxH = lines.length * lineHeight + padding * 2;
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const xPos = align === 'left' ? padding : align === 'right' ? boxW - padding : boxW / 2;
  const strokeAttr = strokeColor
    ? ` stroke="${escapeXml(strokeColor)}" stroke-width="${clampInt(strokeWidth, 1, 40, 2)}" paint-order="stroke" stroke-linejoin="round"`
    : '';
  const bgRect = backgroundColor
    ? `<rect x="0" y="0" width="${boxW}" height="${boxH}" fill="${escapeXml(backgroundColor)}" />`
    : '';
  const tspans = lines.map((line, i) => {
    const y = padding + lineHeight * i + lineHeight * 0.8;
    return `<tspan x="${xPos}" y="${y}">${escapeXml(line)}</tspan>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${boxW}" height="${boxH}">${bgRect}<text font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(color)}" text-anchor="${anchor}"${strokeAttr}>${tspans}</text></svg>`;
  return { svg: Buffer.from(svg), width: boxW, height: boxH };
}

// Applies an opacity multiplier to an already-rendered overlay PNG/SVG buffer
// by scaling its alpha channel — shared by /composite for both text and image
// overlay layers (raw watermark image scaling already lived in /watermark).
async function applyOverlayOpacity(buffer, opacity) {
  if (opacity >= 1) return buffer;
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * opacity);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// Resizes + alpha-scales a logo/image overlay — the same approach /watermark
// uses for its image mode, extracted so /composite can reuse it per-layer.
async function buildImageOverlayBuffer(imageDataUrl, targetWidth, opacity) {
  const wmBuf = dataUrlToBuffer(imageDataUrl);
  if (!wmBuf) throw Object.assign(new Error('A valid overlay image is required'), { status: 400 });
  const wm = await sharp(wmBuf).resize({ width: targetWidth, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = Number.isFinite(Number(opacity)) ? Math.min(1, Math.max(0, Number(opacity))) : 1;
  if (alpha < 1) {
    for (let i = 3; i < wm.data.length; i += 4) {
      wm.data[i] = Math.round(wm.data[i] * alpha);
    }
  }
  return sharp(wm.data, { raw: { width: wm.info.width, height: wm.info.height, channels: 4 } }).png().toBuffer();
}

router.post('/text', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const text = String(req.body?.text || '').slice(0, 500);
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const meta = await sharp(buffer).metadata();
    const fmt = outputFormatFor(meta);
    const fontSize = clampInt(req.body?.fontSize, 8, 600, Math.max(24, Math.round(meta.width * 0.08)));
    const color = parseHexColor(req.body?.color)?.hex || '#ffffff';
    const backgroundColor = req.body?.backgroundColor === 'transparent' ? null : (parseHexColor(req.body?.backgroundColor)?.hex || null);
    const align = ['left', 'center', 'right'].includes(req.body?.align) ? req.body.align : 'center';
    const fontWeight = req.body?.fontWeight === 'normal' ? 'normal' : 'bold';
    const maxWidthPct = clampInt(req.body?.maxWidth, 10, 100, 90);
    const maxWidthPx = Math.round(meta.width * (maxWidthPct / 100));
    const strokeColor = parseHexColor(req.body?.strokeColor)?.hex || null;
    const strokeWidth = clampInt(req.body?.strokeWidth, 1, 40, strokeColor ? 2 : 0);
    const gravity = GRAVITY_MAP[req.body?.position] || 'centre';

    const { svg } = buildTextOverlaySvg({ text, fontSize, color, backgroundColor, align, maxWidthPx, fontWeight, strokeColor, strokeWidth });
    const out = await sharp(buffer).rotate().composite([{ input: svg, gravity }]).toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Text overlay failed' });
  }
});
const COMPOSITE_MAX_OVERLAYS = 8;

// Resolves one overlay spec into a sharp composite() input entry. Text
// overlays reuse buildTextOverlaySvg; image overlays reuse
// buildImageOverlayBuffer (the same resize+alpha approach as /watermark's
// image mode). `position` is either a GRAVITY_MAP key, or {x,y} — a fraction
// (0-1) of the base image for percent offsets, otherwise treated as pixels.
async function buildOverlayComposite(overlay, baseMeta) {
  const type = overlay?.type === 'image' ? 'image' : 'text';
  const opacity = Number.isFinite(Number(overlay?.opacity)) ? Math.min(1, Math.max(0, Number(overlay.opacity))) : 1;
  let input;

  if (type === 'text') {
    const text = String(overlay?.text || '').slice(0, 500);
    if (!text) throw Object.assign(new Error('Each text overlay requires text'), { status: 400 });
    const fontSize = clampInt(overlay?.fontSize, 8, 600, Math.max(24, Math.round(baseMeta.width * 0.08)));
    const color = parseHexColor(overlay?.color)?.hex || '#ffffff';
    const backgroundColor = overlay?.backgroundColor === 'transparent' ? null : (parseHexColor(overlay?.backgroundColor)?.hex || null);
    const align = ['left', 'center', 'right'].includes(overlay?.align) ? overlay.align : 'center';
    const fontWeight = overlay?.fontWeight === 'normal' ? 'normal' : 'bold';
    const maxWidthPct = clampInt(overlay?.maxWidth, 10, 100, 90);
    const maxWidthPx = Math.round(baseMeta.width * (maxWidthPct / 100));
    const strokeColor = parseHexColor(overlay?.strokeColor)?.hex || null;
    const strokeWidth = clampInt(overlay?.strokeWidth, 1, 40, strokeColor ? 2 : 0);
    const { svg } = buildTextOverlaySvg({ text, fontSize, color, backgroundColor, align, maxWidthPx, fontWeight, strokeColor, strokeWidth });
    input = await applyOverlayOpacity(svg, opacity);
  } else {
    const scale = clampInt(overlay?.scale, 1, 100, 25) / 100;
    const targetW = Math.max(1, Math.round(baseMeta.width * scale));
    input = await buildImageOverlayBuffer(overlay?.imageDataUrl, targetW, opacity);
  }

  const composite = { input };
  const position = overlay?.position;
  if (position && typeof position === 'object') {
    const xRaw = Number(position.x) || 0;
    const yRaw = Number(position.y) || 0;
    composite.left = xRaw > 0 && xRaw <= 1 ? Math.round(xRaw * baseMeta.width) : clampInt(xRaw, 0, 20000, 0);
    composite.top = yRaw > 0 && yRaw <= 1 ? Math.round(yRaw * baseMeta.height) : clampInt(yRaw, 0, 20000, 0);
  } else {
    composite.gravity = GRAVITY_MAP[position] || 'centre';
  }
  return composite;
}

// Stateless multi-overlay compositing: one base image + an ordered list of
// text/logo layers, applied in a single sharp composite() call. Deliberately
// not a persisted layer stack — every call is a one-shot render.
router.post('/composite', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid base image is required' });
    }
    const overlays = Array.isArray(req.body?.overlays) ? req.body.overlays : [];
    if (!overlays.length) return res.status(400).json({ error: 'Add at least one overlay' });
    if (overlays.length > COMPOSITE_MAX_OVERLAYS) {
      return res.status(400).json({ error: `Too many overlays (max ${COMPOSITE_MAX_OVERLAYS})` });
    }

    const meta = await sharp(buffer).metadata();
    const fmt = outputFormatFor(meta);
    const composites = [];
    for (const overlay of overlays) {
      // Order matters: first overlay is the bottom of the stack. Sequential
      // await keeps composites in the order overlays were given.
      // eslint-disable-next-line no-await-in-loop
      composites.push(await buildOverlayComposite(overlay, meta));
    }

    const out = await sharp(buffer).rotate().composite(composites).toFormat(fmt).toBuffer();
    const m2 = await sharp(out).metadata().catch(() => null);
    res.json({
      ok: true,
      overlays: composites.length,
      width: m2?.width || null,
      height: m2?.height || null,
      format: fmt,
      bytes: out.length,
      imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Composite failed' });
  }
});
router.post('/collage', async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    const buffers = images.map((d) => dataUrlToBuffer(d)).filter(Boolean);
    if (buffers.length < 2) return res.status(400).json({ error: 'Add at least 2 images' });
    const bufs = buffers.slice(0, 9);
    const n = bufs.length;
    const cols = clampInt(req.body?.columns, 1, 5, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const cell = clampInt(req.body?.cellSize, 100, 1500, 400);
    const gap = clampInt(req.body?.spacing, 0, 300, 12);
    const bg = parseHexColor(req.body?.background)?.hex || '#ffffff';
    const bgRgb = parseHexColor(bg);
    const W = cols * cell + (cols + 1) * gap;
    const H = rows * cell + (rows + 1) * gap;

    const composites = [];
    for (let idx = 0; idx < n; idx += 1) {
      const resized = await sharp(bufs[idx]).rotate().resize(cell, cell, { fit: 'cover', position: 'centre' }).toBuffer();
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      composites.push({ input: resized, left: gap + c * (cell + gap), top: gap + r * (cell + gap) });
    }

    const out = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: bgRgb.r, g: bgRgb.g, b: bgRgb.b, alpha: 1 } },
    }).composite(composites).png().toBuffer();

    res.json({
      ok: true,
      count: n,
      columns: cols,
      rows,
      width: W,
      height: H,
      bytes: out.length,
      imageDataUrl: `data:image/png;base64,${out.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Collage failed' });
  }
});
router.post('/favicon', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const sizes = [16, 32, 48, 64, 180, 192, 256, 512];
    const oriented = await sharp(buffer).rotate().toBuffer();
    const files = [];
    for (const s of sizes) {
      // eslint-disable-next-line no-await-in-loop
      const png = await sharp(oriented).resize(s, s, { fit: 'cover', position: 'centre' }).png().toBuffer();
      files.push({ name: `favicon-${s}x${s}.png`, buf: png });
    }

    const manifest = JSON.stringify({
      name: '',
      short_name: '',
      icons: [
        { src: 'favicon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'favicon-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'standalone',
    }, null, 2);

    const html = [
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
      '<link rel="manifest" href="/site.webmanifest">',
    ].join('\n');

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });
    files.forEach((f) => archive.append(f.buf, { name: f.name }));
    const apple = files.find((f) => f.name === 'favicon-180x180.png');
    if (apple) archive.append(apple.buf, { name: 'apple-touch-icon.png' });
    archive.append(manifest, { name: 'site.webmanifest' });
    archive.append(html, { name: 'head-snippet.html' });
    await archive.finalize();
    await done;

    const zip = Buffer.concat(chunks);
    res.json({
      ok: true,
      count: sizes.length,
      sizes,
      bytes: zip.length,
      zipDataUrl: `data:application/zip;base64,${zip.toString('base64')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Favicon generation failed' });
  }
});
// Raster -> SVG vectorisation (tracing). Best for logos, icons and flat
// clipart; photos become stylised. Uses imagetracerjs over sharp-decoded
// pixels; the image is capped in size first so tracing stays fast.
router.post('/vectorize', async (req, res) => {
  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const buffer = dataUrlToBuffer(imageDataUrl);
    if (!buffer || !/^data:image\//i.test(imageDataUrl)) {
      return res.status(400).json({ error: 'A valid image is required' });
    }
    const colors = clampInt(req.body?.colors, 2, 64, 16);
    const detail = String(req.body?.detail || 'medium');
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(700, 700, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const imgd = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    };
    const presets = {
      smooth: { ltres: 1, qtres: 1, pathomit: 8, blurradius: 2, blurdelta: 20 },
      medium: { ltres: 1, qtres: 1, pathomit: 8 },
      detailed: { ltres: 0.5, qtres: 0.5, pathomit: 1 },
    };
    const opts = { numberofcolors: colors, ...(presets[detail] || presets.medium) };
    const svg = ImageTracer.imagedataToSVG(imgd, opts);
    const base64 = Buffer.from(svg, 'utf8').toString('base64');
    res.json({
      ok: true,
      width: info.width,
      height: info.height,
      colors,
      bytes: Buffer.byteLength(svg, 'utf8'),
      svg,
      imageDataUrl: `data:image/svg+xml;base64,${base64}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Vectorize failed' });
  }
});
// AI icon generator — step 1: suggest relevant reference icons for a subject.
router.post('/icon-references', async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim().slice(0, 80);
    if (!subject) return res.status(400).json({ error: 'A subject is required' });
    const system = 'You suggest names of icons that already exist in popular icon libraries. Respond with ONLY minified JSON, no markdown, no commentary.';
    const prompt = `Suggest icons relevant to the subject "${subject}".
Return JSON exactly like: {"lucide":["wallet","credit-card"],"fontawesome":["wallet","chart-line"]}
- "lucide": 12 real lucide-react icon names in kebab-case that genuinely exist.
- "fontawesome": 8 real Font Awesome 6 Free *solid* icon names (the bare name, no "fa-" prefix) that genuinely exist.
No duplicates, no made-up names.`;
    const text = await callModel(ICON_MODEL, prompt, { maxTokens: 600, system });
    const parsed = safeJsonParse(text) || {};
    const clean = (arr) => (Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().toLowerCase().replace(/^fa-/, '')) : []);
    res.json({
      ok: true,
      subject,
      lucide: [...new Set(clean(parsed.lucide))].slice(0, 16),
      fontawesome: [...new Set(clean(parsed.fontawesome))].slice(0, 16),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Icon suggestion failed' });
  }
});

// AI icon generator — step 2: generate a cohesive SVG icon set.
router.post('/icon-generate', async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim().slice(0, 80);
    if (!subject) return res.status(400).json({ error: 'A subject is required' });
    const count = clampInt(req.body?.count, 5, 20, 10);
    const parsedColor = parseHexColor(req.body?.color);
    const color = parsedColor ? parsedColor.hex : '#111111';
    const references = Array.isArray(req.body?.references)
      ? req.body.references.filter((s) => typeof s === 'string').slice(0, 12)
      : [];
    const strokeWeight = pickOneOf(req.body?.strokeWeight, ['super-thin', 'thin', 'regular', 'bold'], 'regular');
    const fillStyle = pickOneOf(req.body?.fillStyle, ['outlined', 'filled', 'duotone'], 'outlined');
    const corners = pickOneOf(req.body?.corners, ['sharp', 'slightly-rounded', 'fully-rounded'], 'slightly-rounded');
    const detail = pickOneOf(req.body?.detail, ['simple', 'medium', 'detailed'], 'medium');
    const existing = Array.isArray(req.body?.existing)
      ? req.body.existing.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 40)
      : [];
    const feedback = String(req.body?.feedback || '').trim().slice(0, 600);
    const strokeMap = { 'super-thin': 1, thin: 1.5, regular: 2, bold: 3 };
    const linejoin = corners === 'sharp' ? 'miter' : 'round';

    let styleRule;
    if (fillStyle === 'outlined') {
      styleRule = `Outlined: stroke="${color}", fill="none", stroke-width="${strokeMap[strokeWeight]}", stroke-linecap="${corners === 'sharp' ? 'butt' : 'round'}", stroke-linejoin="${linejoin}".`;
    } else if (fillStyle === 'filled') {
      styleRule = `Filled: solid fill="${color}", no stroke.`;
    } else {
      styleRule = `Duotone: primary shapes fill="${color}"; secondary shapes use the same colour at fill-opacity="0.35".`;
    }

    const continuation = existing.length
      ? `\nThis is an addition to an EXISTING set. Already in the set (do NOT repeat or duplicate these): ${existing.join(', ')}.\nGenerate ${count} brand-new icons that match the same visual style, weight and theme as the existing set, and fill obvious gaps.`
      : '';
    const refinement = feedback
      ? `\nUser refinement request — honour this closely: ${feedback}`
      : '';

    const system = `You are a senior icon designer at a world-class design studio. Every icon you create is a small act of visual craft, not a task to complete.
Before drawing each icon, ask yourself: what is the most elegant, non-literal way to represent this concept? Avoid the first obvious interpretation. A bank doesn't need columns. A wallet doesn't need stitching.
Apply these principles to every icon:
- Use the fewest paths necessary. If a shape can be suggested rather than fully drawn, prefer suggestion.
- Treat negative space as deliberately as the paths themselves. The space inside and around the icon is part of the design.
- Ensure consistent optical weight across the set. Every icon must feel like it belongs to the same family — same level of abstraction, same visual tension, same relationship between form and space.
- Make optical corrections where needed. Circles should appear visually equal to squares, not mathematically equal.
- Every path must earn its place. If removing it doesn't break the meaning, remove it.
Before finalising each icon, ask: does this look like it was designed, or does it look like it was generated? If you can't tell the difference, redesign it.
Output ONLY raw JSON. No markdown, no code fences, no commentary.`;
    const prompt = `Design a cohesive set of ${count} SVG icons for the subject "${subject}".
Emulate the visual style of these reference icons: ${references.join(', ') || 'clean, modern line icons'}.${continuation}${refinement}
Rules for EVERY icon:
- Root <svg> with xmlns="http://www.w3.org/2000/svg" and viewBox="0 0 24 24" (no width/height).
- ${styleRule}
- Corner feel: ${corners.replace('-', ' ')}. Detail level: ${detail}.
- Consistent visual weight, proportions and padding across the whole set.
- Self-contained, valid SVG only: no <script>, no <image>, no external references, no <style> blocks.
Return ONLY a JSON array of exactly ${count} objects:
[{"name":"short-kebab-name","svg":"<svg ...>...</svg>"}]
Names must be unique, lowercase, kebab-case, and describe the icon.`;

    const maxTokens = Math.min(8000, 1500 + count * 380);
    const result = await callModel(ICON_MODEL, prompt, { maxTokens, system, returnUsage: true });
    const raw = typeof result === 'string' ? result : result.text;
    const arr = safeJsonParse(raw);
    if (!Array.isArray(arr)) throw new Error('The model did not return an icon set — try again');
    const icons = arr
      .map((o, i) => ({ name: sanitizeIconName(o?.name, i), svg: sanitizeSvgMarkup(o?.svg) }))
      .filter((o) => o.svg)
      .slice(0, count);
    if (!icons.length) throw new Error('No valid icons were produced — try again');

    res.json({ ok: true, subject, count: icons.length, color, icons });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Icon generation failed' });
  }
});
// Batch text — composite the same (templated) text label onto multiple images.
// Template variables: {filename}, {index}, {n}, {date}.
router.post('/batch-text', async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) return res.status(400).json({ error: 'No images provided' });
    const items = images.slice(0, 20);

    const textTemplate = String(req.body?.text || '{filename}').slice(0, 200);
    const color = parseHexColor(req.body?.color)?.hex || '#ffffff';
    const bgHex = req.body?.background ? (parseHexColor(req.body.background)?.hex || null) : null;
    const fontSize = clampInt(req.body?.fontSize, 8, 200, 36);
    const opacity = Math.max(0, Math.min(1, Number(req.body?.opacity) || 0.85));
    const gravity = GRAVITY_MAP[req.body?.position] || 'southeast';
    const today = new Date().toISOString().slice(0, 10);

    const results = [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      const dataUrl = typeof item === 'string' ? item : (item.imageDataUrl || '');
      const rawName = typeof item === 'object' ? (item.name || `image-${idx + 1}`) : `image-${idx + 1}`;
      const buf = dataUrlToBuffer(dataUrl);
      if (!buf) { results.push({ name: rawName, error: 'Could not decode image' }); continue; }

      try {
        const meta = await sharp(buf).rotate().metadata();
        const fmt = outputFormatFor(meta);
        const baseName = rawName.replace(/\.[^/.]+$/, '');

        const label = textTemplate
          .replace(/\{filename\}/gi, baseName)
          .replace(/\{index\}/gi, String(idx + 1))
          .replace(/\{n\}/gi, String(items.length))
          .replace(/\{date\}/gi, today);

        const w = Math.ceil(label.length * fontSize * 0.62) + 28;
        const h = Math.ceil(fontSize * 1.6);

        let svgInner = `<text x="50%" y="50%" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${color}" fill-opacity="${opacity}" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>`;
        if (bgHex) {
          svgInner = `<rect width="${w}" height="${h}" fill="${bgHex}" fill-opacity="${Math.min(1, opacity * 1.2)}" rx="4"/>` + svgInner;
        }
        const svgBuf = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svgInner}</svg>`);

        const out = await sharp(buf).rotate().composite([{ input: svgBuf, gravity }]).toFormat(fmt).toBuffer();
        results.push({
          name: `${baseName}.${fmt}`,
          imageDataUrl: `data:image/${fmt};base64,${out.toString('base64')}`,
          bytes: out.length,
          label,
        });
      } catch (e) {
        results.push({ name: rawName, error: e.message || 'Failed' });
      }
    }

    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Batch text failed' });
  }
});

router.runWatermark = runWatermark;

module.exports = router;
