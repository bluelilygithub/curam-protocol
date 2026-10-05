// End-to-end: hover labels in the plan, the grid on the floor inside the room, the Show room chip and Home key, and the lights hints.
// `npm run dev` first, then `node scripts/e2e-hints.mjs [dir]`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`); if (!ok) failures++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 240)}`); });
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = async (n) => { if (out) await page.screenshot({ path: join(out, `${n}.png`) }); };
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);
await page.getByRole('button', { name: 'Start from a rectangle' }).click();
await wait(600);

// a sofa and a ceiling light in the room
await ev(() => {
  const a = window.roomPlanner;
  const p = JSON.parse(JSON.stringify(a.project.getState().document));
  const r = p.rooms[0];
  const defs = Object.fromEntries(a.project.getState().project.furnitureDefinitions.map((d) => [d.id, d]));
  const put = (definitionId, x, y, extra = {}) => { const d = defs[definitionId]; r.furniture.push({ id: `t-${definitionId}`, definitionId, roomId: r.id, position: { x, y }, elevation: 0, rotation: 0, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight, ...extra }); };
  put('sofa-3', 2, 1.0);
  put('ceiling-light', 2, 3.0, { elevation: 2.6 });
  a.project.getState().load(p);
});
await wait(600);
const world = (x, y) => ev(([x, y]) => { const a = window.roomPlanner; const v = a.view.getState().view; const r = document.querySelector('[data-testid=stage]').getBoundingClientRect(); return { x: r.left + v.offsetX + x * v.scale, y: r.top + v.offsetY - y * v.scale }; }, [x, y]);

// ---------------------------------------------------------------- hover label
const onSofa = await world(2, 1.0);
await page.mouse.move(onSofa.x - 200, onSofa.y - 200);
await page.mouse.move(onSofa.x, onSofa.y, { steps: 4 });
await wait(150);
const tip = page.getByTestId('hover-label');
check('hovering a piece in the plan shows its name and size', (await tip.isVisible()) && /3-seat sofa · 2\.2 × 0\.95 × 0\.85 m/.test(await tip.innerText()), await tip.innerText());
const onLight = await world(2, 3.0);
await page.mouse.move(onLight.x, onLight.y, { steps: 4 });
await wait(150);
check('a ceiling light shows its height too', /Ceiling light/.test(await tip.innerText()) && /at 2\.6 m/.test(await tip.innerText()), await tip.innerText());
await page.mouse.move(onSofa.x - 400, onSofa.y + 150, { steps: 4 });
await wait(150);
check('the label goes away over empty floor', !(await tip.isVisible()));
await page.mouse.move(onSofa.x, onSofa.y, { steps: 3 });
await page.mouse.down();
await wait(100);
check('and while pressing or dragging', !(await tip.isVisible()));
await page.mouse.up();

