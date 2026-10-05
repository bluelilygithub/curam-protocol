// End-to-end: your own photo in a picture frame, the Lights button, the table lamp. `npm run dev` first, then `node scripts/e2e-picture.mjs [dir]`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2] ?? 'spike/out-picture';
mkdirSync(out, { recursive: true });
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
await page.goto(URL);
await page.waitForFunction(() => window.roomPlanner);

// a room with a photo frame on the back wall, a side table and a table lamp on it
await page.getByRole('button', { name: 'Start from a rectangle' }).click();
await wait(500);
await ev(() => {
  const a = window.roomPlanner;
  const p = JSON.parse(JSON.stringify(a.project.getState().document));
  const r = p.rooms[0];
  const defs = Object.fromEntries(window.roomPlanner.project.getState().project.furnitureDefinitions.map((d) => [d.id, d]));
  const put = (definitionId, x, y, extra = {}) => { const d = defs[definitionId]; r.furniture.push({ id: `t-${definitionId}`, definitionId, roomId: r.id, position: { x, y }, elevation: 0, rotation: 0, width: d.defaultWidth, length: d.defaultLength, height: d.defaultHeight, ...extra }); };
  put('photo-frame', 2, 0.016, { elevation: 1.4 });
  put('side-table', 3, 1.0);
  put('table-lamp', 3, 1.0, { elevation: 0.55 });
  put('ceiling-light', 2, 2.5, { elevation: 2.6 });
  a.project.getState().load(p);
});
await wait(500);
check('the library offers a table lamp and a photo frame', (await ev(() => ['table-lamp', 'photo-frame'].every((id) => window.roomPlanner.project.getState().project.furnitureDefinitions.some((d) => d.id === id)))));

// ---------------------------------------------------------------- own photo in the frame
await ev(() => window.roomPlanner.ui.getState().select([{ kind: 'furniture', id: 't-photo-frame' }]));
await page.getByText('Picture', { exact: true }).waitFor({ timeout: 5000 });
check('the Inspector offers a Picture section for a frame', true);
const png = await ev(() => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1000; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 1600, 1000); gr.addColorStop(0, '#d94f30'); gr.addColorStop(1, '#2f6f9a'); g.fillStyle = gr; g.fillRect(0, 0, 1600, 1000); g.fillStyle = '#fff'; g.beginPath(); g.arc(800, 500, 260, 0, 7); g.fill(); return c.toDataURL('image/png'); });
const file = join(out, 'my-holiday.png');
writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
await page.getByLabel('Choose a photo').setInputFiles(file);
await page.waitForFunction(() => { const p = window.roomPlanner.project.getState().project; return !!p.rooms[0].furniture.find((f) => f.id === 't-photo-frame')?.imageId; }, null, { timeout: 15000 });
const st = await ev(() => {
  const p = window.roomPlanner.project.getState().project;
  const f = p.rooms[0].furniture.find((x) => x.id === 't-photo-frame');
  const im = p.images?.[f.imageId];
  return { w: f.width, h: f.height, len: f.length, im: im ? { w: im.width, h: im.height, chars: im.dataUrl.length, name: im.name, jpeg: im.dataUrl.startsWith('data:image/jpeg') } : null, count: Object.keys(p.images ?? {}).length };
});
check('the photo is stored in the project, shrunk to 640 px and as a JPEG', !!st.im && st.im.w === 640 && st.im.h === 400 && st.im.jpeg && st.im.chars < 260000, JSON.stringify(st.im));
check('it is named after the file', st.im?.name === 'my-holiday');
check('the frame is reshaped to the photo (1.6 : 1) and keeps its thickness', Math.abs(st.w / st.h - 1.6) < 0.01 && st.len === 0.03, JSON.stringify(st));
check('the Inspector says it is showing your photo', (await page.getByText('Showing your photo').count()) > 0);

