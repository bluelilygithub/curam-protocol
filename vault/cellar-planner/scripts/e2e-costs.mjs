// The other costs (glass, cooling unit, lighting, installation, margin) and the DXF export in the staff Cellar Planner, in real Chrome.
// Vault's catalogue endpoint is stood in for at the network layer, with the PLACEHOLDER costs (nothing confirmed), as a fresh workspace would have them.
// Run the dev server first (`npm run dev`, port 5176), then: node scripts/e2e-costs.mjs
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const URL = process.env.CELLAR_URL ?? 'http://localhost:5176/cellar-planner-app/';
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };

const STANDARD = { id: 'standard-600', name: 'Standard 600', unitWidthMm: 600, unitHeightMm: 2000, unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, bottlesPerRow: null, bottlesPerRowLabelForward: null, rowsPerUnit: null, orientation: 'NECK_OUT', pricePerUnit: 900, confirmed: true };
const QUOTE = { businessName: 'Acme Wine Cellars', details: '1 High St', terms: 'Deposit 30%.', validityDays: 30, gstNote: '' };
const PLACEHOLDERS = { glassPerM2: { amount: 1400, confirmed: false }, cooling: { amount: 6500, confirmed: false }, lighting: { amount: 1200, confirmed: false }, installation: { amount: 3500, confirmed: false }, margin: { pct: 25, confirmed: false } };
const catalogue = (costs) => ({ catalogue: { rackTypes: [STANDARD], defaultRackType: 'standard-600', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { show: false, currency: '$', fixed: 2000, perUnit: 900, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100, note: '' }, quote: QUOTE, costs, features: [] } });
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: true });

async function open(costs) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token' }, version: 0 })); } catch { /* fine */ } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/cellar-projects**', (r) => r.abort());
  await page.route('**/api/cellar-planner/catalogue', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogue(costs)) }));
  await page.route(/\/api\/cellar-planner\/leads(\/.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"leads":[]}' }));
  await page.goto(URL); await page.getByTestId('plan-canvas').waitFor(); await page.waitForTimeout(900);
  return { page, ctx, errors };
}
const openSectionFn = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); const t = el?.closest('section.section.collapsed')?.querySelector('.section-toggle'); if (t) t.click(); };
const reveal = async (page, id) => { await page.evaluate(openSectionFn, id); await page.waitForTimeout(250); return page.getByTestId(id); };
// a blank sample with the confirmed catalogue type and racks on two walls: nothing but the costs can be wrong with it
const design = async (page) => {
  await page.getByTestId('sample').click(); await page.waitForTimeout(300);
  await (await reveal(page, 'rack-type')).selectOption('standard-600');
  await (await reveal(page, 'fill-NORTH')).click(); await page.waitForTimeout(200);
  await page.getByTestId('fill-SOUTH').click(); await page.waitForTimeout(200);
};

// ---- placeholders: shown on the price, and they stop the quote
{
  const { page, ctx, errors } = await open(PLACEHOLDERS);
  await design(page);
  await reveal(page, 'price-panel');
  const table = await page.getByTestId('price-lines').innerText();
  check('the price lists the cooling unit, lighting, installation and margin', /Cooling unit/.test(table) && /Lighting/.test(table) && /Installation/.test(table) && /Margin/.test(table), table);
  check('each placeholder says so', (table.match(/placeholder/gi) ?? []).length >= 4, table);
  const warn = await page.getByTestId('price-panel').innerText();
  check('the price panel warns the amounts are placeholders and says where to confirm them', /placeholder/i.test(warn) && /Settings/.test(warn), warn.slice(0, 300));
  await page.getByTestId('quote-open').click();
  const blockers = await page.getByTestId('quote-blockers').innerText();
  check('a quote is refused while the costs are placeholders, naming each', /Cooling unit is still a placeholder/.test(blockers) && /Margin is still a placeholder/.test(blockers) && /Installation is still a placeholder/.test(blockers), blockers);
  check('and the Download button is switched off', await page.getByTestId('quote-download').isDisabled());
  await page.getByTestId('quote-close').click();
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- confirmed: the quote is allowed, and the margin never shows as a line
{
  const confirmed = Object.fromEntries(Object.entries(PLACEHOLDERS).map(([k, v]) => [k, { ...v, confirmed: true }]));
  const { page, ctx, errors } = await open(confirmed);
  await design(page);
  await page.getByTestId('quote-open').click();
  const blockers = await page.getByTestId('quote-blockers').innerText().catch(() => '');
  check('with every cost confirmed, none of the cost lines blocks the quote', !/placeholder|has no amount/.test(blockers), blockers);
  await page.keyboard.press('Escape');
  check('no page errors (confirmed)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- DXF
{
  const { page, ctx, errors } = await open(PLACEHOLDERS);
  await page.getByTestId('testcase').click(); await page.waitForTimeout(500);
  await page.getByTestId('package-open').click();
  check('the Drawing package window offers a DXF', (await page.getByTestId('package-dxf').count()) === 1);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByTestId('package-dxf').click()]);
  const text = readFileSync(await dl.path(), 'utf8');
  check('the DXF downloads with a .dxf name', /\.dxf$/i.test(dl.suggestedFilename()), dl.suggestedFilename());
  check('it is a release 12 DXF in millimetres, with the preliminary statement and a circle for every bottle', text.startsWith('0\nSECTION') && text.includes('AC1009') && text.includes('PRELIMINARY DESIGN ONLY') && (text.match(/\nCIRCLE\n/g) ?? []).length > 100);
  check('the window says what was made', /DXF with \d+ views/.test(await page.getByTestId('package-msg').innerText()));
  check('no page errors (dxf)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
