// End-to-end: the furniture schedule panel, the CSV download and the PDF download. `npm run dev` first, then `node scripts/e2e-schedule.mjs [dir]`.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2] ?? 'spike/out-schedule';
mkdirSync(out, { recursive: true });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`); if (!ok) failures++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 240)}`); });
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
await page.goto(URL + '?embedded=1');
await page.waitForFunction(() => window.roomPlanner);

check('the Schedule button is disabled with no room', await page.getByRole('button', { name: 'Schedule' }).isDisabled().catch(() => true));
await page.getByRole('button', { name: 'Start from a rectangle' }).click();
await wait(500);
await ev(() => {
  const a = window.roomPlanner;
  const p = JSON.parse(JSON.stringify(a.project.getState().document));
  p.name = 'Smith, "The" House';
  const r = p.rooms[0];
  const defs = Object.fromEntries(a.project.getState().project.furnitureDefinitions.map((d) => [d.id, d]));
  const put = (id, definitionId, x, y, extra = {}) => { const d = defs[definitionId]; r.furniture.push({ id, definitionId, roomId: r.id, position: { x, y }, elevation: 0, rotation: 0, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight, ...extra }); };
  put('s', 'sofa-3', 2, 1, { metadata: { vendor: 'Freedom, Sydney', sku: 'SF-220', unitCost: 1899, finishCode: 'Grey 12', notes: '=cmd' } });
  put('c1', 'dining-chair', 1, 3, { metadata: { unitCost: 120 } });
  put('c2', 'dining-chair', 2, 3, { metadata: { unitCost: 120 } });
  put('t', 'coffee-table', 3, 3);
  r.fixtures.push({ id: 'dr', type: 'door', wallId: r.walls[0].id, offsetAlongWall: 1.2, width: 0.82, height: 2.04, elevation: 0, hingeSide: 'left', swingAngle: 1.5708 });
  a.project.getState().load(p);
});
await wait(500);

await page.getByRole('button', { name: 'Schedule' }).click();
const dlg = page.getByRole('dialog', { name: 'Furniture schedule' });
await dlg.waitFor();
check('the schedule opens', true);
const rows = await dlg.locator('tbody tr:not(.group-row)').allInnerTexts();
check('it lists each kind with its quantity (two chairs are one line)', rows.length === 4 && rows.some((r) => /Dining chair/.test(r) && /\t2\t/.test(r.replace(/\s{2,}/g, '\t'))) , JSON.stringify(rows));
check('it totals the costs (1899 + 2 x 120 = 2139) and says one piece has no cost', /total 2139\.00/.test(await dlg.getByRole('status').innerText()) && /1 without a cost/.test(await dlg.getByRole('status').innerText()), await dlg.getByRole('status').innerText());
check('All rooms is disabled with one room', await dlg.getByRole('button', { name: 'All rooms' }).isDisabled());
await page.screenshot({ path: join(out, 'schedule-panel.png') });

const csvDl = page.waitForEvent('download');
await dlg.getByRole('button', { name: 'Download CSV' }).click();
const csvFile = await csvDl;
const csvPath = join(out, csvFile.suggestedFilename());
await csvFile.saveAs(csvPath);
const csv = readFileSync(csvPath, 'utf8');
check('the CSV is named after the project and room', /^smith-the-house-room-1-schedule\.csv$/.test(csvFile.suggestedFilename()), csvFile.suggestedFilename());
check('it starts with a byte-order mark and the header row', csv.startsWith('﻿No.,Category,Item,Qty,'));
check('it quotes a comma and neutralises a formula', csv.includes('"Freedom, Sydney"') && csv.includes("'=cmd"));
check('it has the totals line', /Total pieces,4,.*2139\.00/.test(csv) && /1 piece without a unit cost are not in the total/.test(csv));

const pdfDl = page.waitForEvent('download', { timeout: 60000 });
await dlg.getByRole('button', { name: 'Download PDF' }).click();
const pdfFile = await pdfDl;
const pdfPath = join(out, pdfFile.suggestedFilename());
await pdfFile.saveAs(pdfPath);
const pdf = readFileSync(pdfPath);
check('the PDF is named after the project and room', /^smith-the-house-room-1-plan\.pdf$/.test(pdfFile.suggestedFilename()), pdfFile.suggestedFilename());
const parsed = await PDFDocument.load(pdf);
check('it is a real PDF with a plan page and a schedule page', pdf.subarray(0, 5).toString() === '%PDF-' && parsed.getPageCount() === 2, String(parsed.getPageCount()));

await page.keyboard.press('Escape');
await wait(200);
check('Esc closes it', (await page.getByRole('dialog', { name: 'Furniture schedule' }).count()) === 0);

// two rooms: all rooms lists the rooms each kind is in
await ev(() => {
  const a = window.roomPlanner;
  a.startRectangle?.();
});
await wait(500);
await page.getByRole('button', { name: 'Schedule' }).click();
await dlg.waitFor();
check('All rooms is available with two rooms', !(await dlg.getByRole('button', { name: 'All rooms' }).isDisabled()));
await dlg.getByRole('button', { name: 'All rooms' }).click();
check('and lists the rooms for each piece', /Room 1/.test(await dlg.locator('tbody').innerText()));
check('no console or page errors', problems.length === 0, problems.slice(0, 4).join(' | '));
await browser.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('All schedule checks passed.');
