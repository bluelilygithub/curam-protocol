// Renders pages of a PDF to PNG with pdf.js (from a CDN) in headless Chrome, for eyeballing generated PDFs: node scripts/renderPdf.mjs in.pdf outPrefix [scale]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , file, prefix, scaleArg] = process.argv;
const scale = Number(scaleArg ?? 1.6);
const b64 = readFileSync(file).toString('base64');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto('about:blank');
const count = await page.evaluate(async ({ b64, scale }) => {
  const url = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/';
  const pdfjs = await import(url + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = url + 'pdf.worker.min.mjs';
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data }).promise;
  document.body.style.margin = '0';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale });
    const c = document.createElement('canvas');
    c.id = 'p' + i; c.width = vp.width; c.height = vp.height; c.style.display = 'block';
    document.body.appendChild(c);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
  return doc.numPages;
}, { b64, scale });
for (let i = 1; i <= count; i += 1) await page.locator('#p' + i).screenshot({ path: `${prefix}-${i}.png` });
console.log(`${count} page(s)`);
await browser.close();
