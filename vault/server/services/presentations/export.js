'use strict';

// Export one canonical deck to PPTX, PDF, per-slide PNGs (a zip) or a standalone HTML file.
// PPTX keeps every text box editable. PDF/PNG are rendered from the same HTML the live preview uses.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { normalizeDeck } = require('./schema');
const { renderDeckHtml, SIZES } = require('./render');
const { plan } = require('./layouts');
const { assetDir, assetPath, safeAssetName } = require('./sources');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');
const EXPORT_ROOT = path.join(UPLOAD_DIR, 'presentations');
const FORMATS = ['pptx', 'pdf', 'png', 'html'];

const MIME = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  png: 'application/zip',
  html: 'text/html; charset=utf-8',
};

const slug = (s) => String(s || 'presentation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'presentation';

function imageForPptx(ref, userId) {
  const value = String(ref || '').trim();
  if (!value) return null;
  const data = value.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (data) return { data: data[2].replace(/\s/g, ''), ext: data[1].toLowerCase() === 'jpeg' ? 'jpg' : data[1].toLowerCase() };
  const asset = value.match(/^\/api\/presentations\/assets\/\d+\/([A-Za-z0-9._-]+)$/);
  if (asset) {
    try { return { path: assetPath(userId, asset[1]) }; } catch { return null; }
  }
  if (/^https?:\/\/[^\s"'<>]+$/i.test(value)) return { path: value };
  return null;
}

// Slide sizes in inches. Positions come from layouts.js plan() in percent, so 16:9, 4:3 and 1:1 all land on the slide.
const PPTX_SIZES = { '16:9': { w: 10, h: 5.625 }, '4:3': { w: 10, h: 7.5 }, '1:1': { w: 9, h: 9 } };

/** pptxgenjs wants six-digit hex without '#'. */
function pptxColor(hex, fallback = '1F2937') {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}/.test(h) ? h.slice(0, 6).toUpperCase() : fallback;
}

async function buildPptx(deck, theme, { userId, filePath, PptxGenJS = require('pptxgenjs') }) {
  const pptx = new PptxGenJS();
  pptx.author = 'Curam Vault';
  pptx.company = 'Curam Vault';
  pptx.title = deck.title;
  pptx.subject = deck.subtitle || '';
  pptx.lang = 'en-AU';
  if (deck.aspect === '4:3') pptx.layout = 'LAYOUT_4x3';
  else if (deck.aspect === '1:1') {
    pptx.defineLayout({ name: 'PRES_SQUARE', width: 9, height: 9 });
    pptx.layout = 'PRES_SQUARE';
  } else pptx.layout = 'LAYOUT_16x9';

  const size = PPTX_SIZES[deck.aspect] || PPTX_SIZES['16:9'];
  const pt = (px) => Math.max(8, Math.round((px * size.h * 72) / 720)); // px on a 720px-tall slide -> points on this slide
  const geo = (b) => ({ x: (b.x / 100) * size.w, y: (b.y / 100) * size.h, w: (b.w / 100) * size.w, h: (b.h / 100) * size.h });
  const colours = {
    bg: pptxColor(theme.bg, 'FFFFFF'), text: pptxColor(theme.text), primary: pptxColor(theme.primary, '9B5B46'), muted: pptxColor(theme.muted, '6B7280'),
  };
  const fill = (name, alpha) => ({ color: colours[name] || colours.primary, ...(alpha != null && alpha < 1 ? { transparency: Math.round((1 - alpha) * 100) } : {}) });
  const fontFace = String(theme.font || 'Arial').split(',')[0].trim().replace(/['"]/g, '') || 'Arial';
  const SHAPE = { rect: pptx.ShapeType.rect, ellipse: pptx.ShapeType.ellipse, tri: pptx.ShapeType.rtTriangle };

  deck.slides.forEach((slide, index) => {
    const s = pptx.addSlide();
    s.background = { color: colours.bg };
    const p = plan(slide, { designId: deck.designId, aspect: deck.aspect, titleSize: theme.titleSize });

    for (const sh of p.shapes) {
      const opts = {
        ...geo(sh),
        fill: sh.fill ? fill(sh.fill, sh.alpha) : { color: colours.bg, transparency: 100 },
        line: sh.stroke ? { color: colours[sh.stroke], width: sh.strokeWidth || 1 } : { color: colours.bg, transparency: 100, width: 0 },
        ...(sh.kind === 'tri' ? { flipH: true } : {}),
      };
      if (sh.label) {
        s.addText(sh.label, {
          ...opts, shape: SHAPE[sh.kind] || SHAPE.rect, fontFace, fontSize: pt(sh.labelSize || 16), bold: true,
          color: colours[sh.labelColor || 'bg'], align: 'center', valign: 'middle', margin: 0,
        });
      } else s.addShape(SHAPE[sh.kind] || SHAPE.rect, opts);
    }

    for (const im of p.images) {
      const image = imageForPptx(im.ref, userId);
      const g = geo(im);
      if (image) s.addImage({ ...image, ...g, sizing: { type: im.fit === 'cover' ? 'cover' : 'contain', w: g.w, h: g.h } });
    }

    for (const b of p.boxes) {
      const opts = {
        ...geo(b), fontFace, fontSize: pt(b.size), bold: Boolean(b.bold), italic: Boolean(b.italic),
        color: colours[b.color] || colours.text, align: b.align || 'left', valign: b.valign || 'top', margin: 0, fit: 'shrink',
      };
      if (b.bullets) {
        s.addText(b.bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true, paraSpaceAfter: pt(b.size) * 0.4 } })), opts);
      } else s.addText(b.text || '', opts);
    }

    if (theme.showLogo && theme.logoDataUrl) {
      const logo = imageForPptx(theme.logoDataUrl, userId);
      const lw = size.w * 0.15; const lh = size.h * 0.09;
      if (logo) s.addImage({ ...logo, x: size.w - lw - size.w * 0.035, y: size.h * 0.045, w: lw, h: lh, sizing: { type: 'contain', w: lw, h: lh } });
    }
    if (p.number) {
      s.addText(String(index + 1), {
        x: size.w * 0.88, y: size.h * 0.9, w: size.w * 0.09, h: size.h * 0.07, fontFace, fontSize: pt(16), color: colours.muted, align: 'right', valign: 'middle', margin: 0,
      });
    }
    // Speaker notes go into the slide's notes, so they are editable and not shown in the slide show.
    if (slide.notes) s.addNotes(slide.notes);
  });
  await pptx.writeFile({ fileName: filePath });
}

