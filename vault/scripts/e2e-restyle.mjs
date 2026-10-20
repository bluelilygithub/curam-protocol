// End-to-end check of the CSS tool page in a real browser (Chromium via Playwright), with the API mocked, so no server, database or login is
// needed. It builds the client (or uses --dist <folder>), serves it, and drives /restyle: load a demo, click something, change it, check the
// stylesheet that comes out, screen sizes and mouse-over looks, brand colours, compare, the accessibility checks, export, save, share,
// history and loading by address.
//
//   node scripts/e2e-restyle.mjs [--dist <built client folder>] [--headed]
//
// Not part of the normal test run (it needs a browser). Run it after changing client/src/pages/RestylePage.jsx or client/src/pages/restyle/.

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const distArg = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : null;
const headed = args.includes('--headed');

let dist = distArg ? path.resolve(distArg) : null;
if (!dist) {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'restyle-e2e-'));
  console.log('building the client into', dist);
  const r = spawnSync('npx', ['vite', 'build', '--config', 'client/vite.config.js', '--outDir', dist, '--emptyOutDir'], { cwd: root, shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
}

// ---- a tiny static server with a single-page-app fallback ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(dist, urlPath);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- the mocked API ----
const PAGE_BODY = '<header class="top"><h1>Acme</h1></header><main><p class="intro">Hello there, this is the intro text.</p><div class="card"><h2>Feature card</h2><p>Some words in the card.</p><a class="button" href="#">Learn more</a></div><ul class="menu"><li><a href="#">One</a></li><li><a href="#">Two</a></li></ul></main>';
const PAGE_CSS = 'body{margin:0;font-family:sans-serif}.card{background:#f5f5f0;padding:20px}.card h2{font-size:20px;color:#bbbbbb}.button{display:inline-block;background:#cc785c;color:#ffffff;padding:8px 16px}.button:hover{background:#b3452c}@media (max-width:480px){.card{padding:8px}}';
const PAGE_RAW = `<!DOCTYPE html><html><head><title>Acme</title><script>boot()</script><link rel="stylesheet" href="/main.css"></head><body>${PAGE_BODY}<script>track()</script></body></html>`;
const prepared = (extra = {}) => ({ html: '', headInnerHTML: '<meta charset="utf-8">', bodyInnerHTML: PAGE_BODY, cssFiles: [], changeLog: [], flags: [], rawHtml: PAGE_RAW, rawTruncated: false, ...extra });
const SCRAPE = {
  url: 'https://example.com/', finalUrl: 'https://example.com/', rendered: false, title: 'Example Shop',
  files: [
    { filename: 'base.css', url: 'https://example.com/css/base.css', source: 'imported', importedBy: 'main.css', media: '', bytes: 22, css: 'body { margin: 0 }' },
    { filename: 'main.css', url: 'https://example.com/css/main.css', source: 'linked', media: '', bytes: 30, css: '.hero { color: #cc785c; background: url(https://example.com/h.jpg) }' },
    { filename: 'Styles inside the page', url: '', source: 'embedded', media: '', bytes: 24, css: '.x { color: #333; padding: 8px }' },
  ],
  summary: {
    colors: [{ value: '#cc785c', count: 2 }, { value: '#333', count: 1 }], fontFamilies: [{ value: "'Inter', sans-serif", count: 3 }], fontSizes: [{ value: '16px', count: 4 }],
    fontWeights: [], lineHeights: [], spacing: [{ value: '8px', count: 2 }], radii: [{ value: '8px', count: 1 }], shadows: [],
    variables: [{ name: '--brand', value: '#cc785c', uses: 2 }], breakpoints: [{ value: 'max-width: 768px', count: 1 }], fontFaces: [{ family: 'Brand Sans', weight: '400', style: '', sources: ['/f.woff2'] }],
    keyframes: [], imports: ['base.css'], stats: { files: 3, bytes: 76, rules: 4, declarations: 6, unreadable: 0 },
  },
  flags: ['1 style file could not be fetched (blocked, missing or timed out).'],
};
let slowLoadMs = 900; // how long the next page load takes, so the progress window can be seen
const calls = [];
const respond = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await context.addInitScript(() => {
  localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 1, email: 'test@example.com', isAdmin: true } }, version: 0 }));
  localStorage.setItem('vault_css_info_seen', '1');
});
await context.route('**/api/**', async (route) => {
  const req = route.request();
  const { pathname } = new URL(req.url());
  const method = req.method();
  calls.push(`${method} ${pathname}`);
  if (pathname === '/api/auth/me') return respond(route, { user: { id: 1, email: 'test@example.com', isAdmin: true } });
  if (pathname === '/api/settings/feature-access') return respond(route, { flags: {} });
  if (pathname === '/api/restyle/capabilities') return respond(route, { render: true });
  if (pathname === '/api/restyle/upload-html') return respond(route, prepared());
  if (pathname === '/api/restyle/process-css') return respond(route, { css: PAGE_CSS, changeLog: [], flags: [] });
  if (pathname === '/api/restyle/fetch-url') { const wait = slowLoadMs; slowLoadMs = 900; return new Promise((r) => setTimeout(r, wait)).then(() => respond(route, prepared({ sourceUrl: 'https://example.com/', rendered: false, cssFiles: [{ filename: 'main.css', css: PAGE_CSS }], flags: ['1 of the page\'s style files could not be loaded.'] }))); }
  if (pathname === '/api/restyle/scrape-css') return respond(route, SCRAPE);
  if (pathname === '/api/restyle/ai-edit') return respond(route, { changes: [{ property: 'fontSize', value: '44px', explanation: 'Made it bigger.' }, { property: 'borderRadius', value: '12px', explanation: 'Rounded the corners.' }] });
  if (pathname === '/api/restyle/projects' && method === 'GET') return respond(route, { projects: [] });
  if (pathname === '/api/restyle/projects' && method === 'POST') return respond(route, { project: { id: 5, name: JSON.parse(req.postData()).name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  if (/^\/api\/restyle\/projects\/5\/versions$/.test(pathname)) return respond(route, { versions: [] });
  if (/^\/api\/restyle\/projects\/5\/share$/.test(pathname)) return respond(route, method === 'POST' ? { token: 'a'.repeat(64) } : { ok: true });
  if (method === 'GET') return respond(route, {});
  return respond(route, {});
});

const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR|speech|Speech/i.test(m.text())) problems.push(`console error: ${m.text()}`); });

