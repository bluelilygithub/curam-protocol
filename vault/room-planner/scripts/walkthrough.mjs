// Drives the real app in Chrome through the Spec §11 early-validation loop (minus 3D and PDF) and saves screenshots.
// Usage: start `npm run dev`, then `node scripts/walkthrough.mjs [outDir]`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? join(process.cwd(), 'walkthrough');
mkdirSync(out, { recursive: true });
const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: join(out, `${name}.png`) }); console.log('shot', name); };
const app = (fn, arg) => page.evaluate(fn, arg);
/** Page coordinates of a world point. */
const at = async (x, y) => app(([x, y]) => {
  const r = document.querySelector('[data-testid=stage]').getBoundingClientRect();
  const v = window.roomPlanner.view.getState().view;
  return { x: r.left + v.offsetX + x * v.scale, y: r.top + v.offsetY - y * v.scale };
}, [x, y]);
const click = async (x, y, o = {}) => { const p = await at(x, y); await page.mouse.click(p.x, p.y, o); };
const move = async (x, y, steps = 8) => { const p = await at(x, y); await page.mouse.move(p.x, p.y, { steps }); };
const drag = async (a, b, { hold = false, steps = 14 } = {}) => {
  const p = await at(...a); const q = await at(...b);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps });
  if (!hold) await page.mouse.up();
};
const state = () => app(() => {
  const s = window.roomPlanner.project.getState();
  const r = s.project.rooms[0];
  return { rooms: s.project.rooms.length, furniture: r?.furniture.map((f) => ({ id: f.id.slice(0, 4), def: f.definitionId, x: f.position.x, y: f.position.y, rot: f.rotation, w: f.width })) ?? [], fixtures: r?.fixtures.map((f) => ({ type: f.type, wall: f.wallId.slice(0, 4), off: f.offsetAlongWall })) ?? [], walls: r?.walls.map((w) => w.thickness), history: s.historyLength(), undo: s.undoLabel };
});

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
await shot('01-empty');

await page.getByRole('button', { name: /Start from a rectangle/ }).click();
await page.waitForTimeout(200);
await shot('02-room');

// walls with unequal thickness via the inspector
for (const [wallIndex, point, value] of [[1, [2, -0.07], '0.15'], [2, [4.1, 2.5], '0.2'], [4, [-0.05, 2.5], '0.1']]) {
  await click(...point);
  await page.waitForTimeout(150);
  const input = page.locator('.panel.right input').first();
  await input.fill(value);
  await input.press('Enter');
  console.log('wall', wallIndex, await state().then((s) => s.walls));
}
await page.keyboard.press('Escape');
await shot('03-thickness');

// door and window with the wall-snap ghost
await page.locator('.card', { hasText: 'Door' }).first().click();
await move(1.2, 0.35); await shot('04-door-ghost');
await click(1.2, 0.35);
await page.locator('.card', { hasText: 'Window' }).first().click();
await move(3.7, 2.8); await click(3.7, 2.8);
await shot('05-door-window');

// sofa + coffee table
await page.locator('.card', { hasText: '3-seat sofa' }).first().click();
await move(2.0, 4.1); await shot('06-sofa-ghost');
await click(2.0, 4.1);
await page.locator('.card', { hasText: 'Coffee table' }).first().click();
await move(2.0, 3.0); await click(2.0, 3.0);
await shot('07-furnished');

// drag with live dimensions (hold)
await click(2.0, 3.0);
await drag([2.0, 3.0], [1.9, 2.2], { hold: true });
await shot('08-drag-live');
await page.mouse.up();

// clearances
await click(2.0, 4.1);
await page.getByTitle('Show clearance zones of the selection').click();
await shot('09-clearance-selected');

// high object (dashed) and invalid placement
await page.locator('.card', { hasText: 'Wardrobe' }).first().click();
await move(3.2, 1.2); await click(3.2, 1.2);
await shot('10-high-object');

await click(2.0, 4.1);
await drag([2.0, 4.1], [0.2, 4.1], { hold: true });
await shot('11-invalid-drag');
await page.mouse.up();
await page.waitForTimeout(500);
await shot('12-after-animate-back');
console.log('final', JSON.stringify(await state()));

// undo / redo
await page.keyboard.press('Control+z');
await shot('13-undo');

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();
