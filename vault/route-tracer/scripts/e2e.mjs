// Draw-and-save end-to-end test in real Chrome. The MapTiler style and the Vault API are stubbed in the browser (the server routes
// have their own test: npm run test:route-tracks), so this proves the frontend flow: draw, undo, save, list, reload, pan, extend, delete.
// Start `npm run dev` first (port 5177), then `node scripts/e2e.mjs [screenshotDir]`. Exits non-zero if any check fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const APP = process.env.RT_URL ?? 'http://127.0.0.1:5177/route-tracer-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`); if (!ok) failures++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const AUTH = () => { try { localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 1 } } })); } catch { /* none */ } };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['geolocation'], geolocation: { latitude: -27.47, longitude: 153.03 } });
await ctx.addInitScript(AUTH);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console.error: ${m.text().slice(0, 200)}`); });

// ---- stubs
const STYLE = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#dde6dd' } }] };
const cors = { 'access-control-allow-origin': '*' };
const styleHits = [];
await page.route('https://api.maptiler.com/**', (r) => { styleHits.push(r.request().url().split('/maps/')[1]?.split('/')[0]); return r.fulfill({ json: STYLE, headers: cors }); });
const db = [];
let seq = 0;
const rad = Math.PI / 180;
const dist = (lines) => lines.reduce((m, l) => m + l.slice(1).reduce((a, p, i) => {
  const [x1, y1] = l[i]; const [x2, y2] = p;
  const h = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
  return a + 2 * 6371008.8 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}, 0), 0);
const bbox = (lines) => { const xs = lines.flat().map((p) => p[0]); const ys = lines.flat().map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const summary = (t) => { const { geometry, notes, updatedAt, ...s } = t; return s; };
await page.route('**/api/route-tracks**', async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname.replace('/api/route-tracks', '');
  const m = req.method();
  if (m === 'GET' && path === '/config') return route.fulfill({ json: { maptilerKey: 'test' } });
  if (m === 'GET' && path === '') return route.fulfill({ json: { tracks: [...db].reverse().map(summary), nextCursor: null } });
  if (m === 'POST' && path === '') {
    const b = req.postDataJSON();
    const lines = b.geometry.coordinates;
    const t = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, name: b.name, notes: b.notes ?? null, color: b.color, geometry: b.geometry, distanceM: dist(lines), pointCount: lines.flat().length, bbox: bbox(lines), drawMode: b.drawMode, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.push(t);
    return route.fulfill({ status: 201, json: { track: t } });
  }
  const t = db.find((x) => x.id === path.split('/')[1]);
  if (!t) return route.fulfill({ status: 404, json: { error: 'That track was not found.' } });
  if (m === 'GET') return route.fulfill({ json: { track: t } });
  if (m === 'PATCH') {
    Object.assign(t, req.postDataJSON());
    t.distanceM = dist(t.geometry.coordinates); t.pointCount = t.geometry.coordinates.flat().length; t.bbox = bbox(t.geometry.coordinates);
    return route.fulfill({ json: { track: t } });
  }
  if (m === 'DELETE') { db.splice(db.indexOf(t), 1); return route.fulfill({ status: 204, body: '' }); }
  return route.fulfill({ status: 405, json: {} });
});

const wait = (ms) => page.waitForTimeout(ms);
const readout = async () => (await page.getByTestId('distance').textContent()) ?? '';
const km = (s) => (s.endsWith(' km') ? parseFloat(s) : parseFloat(s) / 1000);
const shot = async (n) => { if (out) await page.screenshot({ path: join(out, `${n}.png`) }); };
const lineCount = () => page.evaluate(() => (window.routeTracer.sent?.draw?.features ?? []).filter((f) => f.properties.kind === 'line').length);
const center = () => page.evaluate(() => window.routeTracer.map.getCenter().toArray());
const ready = (p) => p.waitForFunction(() => window.routeTracer?.map?.isStyleLoaded());

async function stroke(points) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) await page.mouse.move(points[i][0], points[i][1], { steps: 6 });
  await page.mouse.up();
  await wait(150);
}

await page.goto(APP);
await ready(page);
check('map loads with the key from /config', true);

// ---- freehand
await page.getByRole('button', { name: 'Draw', exact: true }).click();
check('draw toolbar opens', await page.getByRole('region', { name: 'Drawing tools' }).isVisible());
check('readout starts at 0 m', (await readout()) === '0 m', await readout());
await stroke([[300, 300], [500, 350], [700, 300]]);
const d1 = await readout();
check('live distance after stroke 1', km(d1) > 0, d1);
await stroke([[300, 500], [500, 560], [700, 500]]);
const d2 = await readout();
check('stroke 2 adds distance as a separate line', km(d2) > km(d1) && (await lineCount()) === 2, `${d1} -> ${d2}, lines ${await lineCount()}`);
await page.getByRole('button', { name: 'Undo' }).click();
await wait(300); // React and the next animation frame catch up
check('undo removes exactly one stroke', (await readout()) === d1 && (await lineCount()) === 1, `${await readout()} / ${await lineCount()}`);
await shot('freehand');

// ---- Space + drag pans and draws nothing; wheel zooms
const c0 = await center();
await page.keyboard.down('Space');
await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(400, 300, { steps: 8 }); await page.mouse.up();
await page.keyboard.up('Space');
await wait(300);
const c1 = await center();
check('Space + drag pans the map', Math.abs(c1[0] - c0[0]) > 1e-5 || Math.abs(c1[1] - c0[1]) > 1e-5);
check('Space + drag adds no line', (await lineCount()) === 1 && (await readout()) === d1);
const z0 = await page.evaluate(() => window.routeTracer.map.getZoom());
await page.mouse.move(640, 400);
for (let i = 0; i < 3; i += 1) { await page.mouse.wheel(0, -240); await wait(120); }
const zoomed = await page.waitForFunction((z) => window.routeTracer.map.getZoom() !== z, z0, { timeout: 4000 }).then(() => true, () => false);
check('scroll wheel zooms', zoomed);

// ---- click mode: one undo = one point
await page.getByRole('button', { name: 'Clear' }).click();
await page.getByRole('button', { name: 'Yes' }).click();
check('clear (confirmed) empties the drawing', (await readout()) === '0 m');
await page.getByRole('button', { name: 'Click', exact: true }).click();
for (const [x, y] of [[300, 300], [500, 340], [700, 300]]) { await page.mouse.click(x, y); await wait(450); }
const clickD = await readout();
check('click mode measures a polyline', km(clickD) > 0, clickD);
await page.getByRole('button', { name: 'Undo' }).click();
await wait(300); // React and the next animation frame catch up
check('undo removes exactly one point', km(await readout()) > 0 && km(await readout()) < km(clickD), `${clickD} -> ${await readout()}`);
await page.mouse.click(700, 300); await wait(450);
await shot('click');

// ---- save
await page.getByRole('button', { name: 'Finish' }).click();
const dlg = page.getByRole('dialog', { name: 'Save track' });
const defName = await dlg.getByLabel('Name').inputValue();
check('finish opens the save dialog with a default name', /^Track – \d/.test(defName), defName);
await page.keyboard.press('Escape');
check('Escape returns to drawing without losing work', !(await dlg.isVisible()) && km(await readout()) > 0);
await page.getByRole('button', { name: 'Finish' }).click();
await dlg.getByLabel('Name').fill('Test loop');
await dlg.getByLabel('Notes (optional)').fill('hello');
await dlg.getByRole('button', { name: 'Colour #1D6FA5' }).click();
await dlg.getByLabel('Name').press('Enter');
await page.getByLabel('Track detail').waitFor();
check('saved: stored with the right name, colour and shape', db.length === 1 && db[0].name === 'Test loop' && db[0].color === '#1D6FA5' && db[0].geometry.coordinates[0].length === 3, JSON.stringify(db[0]?.geometry));
check('detail shows the distance', km((await page.locator('.big').textContent()) ?? '') > 0);
await shot('saved');

// ---- reload: list shows it, opens it, draws it
await page.reload();
await ready(page);
await page.getByRole('button', { name: 'Tracks', exact: true }).click();
await page.getByRole('button', { name: /Test loop/ }).click();
await page.getByRole('heading', { name: /Test loop/ }).waitFor({ timeout: 5000 }).catch(() => undefined);
check('after reload the track opens from the list', await page.getByRole('heading', { name: /Test loop/ }).isVisible());
await wait(1000);
check('the saved track is drawn on the map', await page.evaluate(() => window.routeTracer.sent?.saved?.features.length === 1));

// ---- extend
await page.getByRole('button', { name: 'Extend' }).click();
await page.getByRole('button', { name: 'Freehand', exact: true }).click(); // the mode is remembered from the click-mode test above
const before = await readout();
await wait(900); // the fit-to-track animation has settled
await shot('extend');
const endAt = await page.evaluate(() => {
  const map = window.routeTracer.map;
  const f = window.routeTracer.sent.draw.features.find((x) => x.properties.kind === 'line');
  const last = f.geometry.coordinates.at(-1);
  const p = map.project(last);
  const r = map.getCanvasContainer().getBoundingClientRect();
  return [r.left + p.x, r.top + p.y];
});
await stroke([endAt, [endAt[0] - 80, endAt[1] + 60]]);
check('extend continues the same line', km(await readout()) > km(before) && (await lineCount()) === 1, `${before} -> ${await readout()} lines ${await lineCount()}`);
await page.getByRole('button', { name: 'Finish' }).click();
check('extend dialog is prefilled with the track name', (await dlg.getByLabel('Name').inputValue()) === 'Test loop');
await dlg.getByLabel('Name').press('Enter');
await page.getByLabel('Track detail').waitFor();
check('extend saved over the same track', db.length === 1 && db[0].pointCount > 3, `n=${db.length} pts=${db[0]?.pointCount}`);

// ---- edit points on the saved track: add (drag a middle dot), move, delete, undo, save
await page.getByRole('button', { name: 'Edit points' }).first().click();
await wait(900);
const handles = (kind) => page.evaluate((k) => {
  const map = window.routeTracer.map;
  const r = map.getCanvasContainer().getBoundingClientRect();
  return (window.routeTracer.sent.draw.features).filter((f) => f.properties.kind === k).map((f) => {
    const p = map.project(f.geometry.coordinates);
    return { x: r.left + p.x, y: r.top + p.y };
  });
}, kind);
const dragFrom = async (a, dx, dy) => {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(a.x + dx / 2, a.y + dy / 2, { steps: 4 }); await page.mouse.move(a.x + dx, a.y + dy, { steps: 4 });
  await page.mouse.up(); await wait(250);
};
const geo0 = JSON.stringify(db[0].geometry);
const pts0 = db[0].pointCount; // handles only cover what is on screen, so the saved count is the reference
const nv0 = (await handles('vertex')).length;
const mids = await handles('mid');
check('edit mode shows point handles and add-a-point dots', nv0 >= 3 && mids.length >= 2, `vertices ${nv0}, mids ${mids.length}`);
await shot('edit');
await dragFrom(mids[0], 0, -60);
const nv1 = (await handles('vertex')).length;
check('dragging a middle dot adds a point', nv1 === nv0 + 1, `${nv0} -> ${nv1}`);
const c2 = await center();
await dragFrom((await handles('vertex'))[1], 40, 40);
check('dragging a point moves it and does not pan the map', (await handles('vertex')).length === nv1 && (await center()).every((v, i) => Math.abs(v - c2[i]) < 1e-9));
await page.getByRole('button', { name: 'Undo' }).click(); await wait(300);
await page.getByRole('button', { name: 'Undo' }).click(); await wait(300);
check('two undos take back the move and the added point', (await handles('vertex')).length === nv0, `${(await handles('vertex')).length} vs ${nv0}`);
const delBtn = page.getByRole('button', { name: 'Delete selected point' });
check('Delete selected point is off until a point is picked', await delBtn.isDisabled());
const v0 = (await handles('vertex'))[1];
await page.mouse.click(v0.x, v0.y); await wait(250);
check('tapping a point picks it', await delBtn.isEnabled());
await delBtn.click(); await wait(300);
check('delete removes the picked point', (await handles('vertex')).length === nv0 - 1, `${(await handles('vertex')).length} vs ${nv0 - 1}`);
await dragFrom((await handles('mid'))[0], 0, 50);
await page.getByRole('button', { name: 'Finish' }).click();
check('edit dialog is prefilled with the track name', (await dlg.getByLabel('Name').inputValue()) === 'Test loop');
await dlg.getByLabel('Name').press('Enter');
await page.getByLabel('Track detail').waitFor();
// net: +1 add, undone; -1 delete; +1 add  => same count as before, different shape
check('edited points were saved over the same track', db.length === 1 && db[0].pointCount === pts0 && JSON.stringify(db[0].geometry) !== geo0, `n=${db.length} pts=${db[0]?.pointCount} expected ${pts0}`);
await page.getByRole('button', { name: 'Extend' }).click();
check('after edit, Extend opens in a drawing mode, not Edit', await page.getByRole('button', { name: 'Freehand', exact: true }).getAttribute('aria-pressed') === 'true');
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Cancel' }).click();
await page.getByLabel('Track detail').waitFor();
check('cancelling a reopened track returns to its detail', true);

// ---- map style: every option works, including going back to the one the map started with
await page.getByLabel('Map style').selectOption('outdoor-v2'); await wait(500);
await page.getByLabel('Map style').selectOption('hybrid'); await wait(500);
await page.getByLabel('Map style').selectOption('streets-v2'); await wait(800);
check('switching back to Streets loads the Streets style again', styleHits.filter((h) => h === 'streets-v2').length >= 2 && styleHits.includes('outdoor-v2') && styleHits.includes('hybrid'), JSON.stringify(styleHits));
check('the saved track layer survives style switches', await page.evaluate(() => !!window.routeTracer.map.getLayer('saved-line')));

// ---- delete
await page.getByRole('button', { name: 'Delete', exact: true }).click();
await page.getByRole('button', { name: 'Yes' }).click();
await wait(500);
check('delete removes it', db.length === 0);

// ---- units
await page.getByLabel('Units').selectOption('mi');
await page.getByRole('button', { name: 'Draw', exact: true }).click();
check('miles toggle changes the readout', /(ft|mi)$/.test(await readout()), await readout());
await page.getByRole('button', { name: 'Cancel' }).click();

// ---- touch: one finger draws, two fingers do not
const touch = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
await touch.addInitScript(AUTH);
const tp = await touch.newPage();
await tp.route('https://api.maptiler.com/**', (r) => r.fulfill({ json: STYLE, headers: cors }));
await tp.route('**/api/route-tracks/config', (r) => r.fulfill({ json: { maptilerKey: 'test' } }));
await tp.route('**/api/route-tracks?**', (r) => r.fulfill({ json: { tracks: [], nextCursor: null } }));
await tp.goto(APP);
await ready(tp);
await tp.getByRole('button', { name: 'Draw', exact: true }).click();
const cdp = await touch.newCDPSession(tp);
const tdist = async () => (await tp.getByTestId('distance').textContent()) ?? '';
const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
await send('touchStart', [{ x: 100, y: 300, id: 1 }]);
for (let i = 1; i <= 8; i += 1) await send('touchMove', [{ x: 100 + i * 25, y: 300 + i * 6, id: 1 }]);
await send('touchEnd', []);
await tp.waitForTimeout(200);
const t1 = await tdist();
check('touch: one finger draws', km(t1) > 0, t1);
await send('touchStart', [{ x: 120, y: 500, id: 1 }, { x: 220, y: 500, id: 2 }]);
for (let i = 1; i <= 8; i += 1) await send('touchMove', [{ x: 120 + i * 10, y: 500, id: 1 }, { x: 220 + i * 10, y: 500, id: 2 }]);
await send('touchEnd', []);
await tp.waitForTimeout(200);
check('touch: two fingers draw nothing', (await tdist()) === t1, `${t1} -> ${await tdist()}`);
if (out) await tp.screenshot({ path: join(out, 'phone.png') });

check('no page errors', problems.length === 0, problems.join(' | '));
await browser.close();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
