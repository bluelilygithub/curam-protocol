// End-to-end: the decluttered layout (one docked 3D bar with a View menu, snap only in the plan, a single Saved status, icon-only undo, grouped
// library, room summary). `npm run dev` first, then `node scripts/e2e-layout.mjs [dir]`.
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
const shot = async (n) => { if (out) await page.screenshot({ path: join(out, `${n}.png`) }); };
await page.goto(URL + '?embedded=1');
await page.waitForFunction(() => window.roomPlanner);
await page.getByRole('button', { name: 'Start from a rectangle' }).click();
await wait(600);

// ---------------------------------------------------------------- library
const groups = page.locator('.lib-group');
check('the library has no category chips, only collapsible groups', (await page.locator('.chip').count()) === 0 && (await groups.count()) >= 6);
const openCount = async () => page.locator('.lib-group[open]').count();
const before = await openCount();
check('only a few groups start open (doors and windows, seating, tables)', before >= 2 && before <= 4, String(before));
await page.locator('.lib-group > summary', { hasText: 'Storage' }).click();
await wait(200);
check('a group opens and closes', (await openCount()) === before + 1);
await page.reload();
await page.waitForFunction(() => window.roomPlanner);
await wait(500);
check('the groups you opened are remembered after a reload', (await openCount()) === before + 1);
await page.getByLabel('Search library').fill('lamp');
await wait(200);
check('searching opens every group that has a match and hides the rest', (await page.locator('.lib-group').count()) >= 1 && (await page.locator('.lib-group:not([open])').count()) === 0);
await page.getByLabel('Search library').fill('');

// ---------------------------------------------------------------- inspector summary
await page.keyboard.press('Escape');
const summary = await page.getByTestId('room-summary').innerText();
check('the room shows a one-line summary', /^4 × 5 m · 20 m² · \d+ objects? · no problems$/.test(summary), summary);
check('the long list of facts is collapsed under Room details', (await page.locator('details.section', { hasText: 'Room details' }).getAttribute('open')) === null);
const boxes = page.locator('.scene-settings details');
check('Colour palette, Lights and Sound are three collapsed boxes below the inspector', (await boxes.count()) === 3 && (await page.locator('.scene-settings details[open]').count()) === 0);

// ---------------------------------------------------------------- toolbar
check('Undo and Redo are icon-only (no text) but named for screen readers and tooltips', (await page.getByRole('button', { name: /^Undo/ }).innerText()).trim() === '' && (await page.getByRole('button', { name: /^Redo/ }).count()) === 1);
check('Snap and Grid show in the plan', (await page.getByLabel('Snap mode').count()) === 1);
await page.waitForFunction(() => window.roomPlanner.library.getState().status === 'saved', null, { timeout: 10000 }).catch(() => undefined);
check('the status says Saved with no Save button when nothing is waiting', /Saved/.test(await page.locator('.save-status').innerText()) && (await page.getByRole('button', { name: 'Save', exact: true }).count()) === 0);
await page.evaluate(() => window.roomPlanner.project.getState().updateSilently((p) => p));
await shot('layout-2d');

