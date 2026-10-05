// Makes the Library thumbnails of the real 3D models (public/models/thumbs/<id>.png, 192 x 132, transparent). `npm run dev` first, then
// `node scripts/stills-thumbs.mjs`. Re-run after adding or changing a model.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = 'public/models/thumbs';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);
const items = await page.evaluate(async () => {
  const { REAL_MODELS } = await import('/room-planner-app/src/data/realModels.ts');
  const { FURNITURE_LIBRARY } = await import('/room-planner-app/src/data/furnitureLibrary.ts');
  return Object.keys(REAL_MODELS).map((id) => { const d = FURNITURE_LIBRARY.find((x) => x.id === id); return { id, w: d.defaultWidth, l: d.defaultLength, h: d.defaultHeight }; });
});
for (const it of items) {
  const url = await page.evaluate(async (it) => {
    const { renderThumb } = await import('/room-planner-app/scripts/thumbs/thumbRender.ts');
    return renderThumb(it.id, it.w, it.l, it.h, [192, 132]);
  }, it);
  if (!url) { console.log(`FAILED ${it.id}`); continue; }
  const buf = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(join(out, `${it.id}.png`), buf);
  console.log(`${it.id}: ${(buf.length / 1024).toFixed(0)} KB`);
}
if (errors.length) console.log('errors:', errors.slice(0, 3).join(' | '));
await browser.close();
