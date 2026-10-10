// Public planner "Photo" tab, end to end in Chrome: the real planner, the REAL photo service (server/routes/cellarLitePhotoRouter.js) and settings routes,
// in-memory storage, and a stand-in for the AI service that returns a real JPEG. Nothing external is touched and nothing is spent.
// Needs the built lite bundle (npm run build:lite) and Chrome, and axe-core (cellar-planner devDependency).
// Run: node scripts/e2e-lite-photo.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const ROOT = join(import.meta.dirname, '..', '..');
const require = createRequire(join(ROOT, 'cellar-planner', 'package.json'));
const { chromium } = require('playwright-core');
const express = require(ROOT + '/node_modules/express');
const { createCellarLiteConfigRouters } = require(ROOT + '/server/routes/cellarLiteConfigRouter.js');
const { createCellarLitePhotoRouter } = require(ROOT + '/server/routes/cellarLitePhotoRouter.js');
const axePath = join(ROOT, 'cellar-planner', 'node_modules', 'axe-core', 'axe.min.js');

// ---- in-memory storage for the settings and the photos
const settings = new Map();
const photos = new Map();
const pool = { async query(sql, p = []) {
  if (/workspace_settings/.test(sql)) {
    if (/^\s*SELECT/i.test(sql)) return { rows: settings.has(p[0]) ? [{ value: settings.get(p[0]), updatedAt: new Date() }] : [] };
    if (/^\s*INSERT/i.test(sql)) { settings.set(p[0], p[1]); return { rows: [] }; }
    if (/^\s*DELETE/i.test(sql)) { settings.delete(p[0]); return { rows: [] }; }
  }
  if (/SELECT mime, data FROM cellar_lite_photos/.test(sql)) return { rows: photos.has(p[0]) ? [photos.get(p[0])] : [] };
  if (/SELECT 1 FROM cellar_lite_photos/.test(sql)) return { rows: photos.has(p[0]) ? [{ x: 1 }] : [] };
  if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: photos.size }] };
  if (/^\s*INSERT INTO cellar_lite_photos/.test(sql)) { photos.set(p[0], { mime: p[1], data: p[2] }); return { rows: [] }; }
  if (/^\s*DELETE FROM cellar_lite_photos/.test(sql)) return { rows: [] };
  throw new Error('unexpected sql ' + sql);
} };

// a real JPEG the browser can decode (a 320x200 gradient, over the service's minimum size)
const jpegB64 = process.env.TEST_JPEG_B64 || '';
let falJpeg;
{
  const { execFileSync } = await import('node:child_process');
  const py = "import io,sys,base64\nfrom PIL import Image\nim=Image.new('RGB',(320,200))\npx=im.load()\nfor x in range(320):\n  for y in range(200): px[x,y]=((x*255)//320,(y*255)//200,((x+y)*255)//520)\nb=io.BytesIO(); im.save(b,'JPEG',quality=90); sys.stdout.write(base64.b64encode(b.getvalue()).decode())";
  falJpeg = Buffer.from(jpegB64 || execFileSync('python', ['-c', py]).toString(), 'base64');
}
const fal = { calls: [], delayMs: 0, fail: false };
const fetchFn = async (url, init = {}) => {
  if (String(url).startsWith('https://fal.run/')) {
    fal.calls.push(JSON.parse(init.body));
    if (fal.delayMs) await new Promise((r) => setTimeout(r, fal.delayMs));
    if (fal.fail) return { ok: false, status: 500, json: async () => ({ detail: 'boom' }) };
    return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://v3.fal.media/files/x/out.jpg' }] }) };
  }
  return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => falJpeg.buffer.slice(falJpeg.byteOffset, falJpeg.byteOffset + falJpeg.length) };
};
const config = createCellarLiteConfigRouters({ pool });
const photoRouter = createCellarLitePhotoRouter({ pool, loadConfig: async () => (await config.load()).config, fetchFn, falKey: () => 'test', now: () => Date.now(), report: async () => {} });
const api = express(); api.use(express.json({ limit: '5mb' }));
api.use('/api/cellar-lite/config', config.publicRouter); api.use('/api/admin/cellar-lite/config', config.adminRouter); api.use('/api/cellar-lite/photo', photoRouter);
const apiServer = await new Promise((r) => { const s = api.listen(8803, () => r(s)); });
const adminPut = (c) => fetch('http://localhost:8803/api/admin/cellar-lite/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: c }) });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const lite = await new Promise((r) => { const s = http.createServer((req, res) => {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = join(ROOT, 'cellar-planner/dist-lite', p);
  if (!existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
}).listen(8802, () => r(s)); });

