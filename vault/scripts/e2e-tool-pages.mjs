// Browser smoke test (Chromium via Playwright, API mocked) for the three pages that share the ToolSidebar menu and a guide chat:
// Font Customizer (/fonts), Measurements (/measurements) and CSS (/restyle). It checks the menu, tool switching, the hints under tools
// that are not usable yet, the guide button and chat, a microphone on the search box, and that nothing throws. The CSS page has its own,
// deeper run: scripts/e2e-restyle.mjs.
//
//   node scripts/e2e-tool-pages.mjs [--dist <built client folder>] [--headed]

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
const headed = args.includes('--headed');
let dist = args.includes('--dist') ? path.resolve(args[args.indexOf('--dist') + 1]) : null;
if (!dist) {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'toolpages-e2e-'));
  console.log('building the client into', dist);
  const r = spawnSync('npx', ['vite', 'build', '--config', 'client/vite.config.js', '--outDir', dist, '--emptyOutDir'], { cwd: root, shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
}

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

const respond = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await context.addInitScript(() => {
  localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 1, email: 'test@example.com', isAdmin: true } }, version: 0 }));
  ['vault_fonts_info_seen', 'vault_measurements_info_seen', 'vault_css_info_seen', 'vault:fonts-tutorial-seen', 'vault_tour_fonts_completed', 'vault_tour_measurements_completed'].forEach((k) => localStorage.setItem(k, '1'));
});
const asked = [];
await context.route('**/api/**', async (route) => {
  const req = route.request();
  const { pathname } = new URL(req.url());
  if (pathname === '/api/auth/me') return respond(route, { user: { id: 1, email: 'test@example.com', isAdmin: true } });
  if (pathname === '/api/settings/feature-access') return respond(route, { flags: {} });
  if (pathname === '/api/fonts/catalog') return respond(route, { families: [{ family: 'Roboto', slug: 'roboto', category: 'sans-serif', isVariable: true }, { family: 'Lora', slug: 'lora', category: 'serif', isVariable: true }] });
  if (pathname === '/api/fonts/projects') return respond(route, { projects: [{ id: 1, name: 'My Roboto', googleFont: 'Roboto', recipe: {} }] });
  if (pathname === '/api/fonts/session') return respond(route, { sessionId: 's1', meta: { family: 'Roboto', license: 'OFL', was_variable: false } });
  if (/\/api\/fonts\/session\/s1\/preview/.test(pathname)) return respond(route, { error: 'No preview in the test' }, 500);
  if (pathname === '/api/fonts-tutor' || pathname === '/api/measurements-tutor' || pathname === '/api/restyle-tutor') {
    asked.push(pathname);
    return respond(route, { verdict: 'doable', answer: 'Use the tool.', steps: [{ tool: pathname.includes('fonts') ? 'shape' : pathname.includes('measurements') ? 'scan' : 'export', do: 'Open it.' }] });
  }
  if (pathname === '/api/restyle/projects') return respond(route, { projects: [] });
  if (pathname === '/api/restyle/capabilities') return respond(route, { render: false });
  return respond(route, {});
});

const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR|speech|Speech/i.test(m.text())) problems.push(`console error: ${m.text()}`); });

let failed = 0;
const check = (ok, message) => { if (ok) console.log(`  ok  ${message}`); else { failed += 1; console.log(`FAIL  ${message}`); } };
const menu = (title) => page.locator(`nav[aria-label="${title} tools"]`);
const openTool = (title, name) => menu(title).locator('button').evaluateAll((buttons, n) => {
  const b = buttons.find((x) => (x.querySelector('span')?.firstChild?.textContent || '').trim() === n);
  if (!b) throw new Error(`no tool called ${n}`);
  b.click();
}, name);
const mainHeading = () => page.locator('main h2, main > div h2').first().innerText();
const askGuide = async (name, question, expectedStep) => {
  await page.getByRole('button', { name: `Open the ${name}` }).click();
  await page.getByRole('textbox', { name: new RegExp(`Ask the ${name.replace(' guide', '')}`, 'i') }).first().fill(question);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Use the tool.').waitFor({ timeout: 8000 });
  check((await page.getByRole('button', { name: new RegExp(expectedStep, 'i') }).count()) >= 1, `${name}: the answer comes back with an Open button for "${expectedStep}"`);
  await page.getByRole('button', { name: /Close the guide/ }).click();
};

