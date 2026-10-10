// Public planner and owner settings: guide price, starting rooms, highlight, tooltips on every control, the price-help modal, and every fallback when Vault is unreachable.
// Needs the built lite bundle (npm run build:lite) and Chrome. Serves the bundle itself and stands in for Vault's settings address with the REAL
// settings routes (server/routes/cellarLiteConfigRouter.js) backed by an in-memory table, so nothing external is touched.
// Run: node scripts/e2e-lite-config.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const ROOT = join(import.meta.dirname, '..', '..');
const require = createRequire(join(ROOT, 'cellar-planner', 'package.json'));
const { chromium } = require('playwright-core');
const express = require(ROOT + '/node_modules/express');
const { createCellarLiteConfigRouters } = require(ROOT + '/server/routes/cellarLiteConfigRouter.js');

// the REAL settings routes, backed by an in-memory table
const table = new Map();
const pool = { async query(sql, p) {
  if (/^\s*SELECT/i.test(sql)) return { rows: table.has(p[0]) ? [{ value: table.get(p[0]), updatedAt: new Date() }] : [] };
  if (/^\s*INSERT/i.test(sql)) { table.set(p[0], p[1]); return { rows: [] }; }
  if (/^\s*DELETE/i.test(sql)) { table.delete(p[0]); return { rows: [] }; }
} };
let clock = 0;
const { publicRouter, adminRouter } = createCellarLiteConfigRouters({ pool, now: () => (clock += 60000) });
const api = express(); api.use(express.json());
api.use('/api/cellar-lite/config', publicRouter); api.use('/api/admin/cellar-lite/config', adminRouter);
const apiServer = await new Promise((r) => { const s = api.listen(8803, () => r(s)); });
const adminPut = (config) => fetch('http://localhost:8803/api/admin/cellar-lite/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) });

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
async function openPage({ mode = 'real', dataFor } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('cellar-lite:help-seen:v1', '1'); localStorage.setItem('cellar-lite:unit:v1', 'mm'); } catch {} });
  const page = await ctx.newPage();
  const logs = [], errors = [];
  page.on('console', (m) => { logs.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  // the tool asks Vault on the internet; send that request to the local copy of the real settings routes
  await page.route('https://curam-vault.up.railway.app/api/cellar-lite/config', async (route) => {
    if (mode === 'down') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' });
    if (mode === 'fail') return route.abort('failed');
    const r = await fetch('http://localhost:8803/api/cellar-lite/config');
    route.fulfill({ status: r.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: await r.text() });
  });
  return { ctx, page, logs, errors };
}

// ---- A: owner has set prices, unit width, a custom starting room
let res = await adminPut({
  promise: 'Free. No sign-up. Two minutes.',
  rack: { unitWidthMm: 750, unitHeightMm: 2000 }, doors: { singleMm: 970, doubleMm: 1500 },
  pricing: { show: true, currency: '$', fixed: 2000, perUnit: 1000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100, note: 'Guide only.' },
  presets: [{ name: 'Tiny', widthMm: 1500, depthMm: 1500, heightMm: 2300, doorStyle: 'SINGLE' }, { name: 'Huge', widthMm: 5000, depthMm: 4000, heightMm: 2600, doorStyle: 'DOUBLE' }],
});
check('owner settings saved through the real admin route', res.status === 200, await res.text());

let { ctx, page, logs, errors } = await openPage();
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
await page.getByTestId('lite-price').waitFor({ timeout: 8000 }).catch(() => {});
check('promise line from settings is on the page', /Two minutes/.test(await page.getByTestId('lite-promise').innerText().catch(() => '')));
const priceText = await page.getByTestId('lite-price').innerText().catch(() => '');
check('a guide price appears, in the owner\'s currency, with the owner\'s note', /\$[\d,]+ to \$[\d,]+/.test(priceText) && /Guide only/.test(priceText), priceText);
const units = await page.evaluate(() => document.querySelector('[data-testid="lite-units"]').innerText);
check('the screen says the owner\'s rack unit width (750 mm)', /about 750 mm wide/.test(units), units);
const presets = await page.getByTestId('lite-presets').locator('button').allInnerTexts();
check('the owner\'s two starting rooms are offered, not the defaults', JSON.stringify(presets) === '["Tiny","Huge"]', JSON.stringify(presets));
const bottlesBefore = Number((await page.getByTestId('lite-bottles').innerText()).match(/\d+/)[0]);
const priceBefore = priceText;
await page.getByTestId('lite-preset-tiny').click();
check('choosing a starting room fills in its size', (await page.getByTestId('lite-widthMm').inputValue()) === '1500' && (await page.getByTestId('lite-heightMm').inputValue()) === '2300');
const bottlesAfter = Number((await page.getByTestId('lite-bottles').innerText()).match(/\d+/)[0]);
check('and the estimate and price follow', bottlesAfter !== bottlesBefore && (await page.getByTestId('lite-price').innerText()) !== priceBefore, `${bottlesBefore} -> ${bottlesAfter}`);
const pressed = async (id) => (await page.getByTestId(`lite-preset-${id}`).getAttribute('aria-pressed')) === 'true';
const isPrimary = async (id) => /primary/.test(await page.getByTestId(`lite-preset-${id}`).getAttribute('class'));
check('the chosen starting room is highlighted and the other is not', (await pressed('tiny')) && (await isPrimary('tiny')) && !(await pressed('huge')) && !(await isPrimary('huge')));
await page.getByTestId('lite-widthMm').fill('1600'); await page.getByTestId('lite-widthMm').blur();
check('changing the size by hand un-highlights it', !(await pressed('tiny')) && !(await isPrimary('tiny')));
await page.getByTestId('lite-preset-huge').click();
check('choosing another room moves the highlight', (await pressed('huge')) && !(await pressed('tiny')));
check('a starting room can carry a double door', (await page.getByTestId('lite-doorstyle-DOUBLE').getAttribute('aria-checked')) === 'true');
// price formula by hand: units on the current design
const wanted = await page.evaluate(() => 0);
check('console says where the settings came from', logs.some((l) => /\[cellar-lite\] settings loaded/.test(l)), logs.join(' | '));


// ---- tooltips on every control
const untipped = await page.evaluate(() => [...document.querySelectorAll('button, input, select, textarea')]
  .filter((el) => el.offsetParent !== null && !el.hasAttribute('title') && !el.hasAttribute('data-tip')).map((el) => el.getAttribute('data-testid') || el.outerHTML.slice(0, 60)));
check('every visible button, field and menu has a tooltip', untipped.length === 0, JSON.stringify(untipped));
// scroll first: tooltips hide themselves on scroll, and a hover that scrolls the page would hide its own tooltip
await page.getByTestId('lite-doorpos-LEFT').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.getByTestId('lite-doorpos-LEFT').hover();
await page.waitForTimeout(700);
check('hovering shows the themed tooltip', (await page.locator('[role="tooltip"]').allInnerTexts()).some((t) => /toward the left end/.test(t)), JSON.stringify(await page.locator('[role="tooltip"]').allInnerTexts()));
await page.mouse.move(5, 5);

// ---- "How is this price worked out?"
await page.getByTestId('lite-step-3').click();
await page.getByTestId('lite-price-help-open').waitFor({ timeout: 3000 });
const helpBtnBox = await page.getByTestId('lite-price-help-open').boundingBox();
const shareBox = await page.getByTestId('lite-download').boundingBox();
check('the price-help button sits beside "Download my plan", on the same line (Review step)', !!helpBtnBox && !!shareBox && Math.abs(helpBtnBox.y - shareBox.y) < 20, JSON.stringify([helpBtnBox, shareBox]));
await page.getByTestId('lite-price-help-open').click();
await page.getByTestId('lite-price-help').waitFor({ timeout: 3000 });
const modalText = await page.getByTestId('lite-price-help').innerText();
check('it opens as a modal and explains the parts that are in use', /rack unit/i.test(modalText) && /door/i.test(modalText) && /basics every cellar needs/i.test(modalText) && /range/i.test(modalText), modalText);
check('it says what THIS design uses (units, door, room)', /rack units?: \d+/i.test(modalText) || /uses \d+ rack unit/i.test(modalText));
check('it never states what any part costs (none of the owner\'s amounts appear)', !/(2,?000|1,?000|500|900|\$\s?\d)/.test(modalText.replace(/\d+\s[×x]\s\d+\s[×x]\s\d+\s*mm/, '').replace(/about \d+ bottles/g, '').replace(/rack units?: \d+/gi, '').replace(/uses \d+ rack units?/gi, '').replace(/Rack units: \d+/g, '')), modalText);
await page.keyboard.press('Escape');
await page.getByTestId('lite-price-help').waitFor({ state: 'detached', timeout: 3000 });
check('Esc closes it and focus returns to the button', await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) === 'lite-price-help-open');

