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
const suggestLog = [];
let suggestAnswer = [];
let suggestFail = 0;
let suggestDelay = () => 0;
await page.route('https://api.maptiler.com/geocoding/**', async (r) => {
  const url = new URL(r.request().url());
  suggestLog.push({ q: decodeURIComponent(url.pathname.replace('/geocoding/', '').replace(/\.json$/, '')), params: Object.fromEntries(url.searchParams) });
  const wait = suggestDelay(suggestLog.at(-1).q);
  if (wait) await new Promise((res) => setTimeout(res, wait));
  if (suggestFail) return r.fulfill({ status: suggestFail, json: { message: 'no' }, headers: cors });
  return r.fulfill({ json: { type: 'FeatureCollection', query: [], attribution: 'x', features: suggestAnswer.map((a) => ({ place_name: a.name, center: [a.lng, a.lat], geometry: { type: 'Point', coordinates: [a.lng, a.lat] } })) }, headers: cors });
});
let reverseSeq = 0;
const reverseLog = [];
const geocodeLog = [];
let geocodeAnswer = [];
await page.route('**/api/geocode/reverse', (r) => { reverseLog.push(r.request().postDataJSON()); reverseSeq += 1; return r.fulfill({ json: { result: { label: `Test place ${reverseSeq}, Testville`, lat: 0, lng: 0 }, attribution: 'x', cached: false } }); });
await page.route('**/api/geocode', (r) => { geocodeLog.push(r.request().postDataJSON()); return r.fulfill({ json: { results: geocodeAnswer, attribution: 'x', cached: false } }); });
const db = [];
const planLog = [];
let planOrder = 'sorted';
const loopLog = [];
const legLog = [];
const legMetres = [];
let legFail = false;
let legDelay = 0;
const detourLog = [];
let lastDirectM = 0;
let planFail = null;
let seq = 0;
const rad = Math.PI / 180;
const dist = (lines) => lines.reduce((m, l) => m + l.slice(1).reduce((a, p, i) => {
  const [x1, y1] = l[i]; const [x2, y2] = p;
  const h = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
  return a + 2 * 6371008.8 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}, 0), 0);
const bbox = (lines) => { const xs = lines.flat().map((p) => p[0]); const ys = lines.flat().map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const summary = (t) => { const { geometry, notes, updatedAt, ...s } = t; return s; };
const emailLog = [];
const emailStub = { enabled: true, fail: 0, failText: 'The email could not be sent. Try again in a moment.' };
await page.route('**/api/route-tracks**', async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname.replace('/api/route-tracks', '');
  const m = req.method();
  if (m === 'GET' && path === '/config') return route.fulfill({ json: { maptilerKey: 'test', routePlanning: true, emailEnabled: emailStub.enabled } });
  if (m === 'POST' && path === '/email') {
    const b = req.postDataJSON();
    emailLog.push(b);
    if (emailStub.fail) return route.fulfill({ status: emailStub.fail, json: { error: emailStub.failText } });
    return route.fulfill({ json: { ok: true, copied: b.copyToMe === true } });
  }
  if (m === 'GET' && path === '') return route.fulfill({ json: { tracks: [...db].reverse().map(summary), nextCursor: null } });
  if (m === 'POST' && path === '/plan') {
    const b = req.postDataJSON();
    planLog.push(b);
    if (planFail) return route.fulfill({ status: 422, json: { error: planFail } });
    const mk = (bow) => { const mid = [(b.from[0] + b.to[0]) / 2 + bow * (b.to[1] - b.from[1]), (b.from[1] + b.to[1]) / 2 - bow * (b.to[0] - b.from[0])]; const coordinates = [b.from, [(b.from[0] + mid[0]) / 2, (b.from[1] + mid[1]) / 2], mid, [(mid[0] + b.to[0]) / 2, (mid[1] + b.to[1]) / 2], b.to]; return { distanceM: dist([coordinates]), durationS: dist([coordinates]) / 1.4, coordinates }; };
    return route.fulfill({ json: { routes: planOrder === 'shuffled' ? [mk(-0.4), mk(0), mk(0.25)] : [mk(0), mk(0.25), mk(-0.4)], attribution: '(c) openrouteservice.org | (c) OpenStreetMap contributors', cached: false } });
  }
  if (m === 'POST' && path === '/leg') {
    const b = req.postDataJSON();
    legLog.push(b);
    if (legDelay) await new Promise((r) => setTimeout(r, legDelay));
    if (legFail) return route.fulfill({ status: 422, json: { error: 'No road or path was found near the end. Move it closer to a road or footpath.' } });
    const bend = [(b.from[0] + b.to[0]) / 2, (b.from[1] + b.to[1]) / 2 + 0.0004]; // a road that is not the straight line
    const coordinates = [b.from, bend, b.to];
    const d = dist([coordinates]);
    legMetres.push(d);
    return route.fulfill({ json: { route: { distanceM: d, durationS: d / 1.4, coordinates }, cached: false } });
  }
  if (m === 'POST' && path === '/detour') {
    const b = req.postDataJSON();
    detourLog.push(b);
    const directC = [b.from, b.to]; const directM = dist([directC]) * 1.3; lastDirectM = directM;
    const attribution = '(c) openrouteservice.org | (c) OpenStreetMap contributors';
    if (b.lengthKm === undefined || b.lengthKm === null) return route.fulfill({ json: { routes: [{ distanceM: directM, durationS: directM / 1.4, coordinates: directC }], attribution, targetM: null, directM, cached: false } });
    const T = b.lengthKm * 1000;
    if (T < directM * 0.98) return route.fulfill({ status: 422, json: { error: 'The shortest route is already longer than that.', code: 'TARGET_TOO_SHORT', directM, targetM: T } });
    if (T > directM * 4) return route.fulfill({ status: 422, json: { error: 'That is a lot longer than the direct route.', code: 'TARGET_TOO_LONG', directM, targetM: T, maxM: Math.floor((directM * 4) / 100) * 100 } });
    const lat0 = ((b.from[1] + b.to[1]) / 2) * Math.PI / 180; const mx = 111320 * Math.cos(lat0);
    const dx = (b.to[0] - b.from[0]) * mx; const dy = (b.to[1] - b.from[1]) * 111320; const len = Math.hypot(dx, dy);
    const via = (side, t, h) => [b.from[0] + (b.to[0] - b.from[0]) * t + ((-dy / len) * side * h) / mx, b.from[1] + (b.to[1] - b.from[1]) * t + ((dx / len) * side * h) / 111320];
    const mk = (side, t, off) => { // move the via point out until the pretend road (1.3x the straight line) is about T * (1 + off) long
      let lo = 0; let hi = T; for (let i = 0; i < 40; i += 1) { const h = (lo + hi) / 2; if (dist([[b.from, via(side, t, h), b.to]]) * 1.3 < T * (1 + off)) lo = h; else hi = h; }
      const coordinates = [b.from, via(side, t, lo), b.to]; const d = dist([coordinates]) * 1.3;
      return { distanceM: d, durationS: d / 1.4, coordinates, offPct: Math.round(((d - T) / T) * 1000) / 10 };
    };
    return route.fulfill({ json: { routes: [mk(1, 0.5, 0.02), mk(-1, 0.5, -0.05), mk(1, 0.3, 0.09)], attribution, targetM: T, directM, cached: false } });
  }
  if (m === 'POST' && path === '/loop') {
    const b = req.postDataJSON();
    loopLog.push(b);
    const target = b.lengthKm * 1000;
    const mk = (k, off) => { // a loop of about target*(1+off) metres: a circle through the start, heading a different way for each
      const R = (target * (1 + off)) / (2 * Math.PI); const th = (k * 2 * Math.PI) / 3; const lat0 = b.from[1] * Math.PI / 180;
      const dLat = R / 111320; const dLng = R / (111320 * Math.cos(lat0));
      const c = [b.from[0] - dLng * Math.cos(th), b.from[1] - dLat * Math.sin(th)];
      const coordinates = [b.from]; for (let i = 1; i < 24; i += 1) { const a = th + (i * 2 * Math.PI) / 24; coordinates.push([c[0] + dLng * Math.cos(a), c[1] + dLat * Math.sin(a)]); } coordinates.push(b.from);
      const d = dist([coordinates]);
      return { distanceM: d, durationS: d / 1.4, coordinates, offPct: Math.round(((d - target) / target) * 1000) / 10 };
    };
    return route.fulfill({ json: { routes: [mk(0, 0.03), mk(1, -0.06), mk(2, 0.12)].sort((a, c) => Math.abs(a.offPct) - Math.abs(c.offPct)), attribution: '(c) openrouteservice.org | (c) OpenStreetMap contributors', targetM: target, cached: false } });
  }
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

let MX = 0; let MY = 0; // where the map starts on the page (the sidebar is beside it and the header above); set once it has loaded
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
/** Back to the tracks list (a track that is open replaces it, and the Draw and Plan route buttons live there). */
const home = async () => { const b = page.getByRole('button', { name: 'Tracks', exact: true }); if (await b.count()) await b.click(); };
const closeMenus = async () => { await page.keyboard.press('Escape'); await wait(150); };
/** The gear menu: units, distance markers, import, tour. */
const gear = async () => { await page.getByRole('button', { name: 'Settings' }).click(); await wait(150); };
const setUnits = async (u) => { await gear(); await page.getByLabel('Units').selectOption(u); await closeMenus(); };
const toggleMarkers = async () => { await gear(); await page.getByRole('menuitemcheckbox', { name: 'Distance markers' }).click(); await closeMenus(); };
const pickStyle = async (label) => { await page.getByRole('button', { name: 'Map style' }).click(); await page.getByRole('group', { name: 'Map style' }).getByRole('button', { name: label }).click(); await wait(150); };
const profileNow = () => page.evaluate(() => (document.querySelector('[role=group][aria-label="Travel by"] button[aria-pressed=true]')?.getAttribute('aria-label') ?? '').toLowerCase());
const labels = async () => (await page.locator('.km-marker').allTextContents()).map(Number);
const ready = (p) => p.waitForFunction(() => window.routeTracer?.map?.isStyleLoaded());

async function stroke(points, abs = false) {
  const o = abs ? [0, 0] : [MX, MY];
  await page.mouse.move(points[0][0] + o[0], points[0][1] + o[1]);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) await page.mouse.move(points[i][0] + o[0], points[i][1] + o[1], { steps: 6 });
  await page.mouse.up();
  await wait(150);
}

await page.goto(APP);
await ready(page);
{ const b = await page.getByTestId('map').boundingBox(); MX = b.x; MY = b.y; }
check('map loads with the key from /config', true);
check('the sidebar is beside the map, not over it', MX > 300 && MY > 40, `${MX},${MY}`);
await tipsOk('home screen');

// ---- freehand
await home();
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
await toggleMarkers(); await wait(300);
check('turning Distance markers off in the gear menu hides them', (await labels()).length === 0);
await toggleMarkers(); await wait(300);
check('and turning them on shows them again', (await labels()).length === ml.length);

// ---- Space + drag pans and draws nothing; wheel zooms
const c0 = await center();
await page.keyboard.down('Space');
await page.mouse.move(MX + 600, MY + 400); await page.mouse.down(); await page.mouse.move(MX + 400, MY + 300, { steps: 8 }); await page.mouse.up();
await page.keyboard.up('Space');
await wait(300);
const c1 = await center();
check('Space + drag pans the map', Math.abs(c1[0] - c0[0]) > 1e-5 || Math.abs(c1[1] - c0[1]) > 1e-5);
check('Space + drag adds no line', (await lineCount()) === 1 && (await readout()) === d1);
const z0 = await page.evaluate(() => window.routeTracer.map.getZoom());
await page.mouse.move(MX + 640, MY + 400);
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
for (const [x, y] of [[300, 300], [500, 340], [700, 300]]) { await page.mouse.click(MX + x, MY + y); await wait(450); }
const clickD = await readout();
check('click mode measures a polyline', km(clickD) > 0, clickD);
await page.getByRole('button', { name: 'Undo' }).click();
await wait(300); // React and the next animation frame catch up
check('undo removes exactly one point', km(await readout()) > 0 && km(await readout()) < km(clickD), `${clickD} -> ${await readout()}`);
await page.mouse.click(MX + 700, MY + 300); await wait(450);
{ // a point added in Click mode can be dragged, and the map stays where it is
  const pts = () => page.evaluate(() => {
    const map = window.routeTracer.map; const r = map.getCanvasContainer().getBoundingClientRect();
    return window.routeTracer.sent.draw.features.filter((f) => f.properties.kind === 'vertex').map((f) => { const p = map.project(f.geometry.coordinates); return { x: r.left + p.x, y: r.top + p.y, c: f.geometry.coordinates }; });
  });
  const before = await pts(); const c0 = await center(); const dBefore = await readout();
  await page.mouse.move(before[1].x, before[1].y); await page.mouse.down();
  await page.mouse.move(before[1].x + 10, before[1].y + 30, { steps: 4 }); await page.mouse.move(before[1].x + 20, before[1].y + 70, { steps: 4 });
  await page.mouse.up(); await wait(500);
  const after = await pts();
  check('Click mode: dragging a point moves it', after.length === before.length && Math.hypot(after[1].x - before[1].x, after[1].y - before[1].y) > 40, JSON.stringify([before[1], after[1]]));
  check('the map does not move, and no extra point is added', (await center()).every((v, i) => Math.abs(v - c0[i]) < 1e-9) && after.length === 3);
  check('the distance follows the moved point', (await readout()) !== dBefore);
  await page.getByRole('button', { name: 'Undo' }).click(); await wait(400);
  check('and Undo puts the point back', (await readout()) === dBefore && (await pts()).length === 3);
  await page.mouse.click(before[1].x, before[1].y); await wait(500);
  check('tapping an existing point does not add another on top of it', (await pts()).length === 3);
}
await shot('click');

// ---- save
await page.getByRole('button', { name: 'Finish' }).click();
const dlg = page.getByRole('dialog', { name: 'Save track' });
await tipsOk('save dialog');
check('a labelled box keeps its own name when its tooltip shows (the tooltip must not replace the label)', (await dlg.getByLabel('Name').getAttribute('aria-label')) === null && (await dlg.getByLabel('Notes (optional)').getAttribute('aria-label')) === null);
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
  await page.mouse.move(MX + 10, MY + 10); await wait(200);
  check('leaving the chart clears the pin', (await page.locator('.probe-pin').count()) === 0);
}
await shot('detail');
await tipsOk('open track');
await page.getByRole('button', { name: 'Rename / edit' }).click();
await tipsOk('rename / edit form');
await page.getByRole('button', { name: 'Cancel' }).click();
check('the saved track is drawn on the map', await page.evaluate(() => window.routeTracer.sent?.saved?.features.length === 1));

