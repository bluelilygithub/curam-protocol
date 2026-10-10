// Drives website enquiries and the customer quote in the staff Cellar Planner, in real Chrome. Vault's endpoints (catalogue, enquiries) are stood in for
// at the network layer. Run the dev server first (`npm run dev`, port 5176), then:  node scripts/e2e-quote.mjs [screenshot dir]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';

const URL = process.env.CELLAR_URL ?? 'http://localhost:5176/cellar-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };

const type = (over) => ({ unitDepthMm: null, rowPitchMm: null, postsPerUnit: null, bottlesPerRow: null, bottlesPerRowLabelForward: null, rowsPerUnit: null, orientation: 'NECK_OUT', ...over });
const STANDARD = type({ id: 'standard-600', name: 'Standard 600', unitWidthMm: 600, unitHeightMm: 2000, unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true });
const WIDE = type({ id: 'wide-display', name: 'Wide display', unitWidthMm: 900, unitHeightMm: 2100, orientation: 'LABEL_FORWARD', bottlesPerRowLabelForward: 6, pricePerUnit: 1500, confirmed: false });
const QUOTE = { businessName: 'Acme Wine Cellars', details: '1 High St\nMelbourne VIC 3000', terms: 'A 30% deposit is due on acceptance.', validityDays: 30, gstNote: 'All prices include GST.' };
const catalogue = (quote = QUOTE) => ({ catalogue: { rackTypes: [STANDARD, WIDE], defaultRackType: 'standard-600', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { show: false, currency: '$', fixed: 2000, perUnit: 900, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100, note: '' }, quote }, updatedAt: null });
const CODE = 'CL1.WzI3NTAsMTU2NSwyMTUwLDIsMCwwLDUwMCwwXQ';
const LEAD = { id: 7, name: 'Sam Rivera', email: 'sam@example.com', phone: '0412 345 678', summary: 'Inside 2750 x 1565 x 2150 mm, single door', priceText: '$7,100 to $8,700', bottles: 840, status: 'new', clientId: 3, dealId: 4, createdAt: '2026-10-09T01:00:00.000Z' };

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function open({ query = '', leads = [LEAD], leadsStatus = 200, quoteSettings = QUOTE, signedIn = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript((tok) => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); if (tok && !sessionStorage.getItem('seeded')) { localStorage.setItem('vault-auth', JSON.stringify({ state: { token: tok } })); sessionStorage.setItem('seeded', '1'); } } catch { /* ignore */ } }, signedIn ? 'test-token' : '');
  const page = await ctx.newPage();
  const errors = []; const posts = []; const gets = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/cellar-projects**', (r) => r.abort());
  await page.route('**/api/cellar-planner/catalogue', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogue(quoteSettings)) }));
  await page.route(/\/api\/cellar-planner\/leads(\/.*)?$/, async (r) => {
    const u = new globalThis.URL(r.request().url()); const m = r.request().method(); const path = u.pathname.replace('/api/cellar-planner/leads', '');
    if (m === 'GET') gets.push(path || '/');
    if (leadsStatus !== 200) return r.fulfill({ status: leadsStatus, contentType: 'application/json', body: '{}' });
    if (m === 'GET' && path === '') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ leads }) });
    const hit = leads.find((l) => `/${l.id}` === path);
    if (m === 'GET' && hit) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lead: { ...hit, message: 'Please call after 5', code: CODE } }) });
    if (m === 'POST' && /^\/\d+\/(opened|quote)$/.test(path)) { posts.push({ path, body: r.request().postData() }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, valueSet: true, status: 'opened' }) }); }
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto(URL + query);
  await page.getByTestId('plan-canvas').waitFor();
  await page.waitForTimeout(900);
  return { page, ctx, errors, posts, gets };
}
const project = (page) => page.evaluate(() => window.cellar.store.getState().project);
const openSection = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); const t = el?.closest('section.section.collapsed')?.querySelector('.section-toggle'); if (t) t.click(); };
const reveal = async (page, id) => { await page.evaluate(openSection, id); return page.getByTestId(id); };
const scan = async (page, label) => {
  await page.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => `${x.id} x${x.nodes.length}: ${x.nodes[0].target.join(' ')}`));
  check(`accessibility scan, ${label}: no violations`, v.length === 0, v.join(' | '));
};
const download = async (page) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByTestId('quote-download').click()]); const path = await d.path(); return { name: d.suggestedFilename(), bytes: readFileSync(path) }; };

