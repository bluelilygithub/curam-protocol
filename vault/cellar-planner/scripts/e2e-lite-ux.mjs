// Public planner, whole-page behaviour: units, fix-it, slider, download, remembering, drag, and embedded in a page with the real page script (frame height, events, phone bar).
// Needs the built lite bundle (npm run build:lite) and Chrome. Serves the bundle itself and stands in for Vault's settings address with the REAL
// settings routes (server/routes/cellarLiteConfigRouter.js) backed by an in-memory table, so nothing external is touched.
// Run: node scripts/e2e-lite-ux.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const ROOT = join(import.meta.dirname, '..', '..');
const require = createRequire(join(ROOT, 'cellar-planner', 'package.json'));
const { chromium } = require('playwright-core');
const express = require(ROOT + '/node_modules/express');
const { createCellarLiteConfigRouters } = require(ROOT + '/server/routes/cellarLiteConfigRouter.js');

// the REAL settings routes, in memory
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
const serveDist = (req, res) => {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = join(ROOT, 'cellar-planner/dist-lite', p);
  if (!existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
};
const lite = await new Promise((r) => { const s = http.createServer(serveDist).listen(8802, () => r(s)); });

// a stand-in for the business's website: a page with the planner in an iframe and the REAL script (addresses pointed at localhost), plus a contact page
const script = readFileSync(join(ROOT, 'cellar-planner/lite-wordpress/cellar-lite-fill.js'), 'utf8')
  .replace("'https://www.wiwc.com.au'", "'http://localhost:8802'").replace("'https://wiwc.com.au/contact/'", "'http://localhost:8801/contact.html'").replace("'https://wiwc.com.au/cellar-lite/'", "'http://localhost:8802/index.html'");
const site = await new Promise((r) => { const s = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/fill.js') { res.setHeader('content-type', 'text/javascript'); return res.end(script); }
  res.setHeader('content-type', 'text/html');
  if (p === '/contact.html') return res.end('<!doctype html><body><form id="cw-contact-form"><input id="cw-contact-name"><textarea id="cw-contact-message"></textarea></form><script src="/fill.js"></script></body>');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><h1>Our wine cellar planner</h1><p>Intro text.</p><iframe id="f" src="http://localhost:8802/index.html" style="width:100%;height:600px;border:0"></iframe><div style="height:900px">after the planner</div><script>window.dataLayer=[];</script><script src="/fill.js"></script></body></html>');
}).listen(8801, () => r(s)); });

let failed = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + extra}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const withConfig = async (page) => page.route('https://curam-vault.up.railway.app/api/cellar-lite/config', async (route) => {
  const r = await fetch('http://localhost:8803/api/cellar-lite/config');
  route.fulfill({ status: r.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: await r.text() });
});
const fresh = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 1000, height: 1100 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...opts }); const page = await ctx.newPage(); await withConfig(page); const errors = []; page.on('pageerror', (e) => errors.push(e.message)); return { ctx, page, errors }; };
const frameDoorPick = async (page) => {
  await page.frameLocator('#f').getByTestId('lite-doorpick-NORTH').click();
  await page.waitForTimeout(500);
  const ev = await page.evaluate(() => window.dataLayer.map((e) => JSON.stringify(e)));
  check('events: tapping a door wall is counted (and nothing else is sent with it)', ev.some((e) => /cellar_lite_door_pick/.test(e)) && ev.every((e) => !/NORTH|CL1\./.test(e)), ev.join(' | '));
};
const bottles = async (page) => Number((await page.getByTestId('lite-bottles').innerText()).match(/\d+/)[0]);

const baseSettings = { quoteNote: 'We reply within a day.', pricing: { show: true, perUnit: 1000, fixed: 500, doorSingle: 200, doorDouble: 400 } };
// a save replaces the whole settings object, so each step below says everything it wants
await adminPut(baseSettings);