let failed = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + extra}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const photoRequests = [];
async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('cellar-lite:unit:v1', 'mm'); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // the planner talks to Vault on the internet: send that to the local copy of the real routes
  await page.route('https://curam-vault.up.railway.app/**', async (route) => {
    const req = route.request();
    const url = req.url().replace('https://curam-vault.up.railway.app', 'http://localhost:8803');
    if (req.method() === 'POST' && /\/photo$/.test(url)) photoRequests.push(JSON.parse(req.postData() || '{}'));
    const r = await fetch(url, { method: req.method(), headers: req.method() === 'POST' ? { 'content-type': 'application/json' } : {}, body: req.method() === 'POST' ? req.postData() : undefined });
    const body = Buffer.from(await r.arrayBuffer());
    await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*' }, body });
  });
  return { ctx, page, errors };
}
const base = { pricing: { show: false } };

// ================= A. switched off (the default): there is no Photo tab at all
await adminPut(base);
let { ctx, page, errors } = await openPage();
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
await page.waitForTimeout(700);
check('off by default: no Photo tab is shown', (await page.getByTestId('lite-tab-photo').count()) === 0);
await ctx.close();

// ================= B. switched on
await adminPut({ ...base, photo: { enabled: true, dailyLimit: 50, perVisitorPerHour: 2 } });
({ ctx, page, errors } = await openPage());
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-tab-photo').waitFor({ timeout: 8000 });
const tabs = await page.locator('.lite-visual-head .tabs button').allInnerTexts();
check('on: a Photo tab sits beside 3D, Plan and Racks', JSON.stringify(tabs) === '["3D","Plan","Racks","Photo"]', JSON.stringify(tabs));
check('the Photo tab has a tooltip', /photo-style picture/i.test(await page.getByTestId('lite-tab-photo').getAttribute('title')));
await page.getByTestId('lite-tab-photo').click();
await page.getByTestId('lite-photo-idle').waitFor();
check('it never makes a photo by itself: nothing was requested, and a button asks first', photoRequests.length === 0 && fal.calls.length === 0 && (await page.getByTestId('lite-photo-make').count()) === 1);
check('it says plainly what it is: AI, about 20 seconds, not exact', /20 seconds/.test(await page.getByTestId('lite-photo-idle').innerText()) && /AI/.test(await page.getByTestId('lite-photo-idle').innerText()) && /not be exact/.test(await page.getByTestId('lite-photo-idle').innerText()));
if (process.env.SHOT_DIR) await page.locator('.lite-visual').screenshot({ path: join(process.env.SHOT_DIR, 'photo-idle.png') });
await page.addScriptTag({ path: axePath });
const scan = (p) => p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => `${v.id} x${v.nodes.length}: ${v.nodes[0].html.slice(0, 120)}`));
const a1 = await scan(page);
check('accessibility scan of the Photo tab (idle): no violations', a1.length === 0, a1.join(' | '));

