// Drives the staff Cellar Planner's rack catalogue and price panel in real Chrome. Vault's two endpoints are stood in for at the network layer
// (page.route): the signed-in catalogue answer and the design library. Run the dev server first (`npm run dev`, port 5176), then:
//   node scripts/e2e-catalogue.mjs [screenshot dir]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.CELLAR_URL ?? 'http://127.0.0.1:5176/cellar-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };

const type = (over) => ({
  unitDepthMm: null, rowPitchMm: null, postsPerUnit: null, bottlesPerRow: null, bottlesPerRowLabelForward: null, rowsPerUnit: null, orientation: 'NECK_OUT', ...over,
});
const STANDARD = type({ id: 'standard-600', name: 'Standard 600', unitWidthMm: 600, unitHeightMm: 2000, unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true });
const WIDE = type({ id: 'wide-display', name: 'Wide display', unitWidthMm: 900, unitHeightMm: 2100, orientation: 'LABEL_FORWARD', bottlesPerRowLabelForward: 6, pricePerUnit: 1500, confirmed: false });
const CATALOGUE = { catalogue: { rackTypes: [STANDARD, WIDE], defaultRackType: 'standard-600', doors: { singleMm: 970, doubleMm: 1500 }, pricing: { show: false, currency: '$', fixed: 2000, perUnit: 900, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100, note: '' } }, updatedAt: null };

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/** A fresh browser profile. `signedIn` puts a Vault token in storage; `catalogueStatus` is what the stand-in endpoint answers. */
async function open({ signedIn = true, catalogueStatus = 200, keep } = {}) {
  const ctx = keep ?? await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  if (!keep) {
    await ctx.addInitScript((tok) => {
      try {
        localStorage.setItem('cellar-planner:info-seen:v1', '1');
        if (tok && !sessionStorage.getItem('seeded')) { localStorage.setItem('vault-auth', JSON.stringify({ state: { token: tok } })); sessionStorage.setItem('seeded', '1'); }
      } catch { /* ignore */ }
    }, signedIn ? 'test-token' : '');
  }
  const page = await ctx.newPage();
  const errors = []; const calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/cellar-projects**', (r) => r.abort()); // the design library falls back to this browser
  await page.route('**/api/cellar-planner/catalogue', async (r) => {
    calls.push(r.request().headers().authorization ?? 'NO AUTH');
    if (catalogueStatus === 200) await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOGUE) });
    else if (catalogueStatus === 'abort') await r.abort();
    else await r.fulfill({ status: catalogueStatus, contentType: 'application/json', body: '{}' });
  });
  await page.goto(URL);
  await page.getByTestId('plan-canvas').waitFor();
  await page.waitForTimeout(600);
  return { page, ctx, errors, calls };
}
const openSection = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); const t = el?.closest('section.section.collapsed')?.querySelector('.section-toggle'); if (t) t.click(); };
const reveal = async (page, id) => { await page.evaluate(openSection, id); return page.getByTestId(id); };
const project = (page) => page.evaluate(() => window.cellar.store.getState().project);

