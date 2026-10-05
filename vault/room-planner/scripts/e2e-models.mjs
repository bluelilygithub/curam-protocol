// End-to-end: real 3D models (library cards, shown in Realistic, blocks elsewhere, files served) and the Credits panel.
// `npm run dev` first, then `node scripts/e2e-models.mjs [dir]`.
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
const failed = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 240)}`); });
page.on('response', (r) => { if (/\/models\//.test(r.url()) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);
await page.getByRole('button', { name: 'Start from a rectangle' }).click();
await wait(500);

// library
await page.getByLabel('Search library').fill('3D model');
const cards = await page.locator('.card', { hasText: '3D model' }).count();
check('the library offers the thirteen 3D models', cards === 13, String(cards));
const thumbs = await page.locator('.card img.thumb-3d').evaluateAll((els) => els.map((e) => e.complete && e.naturalWidth > 0));
check('each 3D card shows a picture of the model', thumbs.length === 13 && thumbs.every(Boolean), JSON.stringify(thumbs));
await page.getByLabel('Search library').fill('');

// place a sofa and an armchair, look at them in 3D
await ev(() => {
  const a = window.roomPlanner;
  const p = JSON.parse(JSON.stringify(a.project.getState().document));
  const r = p.rooms[0];
  const defs = Object.fromEntries(a.project.getState().project.furnitureDefinitions.map((d) => [d.id, d]));
  const put = (definitionId, x, y) => { const d = defs[definitionId]; r.furniture.push({ id: `m-${definitionId}`, definitionId, roomId: r.id, position: { x, y }, elevation: 0, rotation: 0, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight }); };
  put('real-sofa', 2, 1); put('real-armchair', 1, 3); put('real-coffee-table', 3, 3);
  a.project.getState().load(p);
  a.ui.getState().setViewMode('3d');
});
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
const modelRequests = () => ev(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/models\/.*\.gltf/.test(n)).length);
await wait(1500);
check('no model is fetched in the Standard look', (await modelRequests()) === 0);
await ev(() => { const u = window.roomPlanner.ui.getState(); u.setCinematic(true); u.setLook('realistic'); });
await wait(4000);
check('the Realistic look fetches each model file once', (await modelRequests()) === 3, String(await modelRequests()));
check('and every model file is served', failed.length === 0, failed.join(' | '));
if (out) await page.screenshot({ path: join(out, 'models-3d.png') });

// the library item in the Inspector says there is no finish to choose
await ev(() => window.roomPlanner.ui.getState().select([{ kind: 'furniture', id: 'm-real-sofa' }]));
await wait(300);
check('a 3D model has no Finish choice and says why', (await page.getByText('keeps its own materials').count()) === 1 && (await page.getByLabel('Finish', { exact: true }).count()) === 0);

// credits
await page.getByRole('button', { name: 'Credits' }).first().click();
const dlg = page.getByRole('dialog', { name: 'Credits' });
await dlg.waitFor();
const text = await dlg.innerText();
check('the credits name every model and its author', /Sofa 02 by Kirill Sannikov/.test(text) && /Modern Arm Chair 01 by Vibrant Nordic/.test(text) && /Dining Chair 02 by James Ray Cock/.test(text) && /Wooden Display Shelves 01 by James Ray Cock/.test(text) && /Mid Century Lounge Chair by Kuutti Siitonen/.test(text) && /Modern Coffee Table 01 by Amin/.test(text), text.slice(0, 400));
check('and state the CC0 licence with a link', /CC0/.test(text) && (await dlg.locator('a[href*="creativecommons.org/publicdomain/zero"]').count()) === 1);
check('model links go to Poly Haven', (await dlg.locator('a[href^="https://polyhaven.com/a/"]').count()) === 13);
if (out) await page.screenshot({ path: join(out, 'credits.png') });
await page.keyboard.press('Escape');
await wait(200);
check('Esc closes the credits', (await page.getByRole('dialog', { name: 'Credits' }).count()) === 0);

// Render photo waits for the models and draws a picture with them
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Render photo', exact: true }).click();
const photo = page.getByRole('dialog', { name: 'Render photo' });
await photo.waitFor();
await photo.getByLabel('Size', { exact: true }).selectOption('sm');
await page.getByRole('button', { name: 'Render', exact: true }).click();
await page.waitForFunction(() => /\d+% · about/.test(document.querySelector('.photo-progress')?.textContent ?? '') || /Done/.test(document.querySelector('.photo-progress')?.textContent ?? ''), null, { timeout: 240000 });
const lit = await ev(() => { const c = document.querySelector('[data-testid=photo-canvas] canvas'); const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data; if (!d) return -1; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`); return seen.size; });
check('Render photo draws a picture of the room with the models', lit === -1 || lit > 12, String(lit));
if (out) await page.screenshot({ path: join(out, 'photo-with-models.png') });
await page.keyboard.press('Escape');
await wait(500);
check('no console or page errors', problems.length === 0, problems.slice(0, 4).join(' | '));
await browser.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('All model checks passed.');