/** Replace owned asset URLs with inline data URLs so a downloaded HTML or a headless browser can load them without a web server. */
async function inlineAssets(html, userId, deps = {}) {
  const readFile = deps.readFile || fs.readFile;
  const re = /src="(\/api\/presentations\/assets\/\d+\/([A-Za-z0-9._-]+))"/g;
  const found = [...html.matchAll(re)];
  let out = html;
  for (const match of found) {
    // eslint-disable-next-line no-await-in-loop
    const bytes = await readFile(assetPath(userId, match[2])).catch(() => null);
    if (!bytes) continue;
    const ext = path.extname(safeAssetName(match[2])).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext === 'svg' ? 'svg+xml' : ext}`;
    out = out.split(match[1]).join(`data:${mime};base64,${bytes.toString('base64')}`);
  }
  return out;
}

async function zipFiles(files, outPath, deps = {}) {
  const makeArchive = deps.archiver || archiver;
  const createWriteStream = deps.createWriteStream || ((p) => require('fs').createWriteStream(p));
  const archive = makeArchive('zip', { zlib: { level: 6 } });
  const output = createWriteStream(outPath);
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  for (const file of files) archive.file(file, { name: path.basename(file) });
  await archive.finalize();
  await done;
}

async function buildBrowserFiles({ html, deck, outDir, baseName, format, deps = {}, onProgress = () => {} }) {
  const chromium = deps.chromium || require('playwright').chromium;
  const size = SIZES[deck.aspect] || SIZES['16:9'];
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--block-new-web-contents'] });
  try {
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))));
    if (format === 'pdf') {
      const filePath = path.join(outDir, `${baseName}.pdf`);
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: filePath, printBackground: true, preferCSSPageSize: true });
      return filePath;
    }
    const locators = await page.locator('.slide').all();
    const files = [];
    for (let i = 0; i < locators.length; i += 1) {
      const filePath = path.join(outDir, `${baseName}-slide-${String(i + 1).padStart(2, '0')}.png`);
      // eslint-disable-next-line no-await-in-loop
      await locators[i].screenshot({ path: filePath });
      files.push(filePath);
    }
    if (!files.length) throw new Error('The deck produced no slides to export.');
    onProgress(85, 'Packing the slide images');
    const zipPath = path.join(outDir, `${baseName}-slides.zip`);
    await zipFiles(files, zipPath, deps);
    return zipPath;
  } finally { await browser.close(); }
}

/**
 * Export a deck. Returns { filePath, fileName, mimeType } for the download route.
 * `deps` exists for direct node tests and has no effect on the API's behaviour.
 */
async function exportDeck({ userId, deck: input, format, applyBrand = false, brand = null, theme = null, onProgress = () => {}, outDir: givenOutDir = null, deps = {} }) {
  if (!FORMATS.includes(format)) throw Object.assign(new Error('Choose PPTX, PDF, PNG or HTML.'), { status: 400 });
  const deck = normalizeDeck(input);
  const resolved = {
    ...require('./schema').resolveTheme(theme || deck.themeId),
    ...(applyBrand && brand?.available ? Object.fromEntries(['bg', 'text', 'primary', 'muted', 'font'].filter((k) => brand[k]).map((k) => [k, brand[k]])) : {}),
    ...(applyBrand && brand?.logoDataUrl ? { showLogo: true, logoDataUrl: brand.logoDataUrl } : {}),
  };
  const mkdir = deps.mkdir || fs.mkdir;
  const writeFile = deps.writeFile || fs.writeFile;
  const outDir = givenOutDir || deps.outDir || path.join(EXPORT_ROOT, String(userId), 'exports');
  await mkdir(outDir, { recursive: true });
  const baseName = `${Date.now().toString(36)}-${slug(deck.title)}`;
  onProgress(15, 'Preparing the slides');
  const html = renderDeckHtml(deck, resolved);

  let filePath;
  if (format === 'pptx') {
    onProgress(40, 'Building the editable PPTX');
    filePath = path.join(outDir, `${baseName}.pptx`);
    await buildPptx(deck, resolved, { userId, filePath, PptxGenJS: deps.PptxGenJS });
  } else if (format === 'html') {
    filePath = path.join(outDir, `${baseName}.html`);
    await writeFile(filePath, await inlineAssets(html, userId, deps), 'utf8');
  } else {
    onProgress(40, 'Rendering the slides');
    const standalone = await inlineAssets(html, userId, deps);
    filePath = await buildBrowserFiles({ html: standalone, deck, outDir, baseName, format, deps, onProgress });
  }
  return { filePath, fileName: path.basename(filePath), mimeType: MIME[format], format };
}

module.exports = {
  FORMATS, MIME, EXPORT_ROOT, PPTX_SIZES, slug, pptxColor, imageForPptx, inlineAssets, zipFiles, buildPptx, buildBrowserFiles, exportDeck,
};
