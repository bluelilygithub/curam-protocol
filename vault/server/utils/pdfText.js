'use strict';

/**
 * Plain text out of a PDF, page by page. pdfjs-dist 4+ ships ESM only, so it is loaded with a dynamic
 * import of the .mjs build; require('pdfjs-dist/legacy/build/pdf.js') no longer exists and silently
 * produced empty text for every PDF upload after the 3.x -> 6.x upgrade.
 *
 * Throws on a file pdfjs cannot read; callers decide whether that is an error or an empty result.
 */
async function extractPdfTextFromBuffer(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

module.exports = { extractPdfTextFromBuffer };
