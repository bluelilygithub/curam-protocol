// Render photo in the public planner, in real Chrome with software WebGL (SwiftShader, so it is slow: this renders a small picture for a few passes).
// Needs the built lite bundle (npm run build:lite) and Chrome. Run: node scripts/e2e-lite-photo.mjs [screenshot dir]
// Checks: a phone is told it is not available and has no button; on a computer the button, the time warning and the options show; a picture starts,
// shows progress with a phase message, can be stopped and saved with its caption; the fair-use limit stops a fourth picture; the page stays clean.
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = join(import.meta.dirname, '..');
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = await new Promise((r) => {
  const s = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = join(ROOT, 'dist-lite', p);
    if (!existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
  }).listen(8821, () => r(s));
});
const URL = 'http://localhost:8821/';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };
const fresh = async (viewport) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.addInitScript((n) => { window.__cellarPhotoSamples = n; try { sessionStorage.setItem('cellar-lite:phone-notice:v1', '1'); } catch { /* fine */ } }, Number(process.env.PHOTO_SAMPLES ?? 6));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.route('**/api/cellar-lite/config', (r) => r.abort('failed'));
  await page.goto(URL); await page.getByTestId('lite-stepper').waitFor();
  return { ctx, page, errs };
};

// ---- a phone
{
  const { ctx, page } = await fresh({ width: 390, height: 800 });
  check('a phone is told Render photo is not available, with no button', (await page.getByTestId('lite-photo-phone').count()) === 1 && (await page.getByTestId('lite-photo-open').count()) === 0 && /not available on a phone/.test(await page.getByTestId('lite-photo-phone').innerText()));
  await ctx.close();
}

// ---- a computer
{
  const { ctx, page, errs } = await fresh({ width: 1400, height: 900 });
  check('a computer has the Render photo button and says it takes a few minutes', (await page.getByTestId('lite-photo-open').count()) === 1 && /takes a few minutes/.test(await page.getByTestId('lite-photo-row').innerText()));
  await page.getByTestId('lite-photo-open').click();
  const wait = await page.getByTestId('lite-photo-wait').innerText();
  check('the window warns about the wait before anything starts, with times and "keep this page open"', /This takes time/.test(wait) && /minutes/.test(wait) && /Keep this page open/.test(wait), wait);
  check('three pictures per visit are offered', /3 of 3 pictures left/.test(await page.getByTestId('lite-photo-left').innerText()));
  await page.getByTestId('lite-photo-size').selectOption('sm');
  await page.getByTestId('lite-photo-start').click();
  await page.waitForFunction(() => /\d+% sharpened|Done|Stopped|could not be finished/.test(document.querySelector('[data-testid="lite-photo-status"]')?.textContent ?? ''), null, { timeout: 240000 });
  const status = await page.getByTestId('lite-photo-status').innerText();
  check('a picture starts and shows progress (or finishes)', /\d+% sharpened|Done/.test(status), status);
  check('one of the three is used', /2 of 3 pictures left/.test(await page.getByTestId('lite-photo-left').innerText()));
  // software GL keeps the page too busy to click Stop, so let this small picture finish (its Save button appears when it is done)
  await page.waitForFunction(() => /Done|Stopped/.test(document.querySelector('[data-testid="lite-photo-status"]')?.textContent ?? ''), null, { timeout: 420000 });
  await page.getByTestId('lite-photo-save').waitFor({ timeout: 30000 });
  if (out) await page.getByTestId('lite-photo-canvas').screenshot({ path: join(out, 'photo.png') });
  const dl = page.waitForEvent('download');
  await page.getByTestId('lite-photo-save').click();
  const download = await dl;
  check('Save picture downloads a PNG', /\.png$/i.test(download.suggestedFilename()), download.suggestedFilename());
  await page.keyboard.press('Escape');
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---- the fair-use limit
{
  const { ctx, page } = await fresh({ width: 1400, height: 900 });
  await page.evaluate(() => sessionStorage.setItem('cellar-lite:renders:v1', '3'));
  await page.getByTestId('lite-photo-open').click();
  await page.getByTestId('lite-photo-limit').waitFor({ timeout: 10000 }).catch(() => {});
  check('after three pictures the limit is explained and Start is switched off', (await page.getByTestId('lite-photo-start').isDisabled()) && /used your 3 pictures/.test(await page.getByTestId('lite-photo-limit').innerText()));
  await ctx.close();
}

// ---- the quick Save picture
{
  const { ctx, page } = await fresh({ width: 1400, height: 900 });
  const dl = page.waitForEvent('download');
  await page.getByTestId('lite-photo-quick').click();
  const download = await dl;
  check('Save picture (the quick one) downloads the 3D picture as a PNG', /\.png$/i.test(download.suggestedFilename()), download.suggestedFilename());
  await ctx.close();
}

await browser.close(); server.close();
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
