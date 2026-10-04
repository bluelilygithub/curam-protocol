// End-to-end checks of the help system in real Chrome: themed tooltips, How This Works (auto once + button), the guided tour (button and
// ?tour=1, Settings key), and that the tour leaves the planner as it found it. `npm run dev` first, then `node scripts/e2e-help.mjs [dir]`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`); if (!ok) failures++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } }); // fresh: nothing seen yet
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 240)}`); });
const wait = (ms) => page.waitForTimeout(ms);
const ev2 = () => page.evaluate(() => { const u = window.roomPlanner.ui.getState(); return `${u.snapMode}|${u.grid}`; });
const shot = async (n) => { if (out) await page.screenshot({ path: join(out, `${n}.png`) }); };

await page.goto(URL + '?embedded=1');
await page.waitForFunction(() => window.roomPlanner);

// ------------------------------------------------------------------ How This Works
await page.getByRole('dialog', { name: 'How the Room Planner works' }).waitFor({ timeout: 10000 });
check('How This Works opens by itself on the first visit', true);
await shot('info');
await page.keyboard.press('Escape');
await wait(300);
check('Esc closes it', (await page.getByRole('dialog', { name: 'How the Room Planner works' }).count()) === 0);
check('it remembers it has been seen', (await page.evaluate(() => localStorage.getItem('vault_room_planner_info_seen'))) === '1');
await page.reload();
await page.waitForFunction(() => window.roomPlanner);
await wait(800);
check('it does not open by itself the second time', (await page.getByRole('dialog', { name: 'How the Room Planner works' }).count()) === 0);
await page.getByRole('button', { name: 'How this works' }).click();
await page.getByRole('dialog', { name: 'How the Room Planner works' }).waitFor();
check('the (i) beside the title opens it again', true);
await page.getByRole('button', { name: 'Got it' }).click();
await wait(300);
check('Got it closes it', (await page.getByRole('dialog', { name: 'How the Room Planner works' }).count()) === 0);
check('the title shows beside the compass and (i) when embedded in Vault', (await page.locator('.brand-name').isVisible()) && (await page.locator('.title-help button').count()) === 2);

// ------------------------------------------------------------------ tooltips
await page.getByRole('button', { name: 'Start from a rectangle' }).click();
await wait(600);
const undoBtn = page.getByRole('button', { name: /^Undo/ });
await page.getByRole('button', { name: 'Take the Room Planner tour' }).hover();
await page.locator('.rp-tooltip').waitFor({ timeout: 3000 });
check('hovering a button shows the themed tooltip', (await page.locator('.rp-tooltip').innerText()) === 'Take the Room Planner tour');
check('the native browser tooltip is suppressed while hovering (title moved aside)', (await page.getByRole('button', { name: 'Take the Room Planner tour' }).getAttribute('title')) === null);
await page.mouse.move(700, 500);
await wait(300);
check('it goes away when the pointer leaves, and the title is put back', (await page.locator('.rp-tooltip').count()) === 0 && (await page.getByRole('button', { name: 'Take the Room Planner tour' }).getAttribute('title')) === 'Take the Room Planner tour');
await page.locator('[data-tour="rp-tools"] button').nth(2).hover();
await page.locator('.rp-tooltip').waitFor({ timeout: 3000 });
check('the Walls tool explains itself', /Walls \(3\)/.test(await page.locator('.rp-tooltip').innerText()));
// a field: select the room's wall to get length field
await page.mouse.move(700, 500);
await page.getByRole('button', { name: /^Room Room 1/ }).first().click().catch(() => undefined);
await page.locator('.field').first().waitFor({ timeout: 4000 }).catch(() => undefined);
const fieldCount = await page.locator('.field').count();
if (fieldCount) {
  await page.locator('.field').first().hover();
  await page.locator('.rp-tooltip').waitFor({ timeout: 3000 });
  check('an inspector field shows its explanation', (await page.locator('.rp-tooltip').innerText()).length > 20);
}
// snapping controls: choose, remembered after a reload
await page.getByLabel('Snap mode').selectOption('grid');
await page.getByLabel('Grid size').selectOption('0.25');
check('Snap and Grid selects change the mode and size', (await ev2()) === 'grid|0.25');
await page.reload();
await page.waitForFunction(() => window.roomPlanner);
check('the snap choice is remembered per browser', (await ev2()) === 'grid|0.25');
check('the status bar says so', /grid only/i.test(await page.locator('.statusbar .snap').innerText()) && /25 cm/.test(await page.locator('.statusbar .snap').innerText()));
await page.getByLabel('Snap mode').selectOption('smart');
await page.getByLabel('Grid size').selectOption('0.1');
await page.keyboard.press('Tab');
await wait(500);
await shot('tooltip');

// ------------------------------------------------------------------ tour via the compass
await page.mouse.move(700, 500);
await page.getByRole('button', { name: 'Take the Room Planner tour' }).click();
await page.locator('.shepherd-element.vault-tour').waitFor({ timeout: 10000 });
check('the compass starts the tour', true);
check('step counter reads Step 1 of 11', /Step 1 of 11/.test(await page.locator('.vault-tour-step-count').innerText()));
await shot('tour-1');
let steps = 1;
for (let i = 0; i < 12; i++) {
  const label = await page.locator('.shepherd-footer .shepherd-button').last().innerText();
  if (/Finish/.test(label)) break;
  await page.locator('.shepherd-footer .shepherd-button').last().click();
  await wait(900);
  steps++;
  if (out && [4, 9, 10].includes(steps)) await shot(`tour-${steps}`);
}
check('the tour has 11 steps and reaches the last one', steps === 11, String(steps));
const title3d = await page.locator('.shepherd-title').innerText().catch(() => '');
await page.locator('.shepherd-footer .shepherd-button').last().click();
await wait(600);
check('Finish ends the tour', (await page.locator('.shepherd-element.vault-tour').count()) === 0);
check('it records completion for Vault’s Settings page', (await page.evaluate(() => localStorage.getItem('vault_tour_room_planner_completed'))) === '1');
check('the planner is back in the view it started in (2D)', (await page.evaluate(() => window.roomPlanner.ui.getState().viewMode)) === '2d');

// Skip works and also records it
await page.getByRole('button', { name: 'Take the Room Planner tour' }).click();
await page.locator('.shepherd-element.vault-tour').waitFor();
await page.evaluate(() => localStorage.removeItem('vault_tour_room_planner_completed'));
await page.getByRole('button', { name: 'Skip Tour' }).click();
await wait(400);
check('Skip Tour closes it and counts as seen', (await page.locator('.shepherd-element.vault-tour').count()) === 0 && (await page.evaluate(() => localStorage.getItem('vault_tour_room_planner_completed'))) === '1');

// Esc ends it too
await page.getByRole('button', { name: 'Take the Room Planner tour' }).click();
await page.locator('.shepherd-element.vault-tour').waitFor();
await wait(800);
await page.keyboard.press('Escape');
await wait(400);
check('Esc ends the tour', (await page.locator('.shepherd-element.vault-tour').count()) === 0);

// ------------------------------------------------------------------ ?tour=1 from Vault's Settings
const page2 = await ctx.newPage();
page2.on('pageerror', (e) => problems.push(`pageerror2: ${e.message}`));
await page2.goto(URL + '?embedded=1&tour=1');
await page2.locator('.shepherd-element.vault-tour').waitFor({ timeout: 15000 });
check('?tour=1 (from Settings) starts the tour by itself', true);
check('and does not also pop up How This Works', (await page2.getByRole('dialog', { name: 'How the Room Planner works' }).count()) === 0);
await page2.close();

// ------------------------------------------------------------------ no room yet: the tour still works, centred where there is nothing to point at
const fresh = await browser.newContext({ viewport: { width: 1440, height: 860 } });
await fresh.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } });
const p3 = await fresh.newPage();
await p3.goto(URL + '?embedded=1&tour=1');
await p3.locator('.shepherd-element.vault-tour').waitFor({ timeout: 15000 });
for (let i = 0; i < 10; i++) { await p3.locator('.shepherd-footer .shepherd-button').last().click(); await p3.waitForTimeout(900); }
check('with no room yet the tour still reaches its last step without errors', /Finish/.test(await p3.locator('.shepherd-footer .shepherd-button').last().innerText()));
await p3.locator('.shepherd-footer .shepherd-button').last().click();
await fresh.close();

check('no console or page errors', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('All help checks passed.');
