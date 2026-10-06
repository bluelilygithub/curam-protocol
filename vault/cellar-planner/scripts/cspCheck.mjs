// Serves the production build of Cellar Planner under Vault's production Content Security Policy (the same directives as server/index.js) and
// reports every violation while it opens, takes the guided tour and the guide. Run `npm run build` first, then:  node scripts/cspCheck.mjs
// It exists because the dev server has no CSP: a feature can pass every test and still be blocked on the real site.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = join(import.meta.dirname, '..', '..', 'dist', 'cellar-planner-app');
if (!existsSync(join(DIST, 'index.html'))) { console.error('No build found: run `npm run build` in cellar-planner/ first.'); process.exit(2); }
const CSP = [
  "default-src 'self'", "base-uri 'self'", "font-src 'self' https: data:", "form-action 'self'", "frame-ancestors 'self'", "object-src 'none'", "script-src-attr 'none'", "style-src 'self' https: 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval' blob:", "img-src 'self' data: blob: https://i.ytimg.com", "media-src 'self' blob: data:", "connect-src 'self' blob: data:",
  "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.youtube.com", "worker-src 'self' blob:",
].join('; ');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json' };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '').replace(/^cellar-planner-app[/\\]?/, '');
  let file = join(DIST, rel || 'index.html');
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const problems = [];
page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t) || m.type() === 'error') problems.push(t.replace(/\s+/g, ' ').slice(0, 220)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 200)));
page.on('requestfailed', (r) => problems.push('request failed: ' + r.url()));

await page.goto(`${origin}/cellar-planner-app/?embedded=1`);
await page.getByTestId('plan-canvas').waitFor();
const report = {};
report.marker = await page.locator('meta[name="cellar-planner-app"]').count();
report.guideOpensFirstVisit = (await page.getByTestId('info-modal').count()) === 1;
await page.getByTestId('info-got-it').click();
report.canvasDrawn = Number(await page.getByTestId('plan-canvas').getAttribute('data-prims')) > 10;
report.embeddedTitleHidden = !(await page.locator('.top h1').isVisible());
await page.getByTestId('tour-start').click();
await page.waitForSelector('.shepherd-element.vault-tour', { timeout: 8000 });
report.tourOpens = true;
for (let i = 0; i < 4; i++) { await page.locator('.shepherd-element.vault-tour:not([hidden]) .shepherd-button:not(.vault-tour-btn-secondary)').click(); await page.waitForTimeout(600); }
report.tourSteps = await page.locator('.vault-tour-step-count:visible').innerText();
await page.keyboard.press('Escape');
await page.getByTestId('tab-elevation').click();
await page.waitForTimeout(300);
report.elevationDrawn = Number(await page.getByTestId('elevation-canvas').getAttribute('data-prims')) > 10;
// a save and a draft: both need only same-origin storage and a blob download
await page.getByTestId('save').click();
console.log(JSON.stringify(report, null, 1));
console.log('CSP / console problems:', problems.length);
for (const v of [...new Set(problems)]) console.log('  -', v);
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
