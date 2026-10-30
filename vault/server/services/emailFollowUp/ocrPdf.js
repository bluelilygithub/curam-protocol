'use strict';

// OCR for scanned PDF pages, for Email Follow-Up. Reuses what Vault already has instead of adding a third copy:
//   - poppler's pdftoppm to turn a page into a picture (server/services/contractReview/pdfRasterize.js; installed in the Dockerfile)
//   - the tesseract.js worker pool (server/services/contractReview/ocrScheduler.js; English, shuts itself down when idle)
// Both are loaded on first use, so nothing here costs anything until a scanned PDF turns up. `deps` lets tests supply fakes.
// OCR text is a guess at what the page says: attachmentText.js marks such a source (parser "tesseract"), and the guard asks for a
// person to confirm any figure that came from one.

const MAX_OCR_PAGES = 10;
const DPI = 200;

/**
 * @param {Buffer} pdf
 * @param {number[]} pageNumbers 1-indexed pages to read
 * @param {{rasterizePages?: Function, recognize?: Function}} [deps]
 * @returns {Promise<{page: number, text: string, confidence: number}[]>}
 */
async function ocrPages(pdf, pageNumbers, deps = {}) {
  const rasterize = deps.rasterizePages || require('../contractReview/pdfRasterize').rasterizePages;
  const recognize = deps.recognize || require('../contractReview/ocrScheduler').recognize;
  const pages = pageNumbers.slice(0, MAX_OCR_PAGES);
  const images = await rasterize(pdf, pages, { dpi: DPI, maxPages: MAX_OCR_PAGES, timeoutMs: 90000 });
  // the worker pool queues these, so this is as parallel as the pool allows
  return Promise.all(pages.map(async (page) => {
    const r = await recognize(images[page]);
    return { page, text: String(r.text || ''), confidence: Number.isFinite(r.confidence) ? r.confidence : 0 };
  }));
}

module.exports = { ocrPages, MAX_OCR_PAGES, DPI };
