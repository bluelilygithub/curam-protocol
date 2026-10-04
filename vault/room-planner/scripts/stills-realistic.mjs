// Owner checkpoint stills for M4.6: owner's room + a furnished demo room, clay vs realistic, from two angles.
// `npm run dev` first, then `node scripts/stills-realistic.mjs <outDir> [roomplan.json]`.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2] ?? 'spike/out-m46';
const file = process.argv[3] ?? 'C:/Users/micha/Downloads/room-1.roomplan (4).json';
mkdirSync(out, { recursive: true });
const base = JSON.parse(readFileSync(file, 'utf8'));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('framenavigated', (f) => console.log('NAV', f.url()));
page.on('crash', () => console.log('CRASH'));
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);

const furnish = (p) => {
  const q = JSON.parse(JSON.stringify(p));
  const r = q.rooms[0];
  const xs = r.vertices.map((v) => v.position.x), ys = r.vertices.map((v) => v.position.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const defs = Object.fromEntries(q.furnitureDefinitions.map((d) => [d.id, d]));
  const add = (definitionId, x, y, rotation = 0) => {
    const d = defs[definitionId];
    if (!d) return;
    r.furniture.push({ id: `demo-${definitionId}-${r.furniture.length}`, definitionId, roomId: r.id, position: { x, y }, elevation: 0, rotation, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight });
  };
  r.furniture = [];
  r.fixtures.push({ id: 'demo-window', type: 'window', wallId: r.walls[1].id, offsetAlongWall: 1.2, width: 1.4, height: 1.2, elevation: 0.9 });
  {
    add('sofa-3', x0 + 1.5, y0 + 1.0);
    add('coffee-table', x0 + 1.5, y0 + 2.1);
    add('armchair', x0 + 3.2, y0 + 2.0, 270);
    add('wardrobe', x1 - 0.5, y0 + 1.5, 90);
    add('bookshelf', x0 + 0.3, y1 - 1.2, 270);
    add('side-table', x0 + 3.2, y0 + 0.6);
    add('tv-unit', x0 + 1.5, y1 - 0.3, 180);
  }
  return q;
};

for (const [name, proj] of [['owner', base], ['furnished', furnish(base)]]) {
  await page.evaluate((p) => { window.roomPlanner.project.getState().load(p); window.roomPlanner.ui.getState().setViewMode('3d'); }, proj);
  await page.waitForTimeout(800);
  for (const look of ['clay', 'realistic']) {
    await page.evaluate((l) => { const u = window.roomPlanner.ui.getState(); u.setCinematic(true); u.setLook(l); u.setQuality('high'); }, look);
    await page.waitForTimeout(1500);
    await page.locator('[data-testid=stage3d]').screenshot({ path: join(out, `${name}-${look}.png`) });
    console.log('wrote', `${name}-${look}.png`);
  }
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