// ---- Map as PDF: made in the browser from a hidden map, downloaded or emailed
{
  const errsBefore = problems.length;
  await page.getByRole('button', { name: 'Map as PDF' }).click();
  const dlg = page.getByTestId('pdf-dialog');
  await dlg.waitFor({ timeout: 5000 });
  check('Map as PDF opens a window that says it is working', (await page.getByTestId('pdf-making').count()) === 1 || (await page.getByTestId('pdf-ready').count()) === 1);
  { // the PDF draws the route itself, so its projection must be exactly a MapLibre map's own: a hidden map built the way captureMap builds it
    const diffs = await page.evaluate(async () => {
      const { makeProjector, captureSize } = await import('/route-tracer-app/src/mapPdf.ts');
      const MapCtor = window.routeTracer.map.constructor;
      const out = [];
      for (const [bbox, o] of [[[153.0, -27.52, 153.2, -27.48], 'landscape'], [[153.0, -27.6, 153.02, -27.4], 'portrait'], [[153.0, -27.5, 153.0005, -27.5004], 'landscape']]) {
        const { width, height } = captureSize(o);
        const host = document.createElement('div'); host.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:${height}px`; document.body.appendChild(host);
        const m = new MapCtor({ container: host, style: { version: 8, sources: {}, layers: [] }, bounds: bbox, fitBoundsOptions: { padding: 70, maxZoom: 17 }, interactive: false, attributionControl: false, pixelRatio: 2, fadeDuration: 0 });
        await new Promise((r) => (m.loaded() ? r() : m.once('load', r)));
        const c = m.unproject([width / 2, height / 2]);
        const pr = makeProjector([c.lng, c.lat], m.getZoom(), width, height);
        for (const p of [[bbox[0], bbox[1]], [bbox[2], bbox[3]], [c.lng + 0.003, c.lat - 0.002]]) { const a = m.project(p); const b = pr(p); out.push(Math.hypot(a.x - b.x, a.y - b.y)); }
        m.remove(); host.remove();
      }
      return out;
    });
    check('the PDF projects places onto its picture exactly as a map of that size does', diffs.length === 9 && diffs.every((d) => d < 0.01), JSON.stringify(diffs));
  }
  await page.getByTestId('pdf-ready').waitFor({ timeout: 60000 });
  check('and finishes with one A4 page', /one A4 page, [\d,]+ KB/.test((await page.getByTestId('pdf-ready').textContent()) ?? ''), (await page.getByTestId('pdf-ready').textContent()) ?? '');
  check('the hidden map used to make it is gone again', (await page.locator('body > div[aria-hidden="true"] canvas').count()) === 0);
  await tipsOk('map as PDF window');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pdf-download').click()]);
  check('Download saves a .pdf named after the track', /^Test loop\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const file = await dl.path();
  const head = (await import('node:fs')).readFileSync(file).subarray(0, 5).toString('latin1');
  check('and it is a real PDF', head === '%PDF-');
  if (out) (await import('node:fs')).copyFileSync(file, join(out, 'map.pdf'));

  // email
  const toBox = dlg.getByLabel('To');
  check('Email PDF waits for an address', await dlg.getByRole('button', { name: 'Email PDF' }).isDisabled());
  await toBox.fill('friend@example.com');
  await dlg.getByLabel('Message (optional)').fill('Here is the route.');
  emailLog.length = 0;
  await dlg.getByRole('button', { name: 'Email PDF' }).click();
  await page.getByTestId('pdf-email-sent').waitFor({ timeout: 5000 });
  const sentBody = emailLog[0];
  check('Email PDF sends one address, the message, a copy to me by default, and the same PDF as base64', emailLog.length === 1 && sentBody.to === 'friend@example.com' && sentBody.message === 'Here is the route.' && sentBody.copyToMe === true && /^Test loop$/.test(sentBody.filename) && /Test loop/.test(sentBody.subject) && Buffer.from(sentBody.pdf, 'base64').subarray(0, 5).toString('latin1') === '%PDF-', JSON.stringify({ ...sentBody, pdf: sentBody.pdf?.length }));
  check('and says who it went to', /friend@example.com/.test((await page.getByTestId('pdf-email-sent').textContent()) ?? ''));
  await dlg.getByLabel('Send me a copy').uncheck();
  emailLog.length = 0;
  await dlg.getByRole('button', { name: 'Email PDF' }).click(); await wait(400);
  check('"Send me a copy" off is sent as off', emailLog.length === 1 && emailLog[0].copyToMe === false);
  // a refusal from the server is shown plainly and nothing says sent
  emailStub.fail = 429; emailStub.failText = 'That is a lot of emails in an hour. Wait a while and try again.';
  await dlg.getByRole('button', { name: 'Email PDF' }).click();
  await page.getByTestId('pdf-email-error').waitFor({ timeout: 5000 });
  check('a refused email shows the server\'s plain reason', /lot of emails/.test((await page.getByTestId('pdf-email-error').textContent()) ?? '') && (await page.getByTestId('pdf-email-sent').count()) === 0);
  emailStub.fail = 0;
  await page.keyboard.press('Escape'); await wait(200);
  check('Escape closes the window', (await dlg.count()) === 0);

  // email not set up on the server: Download still works, the form says why and cannot be used
  emailStub.enabled = false;
  await page.reload(); await ready(page);
  await page.getByRole('button', { name: /Test loop/ }).click();
  await page.getByRole('button', { name: 'Map as PDF' }).click();
  await page.getByTestId('pdf-ready').waitFor({ timeout: 60000 });
  check('with email not set up the window says so and the form is switched off', (await page.getByTestId('pdf-email-off').count()) === 1 && await page.getByRole('dialog', { name: 'Map as PDF' }).getByRole('button', { name: 'Email PDF' }).isDisabled() && await page.getByRole('dialog', { name: 'Map as PDF' }).getByLabel('To').isDisabled());
  check('but Download is still there', await page.getByTestId('pdf-download').isEnabled());
  await page.getByRole('button', { name: 'Close', exact: true }).click(); await wait(200);
  emailStub.enabled = true;
  check('making the PDF raised no errors in the page', problems.length === errsBefore, problems.slice(errsBefore).join(' | '));
  await page.reload(); await ready(page);
  await page.getByRole('button', { name: /Test loop/ }).click();
  await page.getByRole('heading', { name: /Test loop/ }).waitFor({ timeout: 5000 });
}

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
await stroke([endAt, [endAt[0] - 80, endAt[1] + 60]], true);
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
await pickStyle('Outdoor'); await wait(500);
await pickStyle('Satellite'); await wait(500);
await pickStyle('Streets'); await wait(800);
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

// ---- Plan route: A and B, three routes, choose one, drag a pin, change how you travel, errors, use it as a track
{
  const planButton = page.getByRole('button', { name: 'Plan route' });
  check('Plan route is on when the server has a routing key', await planButton.isEnabled());
  await planButton.click();
  const bar = page.getByTestId('planbar');
  await bar.waitFor();
  check('planning asks for the start first', /set the start/.test((await page.getByTestId('plan-step').textContent()) ?? ''));
  await tipsOk('plan route');
  planLog.length = 0;
  await page.mouse.click(MX + 300, MY + 300); await wait(300);
  check('then the end', /set the end/.test((await page.getByTestId('plan-step').textContent()) ?? '') && (await page.locator('.plan-pin-a').count()) === 1);
  await page.mouse.click(MX + 760, MY + 360); await wait(300);
  await page.getByTestId('plan-route').first().waitFor({ timeout: 10000 });
  const cards = page.getByTestId('plan-route');
  await wait(800); await shot('plan');
  check('three routes are offered with distance and time', (await cards.count()) === 3 && /km|m/.test((await cards.first().textContent()) ?? '') && /min|h/.test((await cards.first().textContent()) ?? ''), (await cards.allTextContents()).join(' | '));
  check('the request had the points in [lng, lat] order and the walking profile', planLog.length === 1 && planLog[0].profile === 'walking' && planLog[0].from.length === 2 && Math.abs(planLog[0].from[1]) < Math.abs(planLog[0].from[0]), JSON.stringify(planLog[0]));
  await wait(500);
  const sel = () => page.evaluate(() => (window.routeTracer.sent.plan?.features ?? []).map((f) => !!f.properties.sel));
  check('all three are drawn on the map, the first chosen', JSON.stringify(await sel()) === '[true,false,false]', JSON.stringify(await sel()));
  check('the shortest is marked', (await cards.allTextContents()).filter((t) => /^Shortest/.test(t)).length === 1);
  await cards.nth(1).click(); await wait(300);
  check('choosing a route in the list highlights it on the map', JSON.stringify(await sel()) === '[false,true,false]');
  // tapping a route's line on the map chooses it too
  const onLine = await page.evaluate(() => {
    const map = window.routeTracer.map; const r = map.getCanvasContainer().getBoundingClientRect();
    const c = window.routeTracer.sent.plan.features[2].geometry.coordinates; const p = map.project(c[2]);
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(onLine.x, onLine.y); await wait(300);
  check('tapping a route line on the map chooses it', JSON.stringify(await sel()) === '[false,false,true]', JSON.stringify(await sel()));
  // dragging the B pin plans again, and the map stays still
  const c0 = await center();
  const pinB = await page.locator('.plan-pin-b').boundingBox();
  check('the pins are not hidden under the planning card', await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('plan-pin'), [pinB.x + pinB.width / 2, pinB.y + pinB.height / 2]));
  planLog.length = 0;
  await page.mouse.move(pinB.x + pinB.width / 2, pinB.y + pinB.height / 2); await page.mouse.down();
  await page.mouse.move(pinB.x + 20, pinB.y + 30, { steps: 4 }); await page.mouse.move(pinB.x - 30, pinB.y + 70, { steps: 4 });
  await page.mouse.up(); await wait(900);
  check('dragging the B pin asks for new routes', planLog.length >= 1 && (await cards.count()) === 3, `requests ${planLog.length}`);
  check('and the map does not pan while the pin is dragged', (await center()).every((v, i) => Math.abs(v - c0[i]) < 1e-9));
  // another way of travelling
  planLog.length = 0;
  await page.getByRole('group', { name: 'Travel by' }).getByRole('button', { name: 'Cycling' }).click(); await wait(900);
  check('choosing Cycling plans again with the cycling profile', planLog.length === 1 && planLog[0].profile === 'cycling', JSON.stringify(planLog));
  // swap
  const aBefore = planLog[0].from;
  planLog.length = 0;
  await page.getByRole('button', { name: 'Swap A and B' }).click(); await wait(900);
  check('Swap A and B plans the reverse trip', planLog.length === 1 && JSON.stringify(planLog[0].to) === JSON.stringify(aBefore), JSON.stringify(planLog));
  // an error is explained, and Reset clears it
  planFail = 'No road or path was found near the end. Move it closer to a road or footpath.';
  await page.getByRole('button', { name: 'Swap A and B' }).click(); await wait(900);
  check('a routing problem is explained in plain words', /near the end/.test((await page.getByTestId('plan-error').textContent().catch(() => '')) ?? '') && (await cards.count()) === 0);
  check('and Use this route is off until there is one', await page.getByRole('button', { name: /^Use selected route/ }).isDisabled());
  planFail = null;
  await page.getByRole('button', { name: 'Swap A and B' }).click(); await wait(900);
  await cards.first().waitFor({ timeout: 10000 });
  // use it: opens in Edit points, saves as a planned route
  await cards.nth(1).click(); await wait(200);
  const chosen = await page.evaluate(() => window.routeTracer.sent.plan.features[1].geometry.coordinates);
  await page.getByRole('button', { name: /^Use selected route/ }).click();
  await page.getByRole('region', { name: 'Drawing tools' }).waitFor();
  check('the chosen route opens in Edit points with its distance', (await page.getByRole('button', { name: 'Edit points', exact: true }).getAttribute('aria-pressed')) === 'true' && km(await readout()) > 0);
  check('and planning is over (no routes or pins left)', !(await bar.isVisible()) && (await page.locator('.plan-pin').count()) === 0 && (await page.evaluate(() => window.routeTracer.sent.plan.features.length)) === 0);
  await page.getByRole('button', { name: 'Finish' }).click();
  await dlg.getByLabel('Name').press('Enter');
  await page.getByLabel('Track detail').waitFor();
  const planned = db.at(-1);
  check('saved as a planned route with the same points', planned.drawMode === 'route' && JSON.stringify(planned.geometry.coordinates[0]) === JSON.stringify(chosen), `${planned.drawMode} ${planned.geometry.coordinates[0].length} vs ${chosen.length}`);
  // cancel leaves nothing behind
  await home();
  await page.getByRole('button', { name: 'Plan route' }).click();
  await page.mouse.click(MX + 300, MY + 300); await wait(200);
  await page.getByRole('button', { name: 'Cancel' }).click(); await wait(300);
  check('Cancel clears the pins and routes', (await page.locator('.plan-pin').count()) === 0 && !(await bar.isVisible()));
}

// ---- Plan route: the A and B fields (named places, searched on Enter, never as you type) and the order of the routes
{
  await home();
  await page.getByRole('button', { name: 'Plan route' }).click();
  await page.getByTestId('planbar').waitFor();
  await page.getByRole('button', { name: 'A to B', exact: true }).click();
  await tipsOk('plan route: the A and B fields');
  const fieldA = page.getByLabel('Start (A)');
  const fieldB = page.getByLabel('End (B)');
  check('the fields start empty and say what to do', (await fieldA.inputValue()) === '' && /tap the map/i.test((await fieldA.getAttribute('placeholder')) ?? ''));
  reverseLog.length = 0; planLog.length = 0;
  await page.mouse.click(MX + 300, MY + 300); await wait(400);
  await page.mouse.click(MX + 760, MY + 360); await wait(1500);
  check('tapping the map names the place in the field', /^Test place \d+, Testville$/.test(await fieldA.inputValue()) && /^Test place \d+, Testville$/.test(await fieldB.inputValue()), `${await fieldA.inputValue()} | ${await fieldB.inputValue()}`);
  check('one place lookup per point, with its latitude and longitude', reverseLog.length === 2 && reverseLog.every((b) => typeof b.lat === 'number' && typeof b.lng === 'number' && Math.abs(b.lat) < 90), JSON.stringify(reverseLog));
  check('and a labelled box keeps its own name when its tooltip shows', (await fieldA.getAttribute('aria-label')) === 'Start (A)');

  // suggestions as you type: after a pause, from 3 letters, one request however fast the typing, from MapTiler, near where the map is looking
  const c = await center();
  suggestAnswer = [{ name: 'Test Park, Testville, Testshire, Australia', lat: c[1] - 0.01, lng: c[0] + 0.02 }, { name: 'Test Street, Elsewhere', lat: c[1], lng: c[0] }];
  geocodeLog.length = 0; suggestLog.length = 0;
  await fieldB.click();
  await fieldB.fill('Te'); await wait(700);
  check('under 3 letters nothing is asked for', suggestLog.length === 0 && geocodeLog.length === 0);
  await fieldB.fill(''); await fieldB.pressSequentially('Test Pa', { delay: 70 });
  check('nothing is asked for in the middle of typing', suggestLog.length === 0);
  await wait(900);
  check('after a pause in typing, one request goes to MapTiler (not one per letter), and not to Vault\'s private search', suggestLog.length === 1 && suggestLog[0].q === 'Test Pa' && geocodeLog.length === 0, JSON.stringify(suggestLog.map((x) => x.q)));
  check('it asks for autocomplete, a few places, and biases towards where the map is looking', suggestLog[0].params.autocomplete === 'true' && suggestLog[0].params.limit === '5' && /^-?[\d.]+,-?[\d.]+$/.test(suggestLog[0].params.proximity ?? '') && !!suggestLog[0].params.key, JSON.stringify(suggestLog[0].params));
  const list = page.getByRole('listbox', { name: 'Places found' });
  check('the suggestions are listed, shortened to what fits, with the attribution', (await list.getByRole('option').count()) === 2 && (await list.getByRole('option').first().textContent()) === 'Test Park, Testville, Testshire' && /MapTiler/.test((await list.textContent()) ?? ''), (await list.textContent()) ?? '');
  await tipsOk('place suggestions');

  // keyboard: arrows and Enter pick one, Escape closes
  await fieldB.press('Escape'); await wait(150);
  check('Escape closes the list', (await list.count()) === 0);
  await fieldB.fill('Test Par'); await wait(900);
  await fieldB.press('ArrowDown'); await fieldB.press('ArrowDown');
  check('the arrow keys move through the suggestions', (await list.getByRole('option').nth(1).getAttribute('aria-selected')) === 'true');
  await fieldB.press('ArrowUp');
  check('and back up', (await list.getByRole('option').first().getAttribute('aria-selected')) === 'true');
  reverseLog.length = 0; planLog.length = 0;
  await fieldB.press('Enter'); await wait(1500);
  check('Enter picks the highlighted suggestion: B moves there with its name, and plans again', (await fieldB.inputValue()) === 'Test Park, Testville, Testshire' && planLog.length >= 1 && Math.abs(planLog.at(-1).to[0] - (c[0] + 0.02)) < 1e-9, `${await fieldB.inputValue()} ${JSON.stringify(planLog.at(-1))}`);
  check('without looking the name up again', reverseLog.length === 0 && (await list.count()) === 0);

  // Enter with nothing highlighted searches at once, no pause
  suggestLog.length = 0;
  await fieldB.fill('Test Str'); await fieldB.press('Enter'); await wait(250);
  check('Enter searches straight away (no waiting for a pause)', suggestLog.length === 1 && suggestLog[0].q === 'Test Str' && (await list.getByRole('option').count()) === 2);
  await wait(800);
  check('and the pause that follows does not ask again', suggestLog.length === 1);
  await fieldB.press('Escape');
  await fieldB.fill('ab'); await fieldB.press('Enter'); await wait(300);
  check('Enter under 3 letters is explained and sends nothing', suggestLog.length === 1 && /at least 3 letters/.test((await list.textContent().catch(() => '')) ?? ''));

  // a slow answer for an older keystroke never replaces the newer one
  suggestLog.length = 0;
  suggestDelay = (q) => (q === 'Slow Fir' ? 1200 : 0);
  suggestAnswer = [{ name: 'Answer for the later words', lat: c[1], lng: c[0] }];
  await fieldB.fill('Slow Fir'); await wait(450);   // the pause passes: a slow request goes out
  await fieldB.fill('Slow First'); await wait(2000); // typed on, and answered faster
  check('an answer that arrives late for older typing is not shown over the newer one', suggestLog.length === 2 && (await list.getByRole('option').count()) === 1 && /later words/.test((await list.textContent()) ?? ''), JSON.stringify(suggestLog.map((x) => x.q)));
  suggestDelay = () => 0;

  // the same words again are remembered
  await fieldB.fill('Test Par'); await wait(900); suggestLog.length = 0;
  await fieldB.fill('Slow First'); await wait(900);
  check('words asked a moment ago are answered from memory', suggestLog.length === 0);

  // MapTiler cannot answer: typing says so, Enter falls back to Vault's private search
  suggestFail = 403;
  geocodeAnswer = [{ label: 'Private Park, Fallback', lat: c[1] - 0.01, lng: c[0] + 0.02 }];
  suggestLog.length = 0; geocodeLog.length = 0;
  await fieldB.fill('Fallback Park'); await wait(900);
  check('when suggestions are not available, typing says so and does not use the private search behind your back', /not available right now/.test((await list.textContent().catch(() => '')) ?? '') && geocodeLog.length === 0);
  await fieldB.press('Enter'); await wait(500);
  check('Enter then uses Vault\'s private search instead', geocodeLog.length === 1 && geocodeLog[0].q === 'Fallback Park' && (await list.getByRole('option').count()) === 1 && !/MapTiler/.test((await list.textContent()) ?? ''));
  suggestFail = 0;
  await fieldB.press('Escape');
  suggestAnswer = [{ name: 'Test Park, Testville, Testshire, Australia', lat: c[1] - 0.01, lng: c[0] + 0.02 }, { name: 'Test Street, Elsewhere', lat: c[1], lng: c[0] }];
  await fieldB.fill('Test Park'); await wait(900);
  reverseLog.length = 0; planLog.length = 0;
  await list.getByRole('option').first().click(); await wait(1500);
  check('choosing a place sets B there, with its name, and plans again', (await fieldB.inputValue()) === 'Test Park, Testville, Testshire' && planLog.length >= 1, `${await fieldB.inputValue()} ${planLog.length}`);
  check('and does not look the name up again', reverseLog.length === 0);

  // dragging a pin names the new spot
  reverseLog.length = 0;
  const pin = await page.locator('.plan-pin-b').boundingBox(); // B is where the map was flown to; A may be off screen
  await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2); await page.mouse.down();
  await page.mouse.move(pin.x + 25, pin.y + 25, { steps: 4 }); await page.mouse.move(pin.x + 50, pin.y + 40, { steps: 4 });
  await page.mouse.up(); await wait(1500);
  check('dragging the B pin looks up the new place and renames the field', reverseLog.length === 1 && /^Test place \d+, Testville$/.test(await fieldB.inputValue()), `${reverseLog.length} ${await fieldB.inputValue()}`);

  // swapping swaps the names too
  const [na, nb] = [await fieldA.inputValue(), await fieldB.inputValue()];
  await page.getByRole('button', { name: 'Swap A and B' }).click(); await wait(1200);
  check('Swap A and B swaps the names with the points', (await fieldA.inputValue()) === nb && (await fieldB.inputValue()) === na);

  // the shortest route is listed first, however the service ordered them; "Suggested" stays with the service's own first choice
  planOrder = 'shuffled';
  await page.getByRole('button', { name: 'Swap A and B' }).click(); await wait(1500);
  const cards = page.getByTestId('plan-route');
  await cards.first().waitFor({ timeout: 10000 });
  const texts = await cards.allTextContents();
  const metres = (t) => { const m = /(\d+(?:\.\d+)?) (km|m)\b/.exec(t); return m ? (m[2] === 'km' ? parseFloat(m[1]) * 1000 : parseFloat(m[1])) : NaN; };
  const metas = await cards.locator('.plan-meta').allTextContents();
  check('the shortest is listed first, then the others by length', /^Shortest/.test(texts[0]) && /^Option 2/.test(texts[1]) && /^Option 3/.test(texts[2]) && metres(metas[0]) <= metres(metas[1]) && metres(metas[1]) <= metres(metas[2]), `${texts.join(' | ')} / ${metas.join(' | ')}`);
  check('"Suggested" marks the service\'s own first choice, wherever it falls', texts.filter((t) => /Suggested/.test(t)).length === 1 && /Suggested/.test(texts[2]), texts.join(' | '));
  await cards.first().click(); await wait(300);
  check('choosing the first card chooses that route on the map', JSON.stringify(await page.evaluate(() => (window.routeTracer.sent.plan?.features ?? []).map((f) => !!f.properties.sel))) === '[false,true,false]');
  planOrder = 'sorted';
  await page.getByRole('button', { name: 'Cancel' }).click(); await wait(300);
}

// ---- Plan route: a loop of about X km from one point
{
  await home();
  await page.getByRole('button', { name: 'Plan route' }).click();
  await page.getByTestId('planbar').waitFor();
  await page.getByRole('button', { name: 'Loop', exact: true }).click();
  check('Loop asks for just a start', /set the start\. The loop begins and ends there/.test((await page.getByTestId('plan-step').textContent()) ?? ''));
  await tipsOk('plan route: loop');
  loopLog.length = 0;
  await page.mouse.click(MX + 500, MY + 300);
  await page.getByTestId('plan-route').first().waitFor({ timeout: 10000 });
  const cards = page.getByTestId('plan-route');
  const texts = await cards.allTextContents();
  await wait(800); await shot('loop');
  check('three loops are offered, each saying how far it is from the target', texts.length === 3 && texts.every((t) => /^Loop \d/.test(t) && (/\([+−]\d+%\)/.test(t) || /on target/.test(t)) && /min|h/.test(t)), texts.join(' | '));
  const profileNowName = await profileNow();
  check('the request has the start, 5 km (the default), the profile and round 0', loopLog.length === 1 && loopLog[0].lengthKm === 5 && loopLog[0].round === 0 && loopLog[0].profile === profileNowName && loopLog[0].from.length === 2, JSON.stringify(loopLog[0]));
  check('only the start pin is on the map (a loop has no end)', (await page.locator('.plan-pin-a').count()) === 1 && (await page.locator('.plan-pin-b').count()) === 0);
  await wait(500);
  check('the loops are drawn, the first chosen', (await page.evaluate(() => window.routeTracer.sent.plan.features.length)) === 3);
  // a different length plans again; an out-of-range one is refused in the box, with no request
  loopLog.length = 0;
  const len = page.getByLabel(/^Length/);
  await len.fill('8'); await wait(1200);
  check('typing a new length plans again with it', loopLog.length === 1 && loopLog[0].lengthKm === 8, JSON.stringify(loopLog));
  loopLog.length = 0;
  await len.fill('0.4'); await wait(1200);
  check('a length that is too short is explained and not sent', /between 1 and 50 km/.test((await page.getByRole('alert').first().textContent()) ?? '') && loopLog.length === 0);
  await len.fill('80'); await wait(1000);
  check('and so is one that is too long', /between 1 and 50 km/.test((await page.getByRole('alert').first().textContent()) ?? '') && loopLog.length === 0);
  await len.fill('8'); await wait(1200);
  check('going back to the same length keeps the loops on screen without asking again', loopLog.length === 0 && (await cards.count()) === 3);
  await page.getByRole('button', { name: 'Loop', exact: true }).click(); await wait(300);
  check('choosing Loop again when it is already chosen changes nothing', (await cards.count()) === 3 && (await page.locator('.plan-pin-a').count()) === 1);
  await len.fill('9'); await wait(1200);
  check('a different valid length plans again', loopLog.length === 1 && loopLog[0].lengthKm === 9, JSON.stringify(loopLog));
  // different loops
  loopLog.length = 0;
  await page.getByTestId('more-loops').click(); await wait(1000);
  check('Different loops asks for the next round', loopLog.length === 1 && loopLog[0].round === 1 && loopLog[0].lengthKm === 9, JSON.stringify(loopLog));
  // units: the box follows km / mi
  await setUnits('mi'); await wait(300);
  check('in miles the box shows the same length in miles', (await len.inputValue()) === '5.6' && /Length \(mi\)/.test((await page.getByText(/^Length \(/).first().textContent()) ?? ''), await len.inputValue());
  loopLog.length = 0;
  await len.fill('3'); await wait(1200);
  check('a length typed in miles is sent in km', loopLog.length === 1 && Math.abs(loopLog[0].lengthKm - 3 * 1.609344) < 0.001, JSON.stringify(loopLog));
  await setUnits('km'); await wait(300);
  await cards.first().waitFor({ timeout: 10000 });
  // use the first loop: opens in Edit points and is saved as a planned route that ends where it began
  const chosen = await page.evaluate(() => window.routeTracer.sent.plan.features[0].geometry.coordinates);
  await page.getByRole('button', { name: /^Use selected loop/ }).click();
  await page.getByRole('region', { name: 'Drawing tools' }).waitFor();
  await page.getByRole('button', { name: 'Finish' }).click();
  await dlg.getByLabel('Name').press('Enter');
  await page.getByLabel('Track detail').waitFor();
  const lp = db.at(-1);
  const pts = lp.geometry.coordinates[0];
  check('the loop is saved as a planned route that ends where it began', lp.drawMode === 'route' && JSON.stringify(pts) === JSON.stringify(chosen) && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1], `${lp.drawMode} ${pts.length}`);
}

// ---- Plan route: a longer A to B (about X km between the same two points)
{
  await home();
  await page.getByRole('button', { name: 'Plan route' }).click();
  await page.getByTestId('planbar').waitFor();
  await page.getByRole('button', { name: 'Longer route' }).click();
  check('Longer route asks for the start first', /set the start \(A\)/.test((await page.getByTestId('plan-step').textContent()) ?? ''));
  await tipsOk('plan route: longer A to B');
  detourLog.length = 0;
  await page.mouse.click(MX + 100, MY + 250); await wait(300);
  check('then the end', /set the end \(B\)/.test((await page.getByTestId('plan-step').textContent()) ?? ''));
  await page.mouse.click(MX + 850, MY + 330);
  await page.getByTestId('plan-route').first().waitFor({ timeout: 10000 });
  check('with no length yet it asks for the direct route only', detourLog.length === 1 && detourLog[0].lengthKm === undefined, JSON.stringify(detourLog));
  const directKm = lastDirectM / 1000;
  const step = (await page.getByTestId('plan-step').textContent()) ?? '';
  check('and says how long the direct route is, and that a longer length is needed', /The direct route is/.test(step) && /longer than that/.test(step), step);
  check('the direct route is the one card, not offered as an option', (await page.getByTestId('plan-route').count()) === 1 && /Direct route/.test((await page.getByTestId('plan-route').first().textContent()) ?? ''));
  check('Different routes waits for a length', await page.getByTestId('more-loops').isDisabled());
  check('the direct route is long enough to test the limits (at least 2 km, and 4x under 100 km)', directKm > 2 && directKm * 4 < 99, directKm.toFixed(1));

  // a length shorter than the direct route is explained, with the direct distance
  const len = page.getByLabel(/^Length you want/);
  detourLog.length = 0;
  await len.fill(String(Math.round(directKm * 5) / 10)); await wait(1200);
  let err = (await page.getByTestId('plan-error').textContent().catch(() => '')) ?? '';
  check('a length shorter than the direct route is explained with its length', /The shortest route is already/.test(err) && /Choose a longer distance/.test(err) && err.includes(directKm.toFixed(2)), err);
  check('and Use this route is off', await page.getByRole('button', { name: /^Use selected route/ }).isDisabled());
  // far longer than the direct route
  await len.fill(String(Math.floor(directKm * 4.5))); await wait(1200);
  err = (await page.getByTestId('plan-error').textContent().catch(() => '')) ?? '';
  check('a length far beyond the direct route says what the most is, and suggests Loop', /a lot longer than the direct route/.test(err) && /Choose up to/.test(err) && /Loop/.test(err), err);
  // out of range is refused in the box without a request
  detourLog.length = 0;
  await len.fill('150'); await wait(1000);
  check('a length outside 1 to 100 km is refused in the box, not sent', /between 1 and 100 km/.test((await page.getByRole('alert').first().textContent()) ?? '') && detourLog.length === 0);

  // a good length: three options, each close to what was asked
  const want = Math.round(directKm * 16) / 10;
  detourLog.length = 0;
  await len.fill(String(want)); await wait(1300);
  const cards = page.getByTestId('plan-route');
  await cards.first().waitFor({ timeout: 10000 });
  const texts = await cards.allTextContents();
  check('three options are offered, each saying how far it is from the length asked for', texts.length === 3 && texts.every((t) => /^Route \d/.test(t) && (/\([+−]\d+%\)/.test(t) || /on target/.test(t))), texts.join(' | '));
  check('the request had both points, the length and round 0', detourLog.length === 1 && detourLog[0].lengthKm === want && detourLog[0].round === 0 && detourLog[0].to.length === 2 && detourLog[0].from.length === 2, JSON.stringify(detourLog[0]));
  await wait(500);
  await shot('detour');
  check('all three are drawn, and both pins stay', (await page.evaluate(() => window.routeTracer.sent.plan.features.length)) === 3 && (await page.locator('.plan-pin-a').count()) === 1 && (await page.locator('.plan-pin-b').count()) === 1);
  // different routes: the next round
  detourLog.length = 0;
  await page.getByTestId('more-loops').click(); await wait(1100);
  check('Different routes asks for the next round of shapes', detourLog.length === 1 && detourLog[0].round === 1 && detourLog[0].lengthKm === want, JSON.stringify(detourLog));
  // swap keeps the length
  detourLog.length = 0;
  await page.getByRole('button', { name: 'Swap A and B' }).click(); await wait(1100);
  check('Swap A and B plans the reverse trip with the same length', detourLog.length === 1 && detourLog[0].lengthKm === want, JSON.stringify(detourLog));
  await cards.first().waitFor({ timeout: 10000 });
  // switching to A to B keeps both points; Loop drops B
  await page.getByRole('button', { name: 'A to B', exact: true }).click(); await wait(900);
  check('switching to plain A to B keeps both points', (await page.locator('.plan-pin-b').count()) === 1 && (await cards.count()) === 3);
  detourLog.length = 0;
  await page.getByRole('button', { name: 'Longer route' }).click(); await wait(1200);
  check('and back to Longer A to B plans again with the length that was typed', detourLog.length === 1 && detourLog[0].lengthKm === want && (await page.locator('.plan-pin-b').count()) === 1, JSON.stringify(detourLog));
  await page.getByRole('button', { name: 'Loop', exact: true }).click(); await wait(300);
  check('Loop drops B', (await page.locator('.plan-pin-b').count()) === 0 && (await page.locator('.plan-pin-a').count()) === 1);
  await page.getByRole('button', { name: 'Longer route' }).click(); await wait(300);
  check('and B is not remembered when coming back from Loop', (await page.locator('.plan-pin-b').count()) === 0 && /set the end \(B\)/.test((await page.getByTestId('plan-step').textContent()) ?? ''));
  await page.mouse.click(MX + 850, MY + 330); await wait(1500);
  // the new B is a different distance from A, so choose a length that suits it (1.6x the direct route, as before)
  await len.fill(String(Math.round((lastDirectM / 1000) * 16) / 10)); await wait(1300);
  await cards.first().waitFor({ timeout: 10000 });
  // use it: opens in Edit points and saves as a planned route that runs from A to B
  const chosen = await page.evaluate(() => window.routeTracer.sent.plan.features[0].geometry.coordinates);
  await page.getByRole('button', { name: /^Use selected route/ }).click();
  await page.getByRole('region', { name: 'Drawing tools' }).waitFor();
  check('the chosen detour opens in Edit points with its distance', (await page.getByRole('button', { name: 'Edit points', exact: true }).getAttribute('aria-pressed')) === 'true' && km(await readout()) > lastDirectM / 1000);
  await page.getByRole('button', { name: 'Finish' }).click();
  await dlg.getByLabel('Name').press('Enter');
  await page.getByLabel('Track detail').waitFor();
  const saved = db.at(-1);
  const sp = saved.geometry.coordinates[0];
  check('saved as a planned route with the same points', saved.drawMode === 'route' && JSON.stringify(sp) === JSON.stringify(chosen), `${saved.drawMode} ${sp.length}`);
}

// ---- Vault's look: the theme and font chosen in Vault's Settings (localStorage 'vault-settings') are used, and follow a change
{
  const cssVar = (pg, name) => pg.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const bgOf = (pg, sel) => pg.evaluate((q) => getComputedStyle(document.querySelector(q)).backgroundColor, sel);
  check('DM Sans (Vault\'s default font) is linked in this page: a frame does not share the fonts of the page around it', await page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href.includes('family=DM+Sans'))));
  check('with nothing saved it wears Vault\'s default, Warm Sand', (await cssVar(page, '--color-primary')).toLowerCase() === '#cc785c' && (await bgOf(page, 'body')) === 'rgb(245, 245, 240)', `${await cssVar(page, '--color-primary')} ${await bgOf(page, 'body')}`);
  const themed = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await themed.addInitScript(() => {
    localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 1 } } }));
    localStorage.setItem('route-tracer:info-seen:v1', '1');
    localStorage.setItem('vault-settings', JSON.stringify({ state: { theme: 'dark-slate', font: 'Lato' }, version: 0 }));
  });
  const tp2 = await themed.newPage();
  await tp2.route('https://api.maptiler.com/**', (r) => r.fulfill({ json: STYLE, headers: cors }));
  await tp2.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await tp2.route('**/api/route-tracks/config', (r) => r.fulfill({ json: { maptilerKey: 'test', routePlanning: true } }));
  await tp2.route('**/api/route-tracks?**', (r) => r.fulfill({ json: { tracks: [], nextCursor: null } }));
  await tp2.goto(APP);
  await tp2.waitForFunction(() => window.routeTracer?.map?.isStyleLoaded());
  check('the chosen theme colours are used (Dark Slate)', (await cssVar(tp2, '--color-primary')).toLowerCase() === '#7c8cf8' && (await bgOf(tp2, 'body')) === 'rgb(15, 17, 23)' && (await bgOf(tp2, '[data-testid=sidebar]')) === 'rgb(26, 29, 39)', `${await cssVar(tp2, '--color-primary')} ${await bgOf(tp2, 'body')} ${await bgOf(tp2, '[data-testid=sidebar]')}`);
  check('the chosen font is used (Lato), and fetched like Vault does', (await tp2.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Lato') && (await tp2.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href.includes('family=Lato')))));
  check('a primary button is the theme colour with readable text', (await bgOf(tp2, 'button.primary')) === 'rgb(124, 140, 248)' && (await tp2.evaluate(() => getComputedStyle(document.querySelector('button.primary')).color)) === 'rgb(255, 255, 255)');
  check('a dark theme tells the browser, so its own controls follow', (await tp2.evaluate(() => getComputedStyle(document.documentElement).colorScheme)) === 'dark');
  // Vault's Settings changed in another tab: the theme follows without a reload
  await tp2.evaluate(() => {
    const v = JSON.stringify({ state: { theme: 'forest', font: 'Inter' }, version: 0 });
    localStorage.setItem('vault-settings', v);
    window.dispatchEvent(new StorageEvent('storage', { key: 'vault-settings', newValue: v }));
  });
  await wait(300);
  check('and a change in Vault\'s settings is picked up live', (await cssVar(tp2, '--color-primary')).toLowerCase() === '#3d7a5e' && (await bgOf(tp2, 'body')) === 'rgb(240, 244, 240)' && (await tp2.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Inter'));
  await tp2.evaluate(() => { localStorage.setItem('vault-settings', '{broken'); window.dispatchEvent(new StorageEvent('storage', { key: 'vault-settings' })); });
  await wait(200);
  check('unreadable settings fall back to Vault\'s default, not a broken page', (await cssVar(tp2, '--color-primary')).toLowerCase() === '#cc785c');
  await themed.close();
}

// ---- Click mode with Follow roads: each click finds the road from the last one
{
  await home();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('button', { name: 'Click', exact: true }).click();
  const follow = page.getByRole('button', { name: 'Follow roads', exact: true });
  const feats = () => page.evaluate(() => (window.routeTracer.sent.draw?.features ?? []).map((f) => ({ kind: f.properties.kind, n: f.geometry.type === 'LineString' ? f.geometry.coordinates.length : 1, c: f.geometry.coordinates })));
  const kinds = async (k) => (await feats()).filter((f) => f.kind === k);
  const screenOf = (idx) => page.evaluate((i) => {
    const map = window.routeTracer.map; const r = map.getCanvasContainer().getBoundingClientRect();
    const v = window.routeTracer.sent.draw.features.filter((f) => f.properties.kind === 'vertex')[i]; const p = map.project(v.geometry.coordinates);
    return { x: r.left + p.x, y: r.top + p.y };
  }, idx);
  const clickAt = async (x, y) => { await page.mouse.click(MX + x, MY + y); await wait(500); };
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('[data-testid=snap-status]'), undefined, { timeout: 8000 });

  check('the Follow roads switch is there in Click mode, and off to begin with', (await follow.getAttribute('aria-pressed')) === 'false' && await follow.isEnabled());
  // the switch cannot be turned on over a plain line
  await page.getByRole('button', { name: 'Click', exact: true }).click();
  await clickAt(250, 300); await clickAt(400, 330);
  check('with a plain line already drawn it cannot be turned on, and says why', await follow.isDisabled() && /Clear this drawing/.test((await follow.getAttribute('title')) ?? ''));
  await page.getByRole('button', { name: 'Clear' }).click(); await page.getByRole('button', { name: 'Yes', exact: true }).click(); await wait(300);
  check('Clear makes it available again', await follow.isEnabled());

  await follow.click();
  check('turning it on shows the way of travelling', (await follow.getAttribute('aria-pressed')) === 'true' && (await page.getByRole('group', { name: 'Follow roads for' }).getByRole('button').count()) === 4);
  await tipsOk('follow roads');
  const profile = ((await page.evaluate(() => document.querySelector('[role=group][aria-label="Follow roads for"] button[aria-pressed=true]')?.getAttribute('aria-label') ?? '')).replace('Follow roads for ', ''));
  legLog.length = 0; legMetres.length = 0;
  await clickAt(250, 300); await clickAt(450, 360); await clickAt(650, 320);
  await waitIdle().catch(() => undefined); await wait(400);
  check('the first click asks for nothing; each later click asks for the road from the last one, in the chosen way of travelling', legLog.length === 2 && legLog.every((l) => l.profile === profile) && JSON.stringify(legLog[0].to) === JSON.stringify(legLog[1].from), JSON.stringify(legLog.map((l) => [l.profile, l.from.map((n) => +n.toFixed(4)), l.to.map((n) => +n.toFixed(4))])));
  const v3 = await kinds('vertex');
  const roads = await kinds('line');
  check('the handles are the three points clicked, and the route is drawn along the roads (two legs of three points)', v3.length === 3 && roads.length === 2 && roads.every((r) => r.n === 3), `${v3.length} handles, ${roads.map((r) => r.n)}`);
  const sum = legMetres.reduce((a, b) => a + b, 0) / 1000;
  check('the distance is the length of the roads, not of the straight lines', Math.abs(km(await readout()) - sum) < 0.03 && sum > 0, `${await readout()} vs ${sum.toFixed(2)} km`);

  // undo takes back one click: the point and its road
  await page.getByRole('button', { name: 'Undo' }).click(); await wait(400);
  check('Undo takes back the last point and its road together, without asking for anything', (await kinds('vertex')).length === 2 && legLog.length === 2 && Math.abs(km(await readout()) - legMetres[0] / 1000) < 0.03);
  await clickAt(650, 320); await waitIdle().catch(() => undefined); await wait(300);
  check('clicking the same place again is answered from what was learned (no new request)', legLog.length === 2 || legLog.length === 3, String(legLog.length));

  // dragging a point: nothing is asked for while dragging; on release the two roads beside it are found again
  const before = legLog.length;
  const centreBefore = await center();
  const wp = await screenOf(1);
  await page.mouse.move(wp.x, wp.y); await page.mouse.down();
  await page.mouse.move(wp.x + 15, wp.y + 25, { steps: 4 }); await page.mouse.move(wp.x + 40, wp.y + 60, { steps: 4 });
  await wait(600);
  check('while a point is being dragged nothing is asked for, and the legs beside it are straight', legLog.length === before && (await kinds('rawleg')).length === 2);
  await page.mouse.up(); await wait(900);
  check('on release the two roads beside the point are found again, and the map did not move', legLog.length === before + 2 && (await center()).every((v, i) => Math.abs(v - centreBefore[i]) < 1e-9) && (await kinds('rawleg')).length === 0, `${legLog.length - before} new, ${(await kinds('rawleg')).length} raw`);
  await page.getByRole('button', { name: 'Undo' }).click(); await wait(400);
  check('one Undo puts the dragged point and its roads back', (await kinds('vertex')).length === 3 && (await kinds('rawleg')).length === 0);

  // a click where no road can be found: kept as a straight line, said once, and Try again
  legFail = true;
  const failFrom = legLog.length;
  await clickAt(300, 450); await wait(900);
  const status = page.getByTestId('snap-status');
  check('where no road can be found the section stays a straight line and says so', /could not follow a road/.test((await status.textContent()) ?? '') && (await kinds('rawleg')).length === 1 && legLog.length === failFrom + 1);
  check('and the person is told why', (await page.getByText(/No road or path was found near the end/).count()) >= 1);
  legFail = false;
  await page.getByRole('button', { name: 'Try again' }).click(); await wait(1000);
  check('Try again finds it', legLog.length === failFrom + 2 && (await kinds('rawleg')).length === 0 && (await status.count()) === 0);

  // Finish waits for roads that are still being found
  legDelay = 1500;
  await clickAt(500, 480);
  const finishBtn = page.getByRole('button', { name: 'Finish' });
  check('Finish waits while a road is being found', await finishBtn.isDisabled() && /Waiting for the roads/.test((await finishBtn.getAttribute('title')) ?? ''));
  await page.waitForFunction(() => !document.querySelector('[data-testid=snap-status]'), undefined, { timeout: 8000 });
  legDelay = 0;
  check('and is available once they are found', await finishBtn.isEnabled());

  // return to start and out and back
  const nLegs = (await kinds('line')).length + (await kinds('rawleg')).length;
  const beforeLoop = legLog.length;
  await page.getByRole('button', { name: 'Return to start' }).click(); await wait(900);
  const afterLoop = await kinds('line');
  check('Return to start finds a road back to the first point', legLog.length === beforeLoop + 1 && afterLoop.length === nLegs + 1 && JSON.stringify(legLog.at(-1).to) === JSON.stringify(legLog[0].from), `${legLog.length - beforeLoop} new`);
  const dLoop = km(await readout());
  const beforeOB = legLog.length;
  await page.getByRole('button', { name: 'Out and back' }).click(); await wait(500);
  check('Out and back doubles the distance along the same roads without asking for any', legLog.length === beforeOB && Math.abs(km(await readout()) - 2 * dLoop) < 0.05, `${dLoop} -> ${await readout()}`);
  await page.getByRole('button', { name: 'Undo' }).click(); await wait(300);

  // Edit points on a road-following route: the handles are the points clicked and a dot on each road
  await page.getByRole('button', { name: 'Edit points', exact: true }).click(); await wait(500);
  const wpCount = (await kinds('vertex')).length;
  const midCount = (await kinds('mid')).length;
  check('Edit points shows only the points that were clicked, with a dot in the middle of each road (not every point of the road)', wpCount <= 8 && wpCount >= 5 && midCount >= 3 && midCount <= wpCount, `${wpCount} points, ${midCount} dots`);
  await shot('follow-edit');
  const dot = await page.evaluate(() => {
    const map = window.routeTracer.map; const r = map.getCanvasContainer().getBoundingClientRect();
    const f = window.routeTracer.sent.draw.features.filter((x) => x.properties.kind === 'mid')[0]; const p = map.project(f.geometry.coordinates);
    return { x: r.left + p.x, y: r.top + p.y };
  });
  const beforeIns = legLog.length;
  await page.mouse.move(dot.x, dot.y); await page.mouse.down();
  await page.mouse.move(dot.x + 10, dot.y - 20, { steps: 4 }); await page.mouse.move(dot.x + 20, dot.y - 50, { steps: 4 });
  await page.mouse.up(); await wait(1000);
  check('dragging a dot adds a point there and finds the two roads either side of it', (await kinds('vertex')).length === wpCount + 1 && legLog.length === beforeIns + 2, `${(await kinds('vertex')).length} points, ${legLog.length - beforeIns} requests`);
  const pick = await screenOf(2);
  await page.mouse.click(pick.x, pick.y); await wait(300);
  const delBtn = page.getByRole('button', { name: 'Delete selected point' });
  check('a tapped point can be deleted', await delBtn.isEnabled());
  const beforeDel = legLog.length;
  await delBtn.click(); await wait(1000);
  check('deleting a point joins the two roads beside it into one, found again', (await kinds('vertex')).length === wpCount && legLog.length === beforeDel + 1, `${(await kinds('vertex')).length} points, ${legLog.length - beforeDel} requests`);

  // Follow roads off: the next click is a straight leg, asked for nothing
  await page.getByRole('button', { name: 'Click', exact: true }).click(); await wait(200);
  await follow.click();
  check('turning Follow roads off keeps the route and adds straight lines from then on', (await follow.getAttribute('aria-pressed')) === 'false');
  const beforeStraight = legLog.length;
  await clickAt(200, 200); await wait(400);
  const last = (await kinds('line')).at(-1);
  check('a click with it off adds a straight leg and asks for nothing', legLog.length === beforeStraight && last.n === 2);

  // saved as an ordinary track, with the roads as its geometry
  const nWps = (await kinds('vertex')).length;
  await page.getByRole('button', { name: 'Finish' }).click();
  await dlg.getByLabel('Name').fill('Road route');
  await dlg.getByLabel('Name').press('Enter');
  await page.getByLabel('Track detail').waitFor();
  const roadTrack = db.at(-1);
  check('saved as a click-mode track whose geometry is the roads (many more points than clicks)', roadTrack.name === 'Road route' && roadTrack.drawMode === 'click' && roadTrack.geometry.coordinates.length === 1 && roadTrack.pointCount > nWps + 3, `${roadTrack.pointCount} points for ${nWps} clicks`);
  await shot('follow-saved');
  // leave Follow roads off for the rest of the run
}

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
  check('and explains Map as PDF, downloading and emailing', /Map as PDF: download or email/.test(guide) && /Email PDF/.test(guide));
  check('and covers drawing, elevation, GPX and tracks', /Freehand/.test(guide) && /Elevation and climb/.test(guide) && /GPX files/.test(guide) && /Saving and your tracks/.test(guide));
  const noTips = await fp.evaluate(() => [...document.querySelectorAll('[data-testid=info-modal] button')].filter((b) => !(b.getAttribute('title') || b.getAttribute('data-tip') || '').trim()).length); // a focused button has its title moved to data-tip by the tooltip host
  check('guide buttons have tooltips too', noTips === 0);
  await fp.keyboard.press('Escape'); await wait(300);
  check('Plan route is greyed out, with a reason, when the server has no routing key', await fp.getByRole('button', { name: 'Plan route' }).isDisabled() && /not set up/.test((await fp.getByRole('button', { name: 'Plan route' }).getAttribute('title')) ?? '') );
  await fp.keyboard.press('Escape'); await wait(150);
  await fp.getByRole('button', { name: 'Draw', exact: true }).click();
  await fp.getByRole('button', { name: 'Click', exact: true }).click();
  { const f = fp.getByRole('button', { name: 'Follow roads', exact: true }); check('without a routing key Follow roads is off and says why', (await f.isDisabled()) && /not set up/.test((await f.getAttribute('title')) ?? '')); }
  await fp.getByRole('button', { name: 'Cancel' }).click();
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
  check('?tour=1 starts the tour', (await fp.locator('.vault-tour-step-count').first().textContent()) === 'Step 1 of 12');
  await fp.keyboard.press('Escape');
  const doneFlag = await fp.waitForFunction(() => localStorage.getItem('vault_tour_route_tracer_completed') === '1', undefined, { timeout: 4000 }).then(() => true, () => false);
  check('skipping marks it done', doneFlag);
  await fresh.close();
}
{
  await gear();
  await page.getByRole('menuitem', { name: 'Take the guided tour' }).click();
  const card = () => page.locator('.shepherd-element.vault-tour:not([hidden])').last();
  await card().waitFor({ timeout: 10000 });
  const seen = [];
  const attached = [];
  for (let i = 1; i <= 12; i += 1) {
    await page.waitForFunction((n) => [...document.querySelectorAll('.vault-tour-step-count')].some((e) => e.textContent === `Step ${n} of 12` && e.closest('.shepherd-element:not([hidden])')), i, { timeout: 10000 });
    await wait(550);
    seen.push((await card().locator('.shepherd-title').textContent())?.trim());
    attached.push(!!(await card().getAttribute('data-popper-placement')));
    if (i === 6) await shot('tour');
    if (i === 6) check('the tour opens the drawing tools for the drawing steps', await page.getByRole('region', { name: 'Drawing tools' }).isVisible());
    if (i === 9) check('and the tracks list for its step', await page.getByRole('complementary', { name: 'Tracks' }).isVisible() && !(await page.getByRole('region', { name: 'Drawing tools' }).isVisible()));
    const next = card().getByRole('button', { name: /Next|Start Tour|Finish/ });
    await next.click();
  }
  await wait(500);
  check('the tour has 12 steps with titles', seen.length === 12 && seen.every(Boolean) && new Set(seen).size === 12, seen.join(' | '));
  check('every step that points at something is attached to it', [1, 2, 3, 4, 5, 6, 7, 8, 9].every((i) => attached[i]), JSON.stringify(attached));
  check('finishing the tour marks it done', (await page.evaluate(() => localStorage.getItem('vault_tour_route_tracer_completed'))) === '1');
  check('and puts the screen back as it was: the drawing tools it opened are closed and the tracks list is showing', !(await page.getByRole('region', { name: 'Drawing tools' }).isVisible()) && (await page.getByRole('complementary', { name: 'Tracks' }).isVisible()));
  await tipsOk('after the tour');
}

// ---- units
await setUnits('mi');
await home();
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
await send('touchStart', [{ x: 100, y: 200, id: 1 }]);
for (let i = 1; i <= 8; i += 1) await send('touchMove', [{ x: 100 + i * 25, y: 200 + i * 6, id: 1 }]);
await send('touchEnd', []);
await tp.waitForTimeout(200);
const t1 = await tdist();
check('touch: one finger draws', km(t1) > 0, t1);
{ const sb = await tp.getByTestId('sidebar').boundingBox(); const mp = await tp.getByTestId('map').boundingBox();
  check('on a phone the sidebar is a sheet along the bottom of the screen, with the map behind and above it', Math.abs(sb.y + sb.height - 780) < 3 && sb.width > 380 && sb.height < 780 * 0.55 && mp.width > 380, JSON.stringify({ sb, mp: { w: mp.width, h: mp.height } })); }
await send('touchStart', [{ x: 120, y: 250, id: 1 }, { x: 220, y: 250, id: 2 }]);
for (let i = 1; i <= 8; i += 1) await send('touchMove', [{ x: 120 + i * 10, y: 250, id: 1 }, { x: 220 + i * 10, y: 250, id: 2 }]);
await send('touchEnd', []);
await tp.waitForTimeout(200);
check('touch: two fingers draw nothing', (await tdist()) === t1, `${t1} -> ${await tdist()}`);
if (out) await tp.screenshot({ path: join(out, 'phone.png') });

check('no page errors', problems.length === 0, problems.join(' | '));
await browser.close();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
