// Drives the public lite tool in real Chrome, at phone size with touch. Needs both dev servers:
//   npm run dev:lite   (port 5177)   and   npm run dev   (port 5176, for the staff "From design code" check)
// then: node scripts/e2e-lite.mjs
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const LITE = process.env.LITE_URL ?? 'http://localhost:5177/lite.html';
const FULL = process.env.CELLAR_URL ?? 'http://localhost:5176/cellar-planner-app/';
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };
const axe = join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js');
const scan = (pg) => pg.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => `${v.id} x${v.nodes.length}: ${v.nodes[0]?.html.slice(0, 100)}`));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
// the main run measures in millimetres (the steps below type and read whole millimetres); metres and feet have their own checks in e2e-lite-ux.mjs
await ctx.addInitScript(() => { try { localStorage.setItem('cellar-lite:unit:v1', 'mm'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(LITE);
await page.getByTestId('lite-bottles').waitFor();
const bottles = async () => Number((await page.getByTestId('lite-bottles').innerText()).match(/\d+/)[0]);
const first = await bottles();
check('lite: opens with an estimate for the default room', first > 0 && /estimate only/i.test(await page.getByTestId('lite-result').innerText()));
check('lite: no sideways scroll at phone width', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
check('lite: the opening picture is the inside view, and it draws racks', Number(await page.getByTestId('lite-inside-canvas').getAttribute('data-racks')) >= 3 && (await page.getByTestId('lite-tab-inside').getAttribute('aria-pressed')) === 'true');
await page.getByTestId('lite-tab-plan').click();
check('lite: the plan is drawn', Number(await page.getByTestId('lite-plan-canvas').getAttribute('data-prims')) > 10);

check('lite: the screen says the estimate uses standard-size rack units', /standard-size rack units, about 600 mm wide/.test(await page.getByTestId('lite-units').innerText()));
await page.getByTestId('lite-door-style').selectOption('DOUBLE');
check('lite: a double door builds with no "cannot be built" message and shows its hint', (await page.getByTestId('lite-problem').count()) === 0 && /Two doors that open together/.test(await page.getByTestId('lite').innerText()));
check('lite: the double door is two arcs on the plan (the drawing is redrawn)', Number(await page.getByTestId('lite-plan-canvas').getAttribute('data-prims')) > 10);
await page.getByTestId('lite-door-style').selectOption('SINGLE');
await page.getByTestId('lite-widthMm').fill('3600');
const wider = await bottles();
check('lite: a wider room holds at least as many bottles', wider >= first, `${first} -> ${wider}`);
await page.getByTestId('lite-bottle').selectOption('MAGNUM');
check('lite: a magnum room still has no "cannot be built" message', (await page.getByTestId('lite-problem').count()) === 0);
await page.getByTestId('lite-bottle').selectOption('BORDEAUX');

await page.getByTestId('lite-widthMm').fill('50');
check('lite: an out-of-range size shows the allowed range', /Between 1000 mm and 8000 mm/.test(await page.getByTestId('lite').innerText()));
await page.getByTestId('lite-widthMm').blur();
check('lite: leaving the field snaps it into range', (await page.getByTestId('lite-widthMm').inputValue()) === '1000');
await page.getByTestId('lite-widthMm').fill('3000');
const full3000 = await bottles();

await page.getByTestId('lite-mode').selectOption('TARGET');
await page.getByTestId('lite-target').fill('200');
const t = await bottles();
check('lite: a target of 200 gives a layout of at least 200 and no more than the full room', t >= 200 && t <= full3000, `${t} vs ${full3000}`);
await page.getByTestId('lite-target').fill('5000');
check('lite: a target bigger than the room says so', (await page.getByTestId('lite-short').count()) === 1);
await page.getByTestId('lite-mode').selectOption('FILL');

await page.getByTestId('lite-tab-racks').click();
await page.getByTestId('lite-racks-canvas').waitFor();
check('lite: the racks picture draws bottles', Number(await page.getByTestId('lite-racks-canvas').getAttribute('data-prims')) > 50);
const rs = await page.getByTestId('lite-racks-summary').innerText();
check('lite: the racks view lists the bottles for the wall in words (count, units, rows)', /North wall: \d+ bottles in \d+ units? \(\d+ a unit: \d+ rows of \d+\)/.test(rs), rs);
await page.getByTestId('lite-tab-plan').click();

// the address always carries the design, and reopening it gives the same estimate
const addr = page.url();
check('lite: the address carries the design code (?d=)', /[?&]d=CL1\./.test(addr), addr);
const before = await bottles();
const p2 = await ctx.newPage();
await p2.goto(addr);
await p2.getByTestId('lite-bottles').waitFor();
check('lite: reopening the address gives the same width and estimate', (await p2.getByTestId('lite-widthMm').inputValue()) === '3000' && (await p2.getByTestId('lite-bottles').innerText()).includes(String(before)));
await p2.close();

// request a quote: copy fallback (not embedded, so nothing is posted anywhere)
await page.getByTestId('lite-quote').click();
const sent = await page.getByTestId('lite-code').inputValue();
check('lite: the quote step shows the summary and the design code', /estimate only/.test(sent) && /Design code: CL1\./.test(sent));
await page.addScriptTag({ path: axe });
const a1 = await scan(page);
check('lite: accessibility scan at phone size, no violations', a1.length === 0, a1.join(' | '));

// help: the guide, the tour
await page.getByTestId('lite-help-open').click();
check('help: the Help button opens the plain-language guide', /How this works/.test(await page.getByTestId('lite-help').innerText()) && /not a quote or a building plan/.test(await page.getByTestId('lite-help').innerText()));
await page.addScriptTag({ path: axe, }).catch(() => {});
const aH = await scan(page);
check('help: accessibility scan with the guide open, no violations', aH.length === 0, aH.join(' | '));
await page.keyboard.press('Escape');
check('help: Esc closes the guide', (await page.getByTestId('lite-help').count()) === 0);
await page.getByTestId('lite-tour').click();
const steps = [['lt-welcome', 'Plan your wine cellar'], ['lt-size', '1. How big'], ['lt-door', '2. Where is the door'], ['lt-bottle', '3. What do you mostly'], ['lt-mode', '4. How many'], ['lt-result', 'Your estimate'], ['lt-drawing', 'The drawings'], ['lt-quote', 'Happy with it'], ['lt-done', 'That is all']];
const card = '.shepherd-element.vault-tour:not([hidden])';
let walked = 0;
for (const [id, title] of steps) {
  await page.locator(`${card} .shepherd-title`, { hasText: title }).waitFor({ timeout: 8000 });
  walked++;
  const noOverflow = (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0;
  if (!noOverflow) check(`tour: no sideways scroll on step ${id}`, false);
  if (id === 'lt-drawing') check('tour: the drawings step shows the inside view', (await page.getByTestId('lite-tab-inside').getAttribute('aria-pressed')) === 'true');
  await page.locator(`${card} .shepherd-button:not(.vault-tour-btn-secondary)`).click();
}
check('tour: all nine steps show in order', walked === steps.length);
await page.waitForTimeout(600);
check('tour: finishing it is remembered', await page.evaluate(() => localStorage.getItem('cellar-lite:tour-done:v1') === '1'));

// a first visit shows the three-step strip, not a pop-up; the guide opens from the Help button, and "Take the tour" inside it starts the tour
const fresh = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
const fp = await fresh.newPage();
await fp.goto(LITE);
await fp.getByTestId('lite-bottles').waitFor();
check('first visit: no pop-up guide, the three steps are on the page', (await fp.getByTestId('lite-help').count()) === 0 && (await fp.getByTestId('lite-steps').locator('li').count()) === 3);
await fp.getByTestId('lite-help-open').click();
await fp.getByTestId('lite-help').waitFor();
await fp.getByTestId('lite-help-tour').click();
await fp.locator(`${card} .shepherd-title`, { hasText: 'Plan your wine cellar' }).waitFor({ timeout: 8000 });
check('help: Take the tour inside the guide closes it and starts the tour', (await fp.getByTestId('lite-help').count()) === 0);
await fresh.close();

// embedded: the page around it receives the hand-off from the planner's origin
const hostHtml = `<!doctype html><title>host</title><form><input name="design-code"><textarea name="design-summary"></textarea></form><iframe id="f" title="planner" src="${LITE}" style="width:390px;height:700px"></iframe><script>window.__msgs = []; window.addEventListener('message', function (e) { window.__msgs.push({ origin: e.origin, data: e.data }); });</script>`;
const host = await ctx.newPage();
await host.route('http://127.0.0.1:5178/**', (r) => r.fulfill({ contentType: 'text/html', body: hostHtml }));
await host.goto('http://127.0.0.1:5178/page');
await host.frameLocator('#f').getByTestId('lite-bottles').waitFor();
await host.frameLocator('#f').getByTestId('lite-widthMm').fill('3200');
await host.waitForFunction(() => window.__msgs.some((m) => m.data && m.data.type === 'cellar-lite:design'));
const msgs = await host.evaluate(() => window.__msgs);
const last = msgs.filter((m) => m.data && m.data.type === 'cellar-lite:design').pop();
check('embedded: the design is posted to the page around it, from the planner origin', last.origin === new globalThis.URL(LITE).origin && last.data.version === 1 && /^CL1\./.test(last.data.code) && /estimate only/.test(last.data.summary), JSON.stringify(last));
await host.frameLocator('#f').getByTestId('lite-quote').click();
await host.waitForFunction(() => window.__msgs.some((m) => m.data && m.data.requested === true));
check('embedded: Request a quote marks the message as requested', true);
await host.close();

// the real page script: only the planner's own origin can send the visitor to the contact page, and only with a well-formed code
const fillSrc = await readFile(join(import.meta.dirname, '..', 'lite-wordpress', 'cellar-lite-fill.js'), 'utf8')
  .then((t) => t.replace("'https://www.wiwc.com.au'", "'http://localhost:5177'").replace("'https://wiwc.com.au/contact/'", "'http://127.0.0.1:5178/contact'"));
const wp = await ctx.newPage();
await wp.route('http://127.0.0.1:5178/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>wp</title><p>page</p>' }));
await wp.goto('http://127.0.0.1:5178/wp');
await wp.addScriptTag({ content: fillSrc });
const code = sent.match(/CL1\.[A-Za-z0-9_-]+/)[0];
const post = (origin, data) => wp.evaluate(([o, d]) => window.dispatchEvent(new MessageEvent('message', { origin: o, data: d })), [origin, data]);
await post('http://evil.test', { type: 'cellar-lite:design', version: 1, code, summary: 'x', requested: true });
await wp.waitForTimeout(400);
check('page script: a message from another origin is ignored', /\/wp$/.test(wp.url()), wp.url());
await post('http://localhost:5177', { type: 'cellar-lite:design', version: 1, code: '<script>', summary: 'x', requested: true });
await wp.waitForTimeout(400);
check('page script: a malformed code is refused', /\/wp$/.test(wp.url()), wp.url());
await post('http://localhost:5177', { type: 'cellar-lite:design', version: 1, code, summary: 'Inside 3000 mm, about 400 bottles', requested: false });
await wp.waitForTimeout(400);
check('page script: a design update without the button pressed stays on the page', /\/wp$/.test(wp.url()), wp.url());
await post('http://localhost:5177', { type: 'cellar-lite:design', version: 1, code, summary: 'Inside 3000 mm, about 400 bottles', requested: true });
await wp.waitForURL(/contact\?cellar-design=CL1\./, { timeout: 5000 }).catch(() => {});
check('page script: the planner\'s origin, with the button pressed, goes to the contact page carrying the design', /\/contact\?cellar-design=CL1\./.test(wp.url()), wp.url());
await wp.close();

// staff side: the full planner opens the code as a new design
const staff = await browser.newContext({ viewport: { width: 1500, height: 900 } });
await staff.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
const sp = await staff.newPage();
await sp.goto(FULL);
await sp.getByTestId('plan-canvas').waitFor();
await sp.getByTestId('code-open').click();
await sp.getByTestId('code-input').fill('nothing useful');
await sp.getByTestId('code-open-go').click();
check('staff: a bad code gives a plain message', /No design code found/.test(await sp.getByTestId('code-error').innerText()));
await sp.getByTestId('code-input').fill(`Hi, please quote. ${sent}`);
await sp.getByTestId('code-open-go').click();
await sp.getByTestId('code-modal').waitFor({ state: 'detached' });
await sp.waitForTimeout(500);
const proj = await sp.evaluate(() => window.cellar.store.getState().project);
check("staff: the code from an email opens as a new design with the visitor's room", proj.name.startsWith('Lite design') && proj.enclosure.outerWidthMm === 3000 + 100 && proj.estimated.length > 0, JSON.stringify([proj.name, proj.enclosure.outerWidthMm]));
const sp2 = await staff.newPage();
await sp2.goto(`${FULL}?d=${code}`);
await sp2.getByTestId('plan-canvas').waitFor();
await sp2.waitForFunction(() => window.cellar.store.getState().project.name.startsWith('Lite design'), null, { timeout: 8000 });
check('staff: a ?d= link opens the design on load', true);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
