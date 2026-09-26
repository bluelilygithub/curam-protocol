'use strict';

// Builds the six Stage 2 smoke-set fixtures as real PDF/DOCX buffers, in
// memory, at test-run time — no binaries committed to the repo. DOCX build
// reuses documentRedaction/ingestNormalize.js's buildDocxFromParagraphs
// (already exported for exactly this "plain paragraphs -> minimal OOXML"
// need). PDF build uses pdf-lib (already a dependency, same pattern as
// server/routes/pdf.js). Scanned pages are produced via sharp (already a
// dependency) rendering text to a PNG, then embedded into a PDF page with NO
// text layer — a true image-only page, not a fake.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const sharp = require('sharp');
const { buildDocxFromParagraphs } = require('../../documentRedaction/ingestNormalize');
const texts = require('./fixtureTexts');

// pdf-lib stamps /CreationDate and /ModDate with the current time by default
// — that alone made every "deterministic" fixture non-byte-identical across
// separate runs (confirmed: two independent generations of the same fixture
// hashed differently until this was pinned). Every PDFDocument.create() call
// below sets both to this fixed date immediately.
const FIXED_PDF_DATE = new Date('2026-01-01T00:00:00Z');

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;

function wrapLine(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Builds a typed-text PDF (real text layer) from a block of text, paragraphs
 * separated by blank lines, paginating as needed. */
async function buildTypedPdf(text) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_PDF_DATE);
  doc.setModificationDate(FIXED_PDF_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const paragraphs = text.split(/\n\n+/);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  paragraphs.forEach((para, pIdx) => {
    const lines = wrapLine(para.replace(/\n/g, ' '), font, FONT_SIZE, PAGE_WIDTH - MARGIN * 2);
    for (const line of lines) {
      if (y < MARGIN) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
      y -= LINE_HEIGHT;
    }
    // A full blank-line gap (2x) between EVERY paragraph, not just after the
    // title — confirmed via direct repro against pdftotext -layout (the real
    // extraction path): a single LINE_HEIGHT gap between paragraphs doesn't
    // read back as a blank line at all (poppler keeps them as consecutive
    // single-newline-separated lines), so splitParagraphs() — which splits
    // on blank lines, matching translateExtract.js's own convention — merged
    // the entire fixture into one giant paragraph. A real Word/Adobe-
    // exported document has genuine visible paragraph spacing; this
    // synthetic renderer needs to match that, not the tighter spacing that
    // happened to survive pdf-parse's different (and buggy) y-gap heuristic.
    y -= LINE_HEIGHT * 2;
  });
  return Buffer.from(await doc.save());
}

/** Renders text to a PNG image (via sharp's SVG rasterization), returning a
 * PNG buffer sized to a standard page — used to build a genuine image-only
 * PDF page (no text layer at all). Degraded deterministically (fixed
 * rotation angle, fixed blur radius, a fixed downscale-then-upscale) to
 * resemble a real scan rather than a pristine rendered page — a smoke-set
 * fixture that OCRs perfectly every time isn't testing anything a real
 * scanned contract would actually stress. No randomness anywhere in this
 * pipeline (no Math.random) — every parameter is a fixed constant, so the
 * same input text always produces byte-identical output across separate
 * runs/processes (verified directly: sha256 of two independent generations
 * of the same fixture matches). */