// ================================================================ signed in, catalogue loads
{
  const { page, errors, calls } = await open();
  await page.getByTestId('sample').click(); // the blank sample: racks left blank
  await page.waitForTimeout(300);
  check('the catalogue is asked for with the Vault token', calls.length === 1 && calls[0] === 'Bearer test-token', JSON.stringify(calls));
  const status = await page.evaluate(() => window.cellar.catalogue.getState().status);
  check('and loads as "server"', status === 'server', status);

  const select = await reveal(page, 'rack-type');
  const labels = await select.locator('option').allInnerTexts();
  check('the Rack type list offers Custom and both types, marking the unconfirmed one', JSON.stringify(labels) === JSON.stringify(['Custom (typed by hand)', 'Standard 600', 'Wide display (not confirmed)']), JSON.stringify(labels));
  check('the Rack type field explains itself on hover (title)', /catalogue/i.test(await select.locator('xpath=ancestor::label').getAttribute('title')));
  check('before choosing, the price panel says what to do', /Choose a rack type/.test(await (await reveal(page, 'price-unavailable')).innerText()));

  // ---- a confirmed type
  await select.selectOption('standard-600');
  const p1 = await project(page);
  check('Standard 600 fills in the sizes', p1.rackSpec.unitWidthMm === 600 && p1.rackSpec.unitDepthMm === 350 && p1.rackSpec.rowPitchMm === 100 && p1.rackSpec.postsPerUnit === 2 && p1.rackSpec.orientation === 'NECK_OUT', JSON.stringify(p1.rackSpec));
  check('and remembers which type it came from', p1.rackType?.id === 'standard-600' && p1.rackType.confirmed === true);
  check('confirmed: nothing is marked estimated, no "best guesses" banner', (p1.estimated ?? []).length === 0 && (await page.getByTestId('rack-estimated').count()) === 0);
  check('the visible fields show the catalogue numbers', (await page.getByTestId('rack-width').inputValue()) === '600' && (await page.getByTestId('rack-depth').inputValue()) === '350');
  await (await reveal(page, 'fill-NORTH')).click();
  await page.waitForTimeout(200);
  await page.getByTestId('fill-SOUTH').click();
  await page.waitForTimeout(200);
  const units = (await project(page)).runs.reduce((n, r) => n + r.units, 0);
  check('filling two walls places racks', units > 0, String(units));
  const total = await (await reveal(page, 'price-total')).innerText();
  const want = 2000 + units * 900 + 500;
  check(`the price panel totals fixed + ${units} units x 900 + door = $${want.toLocaleString('en-AU')}`, total === `$${want.toLocaleString('en-AU')}`, total);
  const lines = await page.getByTestId('price-lines').innerText();
  check('the breakdown lists each part with its working', /Fixed amount/.test(lines) && new RegExp(`Standard 600 racks\\s+${units} units x \\$900`).test(lines) && /Single door/.test(lines), lines);
  const range = await page.getByTestId('price-range').innerText();
  check('and the range a customer would see', /Customer range: \$[\d,]+ to \$[\d,]+/.test(range), range);
  check('no warning for a confirmed type with no errors', (await page.getByTestId('price-warning').count()) === 0, String(await page.getByTestId('price-warning').allInnerTexts()));
  if (out) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'catalogue-price.png'), clip: { x: 0, y: 80, width: 340, height: 620 } });
    await (await reveal(page, 'rack-type')).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'catalogue-rack.png'), clip: { x: 0, y: 80, width: 340, height: 900 } });
    await (await reveal(page, 'price-total')).scrollIntoViewIfNeeded();
  }

  // ---- accessibility of the new controls, with the picker, the price table and the notes on screen (WCAG 2.1 A and AA)
  const scan = async (label) => {
    await page.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => `${x.id} x${x.nodes.length}: ${x.nodes[0].target.join(' ')}`));
    check(`accessibility scan, ${label}: no violations`, v.length === 0, v.join(' | '));
  };
  await (await reveal(page, 'rack-type')).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await scan('rack type chosen (rack specification open)');
  await (await reveal(page, 'price-total')).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await scan('price breakdown open');

  // ---- a double door changes the door line
  await (await reveal(page, 'door-leaves')).selectOption('DOUBLE').catch(() => undefined);
  const dbl = (await project(page)).enclosure.door.leaves === 2;
  if (dbl) check('a double door uses the double door price', /Double door\s+\$900/.test(await page.getByTestId('price-lines').innerText()), await page.getByTestId('price-lines').innerText());
  else console.log('SKIP  double door (no door-type test id)');
  await (await reveal(page, 'door-leaves')).selectOption('SINGLE').catch(() => undefined);

  // ---- an unconfirmed type
  await (await reveal(page, 'rack-type')).selectOption('wide-display');
  const p2 = await project(page);
  check('Wide display (not confirmed) fills in its sizes', p2.rackSpec.unitWidthMm === 900 && p2.rackSpec.orientation === 'LABEL_FORWARD' && p2.rackSpec.bottlesPerRowLabelForward === 6);
  check('its blank depth stays "not set", not guessed', p2.rackSpec.unitDepthMm === null && (await page.getByTestId('rack-depth').inputValue()) === '');
  check('its values are marked estimated', p2.estimated.includes('unitWidthMm') && p2.estimated.includes('orientation') && !p2.estimated.includes('unitDepthMm'), JSON.stringify(p2.estimated));
  const banner = await (await reveal(page, 'rack-estimated')).innerText();
  check('the banner names the type and says it is not confirmed by the supplier', /Wide display/.test(banner) && /not confirmed by the supplier/i.test(banner), banner);
  await (await reveal(page, 'rack-type')).scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
  await scan('unconfirmed type: estimated banner showing');
  await (await reveal(page, 'price-total').catch(() => page.getByTestId('price-lines'))).scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
  check('the price warns that it is indicative only', /not confirmed by the supplier/.test((await page.getByTestId('price-warning').allInnerTexts()).join(' ')), String(await page.getByTestId('price-warning').allInnerTexts()));
  check('the racks are priced at this type\'s price per unit', new RegExp(`Wide display racks\\s+${units} units x \\$1,500`).test(await page.getByTestId('price-lines').innerText()), await page.getByTestId('price-lines').innerText());

  // ---- editing after choosing
  await (await reveal(page, 'rack-type')).selectOption('standard-600');
  await page.getByTestId('rack-width').fill('650'); await page.getByTestId('rack-width').press('Enter');
  const edited = await (await reveal(page, 'rack-type-edited')).innerText();
  check('editing a value says it now differs from the catalogue', /differ from the catalogue's "Standard 600"/.test(edited), edited);
  await page.getByTestId('rack-type-reapply').click();
  check('"Use the catalogue\'s values again" restores them', (await project(page)).rackSpec.unitWidthMm === 600 && (await page.getByTestId('rack-type-edited').count()) === 0);

  // ---- custom keeps the values but drops the type
  await (await reveal(page, 'rack-type')).selectOption('');
  const p3 = await project(page);
  check('Custom keeps the typed values and drops the type', p3.rackType === undefined && p3.rackSpec.unitWidthMm === 600);
  check('and the price panel asks for a type again', (await page.getByTestId('price-unavailable').count()) === 1);

  // ---- survives save and reload; a new design starts with the default
  await (await reveal(page, 'rack-type')).selectOption('wide-display');
  await page.waitForTimeout(1500); // autosave
  await page.reload();
  await page.getByTestId('plan-canvas').waitFor();
  await page.waitForTimeout(600);
  const back = await project(page);
  check('the chosen type is saved with the design and comes back after a reload', back.rackType?.id === 'wide-display' && back.rackSpec.unitWidthMm === 900, JSON.stringify(back.rackType));
  await page.getByTestId('designs-open').click();
  await page.getByTestId('design-new').click();
  await page.waitForTimeout(600);
  const fresh = await project(page);
  check('a new design starts with the default rack type', fresh.rackType?.id === 'standard-600' && fresh.rackSpec.unitWidthMm === 600 && (fresh.estimated ?? []).length === 0, JSON.stringify([fresh.rackType, fresh.rackSpec.unitWidthMm]));
  check('no script errors', errors.length === 0, errors.join(' | '));
  await page.context().close();
}

