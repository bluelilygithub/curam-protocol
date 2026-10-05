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
  const add = (definitionId, dx, dy, rot = 0) => { const d = defs[definitionId]; r.furniture.push({ id: `m-${r.furniture.length}`, definitionId, roomId: r.id, position: { x: x0 + dx, y: y0 + dy }, elevation: d.mount === 'ceiling' ? 2.6 - d.defaultHeight : (d.defaultElevation ?? (definitionId === 'real-vase' ? 0.39 : 0)), rotation: rot, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight }); };
  add('real-rug', 2.0, 2.6); add('real-bed', 3.0, 1.3); add('real-desk', 1.2, 0.55); add('real-sofa', 1.4, 3.6, 180);
  add('real-coffee-table', 2.0, 2.6); add('real-vase', 2.0, 2.6); add('real-ceiling-lamp', 2.0, 2.6);
  add('real-mirror', 3.99, 3.0, 270); add('real-picture', 2.0, 0.02);
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
await shotAt('close-bed', [org.x + 3.0, 2.2, org.y + 4.2], [org.x + 3.0, 0.6, org.y + 1.3]);
await shotAt('close-wall', [org.x + 2.2, 1.5, org.y + 3.6], [org.x + 2.0, 1.0, org.y + 0.3]);
await shotAt('close-mirror', [org.x + 1.5, 1.4, org.y + 3.0], [org.x + 3.95, 1.2, org.y + 3.0]);
console.log(errors.length ? `errors: ${errors.slice(0, 5).join(' | ')}` : 'no errors');
await browser.close();
