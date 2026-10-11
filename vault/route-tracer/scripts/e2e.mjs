// Draw-and-save end-to-end test in real Chrome. The MapTiler style and the Vault API are stubbed in the browser (the server routes
// have their own test: npm run test:route-tracks), so this proves the frontend flow: draw, undo, save, list, reload, pan, extend, delete.
// Start `npm run dev` first (port 5177), then `node scripts/e2e.mjs [screenshotDir]`. Exits non-zero if any check fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const APP = process.env.RT_URL ?? 'http://127.0.0.1:5177/route-tracer-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`); if (!ok) failures++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const AUTH = () => { try { localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 1 } } })); localStorage.setItem('route-tracer:info-seen:v1', '1'); } catch { /* none */ } };
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
await page.route('https://api.maptiler.com/**', (r) => { if (r.request().url().includes('/maps/')) styleHits.push(r.request().url().split('/maps/')[1]?.split('/')[0]); return r.fulfill({ json: STYLE, headers: cors }); });
// ---- terrain: MapTiler terrain-rgb tiles as PNGs of a known slope (100 m per 0.1 degree east), so the profile can be checked against the ground
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const terrainHeight = (lng) => 100 + (lng - 153) * 1000;
const terrainPng = (z, x, y, size = 64) => {
  const n = 2 ** z; const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py += 1) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px += 1) {
      const lng = ((x + (px + 0.5) / size) / n) * 360 - 180;
      const v = Math.round((terrainHeight(lng) + 10000) / 0.1);
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = (v >> 16) & 255; raw[o + 1] = (v >> 8) & 255; raw[o + 2] = v & 255; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
let terrainHits = 0;
await page.route('https://api.maptiler.com/tiles/terrain-rgb-v2/**', (r) => {
  const m = /terrain-rgb-v2\/(\d+)\/(\d+)\/(\d+)\./.exec(r.request().url());
  terrainHits += 1;
  return r.fulfill({ body: terrainPng(+m[1], +m[2], +m[3]), contentType: 'image/png', headers: cors });
});
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
  if (m === 'POST' && path === '/delete') {
    const ids = req.postDataJSON().ids;
    let n = 0;
    for (const id of ids) { const i = db.findIndex((x) => x.id === id); if (i >= 0) { db.splice(i, 1); n += 1; } }
    return route.fulfill({ json: { ok: true, deleted: n } });
  }
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
/** Every visible button, box and menu must explain itself (a title, or data-tip) in the same way as the other Vault apps. */
const untitled = () => page.evaluate(() => [...document.querySelectorAll('button, input, select, textarea')]
  .filter((el) => !el.closest('.maplibregl-ctrl, .shepherd-element') && !el.hidden && el.getClientRects().length > 0)
  .filter((el) => !(el.getAttribute('title') || el.getAttribute('data-tip') || '').trim())
  .map((el) => `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''} "${(el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().slice(0, 30)}"`));
const tipsOk = async (where) => { const bad = await untitled(); check(`every control has a tooltip: ${where}`, bad.length === 0, bad.join(', ')); };
const labels = async () => (await page.locator('.km-marker').allTextContents()).map(Number);
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
await tipsOk('top bar');

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
await wait(300);
const ml = await labels();
check('distance markers appear along the line', ml.length >= 1 && ml.every((n, i) => Number.isInteger(n) && (i === 0 || n > ml[i - 1])) && ml.at(-1) <= Math.floor(km(d1)), `labels ${ml} for ${d1}`);
await shot('freehand');
await tipsOk('drawing tools');
{ // elevation while drawing: the chart appears for the stroke, reads the stubbed slope, and hides again
  await page.getByRole('button', { name: 'Elevation', exact: true }).click();
  await page.getByTestId('ele-stats').waitFor({ timeout: 10000 });
  const t = (await page.getByTestId('ele-stats').textContent()) ?? '';
  const up = Number((/↑\s*([\d,]+)\s*m/.exec(t) ?? [])[1]?.replace(',', ''));
  const down = Number((/↓\s*([\d,]+)\s*m/.exec(t) ?? [])[1]?.replace(',', ''));
  check('elevation shows climb for the stroke, from terrain tiles', up > 0 && down <= 1 && terrainHits > 0, `${t} (tiles ${terrainHits})`);
  await tipsOk('drawing tools with the elevation chart');
  await page.getByRole('button', { name: 'Elevation', exact: true }).click(); await wait(200);
  check('and the chart hides again', (await page.getByTestId('elevation').count()) === 0);
}
await page.getByRole('button', { name: 'Markers' }).click(); await wait(300);
check('the Markers button hides them', (await labels()).length === 0);
await page.getByRole('button', { name: 'Markers' }).click(); await wait(300);
check('and shows them again', (await labels()).length === ml.length);

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

// ---- route shapes: return to start, out and back
const drawnLine = () => page.evaluate(() => (window.routeTracer.sent.draw.features.find((f) => f.properties.kind === 'line')?.geometry.coordinates) ?? null);
const before1 = await drawnLine();
await page.getByRole('button', { name: 'Return to start' }).click(); await wait(300);
const closed = await drawnLine();
check('Return to start closes the loop back to the first point', closed.length === before1.length + 1 && closed.at(-1)[0] === closed[0][0] && closed.at(-1)[1] === closed[0][1] && km(await readout()) > km(d1));
await page.getByRole('button', { name: 'Return to start' }).click(); await wait(200);
check('and refuses to close an already closed route', (await page.getByText('already ends at its start').count()) >= 1);
await page.getByRole('button', { name: 'Undo' }).click(); await wait(300);
check('undo takes the closing line back', (await readout()) === d1);
await page.getByRole('button', { name: 'Out and back' }).click(); await wait(300);
const doubled = km(await readout());
check('Out and back doubles the distance', Math.abs(doubled - 2 * km(d1)) < 0.03, `${d1} -> ${await readout()}`);
const ob = await drawnLine();
check('and ends where it began', ob.at(-1)[0] === ob[0][0] && ob.at(-1)[1] === ob[0][1]);
await page.getByRole('button', { name: 'Undo' }).click(); await wait(300);
check('undo takes the return leg back', (await readout()) === d1);

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
await tipsOk('save dialog');
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
check('the open track shows distance markers too', (await labels()).length >= 1, `labels ${await labels()}`);
{ // tap the open track: pin + "from start" / "to go" that add up to the track's distance
  const mid = await page.evaluate(() => {
    const map = window.routeTracer.map;
    const g = window.routeTracer.sent.saved.features[0].geometry.coordinates[0];
    const a = map.project(g[0]); const b = map.project(g[1]);
    const r = map.getCanvasContainer().getBoundingClientRect();
    return { x: r.left + (a.x + b.x) / 2 + 3, y: r.top + (a.y + b.y) / 2 + 3 };
  });
  await page.mouse.click(mid.x, mid.y); await wait(400);
  const probe = page.getByTestId('probe');
  const text = (await probe.textContent()) ?? '';
  const num = (re) => { const m = re.exec(text); return m ? (m[2] === 'km' ? parseFloat(m[1]) : parseFloat(m[1]) / 1000) : NaN; };
  const from = num(/([\d.]+) (km|m)\s*from start/); const toGo = num(/start([\d.]+) (km|m)\s*to go/);
  const whole = km((await page.locator('.big').textContent()) ?? '');
  check('tapping the track reads the distance from the start', from > 0 && toGo > 0 && Math.abs(from + toGo - whole) < 0.03, `${text} vs ${whole} km`);
  check('and drops a pin on the line', (await page.locator('.probe-pin').count()) === 1);
  await page.mouse.click(mid.x, mid.y + 150); await wait(300);
  check('tapping away from the line clears it', !(await probe.isVisible()) && (await page.locator('.probe-pin').count()) === 0);
  await page.mouse.click(mid.x, mid.y); await wait(300);
  await page.keyboard.press('Escape'); await wait(200);
  check('Escape clears it', !(await probe.isVisible()));
}
await page.getByTestId('ele-stats').waitFor({ timeout: 10000 });
{
  const g = db[0].geometry.coordinates[0];
  const expect = (g.at(-1)[0] - g[0][0]) * 1000; // the slope is 1000 m per degree east and the track runs west to east
  const t = (await page.getByTestId('ele-stats').textContent()) ?? '';
  const up = Number((/↑\s*([\d,]+)\s*m/.exec(t) ?? [])[1]?.replace(',', ''));
  check('the open track shows its climb, matching the ground', Math.abs(up - expect) <= 5, `${t} vs ${expect.toFixed(1)} m`);
  const svg = page.getByTestId('ele-svg');
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5); await wait(300);
  const he = (await page.getByTestId('probe-ele').textContent().catch(() => '')) ?? '';
  check('moving across the chart puts a pin on the map and reads the height there', /Height [\d,]+ m/.test(he) && (await page.locator('.probe-pin').count()) === 1, he);
  await page.mouse.move(10, 10); await wait(200);
  check('leaving the chart clears the pin', (await page.locator('.probe-pin').count()) === 0);
}
await shot('detail');
await tipsOk('open track');
await page.getByRole('button', { name: 'Rename / edit' }).click();
await tipsOk('rename / edit form');
await page.getByRole('button', { name: 'Cancel' }).click();
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
await tipsOk('edit points mode');
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

