// End-to-end checks of Render photo (M4.7) in real Chrome (SwiftShader WebGL). `npm run dev` first, then
// `node scripts/e2e-photo.mjs [screenshotDir] [roomplan.json]`. Software GL is slow, so this renders a tiny picture for a few passes.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './lib/chromium.mjs';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2] ?? 'spike/out-photo';
const file = process.argv[3] ?? 'C:/Users/micha/Downloads/room-1.roomplan (4).json';
mkdirSync(out, { recursive: true });
const base = JSON.parse(readFileSync(file, 'utf8'));
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`); if (!ok) failures++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 240)}`); });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);

// furnished demo room (same layout the stills script uses)
const q = JSON.parse(JSON.stringify(base));
const r = q.rooms[0];
const xs = r.vertices.map((v) => v.position.x), ys = r.vertices.map((v) => v.position.y);
const x0 = Math.min(...xs), y0 = Math.min(...ys);
const defs = Object.fromEntries(q.furnitureDefinitions.map((d) => [d.id, d]));
r.furniture = [];
for (const [id, dx, dy, rot] of [['sofa-3', 1.5, 1.0, 0], ['coffee-table', 1.5, 2.1, 0], ['armchair', 3.2, 2.0, 270], ['bookshelf', 0.3, 2.8, 270]]) {
  const d = defs[id];
  if (d) r.furniture.push({ id: `demo-${id}`, definitionId: id, roomId: r.id, position: { x: x0 + dx, y: y0 + dy }, elevation: 0, rotation: rot, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight });
}
await page.evaluate((p) => { window.roomPlanner.project.getState().load(p); window.roomPlanner.ui.getState().setViewMode('3d'); }, q);
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
await wait(1200);
const before = await page.evaluate(() => JSON.stringify(window.roomPlanner.project.getState().project));

await page.getByRole('button', { name: 'Render photo', exact: true }).click();
await page.getByRole('dialog', { name: 'Render photo' }).waitFor();
check('the Render photo panel opens', true);
check('the panel says what to expect under its title', /not a studio photograph/.test(await page.getByTestId('photo-expectations').innerText()));
check('there is an eye-level view from inside the room', (await page.getByRole('dialog', { name: 'Render photo' }).getByLabel('View', { exact: true }).locator('option', { hasText: 'Inside the room' }).count()) > 0);
check('no WebGL2 warning on this browser', (await page.getByText("can't render photos").count()) === 0);

await page.getByRole('dialog', { name: 'Render photo' }).getByLabel('Size', { exact: true }).selectOption('sm');
await page.getByRole('dialog', { name: 'Render photo' }).getByLabel('Lighting', { exact: true }).selectOption('daylight');
await page.getByRole('button', { name: 'Render', exact: true }).click();
await page.locator('.photo-busy').waitFor({ timeout: 10000 });
check('shows a plain progress message while it prepares', /\S/.test(await page.locator('.photo-busy').innerText()));
// wait for some passes (software GL is slow: allow a long time)
await page.waitForFunction(() => /\d+% · about/.test(document.querySelector('.photo-progress')?.textContent ?? '') || /Done/.test(document.querySelector('.photo-progress')?.textContent ?? ''), null, { timeout: 240000 });
check('reaches rendering with progress and a time estimate', true);
await wait(8000);
const early = await page.evaluate(() => document.querySelector('[data-testid=photo-canvas] canvas').toDataURL('image/png'));
writeFileSync(join(out, 'photo-early.png'), Buffer.from(early.split(',')[1], 'base64'));
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await page.getByText('Paused').first().waitFor();
check('Pause works', true);
await page.getByRole('button', { name: 'Resume', exact: true }).click();
await wait(500);
await page.getByRole('button', { name: 'Stop', exact: true }).click();
await page.getByText('Stopped').first().waitFor();
check('Stop works and keeps the picture', true);
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
const d = await dl;
const path = join(out, d.suggestedFilename());
await d.saveAs(path);
check('PNG file name is <project>-<room>-<date>.png', /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.png$/.test(d.suggestedFilename()), d.suggestedFilename());
check('PNG has content', statSync(path).size > 2000, String(statSync(path).size));
const dims = await page.evaluate(async (b64) => { const img = new Image(); img.src = b64; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }, 'data:image/png;base64,' + readFileSync(path).toString('base64'));
check('PNG is 640 wide and taller than 360 (caption strip added)', dims[0] === 640 && dims[1] > 360, JSON.stringify(dims));
check('design unchanged by rendering', (await page.evaluate(() => JSON.stringify(window.roomPlanner.project.getState().project))) === before);
await page.keyboard.press('Escape');
await wait(300);
check('Esc closes the panel after the render has ended', (await page.getByRole('dialog', { name: 'Render photo' }).count()) === 0);
check('the 3D view is still there', (await page.locator('[data-testid=stage3d] canvas').count()) > 0);
// a change to the design while rendering stops the render
await page.getByRole('button', { name: 'Render photo', exact: true }).click();
await page.getByRole('dialog', { name: 'Render photo' }).waitFor();
await page.getByRole('dialog', { name: 'Render photo' }).getByLabel('Size', { exact: true }).selectOption('sm');
await page.getByRole('button', { name: 'Render', exact: true }).click();
await page.locator('.photo-busy').waitFor({ timeout: 10000 });
await wait(300);
await page.evaluate((p) => { const x = JSON.parse(JSON.stringify(p)); x.rooms[0].furniture = []; window.roomPlanner.project.getState().load(x); }, q);
await page.getByText('The design changed, so the render was stopped.').first().waitFor({ timeout: 120000 });
check('changing the design while rendering stops the render', true);
await page.keyboard.press('Escape');
check('no console or page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('All photo checks passed.');
