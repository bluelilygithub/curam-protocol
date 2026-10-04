// Owner checkpoint stills for M4.8: the new library items (rugs, plants, lamp, mirror, seating, storage) in a furnished room, under several
// colour palettes. `npm run dev` first, then `node scripts/stills-palettes.mjs <outDir> [roomplan.json]`.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2] ?? 'spike/out-m48';
const file = process.argv[3] ?? 'C:/Users/micha/Downloads/room-1.roomplan (4).json';
mkdirSync(out, { recursive: true });
const base = JSON.parse(readFileSync(file, 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);

const q = JSON.parse(JSON.stringify(base));
const r = q.rooms[0];
const xs = r.vertices.map((v) => v.position.x), ys = r.vertices.map((v) => v.position.y);
const x0 = Math.min(...xs), y0 = Math.min(...ys);
const lib = await page.evaluate(() => window.roomPlanner.project.getState().project?.furnitureDefinitions ?? []);
const defs = Object.fromEntries([...lib, ...q.furnitureDefinitions].map((d) => [d.id, d]));
r.furniture = [];
const add = (definitionId, dx, dy, rot = 0, extra = {}) => {
  const d = defs[definitionId];
  if (!d) { console.log('missing definition', definitionId); return; }
  r.furniture.push({ id: `demo-${r.furniture.length}-${definitionId}`, definitionId, roomId: r.id, position: { x: x0 + dx, y: y0 + dy }, elevation: 0, rotation: rot, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight, ...extra });
};
add('rug-rect', 1.6, 1.9);
add('sofa-3', 1.6, 0.9);
add('coffee-table', 1.6, 2.0);
add('armchair', 3.3, 2.0, 270);
add('loveseat', 3.2, 0.7, 0);
add('side-table', 0.5, 0.5);
add('plant-large', 0.45, 3.4);
add('floor-lamp', 4.1, 0.5);
add('bookshelf', 0.25, 2.2, 270);
add('ottoman', 2.6, 2.7);
add('mirror-floor', 3.2, 3.6, 180);
add('plant-small', 0.5, 0.5, 0, { elevation: 0.55 });
// wall art on the back wall (the wall along the first corner's y), above the sofa and beside it
add('art-landscape', 1.6, 0.016, 0, { elevation: 1.3 });
add('art-abstract', 0.55, 0.016, 0, { elevation: 1.2 });
add('mirror-round', 2.9, 0.021, 0, { elevation: 1.1 });
add('art-seascape', 4.1, 0.016, 0, { elevation: 1.35 });
add('ceiling-light', 2.4, 1.8, 0, { elevation: 2.6 });
add('pendant-light', 1.6, 2.0, 0, { elevation: 1.8 });
add('downlight', 3.4, 1.4, 0, { elevation: 2.66 });
add('sideboard', 4.2, 3.7, 180);
add('plant-small', 4.2, 3.7, 0, { elevation: 0.8 });
await page.evaluate((p) => { window.roomPlanner.project.getState().load(p); window.roomPlanner.ui.getState().setViewMode('3d'); }, q);
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
await page.waitForTimeout(1000);
const cx = x0 + 2.4, cz = y0 + 1.8;
await page.evaluate(([cx, cz]) => window.roomPlanner.camera.getState().requestCamera({ position: [cx + 0.8, 2.0, cz + 4.4], target: [cx - 0.2, 1.4, cz - 1.4], projection: 'perspective', zoom: 1 }, false), [cx, cz]);
await page.evaluate(() => { const u = window.roomPlanner.ui.getState(); u.setCinematic(true); u.setLook('realistic'); u.setQuality('high'); });
for (const pal of (process.env.PALS ?? ',scandi,coastal,moody,terracotta,sage').split(',')) {
  await page.evaluate((id) => window.roomPlanner.setPalette(id || null), pal);
  await page.waitForTimeout(1600);
  await page.locator('[data-testid=stage3d]').screenshot({ path: join(out, `palette-${pal || 'standard'}.png`) });
  console.log('wrote', pal || 'standard');
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