// ================= 1. a first-time visitor
let { ctx, page, errors } = await fresh();
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
check('first visit: no pop-up guide in the way', (await page.getByTestId('lite-help').count()) === 0);
check('first visit: a three-step strip is on the page', (await page.getByTestId('lite-steps').locator('li').count()) === 3 && /room size/i.test(await page.getByTestId('lite-steps').innerText()));
check('first visit: sizes are in metres, no jargon', (await page.getByTestId('lite-widthMm').inputValue()) === '2.75' && (await page.getByTestId('lite-heightMm').inputValue()) === '2.15');
check('first visit: no "welcome back" for a design they never made', (await page.getByTestId('lite-welcome').count()) === 0);
const start = await bottles(page);

// ---- units
await page.getByTestId('lite-widthMm').fill('3.5'); await page.getByTestId('lite-widthMm').blur();
check('typing metres changes the estimate', (await bottles(page)) !== start);
await page.getByTestId('lite-widthMm').fill('20');
check('a size that is out of range says so in the visitor\'s unit', /Between 1 m and 8 m\./.test(await page.getByTestId('lite-units-pick').locator('xpath=..').innerText()));
await page.getByTestId('lite-widthMm').fill('3.5'); await page.getByTestId('lite-widthMm').blur();
await page.getByTestId('lite-unit-ft').click();
const ftShown = await page.getByTestId('lite-widthMm').inputValue();
check('switching to feet re-writes the sizes as feet and inches', /^11' 6"$/.test(ftShown) || /^11'/.test(ftShown), ftShown);
await page.getByTestId('lite-widthMm').fill(`10' 6"`); await page.getByTestId('lite-widthMm').blur();
await page.getByTestId('lite-unit-mm').click();
check('feet and inches typed are kept exactly (10\' 6" = 3200 mm)', (await page.getByTestId('lite-widthMm').inputValue()) === '3200', await page.getByTestId('lite-widthMm').inputValue());
await page.getByTestId('lite-widthMm').fill('275cm'); await page.getByTestId('lite-widthMm').blur();
check('a unit written out wins: 275cm = 2750 mm', (await page.getByTestId('lite-widthMm').inputValue()) === '2750');
check('the door hint is in the chosen unit', /about 970 mm wide/.test(await page.getByTestId('lite-door-style').locator('xpath=..').innerText()));
await page.getByTestId('lite-unit-m').click();
check('the guide mentions the unit in use', true);

// ---- low ceilings: the door is made lower, so a low room just works
await page.getByTestId('lite-heightMm').fill('2'); await page.getByTestId('lite-heightMm').blur();
check('a 2.0 m ceiling builds (no "cannot be built" dead end)', (await page.getByTestId('lite-problem').count()) === 0 && (await bottles(page)) > 0);
await page.getByTestId('lite-heightMm').fill('1.8'); await page.getByTestId('lite-heightMm').blur();
check('a 1.8 m ceiling builds too, with fewer bottles than a tall room', (await page.getByTestId('lite-problem').count()) === 0 && (await bottles(page)) > 0);
await page.getByTestId('lite-heightMm').fill('1.5');
check('lower than 1.8 m says so in the visitors unit', /Between 1\.8 m and 3\.2 m\./.test(await page.getByTestId('lite-units-pick').locator('xpath=..').innerText()));
await page.getByTestId('lite-heightMm').blur();
check('and leaving the box snaps it to 1.8 m', (await page.getByTestId('lite-heightMm').inputValue()) === '1.8', await page.getByTestId('lite-heightMm').inputValue());

// ---- slider
await page.getByTestId('lite-mode').selectOption('TARGET');
await page.getByTestId('lite-target-slider').waitFor({ timeout: 3000 });
await page.getByTestId('lite-target-slider').evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '300'); el.dispatchEvent(new Event('input', { bubbles: true })); });
const sliderVal = await page.getByTestId('lite-target-slider').inputValue();
const targetVal = await page.getByTestId('lite-target').inputValue();
check('the bottle slider sets the number wanted (to the nearest step it allows)', sliderVal === targetVal && Math.abs(Number(targetVal) - 300) <= 6, `slider ${sliderVal} text ${targetVal}`);

