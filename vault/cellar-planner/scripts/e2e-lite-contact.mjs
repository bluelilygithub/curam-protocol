// Public planner to contact page: the button, the page script, the filled form, the link back, the planner button look.
// Needs the built lite bundle (npm run build:lite) and Chrome. Serves the bundle and two stand-in pages itself; Vault's settings address is blocked,
// so the planner uses its built-in defaults and nothing external is touched.
// Run: node scripts/e2e-lite-contact.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(join(import.meta.dirname, '..', 'package.json'));
const { chromium } = require('playwright-core');

const ROOT = join(import.meta.dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// the real script, with only its three addresses pointed at the local test servers
let script = readFileSync(join(ROOT, 'lite-wordpress/cellar-lite-fill.js'), 'utf8')
  .replace("'https://www.wiwc.com.au'", "'http://localhost:8802'")
  .replace("'https://wiwc.com.au/contact/'", "'http://localhost:8801/contact.html'")
  .replace("'https://wiwc.com.au/cellar-lite/'", "'http://localhost:8802/index.html'");

const contact = `<!doctype html><html><body><div style="height:1500px">top of contact page</div>
<form class="cw-form" id="cw-contact-form" action="/x" method="post">
<input type="text" name="name" id="cw-contact-name"><input type="email" name="email" id="cw-contact-email"><input type="tel" name="phone" id="cw-contact-phone">
<textarea name="message" id="cw-contact-message" rows="5"></textarea><button type="submit">Send message</button></form><div style="height:1500px">footer</div>
<script src="/fill.js"></script></body></html>`;
const planner = `<!doctype html><html><body><h1>Planner page</h1><iframe id="f" src="http://localhost:8802/index.html" style="width:100%;height:1100px;border:0"></iframe><script src="/fill.js"></script></body></html>`;

const serve = (port, handler) => new Promise((r) => { const s = http.createServer(handler); s.listen(port, () => r(s)); });
const parent = await serve(8801, (req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/fill.js') { res.setHeader('content-type', 'text/javascript'); return res.end(script); }
  res.setHeader('content-type', 'text/html'); res.end(p === '/contact.html' ? contact : planner);
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
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('cellar-lite:help-seen:v1', '1'); localStorage.setItem('cellar-lite:unit:v1', 'mm'); } catch {} });
const page = await ctx.newPage();
await page.route('https://curam-vault.up.railway.app/**', (r) => r.abort());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8801/planner.html');
const frame = page.frameLocator('#f');
await frame.getByTestId('lite-quote').waitFor();
const btn = await frame.getByTestId('lite-quote').evaluate((el) => { const c = getComputedStyle(el); return { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, bg: c.backgroundColor }; });
check('the quote button is a large, filled button in the brand colour (not a banner)', btn.w < 500 && btn.h >= 50 && btn.bg === 'rgb(74, 90, 42)', JSON.stringify(btn));
await frame.getByTestId('lite-quote').click();
await page.waitForURL(/contact\.html/, { timeout: 8000 }).catch(() => {});
check('pressing the button takes the visitor to the contact page', /contact\.html/.test(page.url()), page.url());
await page.waitForTimeout(4000);
const msg = await page.locator('#cw-contact-message').inputValue().catch(() => '');
check('message box holds the design summary and code', /Cellar planner design/.test(msg) && /Design code: CL1\./.test(msg) && /bottles/.test(msg), msg);
const inView = await page.locator('#cw-contact-form').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= -5 && r.top < 400; });
check('the page has scrolled so the form is in view', inView, 'scrollY=' + await page.evaluate(() => scrollY));
check('the cursor is in the Name field', await page.evaluate(() => document.activeElement?.id) === 'cw-contact-name');
check('the address no longer carries the design', !/cellar-design/.test(page.url()), page.url());
const link = (msg.match(/View this design again: (\S+)/) || [])[1];
check('message carries a link back to the design', !!link && /\?d=CL1\./.test(link), msg);
if (link) {
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await p2.getByTestId('lite-bottles').waitFor();
  const w = await p2.getByTestId('lite-widthMm').inputValue(), dp = await p2.getByTestId('lite-depthMm').inputValue(), h = await p2.getByTestId('lite-heightMm').inputValue();
  const b = await p2.getByTestId('lite-bottles').innerText();
  check('opening that link shows the same room and bottle count', w === '2750' && dp === '1565' && h === '2150' && /1120/.test(b), `${w}x${dp}x${h} ${b}`);
}