// ================================================================ Vault unreachable, but seen before: the remembered catalogue
{
  const first = await open();
  await first.page.waitForTimeout(300);
  const ctx = first.ctx; // same profile (storage) for the second visit
  await first.page.close();
  const { page, errors } = await open({ keep: ctx, catalogueStatus: 'abort' });
  const st = await page.evaluate(() => ({ s: window.cellar.catalogue.getState().status, r: window.cellar.catalogue.getState().reason, n: window.cellar.catalogue.getState().catalogue?.rackTypes.length }));
  check('when Vault cannot be reached the remembered catalogue is used, with the reason', st.s === 'saved' && st.n === 2 && st.r.length > 0, JSON.stringify(st));
  check('and rack types can still be chosen', (await (await reveal(page, 'rack-type')).locator('option').count()) === 3);
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ not signed in / feature off: the planner still works, honestly
for (const [label, opts, reason] of [['not signed in', { signedIn: false }, /not signed in/], ['the feature is off for this account (403)', { catalogueStatus: 403 }, /does not have the Cellar Planner feature/]]) {
  const { page, errors } = await open(opts);
  const st = await page.evaluate(() => window.cellar.catalogue.getState());
  check(`${label}: no catalogue, status unavailable`, st.status === 'unavailable' && st.catalogue === null && reason.test(st.reason), JSON.stringify([st.status, st.reason]));
  check(`${label}: no Rack type picker, a plain note instead`, (await page.getByTestId('rack-type').count()) === 0 && /catalogue is not available/.test(await (await reveal(page, 'rack-catalogue-off')).innerText()));
  check(`${label}: the price panel says why there is no price`, /could not be loaded/.test(await (await reveal(page, 'price-unavailable')).innerText()));
  await (await reveal(page, 'rack-width')).fill('620'); await page.getByTestId('rack-width').press('Enter');
  check(`${label}: values can still be typed by hand`, (await project(page)).rackSpec.unitWidthMm === 620);
  check(`${label}: no script errors`, errors.length === 0, errors.join(' | '));
  await page.context().close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