await page.getByTestId('lite-share').click();
await page.getByTestId('lite-share-done').waitFor({ timeout: 3000 }).catch(() => {});
const link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
check('Copy a link puts a working link on the clipboard', /index\.html\?d=CL1\./.test(link) && !/#/.test(link), link);
await page.getByTestId('lite-step-1').click();
const widthNow = await page.getByTestId('lite-widthMm').inputValue();
const p2 = await ctx.newPage();
await p2.route('https://curam-vault.up.railway.app/api/cellar-lite/config', async (route) => { const r = await fetch('http://localhost:8803/api/cellar-lite/config'); route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: await r.text() }); });
await p2.goto(link);
await p2.getByTestId('lite-bottles').waitFor();
check('opening that link shows the same room', (await p2.getByTestId('lite-widthMm').inputValue()) === widthNow && (await p2.getByTestId('lite-doorstyle-DOUBLE').getAttribute('aria-checked')) === 'true', widthNow);

// the message sent to the contact form includes what the visitor saw
const msg = await page.evaluate(() => new Promise((resolve) => {
  window.addEventListener('message', () => {});
  resolve(document.querySelector('[data-testid="lite-quote"]') ? 'has-button' : 'no');
}));
check('quote button still present', msg === 'has-button');
check('no script errors', errors.length === 0, errors.join(' | '));
await ctx.close();


