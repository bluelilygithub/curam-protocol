// Owner checkpoint stills for the real 3D models: each model next to its block stand-in. `npm run dev` first, then `node scripts/stills-models.mjs [outDir]`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2] ?? 'spike/out-models';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);
await page.getByRole('button', { name: 'Start from a rectangle' }).click();
await page.waitForTimeout(500);
await page.evaluate(() => {
  const a = window.roomPlanner;
  const p = JSON.parse(JSON.stringify(a.project.getState().document));
  const r = p.rooms[0];
  const xs = r.vertices.map((v) => v.position.x), ys = r.vertices.map((v) => v.position.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const defs = Object.fromEntries(a.project.getState().project.furnitureDefinitions.map((d) => [d.id, d]));
  const add = (definitionId, dx, dy, rot = 0) => { const d = defs[definitionId]; r.furniture.push({ id: `m-${r.furniture.length}`, definitionId, roomId: r.id, position: { x: x0 + dx, y: y0 + dy }, elevation: 0, rotation: rot, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight }); };
  add('real-sofa', 1.2, 0.6); add('sofa-3', 3.4, 0.6);
  add('real-armchair', 0.6, 2.0); add('armchair', 2.0, 2.0);
  add('real-lounge-chair', 3.4, 2.0); add('real-coffee-table', 1.4, 3.4); add('coffee-table', 3.0, 3.4);
  add('real-dining-chair', 1.0, 4.4); add('dining-chair', 2.6, 4.4);
  add('real-display-shelves', 0.25, 3.0, 270); add('bookshelf', 3.75, 3.0, 90);
  a.project.getState().load(p);
  a.ui.getState().setViewMode('3d');
});
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
await page.waitForTimeout(800);
for (const [name, look] of [['clay', 'clay'], ['realistic', 'realistic']]) {
  await page.evaluate((l) => { const u = window.roomPlanner.ui.getState(); u.setCinematic(true); u.setLook(l); }, look);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, `models-${name}.png`) });
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `models-${name}-top.png`), clip: { x: 280, y: 56, width: 680, height: 620 } });
}
const shotAt = async (name, pos, target) => {
  await page.evaluate(([pos, target]) => window.roomPlanner.camera.getState().requestCamera({ position: pos, target, projection: 'perspective', zoom: 1 }, false), [pos, target]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, `${name}.png`), clip: { x: 280, y: 56, width: 680, height: 620 } });
};
const org = await page.evaluate(() => { const r = window.roomPlanner.project.getState().project.rooms[0]; return { x: Math.min(...r.vertices.map((v) => v.position.x)), y: Math.min(...r.vertices.map((v) => v.position.y)) }; });
// dining chairs seen from the room side (+y), and the shelves from the middle of the room
await shotAt('close-chairs', [org.x + 1.8, 1.4, org.y + 6.2], [org.x + 1.8, 0.5, org.y + 4.4]);
await shotAt('close-shelves', [org.x + 2.0, 1.6, org.y + 3.0], [org.x + 0.3, 0.9, org.y + 3.0]);
console.log(errors.length ? `errors: ${errors.slice(0, 5).join(' | ')}` : 'no errors');
await browser.close();