// ---- selective delete from the list: tick some, Delete (N), inline Yes / No, select all
const seed = (name) => { const g = { type: 'MultiLineString', coordinates: [[[153.0, -27.5], [153.05, -27.45]]] }; db.push({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, name, notes: null, color: '#E4572E', geometry: g, distanceM: dist(g.coordinates), pointCount: 2, bbox: bbox(g.coordinates), drawMode: 'click', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); };
['Alpha', 'Bravo', 'Charlie'].forEach(seed);
await page.reload();
await ready(page);
await page.getByRole('button', { name: 'Tracks', exact: true }).click();
await page.getByRole('button', { name: /Alpha/ }).waitFor();
await tipsOk('tracks list');
const del = page.getByRole('button', { name: /^Delete/ });
check('Delete is off until something is ticked', await del.isDisabled());
await page.getByLabel('Select Alpha').check();
await page.getByLabel('Select Charlie').check();
check('Delete shows how many are ticked', (await del.textContent()) === 'Delete (2)');
await del.click();
check('delete asks inline first', await page.getByText('Delete 2 tracks?').isVisible() && db.length === 3);
await page.getByRole('button', { name: 'No', exact: true }).click();
check('No keeps everything', db.length === 3 && await page.getByLabel('Select Alpha').isChecked());
await page.getByRole('button', { name: /^Delete/ }).click();
await page.getByRole('button', { name: 'Yes', exact: true }).click();
await wait(500);
check('Yes deletes only the ticked tracks', db.length === 1 && db[0].name === 'Bravo', db.map((x) => x.name).join());
check('the list drops them without a reload', !(await page.getByRole('button', { name: /Alpha/ }).count()) && (await page.getByRole('button', { name: /Bravo/ }).count()) === 1);
await page.getByRole('button', { name: 'Select all' }).click();
await page.getByRole('button', { name: /^Delete/ }).click();
await page.getByRole('button', { name: 'Yes', exact: true }).click();
await wait(500);
check('select all + delete empties the list', db.length === 0 && await page.getByText(/No saved tracks yet/).isVisible());

// ---- GPX import: bad file, good file (opens in Edit points, saves as imported), a recording too long to save as is
const gpxFile = (name, trkpts, trkName = 'Coast run') => ({ name, mimeType: 'application/gpx+xml', buffer: Buffer.from(`<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${trkName}</name><trkseg>${trkpts.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"><ele>5</ele></trkpt>`).join('')}</trkseg></trk></gpx>`) });
const picker = page.locator('input[aria-label="GPX file"]');
await picker.setInputFiles({ name: 'notes.gpx', mimeType: 'text/plain', buffer: Buffer.from('this is not xml') });
await wait(400);
check('a file that is not GPX is refused with a message', (await page.getByText('not a GPX file').count()) >= 1 && !(await page.getByRole('region', { name: 'Drawing tools' }).isVisible()));
const coast = [[-27.468, 153.028], [-27.7, 153.2], [-28.002, 153.43]];
await picker.setInputFiles(gpxFile('coast.gpx', coast));
await page.getByRole('region', { name: 'Drawing tools' }).waitFor();
const expectKm = coast.slice(1).reduce((a, p, i) => { const [y1, x1] = coast[i]; const [y2, x2] = p; const h = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2; return a + 2 * 6371.0088 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); }, 0);
check('the imported route opens with its distance', Math.abs(km(await readout()) - expectKm) < 0.05, `${await readout()} vs ${expectKm.toFixed(2)} km`);
check('and opens in Edit points, so a touch cannot draw on it', (await page.getByRole('button', { name: 'Edit points', exact: true }).getAttribute('aria-pressed')) === 'true');
await page.getByRole('button', { name: 'Finish' }).click();
check('the save dialog is prefilled from the file', (await dlg.getByLabel('Name').inputValue()) === 'Coast run');
await dlg.getByLabel('Name').press('Enter');
await page.getByLabel('Track detail').waitFor();
const imp = db.at(-1);
check('saved as an imported track with the same points', imp.drawMode === 'import' && imp.name === 'Coast run' && JSON.stringify(imp.geometry.coordinates) === JSON.stringify([coast.map(([lat, lon]) => [lon, lat])]), JSON.stringify(imp));
const big = Array.from({ length: 30000 }, (_, i) => [-27 + Math.sin(i / 300) * 0.05 + (i % 2) * 0.0000015, 153 + i * 0.00002]);
await picker.setInputFiles(gpxFile('long.gpx', big, 'Long recording'));
await page.getByRole('region', { name: 'Drawing tools' }).waitFor({ timeout: 20000 });
check('a recording over the point limit is simplified to fit, and says so', (await page.getByText(/Simplified from 30,?000/).count()) >= 1);
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Cancel' }).click();
await wait(300);

// ---- the guide and the tour
{
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await fresh.addInitScript(() => { try { localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 1 } } })); } catch { /* none */ } });
  const fp = await fresh.newPage();
  await fp.route('https://api.maptiler.com/**', (r) => r.fulfill({ json: STYLE, headers: cors }));
  await fp.route('**/api/route-tracks/config', (r) => r.fulfill({ json: { maptilerKey: 'test' } }));
  await fp.route('**/api/route-tracks?**', (r) => r.fulfill({ json: { tracks: [], nextCursor: null } }));
  await fp.goto(APP);
  await fp.getByTestId('info-modal').waitFor({ timeout: 10000 });
  check('the guide opens by itself on the first visit', true);
  if (out) await fp.screenshot({ path: join(out, 'info.png') });
  const guide = (await fp.getByTestId('info-modal').textContent()) ?? '';
  check('and covers drawing, elevation, GPX and tracks', /Freehand/.test(guide) && /Elevation and climb/.test(guide) && /GPX files/.test(guide) && /Saving and your tracks/.test(guide));
  const noTips = await fp.evaluate(() => [...document.querySelectorAll('[data-testid=info-modal] button')].filter((b) => !(b.getAttribute('title') || b.getAttribute('data-tip') || '').trim()).length); // a focused button has its title moved to data-tip by the tooltip host
  check('guide buttons have tooltips too', noTips === 0);
  await fp.keyboard.press('Escape'); await wait(300);
  check('Escape closes the guide', (await fp.getByTestId('info-modal').count()) === 0);
  await fp.reload();
  await fp.waitForFunction(() => window.routeTracer?.map?.isStyleLoaded());
  await wait(500);
  check('it does not open again on the next visit', (await fp.getByTestId('info-modal').count()) === 0);
  await fp.getByRole('button', { name: 'How this works' }).click();
  check('but the (i) button opens it any time', (await fp.getByTestId('info-modal').count()) === 1);
  await fp.getByRole('button', { name: 'Got it' }).click();

  // ?tour=1 (Vault's Settings page) runs the tour on its own
  await fp.goto(`${APP}?tour=1`);
  await fp.locator('.shepherd-element.vault-tour').first().waitFor({ timeout: 10000 });
  check('?tour=1 starts the tour', (await fp.locator('.vault-tour-step-count').first().textContent()) === 'Step 1 of 11');
  await fp.keyboard.press('Escape'); await wait(400);
  check('skipping marks it done', (await fp.evaluate(() => localStorage.getItem('vault_tour_route_tracer_completed'))) === '1');
  await fresh.close();
}
{
  await page.getByRole('button', { name: 'Take the guided tour' }).click();
  const card = () => page.locator('.shepherd-element.vault-tour:not([hidden])').last();
  await card().waitFor({ timeout: 10000 });
  const seen = [];
  const attached = [];
  for (let i = 1; i <= 11; i += 1) {
    await page.waitForFunction((n) => [...document.querySelectorAll('.vault-tour-step-count')].some((e) => e.textContent === `Step ${n} of 11` && e.closest('.shepherd-element:not([hidden])')), i, { timeout: 10000 });
    await wait(550);
    seen.push((await card().locator('.shepherd-title').textContent())?.trim());
    attached.push(!!(await card().getAttribute('data-popper-placement')));
    if (i === 5) await shot('tour');
    if (i === 5) check('the tour opens the drawing tools for the drawing steps', await page.getByRole('region', { name: 'Drawing tools' }).isVisible());
    if (i === 8) check('and the tracks list for its step', await page.getByRole('complementary', { name: 'Tracks' }).isVisible() && !(await page.getByRole('region', { name: 'Drawing tools' }).isVisible()));
    const next = card().getByRole('button', { name: /Next|Start Tour|Finish/ });
    await next.click();
  }
  await wait(500);
  check('the tour has 11 steps with titles', seen.length === 11 && seen.every(Boolean) && new Set(seen).size === 11, seen.join(' | '));
  check('every step that points at something is attached to it', [1, 2, 3, 4, 5, 6, 7, 8, 9].every((i) => attached[i]), JSON.stringify(attached));
  check('finishing the tour marks it done', (await page.evaluate(() => localStorage.getItem('vault_tour_route_tracer_completed'))) === '1');
  check('and puts the screen back as it was', !(await page.getByRole('region', { name: 'Drawing tools' }).isVisible()) && !(await page.getByRole('complementary', { name: 'Tracks' }).isVisible()));
  await tipsOk('after the tour');
}

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