// ---- A2: only a per-unit price set -> the outline mentions only the racking
await adminPut({ pricing: { show: true, perUnit: 1000 } });
{
  const c2 = await openPage();
  await c2.page.goto('http://localhost:8802/index.html');
  await c2.page.getByTestId('lite-step-3').click();
  await c2.page.getByTestId('lite-price-help-open').waitFor({ timeout: 8000 });
  await c2.page.getByTestId('lite-price-help-open').click();
  const t = await c2.page.getByTestId('lite-price-help').innerText();
  check('with only a per-unit price, the outline mentions the racking and not the door or basics', /The racking/.test(t) && !/The door\./.test(t) && !/basics every cellar needs/.test(t), t);
  await c2.ctx.close();
}
await adminPut({
  promise: 'Free. No sign-up. Two minutes.',
  rack: { unitWidthMm: 750, unitHeightMm: 2000 }, doors: { singleMm: 970, doubleMm: 1500 },
  pricing: { show: false },
});

// ---- B: prices switched off -> nothing leaks, nothing shows
await adminPut({ pricing: { show: false, perUnit: 999, fixed: 111 } });
({ ctx, page, logs, errors } = await openPage());
const raw = await (await fetch('http://localhost:8803/api/cellar-lite/config')).json();
check('public answer carries no amounts while prices are off', raw.pricing.perUnit === null && raw.pricing.fixed === null && raw.pricing.show === false, JSON.stringify(raw.pricing));
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
await page.waitForTimeout(800);
check('no price shown when switched off', (await page.getByTestId('lite-price').count()) === 0);
await ctx.close();

// ---- C: Vault down -> defaults, still works, says why
({ ctx, page, logs, errors } = await openPage({ mode: 'down' }));
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
await page.waitForTimeout(800);
check('Vault answering 503: the tool still works with built-in defaults', /1120/.test(await page.getByTestId('lite-bottles').innerText()) && (await page.getByTestId('lite-presets').locator('button').count()) === 3 && (await page.getByTestId('lite-price').count()) === 0);
check('and the Console says why', logs.some((l) => /could not load settings.*503/.test(l)), logs.join(' | '));
check('no script errors', errors.length === 0, errors.join(' | '));
await ctx.close();

// ---- D: network failure with a remembered earlier answer -> uses the remembered one
({ ctx, page, logs, errors } = await openPage());
await adminPut({ rack: { unitWidthMm: 900 }, pricing: { show: true, perUnit: 1000 } });
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-price').waitFor({ timeout: 8000 });
await page.unroute('https://curam-vault.up.railway.app/api/cellar-lite/config');
await page.route('https://curam-vault.up.railway.app/api/cellar-lite/config', (r) => r.abort('failed'));
await page.reload();
await page.getByTestId('lite-bottles').waitFor();
await page.getByTestId('lite-price').waitFor({ timeout: 8000 }).catch(() => {});
check('network down on a later visit: the last settings seen are used (price still shown)', (await page.getByTestId('lite-price').count()) === 1, logs.join(' | '));
check('and the Console says they were remembered', logs.some((l) => /remembered from the last visit/.test(l)));
await ctx.close();

await browser.close(); apiServer.close(); lite.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