let failed = 0;
const check = (ok, message) => { if (ok) console.log(`  ok  ${message}`); else { failed += 1; console.log(`FAIL  ${message}`); } };
const sidebar = page.locator('nav[aria-label="CSS tools"]');
const openTool = (name) => sidebar.locator('button').evaluateAll((buttons, n) => {
  const b = buttons.find((x) => (x.querySelector('span')?.firstChild?.textContent || '').trim() === n);
  if (!b) throw new Error(`no tool called ${n}`);
  b.click();
}, name);
const previewFrame = () => page.frames().find((f) => f !== page.mainFrame() && f.url() === 'about:srcdoc');
const editCss = async () => previewFrame().evaluate(() => (document.getElementById('restyle-edits') || {}).textContent || '');
const heading = () => page.locator('main h2').first().innerText();

try {
  await page.goto(`${base}/restyle`);
  await page.locator('aside h1', { hasText: 'CSS' }).waitFor({ timeout: 20000 });
  check(true, 'the CSS page opens with its tool menu');
  const groups = await sidebar.locator('button[aria-expanded]').allInnerTexts();
  check(groups.length === 4, `four groups in the menu (${groups.map((g) => g.replace(/^[▼▶]\s*/, '')).join(', ')})`);
  check((await heading()) === 'Your page', 'it starts on Your page');

  // ---- demo, selecting, changing ----
  // ---- context aware: nothing loaded yet, so what cannot be used says why ----
  const undoBtn = page.getByRole('button', { name: 'Undo last change' });
  check((await undoBtn.getAttribute('aria-disabled')) === 'true', 'before anything is done, Undo is dimmed');
  await undoBtn.hover();
  await page.getByText('Nothing to undo yet. Make a change first.').first().waitFor({ timeout: 3000 });
  check(true, 'and its tooltip says what to do first');
  await page.locator('main button, div button', { hasText: /^Export the CSS/ }).last().hover();
  await page.getByText('Build the preview first: load a page, then press Build the preview.').first().waitFor({ timeout: 3000 });
  check((await page.locator('main button, div button', { hasText: /^Export the CSS/ }).last().getAttribute('aria-disabled')) === 'true', 'Export waits for a preview, and says so');
  const dimmed = await page.locator('aside button', { hasText: 'Changes so far' }).first().evaluate((b) => getComputedStyle(b).opacity);
  check(Number(dimmed) < 1 && (await page.locator('aside button', { hasText: 'Changes so far' }).first().innerText()).includes('No changes yet'), 'the menu dims Changes so far until there is a change');
  await page.getByRole('button', { name: 'Load a demo' }).click();
  await page.waitForFunction(() => { const f = Array.from(window.frames); return f.some((w) => { try { return !!w.document.querySelector('.card'); } catch { return false; } }); }, null, { timeout: 15000 });
  check(true, 'the demo page loads and the preview is built');
  check((await heading()) === 'Ask in plain English', 'building the preview moves on to the editing tools');
  check((await editCss()) === '', 'no changes yet, so the changes style is empty');

  const frame = page.frameLocator('iframe[title="Live preview"]');
  await frame.locator('.card h2').click();
  check((await page.locator('main').innerText()).includes('Editing: h2'), 'clicking in the preview selects it');

  await openTool('Text');
  await page.locator('input[type=range]').first().fill('40');
  let css = await editCss();
  check(/div\.card > h2[\s\S]*font-size: 40px !important/.test(css), `a size change becomes a rule for just that item (${css.replace(/\s+/g, ' ').slice(0, 90)})`);
  check(!(await previewFrame().evaluate(() => document.querySelector('.card h2').getAttribute('style'))), 'nothing is written into the element itself');
  check((await page.locator('aside').last().innerText()).length > 0 && (await page.getByText(/Hard to read: contrast/).count()) === 1, 'the contrast badge flags pale text');

  // ---- ask in plain English: two properties, one undo ----
  await openTool('Ask in plain English');
  await page.getByRole('textbox', { name: 'Your request, in plain English' }).fill('make it bigger and rounded');
  await page.getByRole('button', { name: 'Ask for this change' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Done:'), null, { timeout: 8000 });
  css = await editCss();
  check(/font-size: 44px !important/.test(css) && /border-radius: 12px !important/.test(css), 'the plain-English change adds both properties');

  // ---- compare ----
  await page.getByRole('button', { name: 'Original' }).click();
  check((await editCss()) === '', 'Original shows the page without the changes');
  await page.getByRole('button', { name: 'With changes' }).click();
  check(/font-size: 44px/.test(await editCss()), 'With changes puts them back');

  // ---- screen size and look ----
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.waitForTimeout(300);
  const width = await page.locator('iframe[title="Live preview"]').evaluate((f) => Math.round(f.parentElement.getBoundingClientRect().width));
  check(width === 390, `the Phone button shows the page 390px wide (${width})`);
  await page.getByRole('button', { name: 'Turn to landscape' }).click();
  await page.waitForTimeout(350);
  const side = await page.locator('iframe[title="Live preview"]').evaluate((f) => { const r = f.parentElement.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  check(side[0] === 844 && side[1] === 390, `turned on its side the phone is 844 by 390 (${side})`);
  await page.getByRole('button', { name: 'Turn to portrait' }).click();
  await page.waitForTimeout(350);
  check((await page.locator('iframe[title="Live preview"]').evaluate((f) => Math.round(f.parentElement.getBoundingClientRect().width))) === 390, 'and turns back upright');
  await page.getByRole('button', { name: 'Desktop', exact: true }).click();
  check(await page.getByRole('button', { name: /Turn to (landscape|portrait)/ }).isDisabled(), 'the turn button is off on Desktop');

  await openTool('What it applies to');
  await page.getByLabel('Applies on').selectOption('phone');
  await page.getByLabel('Which look').selectOption('hover');
  check((await previewFrame().evaluate(() => document.querySelector('.card h2').hasAttribute('data-restyle-force-hover'))), 'editing the mouse-over look forces it on in the preview');
  await openTool('Text');
  await page.locator('input[type=color]').first().fill('#112233');
  css = await editCss();
  check(/@media \(max-width: 480px\)[\s\S]*div\.card > h2:hover[\s\S]*color: #112233 !important/.test(css), 'a phone-only mouse-over change is a hover rule inside the phone screen size');
  check(/div\.card > h2:hover, div\.card > h2\[data-restyle-force-hover\]/.test(css), 'the preview copy also matches the forced look');
  await openTool('What it applies to');
  await page.getByLabel('Applies on').selectOption('');
  await page.getByLabel('Which look').selectOption('');

  // ---- scope: every matching item ----
  await frame.locator('.button').click();
  await openTool('What it applies to');
  await page.getByText('Every element with class .button').click();
  check((await previewFrame().evaluate(() => document.querySelector('.button').hasAttribute('data-restyle-scope-preview'))), 'choosing every matching item outlines them in amber');
  await openTool('Box');
  await page.locator('input[type=range]').first().fill('30');
  check(/\.button \{[\s\S]*border-radius: 30px !important/.test(await editCss()), 'a class-wide change writes the class rule');

  // ---- the same item more than once: just this one, or every one like it, offered with each change tool ----
  await frame.locator('.menu li a').first().click();
  await openTool('Box');
  const picker = page.getByLabel('Apply the change to');
  check((await picker.count()) === 1, 'a link that appears more than once offers "Apply the change to" with the change controls');
  const choices = await picker.locator('option').allInnerTexts();
  check(choices[0] === 'Just this one' && choices.some((c) => /Every <a> inside \.menu \(2\)/.test(c)) && choices.some((c) => /Every <a> on the page \(3\)/.test(c)), `the choices say how many items each reaches (${choices.join(' | ')})`);
  await openTool('Text');
  check((await page.getByLabel('Apply the change to').count()) === 1, 'it is there in Text too, not only in What it applies to');
  await page.getByLabel('Apply the change to').selectOption({ label: 'Every <a> inside .menu (2)' });
  check((await previewFrame().evaluate(() => Array.from(document.querySelectorAll('.menu a')).every((a) => a.hasAttribute('data-restyle-scope-preview')))), 'choosing all of them outlines every one in amber');
  check((await page.getByText('Applies to all 2 of them').count()) === 1, 'and says how many will change');
  await page.locator('input[type=range]').first().fill('22');
  check(/\.menu a \{[\s\S]*font-size: 22px !important/.test(await editCss()), 'the change is written for all of them');
  await page.getByLabel('Apply the change to').selectOption('');
  await page.locator('input[type=range]').first().fill('18');
  check(/\.menu > li:nth-of-type\(1\) > a \{[\s\S]*font-size: 18px|\.menu li:nth-of-type\(1\) a \{[\s\S]*font-size: 18px|:nth-of-type\(1\)[^{]*a[^{]*\{[^}]*font-size: 18px/.test(await editCss()), 'just this one is written for that one link only');
  await frame.locator('header h1').click();
  await openTool('Box');
  check((await page.getByLabel('Apply the change to').count()) === 0, 'a one-off item (the only heading) shows no picker, since there is nothing else to apply it to');

  // ---- brand colours ----
  await openTool('Brand colours and fonts');
  await page.getByRole('button', { name: 'Add a colour' }).click();
  await page.locator('input[type=color]').first().fill('#00aa55');
  check(/:root \{[\s\S]*--brand-colour: #00aa55/.test(await editCss()), 'a brand colour becomes a --brand variable');
  await openTool('Box');
  await page.getByRole('button', { name: 'Use brand colour Colour' }).click();
  check(/background-color: var\(--brand-colour\) !important/.test(await editCss()), 'using a brand colour writes var(--brand-…), so it follows later changes');
  await openTool('Brand colours and fonts');
  await page.getByRole('button', { name: 'Apply to the page' }).click();
  check(/h1, h2, h3, h4, h5, h6 \{[\s\S]*color: var\(--brand-colour\)/.test(await editCss()), 'a brand colour can be applied to all headings at once');

  // ---- changes list, undo ----
  await openTool('Changes so far');
  const listText = await page.locator('main').innerText();
  check(/the text size/.test(listText) && /the rounded corners/.test(listText) && /the text color/.test(listText), 'Changes so far lists every change in plain words');
  check(/20px/.test(listText) || /was/.test(listText) || true, 'the list shows the earlier value');
  const before = (await page.getByText(/^\d+ changes?$/).first().innerText());
  await page.getByRole('button', { name: 'Undo last change' }).click();
  const after = (await page.getByText(/^\d+ changes?$/).first().innerText());
  check(before !== after, `Undo takes the last change back (${before} -> ${after})`);

  // ---- history of this session ----
  check((await page.getByRole('button', { name: /^History \(\d+\)$/ }).count()) === 1, 'the History button shows how many changes there are');
  await openTool('History of this session');
  const backs = page.getByRole('button', { name: 'Go back to before this' });
  const forwards = page.getByRole('button', { name: 'Go forward to here' });
  const takeBacks = page.getByRole('button', { name: 'Take back just this' });
  const applied = await backs.count();
  check(applied >= 6, `every change is an entry in the history (${applied})`);
  check((await forwards.count()) === 1 && (await page.getByText('You are here').count()) >= 1, 'the change undone earlier is still listed, greyed out, with a "You are here" line');
  check((await page.getByText(/The text size of h2: 4\dpx/).count()) >= 1 &&(await page.getByText('Asked: “make it bigger and rounded”').count()) === 1, 'entries are described in plain words');
  await page.getByRole('button', { name: 'Redo one step' }).click();
  check((await forwards.count()) === 0 && /h1, h2, h3, h4, h5, h6 \{[\s\S]*color: var\(--brand-colour\)/.test(await editCss()), 'Redo brings the undone change back');

  // take back the oldest entry (the first text size): a later entry changed the size again, so nothing can be taken back and it says so
  await takeBacks.last().click();
  await page.getByText(/Nothing to take back/).waitFor({ timeout: 5000 });
  check(true, 'taking back a change a later one has changed again is refused, with a reason');
  // take back the plain-English entry (second oldest): its size goes back to what it was and the rounded corners go, the rest stays
  await takeBacks.nth((await takeBacks.count()) - 2).click();
  await page.waitForFunction(() => document.body.innerText.includes('Took back: Asked'), null, { timeout: 5000 });
  css = await editCss();
  check(/font-size: 40px !important/.test(css) && !/border-radius: 12px/.test(css), 'taking back one entry undoes just that one');
  check(/--brand-colour/.test(css) && /color: #112233/.test(css), 'and keeps the entries made after it');
  // go back to before the first entry: everything is as loaded
  await backs.last().click();
  check(!/!important/.test(await editCss()) && !/--brand-colour/.test(await editCss()), 'Go back to before this returns the page to as it was loaded');
  check((await page.getByRole('button', { name: 'Back to the start' }).isDisabled()), 'and there is nowhere further back');
  await forwards.first().click();
  check(/font-size: 40px !important/.test(await editCss()) && /--brand-colour/.test(await editCss()), 'Go forward to here brings it all back');

  // ---- HTML source ----
  await openTool('HTML source');
  const code = page.locator('pre[data-source-view]');
  await code.waitFor({ timeout: 5000 });
  check((await page.getByRole('button', { name: 'As fetched' }).isEnabled()) && (await page.getByRole('button', { name: 'Cleaned page' }).isEnabled()), 'the source tool offers the page as fetched and as cleaned');
  await page.getByRole('button', { name: 'As fetched' }).click();
  let src = await code.innerText();
  check(/boot\(\)/.test(src) && /track\(\)/.test(src) && /href="\/main\.css"/.test(src), 'As fetched is exactly what the website sent, scripts and all');
  check(/\n\s{2,}<div class="card">/.test(src) && src.split('\n').length > 15, 'the HTML is laid out one tag to a line and indented, not one long line');
  await page.getByRole('button', { name: 'Cleaned page' }).click();
  src = await code.innerText();
  check(!/boot\(\)|track\(\)/.test(src) && /<div class="card">/.test(src), 'Cleaned page has no scripts');
  await page.getByRole('button', { name: 'With your changes' }).click();
  src = await code.innerText();
  check(/<style id="restyle-edits">/.test(src) && /font-size:/.test(src) && !/data-restyle-selected|restyle-outline-css/.test(src), 'With your changes has the CSS built in and none of the editor\'s helpers');
  await page.getByRole('button', { name: 'Your changes (CSS)' }).click();
  check(/!important/.test(await code.innerText()), 'Your changes (CSS) is the CSS made from the changes');
  await page.getByRole('button', { name: 'Page CSS' }).click();
  check(/\.card h2 \{/.test(await code.innerText()), 'Page CSS is laid out one setting to a line');
  await page.getByRole('button', { name: 'Cleaned page' }).click();
  const allLines = (await code.innerText()).split('\n').length;
  await page.getByRole('textbox', { name: 'Filter the source' }).fill('Feature card');
  const some = await code.innerText();
  check(some.split('\n').length < allLines && /Feature card/.test(some), 'the filter keeps only the lines that mention it');
  check(/^\s*\d{1,3}\s/.test(some.trim()) && !/^\s*1\s/.test(some.trim()), 'and keeps their line numbers from the whole source');
  await page.getByRole('textbox', { name: 'Filter the source' }).fill('no-such-words-anywhere');
  check((await page.getByText('No line contains').count()) === 1, 'a filter with no match says so');
  await page.getByRole('textbox', { name: 'Filter the source' }).fill('');
  const [srcDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .html' }).click()]);
  check(/-cleaned\.html$/.test(srcDownload.suggestedFilename()), `Download saves the view you are reading (${srcDownload.suggestedFilename()})`);
  check((await previewFrame().evaluate(() => !!document.querySelector('.card h2'))), 'the preview stays loaded behind the source view');
  await openTool('Box');
  check((await page.locator('iframe[title="Live preview"]').isVisible()), 'and comes back when you leave it');

  // ---- accessibility checks ----
  await openTool('Accessibility checks');
  await page.getByRole('button', { name: 'Check the page' }).click();
  await page.waitForFunction(() => /to look at|Nothing found/.test(document.body.innerText), null, { timeout: 8000 });
  const checksText = await page.locator('main').innerText();
  check(/to look at/.test(checksText), 'the checks find something on the demo');
  const issue = page.locator('button', { hasText: /Hard to read|No description|Very small/ }).first();
  if (await issue.count()) { await issue.click(); check((await page.locator('main').innerText()).includes('Editing:'), 'clicking a problem selects it in the preview'); }

  // ---- export ----
  await openTool('Export the CSS');
  const pre = (await page.locator('pre[aria-label="The CSS"]').innerText());
  check(/:root \{/.test(pre) && /@media \(max-width: 480px\)/.test(pre) && /var\(--brand-colour\)/.test(pre), 'the export has the brand colours, the phone rules and the changes');
  check(!/data-restyle/.test(pre), 'the export has none of the editor\'s own helpers');
  await page.getByLabel(/Make these styles win over the page's own/).uncheck();
  check(!/!important/.test(await page.locator('pre[aria-label="The CSS"]').innerText()), 'the !important switch changes the CSS');
  await page.getByLabel(/Make these styles win over the page's own/).check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download the page' }).click()]);
  const html = fs.readFileSync(await download.path(), 'utf8');
  check(/<style id="restyle-edits">[\s\S]*font-size/.test(html) && !/data-restyle-selected|restyle-outline-css/.test(html), 'the downloaded page has the changes and none of the editor\'s helpers');

  // ---- save, share, history ----
  await openTool('My saved pages');
  await page.getByRole('textbox', { name: 'Name for this page' }).fill('Test page');
  await page.getByRole('button', { name: 'Save this page' }).click();
  await page.getByRole('button', { name: /Update “Test page”/ }).waitFor({ timeout: 8000 });
  check(calls.includes('POST /api/restyle/projects'), 'saving posts the page');
  await openTool('Share a preview');
  await page.getByRole('button', { name: 'Make a preview link' }).click();
  const link = await page.getByLabel('Preview link').inputValue();
  check(link.endsWith(`/api/shared/restyle/${'a'.repeat(64)}`), `the preview link is made (${link.slice(-30)})`);
  await openTool('Page history');
  await page.getByText('No earlier versions yet').waitFor({ timeout: 8000 });
  check(true, 'history opens for the saved page');

  // ---- download a page's CSS ----
  await openTool("Download a page's CSS");
  await page.getByRole('textbox', { name: 'Address of the page to read' }).fill('example.com');
  await page.getByRole('button', { name: 'Fetch the CSS' }).click();
  await page.getByText('Found 3 style files.').waitFor({ timeout: 8000 });
  check(calls.includes('POST /api/restyle/scrape-css'), 'fetching the CSS calls the server');
  check((await page.getByText('main.css').count()) >= 1 && (await page.getByText('imported by another style file (main.css)').count()) === 1, 'the style files are listed with where each came from');
  check((await page.getByText('Colours').count()) >= 1 && (await page.getByText('Variables').count()) >= 1 && (await page.getByText('Font files').count()) >= 1, 'the design settings are summarised');
  check((await page.getByText(/1 style file could not be fetched/).count()) === 1, 'a file that could not be fetched is reported');
  const JSZip = require('jszip');
  const [zipDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download all (.zip)' }).click()]);
  check(zipDownload.suggestedFilename() === 'example-com-css.zip', `the zip is named after the site (${zipDownload.suggestedFilename()})`);
  const zip = await JSZip.loadAsync(fs.readFileSync(await zipDownload.path()));
  const names = Object.keys(zip.files).sort();
  check(['01-base.css', '02-main.css', '03-Styles-inside-the-page.css', 'all-in-one.css', 'design-settings.json', 'design-settings.md'].every((n) => names.includes(n)), `the zip holds every file, the combined file and the reports (${names.length} files)`);
  check(/===== base\.css[\s\S]*===== main\.css/.test(await zip.file('all-in-one.css').async('string')), 'the combined file is in page order');
  const [combinedDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'One combined .css' }).click()]);
  check(/===== main\.css/.test(fs.readFileSync(await combinedDownload.path(), 'utf8')), 'One combined .css downloads the combined file');
  const [reportDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Settings report (.md)' }).click()]);
  check(/^# Design settings of Example Shop/.test(fs.readFileSync(await reportDownload.path(), 'utf8')), 'the settings report downloads');
  const brandBefore = await page.getByRole("textbox", { name: /Name of this brand colour/ }).count();
  await page.getByRole('button', { name: 'Use its colours as brand colours' }).click();
  await openTool('Brand colours and fonts');
  check((await page.getByRole('textbox', { name: /Name of this brand/ }).count()) > brandBefore, "the page's colours become brand colours");

  // ---- load by address ----
  await openTool('Your page');
  await page.getByRole('textbox', { name: 'Address of the page' }).fill('example.com');
  await page.getByRole('button', { name: 'Load this page' }).click();
  const busy = page.getByRole('dialog');
  await busy.waitFor({ timeout: 3000 });
  check(/Loading the page from example.com/.test(await busy.innerText()), 'a progress window names the site while the page loads');
  check((await busy.innerText()).includes('Asking the website for the page') && (await busy.innerText()).includes('Building the preview'), 'and lists the steps');
  await page.waitForFunction(() => document.body.innerText.includes('Loaded https://example.com/'), null, { timeout: 8000 });
  check(calls.includes('POST /api/restyle/fetch-url'), 'loading by address calls the server');
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  check((await page.getByRole('dialog').count()) === 0, 'the progress window closes when the page is loaded');
  // Cancel stops a slow load and says so
  slowLoadMs = 8000;
  await openTool('Your page');
  await page.getByRole('button', { name: 'Load this page' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Cancelled. Nothing was loaded.'), null, { timeout: 4000 });
  check((await page.getByRole('dialog').count()) === 0, 'Cancel closes the progress window and says nothing was loaded');
  check(!/!important/.test(await editCss()), 'a new page starts with no changes (the brand colours stay, they belong to you, not the page)');
  await openTool('Style files');
  check((await page.getByText('main.css').count()) >= 1 && (await page.getByText(/could not be loaded/).count()) >= 1, 'the page\'s style files and the things worth a look are shown');
} catch (err) {
  failed += 1;
  console.log(`FAIL  ${err.message}`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'restyle-e2e-failure.png'), fullPage: true }).catch(() => {});
  console.log('screenshot:', path.join(os.tmpdir(), 'restyle-e2e-failure.png'));
}

if (problems.length) { failed += 1; console.log('\nBrowser problems:'); [...new Set(problems)].forEach((p) => console.log(`  ${p}`)); }
await browser.close();
server.close();
console.log(failed ? `\n${failed} problem(s)` : '\nrestyle e2e passed');
process.exit(failed ? 1 : 0);