// ---- the copy of the enquiry to Vault (the form's own submit is not touched)
const ENQUIRY = 'https://curam-vault.up.railway.app/api/cellar-lite/enquiry';
const sent = [];
const onEnquiry = async (route) => { sent.push({ body: route.request().postData(), type: route.request().headers()['content-type'] }); await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }); };
await page.route(ENQUIRY, onEnquiry);
await ctx.route(ENQUIRY, onEnquiry);
await page.locator('#cw-contact-name').fill('Sam Rivera');
await page.locator('#cw-contact-email').fill('Sam@Example.com');
await page.locator('#cw-contact-phone').fill('0412 345 678');
await page.locator('#cw-contact-message').fill('Please call me after 5pm.\n\n' + msg);
await page.locator('#cw-contact-form button').click();
await page.waitForTimeout(1500);
check('sending the form also posts one copy to Vault, as text/plain (no preflight)', sent.length === 1 && /^text\/plain/.test(sent[0].type || ''), JSON.stringify(sent.map((x) => x.type)));
const copy = sent[0] ? JSON.parse(sent[0].body) : {};
check('the copy carries name, email, phone, the design code and counts', copy.name === 'Sam Rivera' && copy.email === 'Sam@Example.com' && copy.phone === '0412 345 678' && /^CL1\./.test(copy.code) && copy.bottles === 1120, JSON.stringify(copy).slice(0, 300));
check('the visitor\'s own words are sent without the design block', copy.message === 'Please call me after 5pm.', JSON.stringify(copy.message));
check('and the summary line', /^Inside 2750 x 1565 x 2150 mm/.test(copy.summary || ''), copy.summary);

// the negative cases on a fresh contact page, with the form's own submit cancelled so the page stays put
const DESIGN = 'CL1.WzI3NTAsMTU2NSwyMTUwLDIsMCwwLDUwMCwwXQ';
const SUMMARY = 'Inside 2750 x 1565 x 2150 mm, single door on the south wall, Bordeaux / Shiraz, about 840 bottles using standard rack units about 600 mm wide (estimate only, final site measure required) Guide price shown: $7,100 to $8,700.';
const fresh = async (query) => {
  const pg = await ctx.newPage();
  await pg.goto('http://localhost:8801/contact.html' + (query ?? ''));
  await pg.waitForTimeout(800);
  await pg.evaluate(() => document.querySelector('#cw-contact-form').addEventListener('submit', (e) => e.preventDefault()));
  return pg;
};
const submit = async (pg) => { await pg.evaluate(() => document.querySelector('#cw-contact-form').requestSubmit()); await pg.waitForTimeout(500); };
const withDesign = `?cellar-design=${encodeURIComponent(DESIGN)}&cellar-summary=${encodeURIComponent(SUMMARY)}`;
const before = () => sent.length;

let n = before();
let pg = await fresh();
await pg.locator('#cw-contact-name').fill('Plain Person'); await pg.locator('#cw-contact-email').fill('p@example.com'); await pg.locator('#cw-contact-message').fill('Just a normal enquiry, no planner.');
await submit(pg);
check('a contact form with no planner design is NOT copied to Vault', sent.length === n);
await pg.close();

pg = await fresh(withDesign);
await pg.locator('#cw-contact-email').fill('nobody@example.com');
await submit(pg);
check('a design but no name: not copied', sent.length === n);
await pg.locator('#cw-contact-name').fill('Has Name'); await pg.locator('#cw-contact-email').fill('not-an-email');
await submit(pg);
check('a design but an invalid email: not copied', sent.length === n);
await pg.locator('#cw-contact-email').fill('ok@example.com');
await submit(pg);
check('once name and email are good it is copied', sent.length === n + 1, String(sent.length - n));
const c2 = JSON.parse(sent.at(-1).body);
check('bottles and the guide price are read from the summary; phone left blank is sent blank', c2.bottles === 840 && c2.priceText === '$7,100 to $8,700' && c2.phone === '', JSON.stringify(c2));
await submit(pg); await submit(pg);
check('pressing Send again for the same enquiry does not copy it again', sent.length === n + 1, String(sent.length - n));
await pg.close();

// Vault unreachable: the form must still work normally
const down = await ctx.newPage();
await down.route(ENQUIRY, (r) => r.abort());
const pageErrors = [];
down.on('pageerror', (e) => pageErrors.push(e.message));
await down.goto('http://localhost:8801/contact.html' + withDesign);
await down.waitForTimeout(800);
await down.evaluate(() => document.querySelector('#cw-contact-form').addEventListener('submit', (e) => { window.__formSubmitted = !e.defaultPrevented; e.preventDefault(); }));
await down.locator('#cw-contact-name').fill('Offline Olly'); await down.locator('#cw-contact-email').fill('olly@example.com');
await submit(down);
check('with Vault unreachable the form\'s own submit still goes ahead and nothing throws', (await down.evaluate(() => window.__formSubmitted)) === true && pageErrors.length === 0, pageErrors.join(' | '));
await down.close();

check('no script errors', errors.length === 0, errors.join(' | '));
console.log('message was:\n' + msg);
await browser.close(); parent.close(); lite.close();
process.exit(failed ? 1 : 0);