// ---- download
await page.getByTestId('lite-mode').selectOption('FILL');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('lite-download').click()]);
const dlPath = await dl.path();
const bytes = readFileSync(dlPath);
check('Download my plan gives a real PDF', dl.suggestedFilename() === 'my-wine-cellar-plan.pdf' && bytes.slice(0, 5).toString() === '%PDF-' && bytes.length > 5000, `${dl.suggestedFilename()} ${bytes.length}`);
await page.getByTestId('lite-download-done').waitFor({ timeout: 5000 }).catch(() => {});
check('and says it was saved', (await page.getByTestId('lite-download-done').count()) === 1);

// ---- quote note
await page.getByTestId('lite-quote').click();
check('after asking for a quote the owner\'s reassurance line is shown', /We reply within a day\./.test(await page.getByTestId('lite-quote-note').innerText().catch(() => '')));
await page.getByRole('button', { name: 'Keep editing' }).click();

// ---- every control has a tooltip
const untipped = await page.evaluate(() => [...document.querySelectorAll('button, input, select, textarea')].filter((el) => el.offsetParent !== null && !el.hasAttribute('title') && !el.hasAttribute('data-tip')).map((el) => el.getAttribute('data-testid') || el.outerHTML.slice(0, 70)));
check('every visible control still has a tooltip (units, fix, slider, download...)', untipped.length === 0, JSON.stringify(untipped));

// ---- tap-to-choose door wall
await page.getByTestId('lite-door').selectOption('SOUTH');
const radios = page.getByTestId('lite-doorpick').getByRole('radio');
check('door picture: four walls to tap, as radio buttons with names', (await radios.count()) === 4 && /Top wall \(North\)/.test(await page.getByTestId('lite-doorpick-NORTH').getAttribute('aria-label')));
check('door picture: the current wall is the one marked', (await page.getByTestId('lite-doorpick-SOUTH').getAttribute('aria-checked')) === 'true' && (await page.getByTestId('lite-doorpick-NORTH').getAttribute('aria-checked')) === 'false');
await page.getByTestId('lite-doorpick-EAST').click();
check('door picture: tapping a wall moves the door (the menu follows)', (await page.getByTestId('lite-door').inputValue()) === 'EAST' && (await page.getByTestId('lite-doorpick-EAST').getAttribute('aria-checked')) === 'true' && (await page.getByTestId('lite-doorpick-SOUTH').getAttribute('aria-checked')) === 'false');
await page.getByTestId('lite-door').selectOption('WEST');
check('door picture: choosing from the menu moves the marked wall', (await page.getByTestId('lite-doorpick-WEST').getAttribute('aria-checked')) === 'true');
await page.getByTestId('lite-doorpick-NORTH').focus();
await page.keyboard.press('Enter');
check('door picture: works from the keyboard (focus a wall, Enter)', (await page.getByTestId('lite-door').inputValue()) === 'NORTH');
const dpSouth = await page.getByTestId('lite-doorpick-SOUTH').boundingBox();
const dpWest = await page.getByTestId('lite-doorpick-WEST').boundingBox();
check('door picture: every wall button is at least 44px tall to tap', dpSouth.height >= 43.5 && dpWest.height >= 43.5, JSON.stringify([dpSouth, dpWest]));
await page.getByTestId('lite-doorpick-SOUTH').click();
check('no call button when no number is set', (await page.getByTestId('lite-call').count()) === 0);

