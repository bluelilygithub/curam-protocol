// Serves the production build of Garden Planner under Vault's production Content Security Policy (the same directives as server/index.js) and
// reports every violation, then tries the real tag scan and a photo. Run `npm run build` in vault/ first, then:  node scripts/cspCheck.mjs
// It exists because the dev server has no CSP: a feature can pass every test and still be blocked on the real site.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = join(import.meta.dirname, '..', '..', 'dist', 'garden-planner-app');
if (!existsSync(join(DIST, 'index.html'))) { console.error('No build found: run `npm run build` in vault/ first.'); process.exit(2); }
const PHOTO_HOSTS = (process.env.PHOTO_HOSTS ?? 'https://inaturalist-open-data.s3.amazonaws.com https://static.inaturalist.org https://upload.wikimedia.org https://thumb.wikimedia.org https://images.ala.org.au').trim();
const CSP = [
  "default-src 'self'", "base-uri 'self'", "font-src 'self' https: data:", "form-action 'self'", "frame-ancestors 'self'", "object-src 'none'", "script-src-attr 'none'", "style-src 'self' https: 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  `img-src 'self' data: blob: https://i.ytimg.com ${process.env.NO_PHOTO_HOSTS ? '' : PHOTO_HOSTS}`,
  "media-src 'self' blob: data:", "connect-src 'self' blob: data:", "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.youtube.com", "worker-src 'self' blob:",
].join('; ');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.map': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) { res.statusCode = 404; res.end('{}'); return; }
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '').replace(/^garden-planner-app[/\\]?/, '');
  let file = join(DIST, rel || 'index.html');
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 't' }, version: 0 })); } catch { /* ignore */ } });
const page = await ctx.newPage();
const violations = [];
page.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) violations.push(t.replace(/\s+/g, ' ').slice(0, 220)); });
page.on('pageerror', (e) => violations.push('pageerror: ' + e.message.slice(0, 200)));
await page.route('**/api/garden-projects**', (r) => r.abort('failed'));
await page.route('**/api/plant-images/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', images: [
  { id: '1', source: 'inaturalist', sourceLabel: 'iNaturalist', sourceUrl: 'https://www.inaturalist.org/observations/1', imageUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/large.jpg', thumbUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg', creator: 'A', licenceCode: 'CC BY 4.0', licenceUrl: null, displayOnly: false, title: 't', role: 'plant', width: 2000, height: 1000, modified: false, credit: 'x', defaultFor: [] },
  { id: '2', source: 'wikimedia', sourceLabel: 'Wikimedia Commons', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/X.jpg', thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/X.jpg/640px-X.jpg', creator: 'B', licenceCode: 'CC BY-SA 4.0', licenceUrl: null, displayOnly: true, title: 't', role: 'plant', width: 2000, height: 1000, modified: false, credit: 'x', defaultFor: [] },
  { id: '3', source: 'ala', sourceLabel: 'Atlas of Living Australia', sourceUrl: 'https://biocache.ala.org.au/x', imageUrl: 'https://images.ala.org.au/image/abc/original', thumbUrl: 'https://images.ala.org.au/image/abc/thumbnail_large', creator: 'C', licenceCode: 'CC0 1.0', licenceUrl: null, displayOnly: false, title: 't', role: 'plant', width: null, height: null, modified: false, credit: 'x', defaultFor: [] },
] }) }));
await page.goto(`${origin}/garden-planner-app/`);
await page.waitForSelector('.wizard');
const report = {};

// 1. photos on a plant card: does the browser even ask the photo hosts?
const asked = [];
page.on('request', (r) => { if (/inaturalist|wikimedia|ala\.org/.test(r.url()) && /\.(jpg|jpeg|png)/i.test(r.url())) asked.push(r.url()); });
await page.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'CSP', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 20, depth: 20 } }));
await page.waitForSelector('.stage canvas');
await page.locator('.plant-head').first().click();
await page.waitForTimeout(2500);
report.photoRequests = asked.length;
report.photoCardMessage = (await page.locator('.photo-empty').count()) ? (await page.locator('.photo-empty').innerText()).trim() : '(a photo carousel is showing)';

// 2. the tag scan with the real reader (downloads its engine and model: needs the network)
const scan = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 400;
  const g = c.getContext('2d'); g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 900, 400); g.fillStyle = '#111'; g.font = '54px Arial'; g.fillText('Lavandula angustifolia', 40, 120); g.font = '40px Arial'; g.fillText('English Lavender', 40, 220);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  try { const r = await Promise.race([window.gardenPlanner.tagScanner.scan(blob, () => undefined), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 60 s')), 60000))]); return { ok: true, text: r.text.slice(0, 60) }; } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 160) }; }
});
report.tagScan = scan;

console.log(JSON.stringify(report, null, 1));
console.log('CSP violations:', violations.length);
for (const v of [...new Set(violations)]) console.log('  -', v);
await browser.close();
server.close();