// ================================================================ quote: refused until the numbers can be trusted
{
  const { page, errors, posts, ctx } = await open();
  await page.getByTestId('sample').click(); await page.waitForTimeout(300);
  await page.getByTestId('quote-open').click();
  const blockers = await page.getByTestId('quote-blockers').innerText();
  check('with no rack type the quote is refused, saying what to do', /can't be made yet/.test(blockers) && /Choose a rack type/.test(blockers), blockers);
  check('and the Download button is disabled', await page.getByTestId('quote-download').isDisabled());
  await scan(page, 'quote form blocked');
  await page.getByTestId('quote-close').click();

  await (await reveal(page, 'rack-type')).selectOption('wide-display');
  await page.getByTestId('quote-open').click();
  const b2 = await page.getByTestId('quote-blockers').innerText();
  check('an unconfirmed rack type is refused and says how to fix it', /not confirmed by the supplier/.test(b2) && /Tick "Confirmed by supplier"/.test(b2), b2);
  check('and no racks placed is listed too', /No racks are placed/.test(b2), b2);
  await page.getByTestId('quote-close').click();

  await (await reveal(page, 'rack-type')).selectOption('standard-600');
  await (await reveal(page, 'fill-NORTH')).click(); await page.waitForTimeout(200);
  await page.getByTestId('fill-SOUTH').click(); await page.waitForTimeout(200);
  await page.getByTestId('quote-open').click();
  check('a confirmed type with racks placed and no errors: nothing blocks the quote', (await page.getByTestId('quote-blockers').count()) === 0 && !(await page.getByTestId('quote-download').isDisabled()));
  const total = await page.getByTestId('quote-total').innerText();
  check('the form shows the same total as the Price panel', /\$7,900/.test(total), total);
  check('the reference starts as the date', /^Q\d{8}$/.test(await page.getByTestId('quote-reference').inputValue()));
  await page.getByTestId('quote-customer').fill('Sam Rivera');
  await page.getByTestId('quote-address').fill('5 Vine Rd Tarneit');
  await page.getByTestId('quote-notes').fill('Delivery in March.');
  await scan(page, 'quote form ready');
  const file = await download(page);
  check('Download gives a PDF named from the reference', /^q\d{8}-quote\.pdf$/.test(file.name) && new TextDecoder().decode(file.bytes.slice(0, 5)) === '%PDF-', file.name);
  check('the quote carries the 3D picture of the inside', new TextDecoder('latin1').decode(file.bytes).includes('/Subtype /Image'));
  const pdf = await PDFDocument.load(file.bytes);
  check('one A4 page, titled with the reference', pdf.getPageCount() === 1 && Math.round(pdf.getPage(0).getSize().width) === 595 && /^Quote Q\d{8}$/.test(pdf.getTitle() ?? ''), `${pdf.getPageCount()} ${pdf.getTitle()}`);
  const msg = await page.getByTestId('quote-msg').innerText();
  check('the message reports the download and total', /Downloaded the quote \(1 page, total \$7,900\)/.test(msg), msg);
  check('a design with no enquiry logs nothing in the CRM', posts.length === 0, JSON.stringify(posts));
  const kept = await project(page);
  check('the customer\'s name and address are kept with the design for next time', kept.drawing?.client === 'Sam Rivera' && kept.drawing?.address === '5 Vine Rd Tarneit', JSON.stringify(kept.drawing));
  if (out) { await page.waitForTimeout(300); await page.screenshot({ path: join(out, 'quote-modal.png') }); }
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ the owner has not entered their business name
{
  const { page, ctx } = await open({ quoteSettings: { ...QUOTE, businessName: '' } });
  await page.getByTestId('sample').click(); await page.waitForTimeout(300);
  await (await reveal(page, 'rack-type')).selectOption('standard-600');
  await (await reveal(page, 'fill-NORTH')).click(); await page.waitForTimeout(300);
  await page.getByTestId('quote-open').click();
  check('no business name set: refused, pointing at Settings', /business name.*Settings/s.test(await page.getByTestId('quote-blockers').innerText()));
  await ctx.close();
}

// ================================================================ enquiries
{
  const { page, errors, posts, gets, ctx } = await open();
  check('the Enquiries button shows how many are new', (await page.getByTestId('leads-new-count').innerText()) === '1');
  await page.getByTestId('leads-open').click();
  await page.waitForTimeout(400);
  const item = await page.getByTestId('lead-item').first().innerText();
  check('the list shows the person, status, bottles, guide price and summary', /Sam Rivera/.test(item) && /new/i.test(item) && /840 bottles/.test(item) && /\$7,100 to \$8,700/.test(item) && /single door/.test(item), item);
  await scan(page, 'enquiries list');
  if (out) await page.screenshot({ path: join(out, 'enquiries.png') });
  await page.getByTestId('lead-open-7').click();
  await page.waitForTimeout(1200);
  const p = await project(page);
  check('opening it adds a new design named for the person, linked to the enquiry', p.name === 'Enquiry: Sam Rivera' && p.lead?.id === 7, JSON.stringify([p.name, p.lead]));
  check('it has the visitor\'s room and the default rack type applied', p.enclosure.door.widthMm > 0 && p.runs.length > 0 && p.rackType?.id === 'standard-600' && p.rackSpec.unitDepthMm === 350, JSON.stringify([p.rackType, p.runs.length]));
  check('the client name is ready for the drawing package', p.drawing?.client === 'Sam Rivera');
  check('Vault is told it was opened', posts.some((x) => x.path === '/7/opened'), JSON.stringify(posts));
  check('the status line says what happened', /Opened the enquiry from Sam Rivera/.test(await page.getByTestId('status').innerText()));

  // a quote for this design is logged on the enquiry
  await page.getByTestId('quote-open').click();
  check('the form says the quote will be logged on their deal', /logged on their deal in the CRM/.test(await page.getByTestId('quote-lead').innerText()));
  check('customer starts as the enquirer', (await page.getByTestId('quote-customer').inputValue()) === 'Sam Rivera');
  check('reference carries the enquiry number', /^Q\d{8}-E7$/.test(await page.getByTestId('quote-reference').inputValue()));
  const blockers = await page.getByTestId('quote-blockers').count() ? await page.getByTestId('quote-blockers').innerText() : '';
  console.log('INFO  blockers for an enquiry design:', blockers.replace(/\s+/g, ' ').slice(0, 300) || 'none');
  if (!blockers) {
    await download(page);
    const q = posts.find((x) => x.path === '/7/quote');
    check('making the quote logs it on the enquiry with the total and reference', !!q && JSON.parse(q.body).total > 0 && /^Q\d{8}-E7$/.test(JSON.parse(q.body).reference), JSON.stringify(q));
    check('and says so, including that the deal value was set', /Logged on Sam Rivera's enquiry in the CRM and set as the deal value/.test(await page.getByTestId('quote-msg').innerText()), await page.getByTestId('quote-msg').innerText());
  }
  check('the list was asked for', gets.includes('/'));
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ the CRM link: ?lead=7 opens the design on load
{
  const { page, errors, ctx } = await open({ query: '?embedded=1&lead=7' });
  const p = await project(page);
  check('?lead=7 opens that enquiry\'s design when the planner loads', p.lead?.id === 7 && p.rackType?.id === 'standard-600', JSON.stringify([p.name, p.lead, p.rackType]));
  check('and removes ?lead from the address so a reload does not add it again', !/lead=/.test(page.url()), page.url());
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  const { page, ctx } = await open({ query: '?lead=999' });
  check('an enquiry that cannot be found says so, and the planner still works', /Could not open the enquiry/.test(await page.getByTestId('status').innerText()) && (await page.getByTestId('plan-canvas').count()) === 1);
  await ctx.close();
}

// ================================================================ Vault says no / signed out
for (const [label, opts, want] of [['the feature is off (403)', { leadsStatus: 403 }, /does not have the Cellar Planner feature/], ['not signed in', { signedIn: false }, /not signed in/]]) {
  const { page, errors, ctx } = await open(opts);
  await page.getByTestId('leads-open').click(); await page.waitForTimeout(500);
  check(`${label}: the list explains why there is nothing`, want.test(await page.getByTestId('leads-unavailable').innerText()));
  check(`${label}: no new-count badge`, (await page.getByTestId('leads-new-count').count()) === 0);
  await page.getByTestId('leads-close').click();
  await page.getByTestId('quote-open').click();
  check(`${label}: the quote form still opens and explains it cannot be made`, (await page.getByTestId('quote-blockers').count()) === 1);
  check(`${label}: no script errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
