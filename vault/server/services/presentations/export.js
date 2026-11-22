'use strict';

// Export one canonical deck to PPTX, PDF, per-slide PNGs (a zip) or a standalone HTML file.
// PPTX keeps every text box editable. PDF/PNG are rendered from the same HTML the live preview uses.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { normalizeDeck } = require('./schema');
const { renderDeckHtml, SIZES } = require('./render');
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

  const fg = theme.text || '#1f2937';
  const accent = theme.primary || '#9B5B46';
  const muted = theme.muted || '#6b7280';
  const fontFace = String(theme.font || 'Arial').split(',')[0].trim().replace(/['"]/g, '') || 'Arial';
  const titleSize = Math.max(24, Math.min(60, Number(theme.titleSize) || 40));

  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    s.background = { color: theme.bg || '#ffffff' };
    if (theme.showLogo && theme.logoDataUrl) {
      const logo = imageForPptx(theme.logoDataUrl, userId);
      if (logo) s.addImage({ ...logo, x: 7.6, y: 0.3, w: 1.7, h: 0.7, sizing: { type: 'contain', w: 1.7, h: 0.7 } });
    }
    const centered = slide.layout === 'title' || slide.layout === 'closing';
    s.addText(slide.title || '', {
      x: centered ? 0.8 : 0.7, y: centered ? 2.1 : 0.55, w: centered ? 8.4 : 8.6, h: centered ? 1.5 : 1.1,
      fontSize: centered ? titleSize + 8 : titleSize, bold: true, color: fg, fontFace,
      align: centered ? 'center' : 'left', valign: 'mid',
    });
    if (centered && slide.body) {
      s.addText(slide.body, { x: 1.2, y: 3.7, w: 7.6, h: 1.4, fontSize: 24, color: muted, fontFace, align: 'center', valign: 'mid' });
    } else {
      const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean).slice(0, 6) : [];
      if (bullets.length) {
        const hasImage = Boolean(slide.imageRef) && slide.layout === 'picture';
        s.addText(bullets.map((b) => `•  ${b}`).join('\n'), {
          x: hasImage ? 0.7 : 0.85, y: 1.9, w: hasImage ? 4.2 : 8.2, h: 4.5,
          fontSize: 22, color: fg, fontFace, valign: 'top', breakLine: false,
        });
      }
      if (slide.body) {
        s.addText(slide.body, { x: 0.85, y: 5.2, w: 8.2, h: 1.2, fontSize: 18, color: muted, fontFace, valign: 'top' });
      }
      const image = slide.layout === 'picture' ? imageForPptx(slide.imageRef, userId) : null;
      if (image) s.addImage({ ...image, x: 5.1, y: 1.8, w: 4.1, h: 4.2, sizing: { type: 'contain', w: 4.1, h: 4.2 } });
    }
    // Speaker notes are kept as editable text in the notes master-less slide: a plain text box below the slide is not visible in show mode.
    if (slide.notes) s.addNotes(slide.notes);
    s.addShape(pptx.ShapeType.rect, { x: 9.05, y: 7.0, w: 0.25, h: 0.05, fill: { color: accent }, line: { color: accent, width: 0 } });
  }
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
  FORMATS, MIME, EXPORT_ROOT, slug, imageForPptx, inlineAssets, zipFiles, buildPptx, buildBrowserFiles, exportDeck,
};