// 3D: the picture material carries the photo texture once loaded
await ev(() => { const a = window.roomPlanner; a.setViewMode('3d'); });
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 30000 });
await ev(() => { const u = window.roomPlanner.ui.getState(); u.setCinematic(true); u.setLook('realistic'); });
await wait(1500);
const hasMap = await ev(() => {
  const g = window.roomPlanner3d.scene3d.furnitureObject('t-photo-frame');
  let found = false;
  g.traverse((o) => { const m = o.material; if (o.isMesh && m?.map && m.map.image && m.map.image.width === 640) found = true; });
  return found;
});
check('the frame shows the photo in the Realistic look', hasMap);
await page.screenshot({ path: join(out, 'photo-in-frame.png') });

// ---------------------------------------------------------------- Lights button
check('Lights is enabled in the Realistic look', !(await page.getByRole('button', { name: 'Lights', exact: true }).isDisabled()));
const glow = () => ev(() => { let n = 0; window.roomPlanner3d.scene3d.root.traverse((o) => { if (o.isMesh && o.material?.emissive && o.material.emissive.getHex() !== 0) n++; }); return n; });
const lamps = () => ev(() => { let n = 0; window.roomPlanner3d.scene3d.root.traverse((o) => { if (o.isPointLight) n++; }); return n; });
const onGlow = await glow();
const onLamps = await lamps();
check('with the lights on the ceiling light and table lamp glow and light the room', onGlow >= 2 && onLamps === 2, `${onGlow} glowing, ${onLamps} lights`);
await page.getByRole('button', { name: 'Lights', exact: true }).click();
await wait(500);
check('switching the lights off removes the glow and the light', (await glow()) === 0 && (await lamps()) === 0, `${await glow()} glowing, ${await lamps()} lights`);
await page.getByRole('button', { name: 'Lights', exact: true }).click();
await wait(500);
check('and on again brings them back', (await lamps()) === 2);
await ev(() => window.roomPlanner.ui.getState().setLook('clay'));
await wait(300);
check('Lights is disabled in the Clay look, with a tooltip that says why', await page.getByRole('button', { name: 'Lights', exact: true }).isDisabled());
await ev(() => window.roomPlanner.ui.getState().setLook('realistic'));

// ---------------------------------------------------------------- undo and back to the built-in picture
await ev(() => { window.roomPlanner.setViewMode('2d'); window.roomPlanner.ui.getState().select([{ kind: 'furniture', id: 't-photo-frame' }]); });
await page.getByRole('button', { name: 'Use the built-in picture' }).click();
await wait(300);
check('Use the built-in picture clears the photo', (await ev(() => window.roomPlanner.project.getState().project.rooms[0].furniture.find((f) => f.id === 't-photo-frame').imageId ?? null)) === null);
await ev(() => window.roomPlanner.project.getState().undo());
check('undo brings the photo back', !!(await ev(() => window.roomPlanner.project.getState().project.rooms[0].furniture.find((f) => f.id === 't-photo-frame').imageId)));
await ev(() => window.roomPlanner.project.getState().undo());
const back = await ev(() => { const f = window.roomPlanner.project.getState().project.rooms[0].furniture.find((x) => x.id === 't-photo-frame'); return { w: f.width, h: f.height, id: f.imageId ?? null }; });
check('undoing the photo restores the frame shape too', back.id === null && Math.abs(back.w - 0.4) < 0.001 && Math.abs(back.h - 0.5) < 0.001, JSON.stringify(back));

// a file that is not a picture is refused in plain words
await ev(() => window.roomPlanner.ui.getState().select([{ kind: 'furniture', id: 't-photo-frame' }]));
const txt = join(out, 'notes.txt');
writeFileSync(txt, 'not a picture');
await page.getByLabel('Choose a photo').setInputFiles(txt);
await page.getByText('not a picture').first().waitFor({ timeout: 5000 });
check('a file that is not a picture is refused with a plain message', true);
check('no console or page errors', problems.length === 0, problems.slice(0, 4).join(' | '));
await browser.close();
if (failures) { console.log(`${failures} check(s) failed`); process.exit(1); }
console.log('All picture checks passed.');