async function renderTextToPng(text) {
  const lines = text.split(/\n\n+/).flatMap((p) => wrapLine(p, { widthOfTextAtSize: (s) => s.length * 6.5 }, FONT_SIZE, PAGE_WIDTH - MARGIN * 2).concat(['']));
  const svgLines = lines.map((line, i) =>
    `<text x="${MARGIN}" y="${MARGIN + (i + 1) * LINE_HEIGHT}" font-family="sans-serif" font-size="${FONT_SIZE}">${escapeXml(line)}</text>`
  ).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}">
    <rect width="100%" height="100%" fill="white"/>
    ${svgLines}
  </svg>`;
  const clean = await sharp(Buffer.from(svg)).png().toBuffer();
  return degradeScanImage(clean);
}

const SCAN_ROTATE_DEGREES = 1.3;      // fixed slight skew, matching an imperfectly-fed scanner page
const SCAN_BLUR_SIGMA = 0.6;          // fixed slight softness
const SCAN_DOWNSCALE_FACTOR = 0.6;    // fixed resolution loss, then scaled back up

/** Deterministically degrades a clean rendered page to resemble a real scan
 * — fixed rotation + blur + a downscale/upscale round-trip for resolution
 * loss. No Math.random or any other non-deterministic input. */
async function degradeScanImage(pngBuffer) {
  const meta = await sharp(pngBuffer).metadata();
  const lowResWidth = Math.round(meta.width * SCAN_DOWNSCALE_FACTOR);
  const lowResHeight = Math.round(meta.height * SCAN_DOWNSCALE_FACTOR);
  return sharp(pngBuffer)
    .resize(lowResWidth, lowResHeight)
    .resize(meta.width, meta.height)
    .blur(SCAN_BLUR_SIGMA)
    .rotate(SCAN_ROTATE_DEGREES, { background: '#ffffff' })
    .png()
    .toBuffer();
}

function escapeXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Builds a true image-only PDF (no text layer) from raw text, by rendering
 * it to a PNG and embedding that image as the entire page content. */
async function buildScannedPdf(text) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_PDF_DATE);
  doc.setModificationDate(FIXED_PDF_DATE);
  const pngBuf = await renderTextToPng(text);
  const png = await doc.embedPng(pngBuf);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawImage(png, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  return Buffer.from(await doc.save());
}

/** Builds a mixed PDF: typed pages (real text layer) followed by one
 * image-only scanned page. */
async function buildMixedPdf(typedText, scannedText) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(FIXED_PDF_DATE);
  doc.setModificationDate(FIXED_PDF_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const paragraphs = typedText.split(/\n\n+/);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  for (const para of paragraphs) {
    const lines = wrapLine(para.replace(/\n/g, ' '), font, FONT_SIZE, PAGE_WIDTH - MARGIN * 2);
    for (const line of lines) {
      if (y < MARGIN) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT;
  }
  const pngBuf = await renderTextToPng(scannedText);
  const png = await doc.embedPng(pngBuf);
  const scannedPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  scannedPage.drawImage(png, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  return Buffer.from(await doc.save());
}

async function buildDocx(text) {
  const paragraphs = text.split(/\n\n+/).map((p) => p.replace(/\n/g, ' '));
  return buildDocxFromParagraphs(paragraphs);
}

async function buildAllFixtures() {
  return {
    scanned: {
      buffer: await buildScannedPdf(texts.SCANNED_SOURCE_TEXT),
      mimeType: 'application/pdf',
      filename: 'scanned-lease.pdf',
    },
    mixed: {
      buffer: await buildMixedPdf(texts.MIXED_TYPED_BODY, texts.MIXED_SCANNED_EXHIBIT_TEXT),
      mimeType: 'application/pdf',
      filename: 'mixed-service-order.pdf',
    },
    unnumbered: {
      buffer: await buildDocx(texts.UNNUMBERED),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'unnumbered-nda.docx',
    },
    deepNesting: {
      buffer: await buildTypedPdf(texts.DEEP_NESTING),
      mimeType: 'application/pdf',
      filename: 'deep-nesting-msa.pdf',
    },
    multiParty: {
      buffer: await buildDocx(texts.MULTI_PARTY),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'multi-party-loan.docx',
    },
    amendment: {
      buffer: await buildTypedPdf(texts.AMENDMENT),
      mimeType: 'application/pdf',
      filename: 'amendment-1.pdf',
    },
  };
}

module.exports = {
  buildAllFixtures,
  buildTypedPdf,
  buildScannedPdf,
  buildMixedPdf,
  buildDocx,
};