// ---------------------------------------------------------------- 3D dock
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
await wait(800);
check('Snap and Grid are hidden in 3D', (await page.getByLabel('Snap mode').count()) === 0);
check('there is exactly one 3D bar, docked at the bottom of the view', (await page.locator('.dock3d').count()) === 1);
const geo = await page.evaluate(() => {
  const d = document.querySelector('.dock3d').getBoundingClientRect();
  const v = document.querySelector('.viewport').getBoundingClientRect();
  return { dockBottom: v.bottom - d.bottom, dockTop: d.top - v.top, dockH: d.height, viewH: v.height, cx: Math.abs((d.left + d.right) / 2 - (v.left + v.right) / 2) };
});
check('it sits at the bottom, centred, and is one slim row', geo.dockBottom < 30 && geo.dockTop > geo.viewH * 0.8 && geo.dockH < 70 && geo.cx < 4, JSON.stringify(geo));
for (const name of ['Perspective', 'Orthographic', 'Isometric', 'Top', 'Fit room', 'Standard', 'Clay', 'Realistic', 'Play tour', 'Render photo']) {
  if ((await page.locator('.dock3d').getByRole('button', { name, exact: true }).count()) !== 1) { check(`the bar has ${name}`, false); }
}
check('the bar has camera, look, tour and photo controls', true);
check('quality, lights, sound, palette, walk and saved views are not on the bar', (await page.locator('.dock3d').getByRole('button', { name: 'Lights', exact: true }).count()) === 0 && (await page.locator('.dock3d').getByLabel('Ambient sound').count()) === 0 && (await page.locator('.dock3d').getByRole('button', { name: 'Walk', exact: true }).count()) === 0 && (await page.locator('.dock3d').getByRole('button', { name: 'Save view' }).count()) === 0);
check('tour settings are hidden until a tour plays', (await page.locator('.dock3d').getByRole('button', { name: 'Loop' }).count()) === 0 && (await page.locator('.tour-note').count()) === 0);
await page.locator('.dock3d').getByRole('button', { name: 'View ▾' }).click();
const menu = page.getByRole('group', { name: 'View options', exact: true });
await menu.waitFor();
for (const label of ['Low', 'High', 'Walk', 'Full screen', 'Save view']) check(`the View menu has ${label}`, (await menu.getByRole('button', { name: label, exact: true }).count()) === 1);
check('Lights, Sound and Palette are no longer in the View menu', (await menu.getByRole('button', { name: 'Lights', exact: true }).count()) === 0 && (await menu.getByLabel('Ambient sound').count()) === 0 && (await menu.getByLabel('Colour palette').count()) === 0);
const mgeo = await page.evaluate(() => { const m = document.querySelector('.dock-menu').getBoundingClientRect(); const d = document.querySelector('.dock3d').getBoundingClientRect(); const v = document.querySelector('.viewport').getBoundingClientRect(); return { above: m.bottom <= d.top + 1, inside: m.left >= v.left - 1 && m.right <= v.right + 1 && m.top >= v.top - 1 }; });
check('the menu opens upward from the bar and stays inside the view', mgeo.above && mgeo.inside, JSON.stringify(mgeo));
await shot('layout-3d-menu');
await page.keyboard.press('Escape');
await wait(200);
check('Esc closes the menu and stays in 3D', (await page.getByRole('group', { name: 'View options', exact: true }).count()) === 0 && (await page.evaluate(() => window.roomPlanner.ui.getState().viewMode)) === '3d');
await page.locator('.dock3d').getByRole('button', { name: 'View ▾' }).click();
await page.mouse.click(600, 300);
await wait(200);
check('a click elsewhere closes it too', (await page.getByRole('group', { name: 'View options', exact: true }).count()) === 0);

// the look segment: Clay turns Cinematic on, Standard turns it off
await page.getByRole('group', { name: 'Look' }).getByRole('button', { name: 'Clay', exact: true }).click();
check('Clay switches Cinematic on', await page.evaluate(() => window.roomPlanner.ui.getState().cinematic && window.roomPlanner.ui.getState().look === 'clay'));
await page.getByRole('group', { name: 'Look' }).getByRole('button', { name: 'Realistic', exact: true }).click();
check('Realistic sets the realistic look', await page.evaluate(() => window.roomPlanner.ui.getState().look === 'realistic'));
await page.getByRole('group', { name: 'Look' }).getByRole('button', { name: 'Standard', exact: true }).click();
check('Standard switches Cinematic off', await page.evaluate(() => !window.roomPlanner.ui.getState().cinematic));
// Play from Standard switches Cinematic on and shows the tour settings
await page.getByRole('button', { name: 'Play tour' }).click();
await wait(500);
check('Play tour works from the Standard look and shows the tour settings', (await page.evaluate(() => window.roomPlanner.ui.getState().cinematic && window.roomPlanner.ui.getState().tourPlaying)) && (await page.getByRole('button', { name: 'Loop' }).count()) === 1);
await page.getByRole('button', { name: 'Pause tour' }).click();
await wait(300);
check('the tour settings go away when it is paused', (await page.getByRole('button', { name: 'Loop' }).count()) === 0);
await shot('layout-3d');

// back in 2D the snap controls return
await page.getByRole('button', { name: '2D', exact: true }).click();
await wait(300);
check('Snap and Grid come back in the plan', (await page.getByLabel('Snap mode').count()) === 1);
check('no console or page errors', problems.length === 0, problems.slice(0, 4).join(' | '));
await browser.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('All layout checks passed.');