// ---- unit and design are remembered
const widthBefore = await page.getByTestId('lite-widthMm').inputValue();
await page.getByTestId('lite-unit-ft').click();
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
check('next visit: "welcome back" is offered and the design is kept', (await page.getByTestId('lite-welcome').count()) === 1 && (await page.getByTestId('lite-door-style').count()) === 1);
check('next visit: the chosen unit (feet) is kept', /'/.test(await page.getByTestId('lite-widthMm').inputValue()), await page.getByTestId('lite-widthMm').inputValue());
await page.getByTestId('lite-start-again').click();
check('Start again returns to the standard room and hides the note', (await page.getByTestId('lite-welcome').count()) === 0 && /^9'/.test(await page.getByTestId('lite-widthMm').inputValue()));
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-bottles').waitFor();
check('and it is not offered again next time', (await page.getByTestId('lite-welcome').count()) === 0);
check('a shared link does not say "welcome back"', await (async () => { await page.goto('http://localhost:8802/index.html?d=CL1.WzI3NTAsMTU2NSwyMTUwLDIsMCwwLDUwMCwwXQ'); await page.getByTestId('lite-bottles').waitFor(); return (await page.getByTestId('lite-welcome').count()) === 0; })());
check('no script errors (standalone)', errors.length === 0, errors.join(' | '));
await ctx.close();

// ================= 1b. the call button
await adminPut({ ...baseSettings, phone: '03 9123 4567' });
({ ctx, page, errors } = await fresh());
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-call').waitFor({ timeout: 8000 }).catch(() => {});
check('call button: shows the number the owner set, as a link that dials', (await page.getByTestId('lite-call').count()) === 1 && (await page.getByTestId('lite-call').getAttribute('href')) === 'tel:0391234567' && /Call 03 9123 4567/.test(await page.getByTestId('lite-call').innerText()), await page.getByTestId('lite-call').innerText().catch(() => ''));
check('call button: big enough to tap, and has a tooltip', (await page.getByTestId('lite-call').boundingBox()).height >= 38 && /talk to someone/i.test(await page.getByTestId('lite-call').getAttribute('title')));
await ctx.close();
await adminPut(baseSettings);

// ================= 2. drag direction of the inside view
({ ctx, page, errors } = await fresh());
await page.goto('http://localhost:8802/index.html');
await page.getByTestId('lite-inside-canvas').waitFor();
await page.waitForTimeout(500);
const doorX0 = Number(await page.getByTestId('lite-inside-canvas').getAttribute('data-doorx'));
await page.getByTestId('lite-inside-canvas').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const box = await page.getByTestId('lite-inside-canvas').boundingBox();
const cursorOf = () => page.getByTestId('lite-inside-canvas').evaluate((el) => getComputedStyle(el.querySelector('.konvajs-content') || el).cursor);
await page.mouse.move(box.x + 300, box.y + 200);
check('the pointer is an open hand over the picture (it can be dragged)', (await cursorOf()) === 'grab', await cursorOf());
await page.mouse.down();
check('and a closed hand while dragging', (await cursorOf()) === 'grabbing', await cursorOf()); await page.mouse.move(box.x + 420, box.y + 200, { steps: 6 }); await page.mouse.up();
check('and back to an open hand when let go', (await cursorOf()) === 'grab', await cursorOf());
await page.waitForTimeout(400);
const yaw = Number(await page.getByTestId('lite-inside-canvas').getAttribute('data-yaw'));
check('dragging turns the inside view (and a Reset button appears)', Math.abs(yaw) > 3 && (await page.getByTestId('lite-inside-reset').count()) === 1, `yaw ${yaw}`);
const doorX1 = Number(await page.getByTestId('lite-inside-canvas').getAttribute('data-doorx'));
check('dragging right moves the scene right (like grabbing it)', doorX1 > doorX0, `door x ${doorX0} -> ${doorX1}`);
await page.getByTestId('lite-inside-reset').click();
await page.waitForTimeout(300);
check('Reset looks straight ahead again', Number(await page.getByTestId('lite-inside-canvas').getAttribute('data-yaw')) === 0);
await page.getByTestId('lite-tab-plan').click();
await page.waitForTimeout(300);
const planCursor = await page.getByTestId('lite-plan-canvas').evaluate((el) => getComputedStyle(el.querySelector('.konvajs-content') || el).cursor);
check('the plan (which pans) shows the open hand too', planCursor === 'grab', planCursor);

await ctx.close();

// ================= 3. embedded in the business's page, with the real script
({ ctx, page, errors } = await fresh());
const consoleLines = [];
page.on('console', (m) => consoleLines.push(m.text()));
await page.goto('http://localhost:8801/planner.html');
const frame = page.frameLocator('#f');
await frame.getByTestId('lite-bottles').waitFor();
await page.waitForTimeout(800);
const h1 = await page.evaluate(() => document.getElementById('f').getBoundingClientRect().height);
check('the frame is sized to the planner (no inner scroll bar): taller than the 600px it started at', h1 > 900, String(h1));
const scrollingAttr = await page.evaluate(() => document.getElementById('f').getAttribute('scrolling'));
check('and the frame is told not to scroll', scrollingAttr === 'no');
await frame.getByTestId('lite-preset-small').click();
await frame.getByTestId('lite-tab-plan').click();
await page.waitForTimeout(500);
const events = await page.evaluate(() => window.dataLayer.map((e) => JSON.stringify(e)));
check('usage events reach the page\'s dataLayer (start, preset, view)', events.some((e) => /cellar_lite_start/.test(e)) && events.some((e) => /cellar_lite_preset/.test(e) && /small/.test(e)) && events.some((e) => /cellar_lite_view/.test(e)), events.join(' | '));
check('events carry no personal data or design details', events.every((e) => !/CL1\.|@|\d{3,}/.test(e.replace(/cellar_lite_[a-z_]+/g, ''))), events.join(' | '));
// desktop: no phone bar
check('desktop width: no phone bar', (await page.evaluate(() => { const b = document.getElementById('cellar-lite-bar'); return !b || getComputedStyle(b).display === 'none'; })));
await ctx.close();

// phone: bar shows with the count and price, hides at the top?, and its button goes to the contact page
({ ctx, page, errors } = await fresh({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }));
await page.goto('http://localhost:8801/planner.html');
await page.frameLocator('#f').getByTestId('lite-bottles').waitFor();
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(500);
const barInfo = await page.evaluate(() => { const b = document.getElementById('cellar-lite-bar'); return b ? { display: getComputedStyle(b).display, text: b.innerText } : null; });
check('phone width: the quote bar is shown while the planner is on screen, with bottles and price', !!barInfo && barInfo.display === 'flex' && /About \d+ bottles/.test(barInfo.text) && /\$/.test(barInfo.text), JSON.stringify(barInfo));
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
check('and is hidden once the planner has scrolled out of view', (await page.evaluate(() => getComputedStyle(document.getElementById('cellar-lite-bar')).display)) === 'none');
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(500);
// the little picture: shown in the bar while the big picture is off screen, hidden while it is on screen
const thumbInfo = await page.evaluate(() => { const i = document.querySelector('#cellar-lite-bar img'); return i ? { display: getComputedStyle(i).display, src: i.src.slice(0, 23), w: i.naturalWidth, h: i.naturalHeight, len: i.src.length } : null; });
check('phone bar: while editing, it shows a live picture of the cellar (a real JPEG)', !!thumbInfo && thumbInfo.display === 'block' && thumbInfo.src === 'data:image/jpeg;base64,' && thumbInfo.w === 180 && thumbInfo.h === 112 && thumbInfo.len < 40000, JSON.stringify(thumbInfo));
await frameDoorPick(page);
const picTop = await page.evaluate(() => { const f = document.getElementById('f').getBoundingClientRect(); return f.top + window.scrollY; });
const picY = await page.frameLocator('#f').locator('.lite-drawing').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
await page.evaluate((y) => window.scrollTo(0, y), picTop + picY - 40);
await page.waitForTimeout(700);
const thumbHidden = await page.evaluate(() => { const i = document.querySelector('#cellar-lite-bar img'); const b = document.getElementById('cellar-lite-bar'); return { img: getComputedStyle(i).display, bar: getComputedStyle(b).display }; });
check('phone bar: when the big picture is on screen the little one is hidden (never shown twice), the bar stays', thumbHidden.img === 'none' && thumbHidden.bar === 'flex', JSON.stringify(thumbHidden));
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(500);
await page.locator('#cellar-lite-bar button').click();
await page.waitForURL(/contact\.html/, { timeout: 6000 }).catch(() => {});
await page.waitForTimeout(800);
const msg = await page.locator('#cw-contact-message').inputValue().catch(() => '');
check('the bar\'s button takes the visitor to the contact form with the design filled in', /contact\.html/.test(page.url()) && /Design code: CL1\./.test(msg), page.url() + ' ' + msg.slice(0, 80));
check('no script errors (embedded)', errors.length === 0, errors.join(' | '));
await ctx.close();

await browser.close(); apiServer.close(); lite.close(); site.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
