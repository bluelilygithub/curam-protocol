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
<input type="text" name="name" id="cw-contact-name"><input type="email" name="email" id="cw-contact-email">
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
check('no script errors', errors.length === 0, errors.join(' | '));
console.log('message was:\n' + msg);
await browser.close(); parent.close(); lite.close();
process.exit(failed ? 1 : 0);