fal.delayMs = 900;
await page.getByTestId('lite-photo-make').click();
await page.getByTestId('lite-photo-status').waitFor({ timeout: 3000 });
check('while it works: a clear "making your photo" message, announced to screen readers', /Making your photo/.test(await page.getByTestId('lite-photo-status').innerText()) && (await page.getByTestId('lite-photo-status').getAttribute('role')) === 'status');
await page.getByTestId('lite-photo-img').waitFor({ timeout: 15000 });
check('the photo appears', await page.getByTestId('lite-photo-img').evaluate((el) => el.complete && el.naturalWidth > 100), 'not decoded');
check('and is labelled an artist\'s impression made by AI', /Artist's impression made by AI/.test(await page.getByTestId('lite-photo-caption').innerText()) && /alt/.test('alt') && /photograph/.test(await page.getByTestId('lite-photo-img').getAttribute('alt')));
const req = photoRequests[0];
check('what was sent: the design code, the finish and door as plain words, and a JPEG of the 3D picture', !!req && /^CL1\./.test(req.design) && req.finish === 'oak' && req.door === 'single' && /^data:image\/jpeg;base64,/.test(req.image), JSON.stringify(Object.keys(req || {})));
const imgBytes = Buffer.from((req.image || '').split(',')[1] || '', 'base64');
check('the picture sent is a real JPEG of a sensible size (not the thumbnail)', imgBytes[0] === 0xff && imgBytes[1] === 0xd8 && imgBytes.length > 8000 && imgBytes.length < 400000, `${imgBytes.length} bytes`);
check('the AI service was asked once, with the fixed prompt for oak and a single door', fal.calls.length === 1 && /light oak timber racking/.test(fal.calls[0].prompt) && /a single clear glass door/.test(fal.calls[0].prompt));
if (process.env.SHOT_DIR) await page.locator('.lite-visual').screenshot({ path: join(process.env.SHOT_DIR, 'photo-done.png') });
const a2 = await scan(page);
check('accessibility scan of the Photo tab (with a photo): no violations', a2.length === 0, a2.join(' | '));

// remembered for the visit: switching tabs and back costs nothing
await page.getByTestId('lite-tab-plan').click();
await page.getByTestId('lite-tab-photo').click();
await page.waitForTimeout(500);
check('coming back to the tab shows the same photo with no new request', (await page.getByTestId('lite-photo-img').count()) === 1 && photoRequests.length === 1 && fal.calls.length === 1);

// a new finish is a new design: back to the button, and a new photo is made
await page.getByTestId('lite-step-2').click();
await page.getByTestId('lite-finish-WALNUT').click();
await page.waitForTimeout(300);
check('changing the finish: the old photo is not shown for the new design (it asks again)', (await page.getByTestId('lite-photo-make').count()) === 1 && (await page.getByTestId('lite-photo-img').count()) === 0);
fal.delayMs = 0;
await page.getByTestId('lite-photo-make').click();
await page.getByTestId('lite-photo-img').waitFor({ timeout: 15000 });
check('a second photo for walnut was made, with the walnut prompt', photoRequests.length === 2 && fal.calls.length === 2 && /dark walnut timber racking/.test(fal.calls[1].prompt));
// going back to oak shows the first photo again for free
await page.getByTestId('lite-finish-OAK').click();
await page.waitForTimeout(400);
check('going back to oak shows the first photo again, free', (await page.getByTestId('lite-photo-img').count()) === 1 && fal.calls.length === 2);

// the per-visitor limit (2 an hour): a third NEW photo is refused in plain words, with a way to retry
await page.getByTestId('lite-finish-BLACK').click();
await page.waitForTimeout(300);
await page.getByTestId('lite-photo-make').click();
await page.getByTestId('lite-photo-error').waitFor({ timeout: 8000 });
check('the per-visitor limit: a polite message, not a crash', /a little while/i.test(await page.getByTestId('lite-photo-error').innerText()) && (await page.getByTestId('lite-photo-retry').count()) === 1, await page.getByTestId('lite-photo-error').innerText());
check('and no money was spent on it', fal.calls.length === 2);
if (process.env.SHOT_DIR) await page.locator('.lite-visual').screenshot({ path: join(process.env.SHOT_DIR, 'photo-error.png') });
const a3 = await scan(page);
check('accessibility scan of the Photo tab (error): no violations', a3.length === 0, a3.join(' | '));
check('no script errors', errors.length === 0, errors.join(' | '));
await ctx.close();

// ================= C. the AI service failing, and being switched off again
await adminPut({ ...base, photo: { enabled: true, dailyLimit: 50, perVisitorPerHour: 10 } });
fal.fail = true;
({ ctx, page, errors } = await openPage());
await page.goto('http://localhost:8802/index.html?d=CL1.WzI4MDAsMTYwMCwyMzAwLDIsMCwwLDUwMCwwXQ');
await page.getByTestId('lite-tab-photo').waitFor({ timeout: 8000 });
await page.getByTestId('lite-tab-photo').click();
await page.getByTestId('lite-photo-make').click();
await page.getByTestId('lite-photo-error').waitFor({ timeout: 8000 });
check('the AI service failing: a plain "try again" message', /try again/i.test(await page.getByTestId('lite-photo-error').innerText()));
fal.fail = false;
await page.getByTestId('lite-photo-retry').click();
await page.getByTestId('lite-photo-img').waitFor({ timeout: 15000 });
check('Try again works once the service is back', (await page.getByTestId('lite-photo-img').count()) === 1);
await ctx.close();

await adminPut({ ...base, photo: { enabled: true, dailyLimit: 0, perVisitorPerHour: 10 } });
({ ctx, page, errors } = await openPage());
await page.goto('http://localhost:8802/index.html?d=CL1.WzI5MDAsMTcwMCwyMzAwLDIsMCwwLDUwMCwwXQ');
await page.getByTestId('lite-tab-photo').waitFor({ timeout: 8000 });
await page.getByTestId('lite-tab-photo').click();
await page.getByTestId('lite-photo-make').click();
await page.getByTestId('lite-photo-error').waitFor({ timeout: 8000 });
check('the daily cap reached: told to try tomorrow', /tomorrow/i.test(await page.getByTestId('lite-photo-error').innerText()));
await ctx.close();

// an older Vault whose settings never mention photos: no Photo tab, and nothing breaks
({ ctx, page, errors } = await openPage());
await page.route('https://curam-vault.up.railway.app/api/cellar-lite/config', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ rack: { unitWidthMm: 600 } }) }));
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
await page.waitForTimeout(700);
check('settings that never mention photos (an older Vault): no Photo tab, no errors', (await page.getByTestId('lite-tab-photo').count()) === 0 && errors.length === 0, errors.join(' | '));
await ctx.close();

// switched off again by the owner: the tab is gone for the next visitor
await adminPut(base);
({ ctx, page, errors } = await openPage());
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
await page.waitForTimeout(700);
check('switched off again: the tab is gone', (await page.getByTestId('lite-tab-photo').count()) === 0);
await ctx.close();

await browser.close(); apiServer.close(); lite.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
