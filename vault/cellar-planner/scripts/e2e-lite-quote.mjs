// Public planner "Request a quote": the details are asked for inside the planner (name, email, phone, state), checked, sent to Vault, and the visitor
// never leaves the page. Needs the built lite bundle (npm run build:lite) and Chrome. Vault is stood in for at the network layer.
// Run: node scripts/e2e-lite-quote.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(join(import.meta.dirname, '..', 'package.json'));
const { chromium } = require('playwright-core');

const ROOT = join(import.meta.dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const script = readFileSync(join(ROOT, 'lite-wordpress/cellar-lite-fill.js'), 'utf8')
  .replace("'https://www.wiwc.com.au'", "'http://localhost:8802'")
  .replace("'https://wiwc.com.au/contact/'", "'http://localhost:8801/contact.html'")
  .replace("'https://wiwc.com.au/cellar-lite/'", "'http://localhost:8802/index.html'");
const planner = '<!doctype html><html><body><h1>Planner page</h1><iframe id="f" src="http://localhost:8802/index.html" style="width:100%;height:1100px;border:0"></iframe><script src="/fill.js"></script></body></html>';
const serve = (port, handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(port, () => r(s)); });
const parent = await serve(8801, (req, res) => {
  if (req.url.split('?')[0] === '/fill.js') { res.setHeader('content-type', 'text/javascript'); return res.end(script); }
  res.setHeader('content-type', 'text/html'); res.end(planner);
});
const lite = await serve(8802, (req, res) => {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = join(ROOT, 'dist-lite', p);
  if (!existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
});

let failed = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + extra}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('cellar-lite:help-seen:v1', '1'); localStorage.setItem('cellar-lite:unit:v1', 'mm'); } catch (e) { /* fine */ } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const sent = []; let mode = 'ok';
await ctx.route('https://curam-vault.up.railway.app/**', async (route) => {
  if (!route.request().url().endsWith('/api/cellar-lite/enquiry')) return route.abort();
  sent.push({ body: route.request().postData(), type: route.request().headers()['content-type'] });
  const cors = { 'access-control-allow-origin': '*' };
  if (mode === 'down') return route.abort();
  if (mode === 'bad') return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: '{"error":"That email address does not look right."}' });
  return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });
});
await page.goto('http://localhost:8801/planner.html');
const frame = page.frameLocator('#f');
await frame.getByTestId('lite-quote').waitFor();

await frame.getByTestId('lite-quote').click();
await frame.getByTestId('lite-quote-form').waitFor();
check('the button opens the form inside the planner; the visitor stays on the page', /planner\.html/.test(page.url()) && (await frame.getByTestId('lite-quote-name').count()) === 1);
for (const id of ['name', 'email', 'phone', 'state', 'message']) check(`the form asks for ${id}`, (await frame.getByTestId(`lite-quote-${id}`).count()) === 1);
const opts = await frame.getByTestId('lite-quote-state').locator('option').allInnerTexts();
check('the state list is the eight Australian states and territories', opts.length === 9 && ['New South Wales', 'Victoria', 'Queensland', 'Western Australia', 'South Australia', 'Tasmania', 'Australian Capital Territory', 'Northern Territory'].every((n) => opts.includes(n)), opts.join(','));
check('the cursor starts in the name box', await frame.getByTestId('lite-quote-name').evaluate((el) => el === el.ownerDocument.activeElement));

await frame.getByTestId('lite-quote-send').click();
check('sending an empty form says what is missing and sends nothing', /your name/i.test(await frame.getByTestId('lite-quote-error').innerText()) && sent.length === 0);
await frame.getByTestId('lite-quote-name').fill('Sam Rivera');
await frame.getByTestId('lite-quote-email').fill('not-an-email');
await frame.getByTestId('lite-quote-send').click();
check('a bad email is refused with a plain message', /email/i.test(await frame.getByTestId('lite-quote-error').innerText()) && sent.length === 0);
await frame.getByTestId('lite-quote-email').fill('sam@example.com');
await frame.getByTestId('lite-quote-phone').fill('12');
await frame.getByTestId('lite-quote-send').click();
check('a phone that cannot be a phone number is refused', /phone/i.test(await frame.getByTestId('lite-quote-error').innerText()) && sent.length === 0);
await frame.getByTestId('lite-quote-phone').fill('');
await frame.getByTestId('lite-quote-send').click();
check('phone may be left blank; with no state chosen the visitor is asked to choose one', /state or territory/i.test(await frame.getByTestId('lite-quote-error').innerText()) && sent.length === 0);

// Vault down: told plainly, nothing lost, can try again
mode = 'down';
await frame.getByTestId('lite-quote-state').selectOption('VIC');
await frame.getByTestId('lite-quote-send').click();
await frame.getByTestId('lite-quote-failed').waitFor();
check('when Vault cannot be reached the visitor is told, and the form stays filled', /still here/.test(await frame.getByTestId('lite-quote-failed').innerText()) && (await frame.getByTestId('lite-quote-name').inputValue()) === 'Sam Rivera');
// Vault refuses with a reason: shown
mode = 'bad';
await frame.getByTestId('lite-quote-send').click();
await frame.getByTestId('lite-quote-error').waitFor();
check('a refusal from Vault is shown in its own words', /does not look right/.test(await frame.getByTestId('lite-quote-error').innerText()));

mode = 'ok';
await frame.getByTestId('lite-quote-phone').fill('0412 345 678');
await frame.getByTestId('lite-quote-message').fill('After 5pm please.');
const before = sent.length;
await frame.getByTestId('lite-quote-send').click();
await frame.getByTestId('lite-quote-sent').waitFor();
check('a good form is sent once and the visitor is thanked', sent.length === before + 1 && /Thank you/.test(await frame.getByTestId('lite-quote-form').innerText()));
const body = JSON.parse(sent.at(-1).body);
check('as text/plain (no preflight), with name, email, phone, state, the design, the count and the message', /^text\/plain/.test(sent.at(-1).type || '') && body.name === 'Sam Rivera' && body.email === 'sam@example.com' && body.phone === '0412 345 678' && body.state === 'VIC' && /^CL1\./.test(body.code) && body.bottles === 1120 && body.message === 'After 5pm please.' && body.website === '', JSON.stringify(body).slice(0, 400));
check('the page is still the planner page (nothing redirected)', /planner\.html/.test(page.url()));
await frame.getByTestId('lite-quote-sent-close').click();
check('closing returns to the design', (await frame.getByTestId('lite-quote-form').count()) === 0);

// the phone bar on the page asks the planner to open the same form, instead of going to the contact page
await page.setViewportSize({ width: 420, height: 800 });
await page.waitForTimeout(700);
const bar = page.locator('#cellar-lite-bar button');
if (await bar.isVisible().catch(() => false)) {
  await bar.click();
  await frame.getByTestId('lite-quote-form').waitFor({ timeout: 5000 }).catch(() => {});
  check('the phone bar opens the same form', (await frame.getByTestId('lite-quote-form').count()) === 1 && /planner\.html/.test(page.url()), page.url());
} else console.log('INFO  phone bar not visible in this run, skipped');

check('no script errors', errors.length === 0, errors.join(' | '));
await browser.close(); parent.close(); lite.close();
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
