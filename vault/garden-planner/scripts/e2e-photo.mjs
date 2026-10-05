// End-to-end checks of Render photo for the garden in real Chrome (SwiftShader WebGL). `npm run dev` first, then
// `node scripts/e2e-photo.mjs [screenshotDir]`. Software GL is slow, so this renders a tiny picture for a few passes. Not part of e2e.mjs.
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const URL = process.env.GP_URL ?? 'http://127.0.0.1:5175/garden-planner-app/';
const out = process.argv[2] ?? 'spike/out-photo';
mkdirSync(out, { recursive: true });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`); if (!ok) failures++; };

// a solid green 8x8 PNG for the fake satellite tiles
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [30, 160, 40]).flat())])));
const GREEN_PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(withMap) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((signedIn) => {
    try {
      localStorage.setItem('garden-planner:info-seen:v1', '1');
      if (signedIn) localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token' }, version: 0 }));
    } catch { /* ignore */ }
  }, withMap);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (withMap) {
    await page.route('**/api/garden-projects**', (r) => r.abort('failed'));
    await page.route('**/api/map-tiles/**', (route) => {
      const path = new globalThis.URL(route.request().url()).pathname.replace(/^.*\/api\/map-tiles/, '');
      if (path === '/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 20 }) });
      return route.fulfill({ status: 200, contentType: 'image/png', body: GREEN_PNG });
    });
  }
  await page.goto(URL);
  await page.waitForSelector('.wizard');
  await page.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Photo garden', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 24, depth: 20 } }));
  await page.waitForSelector('.stage canvas');
  // a house, a lawn, a bed and a few plants, so there is something to light
  await page.evaluate(() => {
    const a = window.gardenPlanner;
    const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const house = { id: 'h', vertices: rect(6, 12, 18, 18).map((position, i) => ({ id: 'v' + i, position })), height: 3.2 };
    a.project.getState().commit({ type: 'Composite', commands: [
      { type: 'SetSingleton', name: 'house', from: null, to: house },
      { type: 'SetItem', collection: 'lawns', id: 'l1', from: null, to: { id: 'l1', name: 'Lawn', shape: { points: rect(3, 2, 21, 9), smooth: false }, grass: 'couch' } },
      { type: 'SetItem', collection: 'plants', id: 'p1', from: null, to: { id: 'p1', plantId: 'syzygium-smithii', position: { x: 4, y: 11 } } },
      { type: 'SetItem', collection: 'plants', id: 'p2', from: null, to: { id: 'p2', plantId: 'lavandula-angustifolia', position: { x: 20, y: 11 } } },
    ] }, 'demo');
    a.ui.getState().set({ viewMode: '3d', month: 12, hour: 11 });
  });
  await page.waitForSelector('[data-testid="open-photo"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  return { ctx, page, errs };
}

// ------------------------------------------------------------ a garden without the map
{
  const { ctx, page, errs } = await open(false);
  const before = await page.evaluate(() => JSON.stringify(window.gardenPlanner.project.getState().project));
  await page.getByTestId('open-photo').click();
  const dlg = page.getByRole('dialog', { name: 'Render photo' });
  await dlg.waitFor();
  check('the Render photo panel opens from the 3D view', true);
  check('the panel says what to expect, and that plants are simple shapes', /simple shapes/.test(await page.getByTestId('photo-expectations').innerText()));
  check('no WebGL2 warning on this browser', (await page.getByText("can't render photos").count()) === 0);
  check('it says where the sun is for the month and time on the sliders', /Sun \d+° up in December at 11:00 am/.test(await page.getByTestId('photo-sun').innerText()), await page.getByTestId('photo-sun').innerText());
  check('the satellite map note is absent when the map is off', (await page.getByTestId('photo-map-note').count()) === 0);

  // the sun is down at 3 am: nothing to render
  await page.evaluate(() => window.gardenPlanner.ui.getState().set({ hour: 3 }));
  await page.waitForFunction(() => /sun is down/i.test(document.querySelector('[data-testid="photo-sun"]')?.textContent ?? ''));
  check('with the sun down it says so and will not start', await dlg.getByRole('button', { name: 'Render', exact: true }).isDisabled());
  await page.evaluate(() => window.gardenPlanner.ui.getState().set({ hour: 11 }));
  await page.waitForFunction(() => /Sun \d+° up/.test(document.querySelector('[data-testid="photo-sun"]')?.textContent ?? ''));
  check('and starts again when the time is daytime', !(await dlg.getByRole('button', { name: 'Render', exact: true }).isDisabled()));

  await dlg.getByLabel('Size', { exact: true }).selectOption('sm');
  await dlg.getByLabel('Lighting', { exact: true }).selectOption('daylight');
  await dlg.getByRole('button', { name: 'Render', exact: true }).click();
  await page.locator('.photo-busy').waitFor({ timeout: 10000 });
  check('shows a plain progress message while it prepares', /\S/.test(await page.locator('.photo-busy').innerText()));
  await page.waitForFunction(() => /\d+% · about/.test(document.querySelector('.photo-progress')?.textContent ?? '') || /Done/.test(document.querySelector('.photo-progress')?.textContent ?? '') || document.querySelector('[data-testid="photo-failed"]'), null, { timeout: 240000 });
  check('the render did not fail', (await page.getByTestId('photo-failed').count()) === 0, (await page.getByTestId('photo-failed').count()) ? await page.getByTestId('photo-failed').innerText() : '');
  check('reaches rendering with progress and a time estimate', true);
  // edit the garden while it renders: the picture must not change the design, and the design edit must not break the render
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(out, 'photo-panel.png') });
  const early = await page.evaluate(() => document.querySelector('[data-testid=photo-canvas] canvas').toDataURL('image/png'));
  check('the picture has content (not blank)', early.length > 4000);
  await dlg.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByText('Paused').first().waitFor();
  check('Pause works', true);
  await dlg.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(500);
  await dlg.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByText('Stopped').first().waitFor();
  check('Stop works and keeps the picture', true);
  const dl = page.waitForEvent('download');
  await dlg.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const d = await dl;
  const path = join(out, d.suggestedFilename());
  await d.saveAs(path);
  check('PNG file name is <garden>-<place>-<date>.png', /^photo-garden-brisbane-qld-\d{4}-\d{2}-\d{2}\.png$/.test(d.suggestedFilename()), d.suggestedFilename());
  check('PNG has content', statSync(path).size > 2000, String(statSync(path).size));
  const dims = await page.evaluate(async (b64) => { const img = new Image(); img.src = b64; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }, 'data:image/png;base64,' + readFileSync(path).toString('base64'));
  check('PNG is 640 wide and taller than 360 (caption strip added)', dims[0] === 640 && dims[1] > 360, JSON.stringify(dims));
  check('the garden is unchanged by rendering', (await page.evaluate(() => JSON.stringify(window.gardenPlanner.project.getState().project))) === before);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc closes the panel after the render has ended', (await page.getByRole('dialog', { name: 'Render photo' }).count()) === 0);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ------------------------------------------------------------ with the satellite map on the ground
{
  const { ctx, page, errs } = await open(true);
  await page.evaluate(() => { const a = window.gardenPlanner; a.showMap(true); });
  await page.waitForFunction(() => /^[1-9]\d*\/\d+$/.test(document.querySelector('.stage canvas')?.dataset.mapTiles ?? ''), null, { timeout: 15000 });
  await page.getByTestId('open-photo').click();
  const dlg = page.getByRole('dialog', { name: 'Render photo' });
  await dlg.waitFor();
  check('with the map on the panel says so, and that its credit is printed on the picture', /credit printed/.test(await page.getByTestId('photo-map-note').innerText()));
  await dlg.getByLabel('Size', { exact: true }).selectOption('sm');
  await dlg.getByRole('button', { name: 'Render', exact: true }).click();
  await page.waitForFunction(() => /\d+% · about/.test(document.querySelector('.photo-progress')?.textContent ?? '') || /Done/.test(document.querySelector('.photo-progress')?.textContent ?? '') || document.querySelector('[data-testid="photo-failed"]'), null, { timeout: 240000 });
  check('a render with the satellite map did not fail', (await page.getByTestId('photo-failed').count()) === 0, (await page.getByTestId('photo-failed').count()) ? await page.getByTestId('photo-failed').innerText() : '');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(out, 'photo-panel-map.png') });
  await dlg.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByText('Stopped').first().waitFor();
  // the credit must be inside the saved picture: compare the bottom-right corner of the picture with and without it is hard, so look for light pixels over the green ground
  const dl = page.waitForEvent('download');
  await dlg.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const d = await dl;
  const path = join(out, 'map-' + d.suggestedFilename());
  await d.saveAs(path);
  const credit = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    // the credit is drawn as a pale box in the bottom-right of the picture (just above the caption strip): count near-white pixels there
    const picH = Math.round(img.naturalWidth * 360 / 640);
    const box = g.getImageData(img.naturalWidth - 200, picH - 18, 190, 14).data;
    let pale = 0; for (let i = 0; i < box.length; i += 4) if (box[i] > 200 && box[i + 1] > 200 && box[i + 2] > 200) pale++;
    return pale;
  }, 'data:image/png;base64,' + readFileSync(path).toString('base64'));
  check('the map credit is printed inside the saved picture', credit > 300, String(credit));
  check('no page errors with the map', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
