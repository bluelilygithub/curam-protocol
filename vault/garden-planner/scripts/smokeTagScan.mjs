// Live check of the plant tag scan with the REAL OCR engine (needs the network once, for the reading model). Draws mock nursery tags on a
// canvas, reads them with the app's own scanner, and prints what was read and which plants matched. Not part of the e2e run (network).
//   cd garden-planner && npx vite --host 127.0.0.1   (in another terminal)   then   node scripts/smokeTagScan.mjs
import { chromium } from 'playwright-core';

const URL = process.env.GP_URL ?? 'http://127.0.0.1:5175/garden-planner-app/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(URL);
await page.waitForSelector('.wizard');

const TAGS = [
  { name: 'clean lavender tag', lines: ['English Lavender', 'Lavandula angustifolia', 'Full sun. Height 60cm', 'Width 60cm   $12.95'], noise: 0 },
  { name: 'grevillea variety, small print', lines: ["Grevillea 'Robyn Gordon'", 'Native shrub - attracts birds', 'Height 1.5m x Width 1.5m', 'Full sun to part shade'], noise: 0 },
  { name: 'washed-out, slightly noisy tag', lines: ['Syzygium smithii', 'Lilly Pilly', 'Height 4-8m  Width 2-4m'], noise: 28 },
];

for (const tag of TAGS) {
  const result = await page.evaluate(async (t) => {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 520;
    const g = c.getContext('2d');
    g.fillStyle = t.noise ? '#d9d6c8' : '#f4f1e8'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = t.noise ? '#6a6a60' : '#1a1a1a';
    t.lines.forEach((l, i) => { g.font = `${i === 0 ? 54 : 38}px Arial`; g.fillText(l, 40, 90 + i * 100); });
    if (t.noise) { const d = g.getImageData(0, 0, c.width, c.height); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * t.noise * 2; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } g.putImageData(d, 0, 0); }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    const t0 = performance.now();
    const r = await window.gardenPlanner.tagScanner.scan(blob, () => undefined);
    return { ...r, ms: Math.round(performance.now() - t0) };
  }, tag);
  console.log(`\n== ${tag.name}  (${result.ms} ms, confidence ${result.meanConf.toFixed(0)})`);
  console.log(result.lines.map((l) => '   | ' + l).join('\n'));
}
await page.evaluate(() => window.gardenPlanner.tagScanner.dispose());
await browser.close();
