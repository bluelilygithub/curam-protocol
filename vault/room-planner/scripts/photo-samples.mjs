// Owner checkpoint: render real sample photos (to completion) of a furnished demo room. `node scripts/photo-samples.mjs <outDir> [quality draft|good] [size sm|hd] [roomplan.json]`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2] ?? 'spike/out-photo';
const quality = process.argv[3] ?? 'draft';
const size = process.argv[4] ?? 'sm';
const file = process.argv[5] ?? 'C:/Users/micha/Downloads/room-1.roomplan (4).json';
mkdirSync(out, { recursive: true });
const base = JSON.parse(readFileSync(file, 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
const page = await ctx.newPage();
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);
const q = JSON.parse(JSON.stringify(base));
const r = q.rooms[0];
const xs = r.vertices.map((v) => v.position.x), ys = r.vertices.map((v) => v.position.y);
const x0 = Math.min(...xs), y0 = Math.min(...ys);
const defs = Object.fromEntries(q.furnitureDefinitions.map((d) => [d.id, d]));
r.furniture = [];
for (const [id, dx, dy, rot] of [['sofa-3', 1.5, 1.0, 0], ['coffee-table', 1.5, 2.1, 0], ['armchair', 3.2, 2.0, 270], ['bookshelf', 0.3, 2.8, 270], ['side-table', 3.2, 0.6, 0]]) {
  const d = defs[id];
  if (d) r.furniture.push({ id: `demo-${id}`, definitionId: id, roomId: r.id, position: { x: x0 + dx, y: y0 + dy }, elevation: 0, rotation: rot, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight });
}
await page.evaluate((p) => { window.roomPlanner.project.getState().load(p); window.roomPlanner.ui.getState().setViewMode('3d'); }, q);
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
await page.waitForTimeout(1000);
// a closer, lower view so the furniture is the subject
const cx = x0 + 2.4, cz = y0 + 1.6;
await page.evaluate(([cx, cz]) => window.roomPlanner.camera.getState().setCamera({ position: [cx + 3.2, 2.6, cz + 3.4], target: [cx - 0.3, 0.6, cz - 0.2], projection: 'perspective', zoom: 1 }), [cx, cz]);
for (const light of (process.env.LIGHTS ?? 'daylight,evening').split(',')) {
  await page.getByRole('button', { name: 'Render photo', exact: true }).click();
  await page.getByRole('dialog', { name: 'Render photo' }).waitFor();
  await page.getByLabel('Size').selectOption(size);
  await page.getByLabel('Quality').selectOption(quality);
  await page.getByLabel('Lighting').selectOption(light);
  if (process.env.VIEW) await page.getByRole('dialog', { name: 'Render photo' }).getByLabel('View', { exact: true }).selectOption(process.env.VIEW);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await page.waitForFunction(() => /^Done/.test(document.querySelector('.photo-progress span')?.textContent ?? ''), null, { timeout: 40 * 60 * 1000, polling: 2000 });
  const secs = Math.round((Date.now() - t0) / 1000);
  const png = await page.evaluate(() => document.querySelector('[data-testid=photo-canvas] canvas').toDataURL('image/png'));
  writeFileSync(join(out, `sample-${light}-${quality}-${size}${process.env.VIEW ? '-' + process.env.VIEW.replace(':', '') : ''}.png`), Buffer.from(png.split(',')[1], 'base64'));
  console.log(`${light} ${quality} ${size}: ${secs} s (software GL, not your GPU)`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}
await browser.close();