try {
  // ---------------- Measurements ----------------
  console.log('Measurements');
  await page.goto(`${base}/measurements`);
  await page.locator('aside h1', { hasText: 'Measurements' }).waitFor({ timeout: 20000 });
  check(true, 'the page opens with the shared tool menu');
  const groups = (await menu('Measurements').locator('button[aria-expanded]').allInnerTexts()).map((g) => g.replace(/^[▼▶]\s*/, ''));
  check(groups.join('|') === 'Convert|Look up|Documents', `groups: ${groups.join(', ')}`);
  check((await page.getByRole('textbox', { name: /Value to convert/i }).count()) >= 1, 'the converter shows its value box');
  await openTool('Measurements', 'Formulas');
  await page.getByRole('textbox', { name: /Search units/i }).first().waitFor({ timeout: 5000 });
  check(page.url().includes('tab=formulas'), 'choosing Formulas shows its search and keeps ?tab= in the address');
  await openTool('Measurements', 'Document scanner');
  await page.getByText(/Drop a PDF, JPG or PNG here/).waitFor({ state: 'visible', timeout: 5000 });
  check(true, 'choosing Document scanner shows the drop box');
  check((await menu('Measurements').locator('..').getByRole('button', { name: /Speak into Search tools/ }).count()) === 1, 'the tool search has a microphone');
  await askGuide('Measurements guide', 'convert every size in a pdf', 'Document scanner');

  // ---------------- Fonts ----------------
  console.log('Fonts');
  await page.goto(`${base}/fonts`);
  await page.locator('aside h1', { hasText: 'Font Customizer' }).waitFor({ timeout: 20000 });
  const fgroups = (await menu('Font Customizer').locator('button[aria-expanded]').allInnerTexts()).map((g) => g.replace(/^[▼▶]\s*/, ''));
  check(fgroups.join('|') === 'Choose|Change|Keep', `groups: ${fgroups.join(', ')}`);
  const hints = await menu('Font Customizer').getByText('Load a font first').count();
  check(hints === 6, `six tools say "Load a font first" before a font is loaded (${hints})`);
  await openTool('Font Customizer', 'Shape');
  check((await page.getByText('Load a font first, then come back here.').count()) === 1, 'a tool that needs a font says so in its panel');
  await openTool('Font Customizer', 'My Fonts');
  check((await page.getByText('My Roboto').count()) >= 1, 'My Fonts lists the saved font');
  await openTool('Font Customizer', 'Choose a font');
  const picker = page.getByRole('textbox', { name: 'Search Google Fonts' });
  await picker.fill('Robo');
  await page.getByRole('button', { name: /Roboto/ }).first().click();
  await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Reshape the letters'), null, { timeout: 8000 });
  check(true, 'loading a font moves on to Shape');
  check((await page.getByText('Stem Thickness').count()) >= 1 && (await page.getByText('Proportional Width').count()) >= 1, 'Shape shows its four sliders');
  check((await menu('Font Customizer').getByText('Load a font first').count()) === 0, 'the hints go once a font is loaded');
  await openTool('Font Customizer', 'Download');
  check((await page.getByRole('textbox', { name: 'New family name' }).count()) >= 1, 'Download asks for a new family name');
  check((await page.getByRole('button', { name: /Say the name of a font/ }).count()) === 0, 'the font search microphone is on the Choose a font tool only');
  await openTool('Font Customizer', 'Choose a font');
  check((await page.getByRole('button', { name: 'Say the name of a font' }).count()) === 1, 'the font search has a microphone');
  await askGuide('Font Customizer guide', 'make it bolder', 'Shape');

  // ---------------- CSS ----------------
  console.log('CSS');
  await page.goto(`${base}/restyle`);
  await page.locator('aside h1', { hasText: 'CSS' }).waitFor({ timeout: 20000 });
  const cgroups = (await menu('CSS').locator('button[aria-expanded]').allInnerTexts()).map((g) => g.replace(/^[▼▶]\s*/, ''));
  check(cgroups.join('|') === 'Your page|Change it|Check and compare|Keep and share', `groups: ${cgroups.join(', ')}`);
  check((await menu('CSS').getByText('Build the preview first').count()) >= 8, 'tools that need a preview or a click say to build the preview first');
  check((await menu('CSS').getByText('Save the page first').count()) === 2, 'History and Share say to save the page first');
  check((await page.getByRole('textbox', { name: 'Address of the page' }).count()) === 1, 'Your page offers a web address box');
  check((await page.getByRole('textbox', { name: 'Address of the page' }).locator('xpath=..').getByRole('button', { name: /Speak into/ }).count()) === 1, 'the address box has a microphone');
  check(await page.getByLabel('This page builds itself with JavaScript (loads slower)').isDisabled(), 'the JavaScript option is greyed out when the server has no browser');
  await askGuide('CSS guide', 'get the css for my site', 'Export the CSS');
  check(asked.length === 3, `each guide was asked once (${asked.join(', ')})`);
} catch (err) {
  failed += 1;
  console.log(`FAIL  ${err.message}`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'toolpages-e2e-failure.png'), fullPage: true }).catch(() => {});
  console.log('screenshot:', path.join(os.tmpdir(), 'toolpages-e2e-failure.png'));
}

if (problems.length) { failed += 1; console.log('\nBrowser problems:'); [...new Set(problems)].forEach((p) => console.log(`  ${p}`)); }
await browser.close();
server.close();
console.log(failed ? `\n${failed} problem(s)` : '\ntool pages e2e passed');
process.exit(failed ? 1 : 0);