// ---------------------------------------------------------------- grid inside the room
const gridInfo = await ev(() => {
  const a = window.roomPlanner;
  const v = a.view.getState().view;
  const canvases = [...document.querySelectorAll('[data-testid=stage] canvas')];
  const rect = canvases[0].getBoundingClientRect();
  const room = a.project.getState().project.rooms[0];
  const c = room.vertices[0].position;
  // sample a horizontal line a little way inside the room, away from the furniture, across 0.5 m
  const y = c.y + 3.6;
  const px = Math.round(v.offsetX + (c.x + 0.4) * v.scale);
  const py = Math.round(v.offsetY - y * v.scale);
  const vals = new Set();
  for (const cv of canvases) {
    const g = cv.getContext('2d');
    if (!g) continue;
    const d = g.getImageData(px, py, Math.round(0.5 * v.scale), 1).data;
    const cols = [];
    for (let i = 0; i < d.length; i += 4) cols.push(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    if (new Set(cols).size > 1) cols.forEach((x) => vals.add(x));
  }
  return { distinct: vals.size, scale: v.scale };
});
check('grid lines show on the floor inside the room', gridInfo.distinct >= 2, JSON.stringify(gridInfo));
await ev(() => window.roomPlanner.ui.getState().toggleGrid());
await wait(300);
const gridOff = await ev(() => {
  const a = window.roomPlanner;
  const v = a.view.getState().view;
  const room = a.project.getState().project.rooms[0];
  const c = room.vertices[0].position;
  const px = Math.round(v.offsetX + (c.x + 0.4) * v.scale);
  const py = Math.round(v.offsetY - (c.y + 3.6) * v.scale);
  const vals = new Set();
  for (const cv of document.querySelectorAll('[data-testid=stage] canvas')) {
    const g = cv.getContext('2d');
    const d = g.getImageData(px, py, Math.round(0.5 * v.scale), 1).data;
    const cols = [];
    for (let i = 0; i < d.length; i += 4) cols.push(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    if (new Set(cols).size > 1) cols.forEach((x) => vals.add(x));
  }
  return vals.size;
});
check('turning the grid off removes them again', gridOff < gridInfo.distinct, `${gridOff} vs ${gridInfo.distinct}`);
await ev(() => window.roomPlanner.ui.getState().toggleGrid());
await wait(300);
await shot('hints-grid');

// ---------------------------------------------------------------- lost room
check('no Show room chip while the room is in view', (await page.getByTestId('recentre').count()) === 0);
await ev(() => { const a = window.roomPlanner; const v = a.view.getState().view; a.view.getState().setView({ ...v, offsetX: v.offsetX + 4000 }); });
await wait(300);
check('the Show room chip appears when the room is dragged off the page', (await page.getByTestId('recentre').count()) === 1);
await shot('hints-lost');
await page.getByRole('button', { name: 'Show room' }).click();
await wait(300);
check('Show room brings it back and the chip goes', (await page.getByTestId('recentre').count()) === 0);
await ev(() => { const a = window.roomPlanner; const v = a.view.getState().view; a.view.getState().setView({ ...v, offsetX: v.offsetX - 5000, offsetY: v.offsetY + 3000 }); });
await wait(300);
await page.locator('[data-testid=stage]').hover();
await page.keyboard.press('Home');
await wait(300);
check('the Home key does the same', (await page.getByTestId('recentre').count()) === 0);

// ---------------------------------------------------------------- lights hints
await ev(() => window.roomPlanner.ui.getState().select([{ kind: 'furniture', id: 't-ceiling-light' }]));
await wait(300);
check('a light in the plan says where it can be seen', (await page.locator('.light-hint', { hasText: 'Realistic 3D look' }).count()) === 1);
await page.getByRole('button', { name: 'See it in 3D' }).click();
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
await wait(800);
const st = await ev(() => { const u = window.roomPlanner.ui.getState(); return { view: u.viewMode, cine: u.cinematic, look: u.look, on: u.lightsOn }; });
check('See it in 3D opens the Realistic look with the lights on', st.view === '3d' && st.cine && st.look === 'realistic' && st.on, JSON.stringify(st));
check('the hint is gone once you can see them', (await page.locator('.light-hint').count()) === 0);
await page.getByRole('group', { name: 'Look' }).getByRole('button', { name: 'Standard', exact: true }).click();
await wait(400);
check('in 3D without the Realistic look the room says it has lights', (await page.getByTestId('lights-hint').count()) === 1);
await page.getByTestId('lights-hint').getByRole('button', { name: 'Show Realistic' }).click();
await wait(400);
check('Show Realistic switches the look and the hint goes', (await ev(() => window.roomPlanner.ui.getState().look)) === 'realistic' && (await page.getByTestId('lights-hint').count()) === 0);
await page.getByRole('group', { name: 'Look' }).getByRole('button', { name: 'Standard', exact: true }).click();
await page.getByTestId('lights-hint').getByRole('button', { name: 'Dismiss' }).click();
check('the hint can be dismissed', (await page.getByTestId('lights-hint').count()) === 0);
await shot('hints-3d');

// placing a light says the same, in a status message
await ev(() => window.roomPlanner.setViewMode('2d'));
await ev(() => { window.roomPlanner.project.getState().undo?.(); });
await page.getByLabel('Search library').fill('table lamp');
await page.locator('.card', { hasText: 'Table lamp' }).first().click();
await page.getByLabel('Search library').fill('');
const spot = await world(3, 3.5);
await page.mouse.move(spot.x, spot.y, { steps: 5 });
await page.mouse.click(spot.x, spot.y);
await wait(400);
check('placing a lamp says where lights can be seen', /Lights show in the Realistic 3D look/.test(await page.locator('.statusbar').innerText()));
check('no console or page errors', problems.length === 0, problems.slice(0, 4).join(' | '));
await browser.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('All hint checks passed.');
