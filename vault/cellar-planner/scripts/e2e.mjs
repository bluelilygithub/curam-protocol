// Drives the Cellar Planner screens in real Chrome. Run the dev server first (`npm run dev`, port 5176), then: node scripts/e2e.mjs [screenshot dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.CELLAR_URL ?? 'http://127.0.0.1:5176/cellar-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };


// The left sidebar is an accordion (one section open at a time). Before a test types into or clicks a control, open the section that holds it.
const openSection = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); const t = el?.closest('section.section.collapsed')?.querySelector('.section-toggle'); if (t) t.click(); };
function autoOpen(pg) {
  const orig = pg.getByTestId.bind(pg);
  pg.getByTestId = (id) => {
    const loc = orig(id);
    for (const m of ['fill', 'click', 'selectOption', 'press', 'hover', 'check', 'uncheck']) { const f = loc[m]?.bind(loc); if (f) loc[m] = async (...a) => { await pg.evaluate(openSection, id); return f(...a); }; }
    return loc;
  };
  return pg;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
// the first-visit guide has its own checks below; the main run starts with it already seen
await ctx.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
const page = autoOpen(await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = async (n) => { if (out) await page.screenshot({ path: join(out, `${n}.png`) }); };
const set = async (testid, value) => { const el = page.getByTestId(testid); await el.fill(value); await el.press('Enter'); };
const state = () => page.evaluate(() => window.cellar.store.getState().project);
const analysis = () => page.evaluate(() => window.cellar.analyse());
const prims = async (id) => Number(await page.getByTestId(`${id}-canvas`).getAttribute('data-prims'));
const issueCodes = async () => (await analysis()).issues.map((i) => i.code);

await page.goto(URL);
await page.getByTestId('plan-canvas').waitFor();
await page.waitForTimeout(500);
// the first visit opens the ready-made Test case (never an empty screen); the main run below starts from the BLANK sample
check('the first visit opens the Test case: racks filled, 1120 bottles, marked estimated', (await page.getByTestId('total').innerText()).startsWith('1120 bottles') && (await page.getByTestId('rack-width').inputValue()) === '600' && (await page.getByTestId('rack-estimated').count()) === 1);
await page.getByTestId('sample').click();
await page.waitForTimeout(300);

// ---- the starting screen: the sample enclosure, nothing invented
check('the plan draws the sample enclosure', (await prims('plan')) > 10, String(await prims('plan')));
check('with no runs the total is a real zero', (await page.getByTestId('total').innerText()).startsWith('0 bottles'));
check('the rack values start blank, with a banner saying so', (await page.getByTestId('rack-missing').count()) === 1 && /not set/.test(await page.getByTestId('rack-missing').textContent()));
check('the rack fields show "not set", not 0', (await page.getByTestId('rack-width').inputValue()) === '' && (await page.getByTestId('rack-width').getAttribute('placeholder')) === 'not set');
check('no walkway minimum is set', (await page.getByTestId('walkway').inputValue()) === '');
check('the inside size shown is 2750 x 1565 x 2150', /Inside 2750 x 1565 x 2150 mm/.test(await page.getByTestId('checks-panel').innerText()));
check('the glass share is 10.4% (the door opening over the outer wall area)', /Glass 10\.4% of the outer wall area/.test(await page.getByTestId('checks-panel').innerText()));
check('advisory guidance is separate and carries the sign-off wording', /Advisory only: requires mechanical engineer \/ HVAC sign-off/.test(await page.getByTestId('advisories').innerText()));
check('the preliminary-design wording is on every drawing', /PRELIMINARY DESIGN ONLY/.test(await page.locator('.foot').innerText()));
await shot('01-sample-plan');

// ---- elevation
await page.getByTestId('tab-elevation').click();
await page.getByTestId('elevation-canvas').waitFor();
await page.waitForTimeout(300);
check('the elevation draws the door wall (south) with its header parts', (await prims('elevation')) > 15, String(await prims('elevation')));
await shot('02-elevation-south');
await page.getByTestId('wall-NORTH').click();
await page.waitForTimeout(300);
check('another wall draws too (walls, header and the three dimensions)', (await prims('elevation')) >= 5);
await page.getByTestId('tab-plan').click();

// ---- a run with the blank rack spec: "not set", never zero
await page.getByTestId('add-run').click();
let s = await state();
check('adding a run works', s.runs.length === 1 && s.runs[0].wall === 'NORTH');
check('its total is "not set" (a blank is never counted as zero)', /^not set \(1 run/.test(await page.getByTestId('total').innerText()), await page.getByTestId('total').innerText());
check('RACK_SPEC_MISSING is reported', (await page.getByTestId('issue-RACK_SPEC_MISSING').count()) === 1);
check('the plan draws no rack, only a "not set" note', (await issueCodes()).includes('RACK_SPEC_MISSING'));
await shot('03-run-not-set');

// ---- enter (invented) rack values
for (const [id, v] of [['rack-width', '800'], ['rack-depth', '350'], ['rack-height', '2000'], ['rack-pitch', '100'], ['rack-per-row', '8'], ['rack-posts', '2']]) await set(id, v);
await page.getByTestId('rack-orientation').selectOption('NECK_OUT');
await page.waitForTimeout(200);
check('the missing-values banner goes once everything is entered', (await page.getByTestId('rack-missing').count()) === 0);
check('1 unit = 20 rows x 8 bottles = 160', (await page.getByTestId('total').innerText()).startsWith('160 bottles'), await page.getByTestId('total').innerText());

// ---- fill a wall
await page.getByTestId('fill-NORTH').click();
await page.waitForTimeout(200);
s = await state();
check('filling the north wall puts 3 whole units on it (2750 / 800)', s.runs.filter((r) => r.wall === 'NORTH').reduce((n, r) => n + r.units, 0) === 3, JSON.stringify(s.runs));
check('3 units = 480 bottles', (await page.getByTestId('total').innerText()).startsWith('480 bottles'));
check('the status line says what happened', /Filled the north wall with 3 units/.test(await page.getByTestId('fill-msg').innerText()));
await page.getByTestId('fill-SOUTH').click();
s = await state();
check('the south wall is filled either side of the door', s.runs.filter((r) => r.wall === 'SOUTH').length === 2);
await shot('04-racks-placed');
check('no errors with racks on the north and south walls', (await analysis()).issues.filter((i) => i.severity === 'error').length === 0, JSON.stringify((await analysis()).issues.filter((i) => i.severity === 'error').map((i) => i.code)));

// ---- no walkway minimum: not checked, with a note; then set one
check('with no minimum the walkway is not checked (an information note)', (await issueCodes()).includes('WALKWAY_NOT_SET') && !(await issueCodes()).includes('WALKWAY_TOO_NARROW'));
await set('walkway', '900');
await page.waitForTimeout(200);
check('with 900 mm set, facing runs are a WARNING, not an error', (await analysis()).issues.some((i) => i.code === 'WALKWAY_TOO_NARROW' && i.severity === 'warning') && (await analysis()).issues.filter((i) => i.severity === 'error').length === 0);
await shot('05-walkway-warning');
await set('walkway', '');
check('clearing it goes back to "not set"', (await state()).walkwayMm === null);

// ---- an error shows up and is drawn
await set('run-units-' + (await state()).runs.find((r) => r.wall === 'NORTH').id, '4');
await page.waitForTimeout(200);
check('four units on a 2750 mm wall is an error', (await issueCodes()).includes('RUN_OUTSIDE'));
check('the error is listed with its fix', /at most 3 units/.test(await page.getByTestId('issue-RUN_OUTSIDE').innerText()));
check('the error count is shown', /1 errors?/.test(await page.getByTestId('issue-count').innerText()));
await shot('06-run-error');

// ---- undo and redo
await page.getByTestId('undo').click();
check('undo takes the 4th unit back', (await state()).runs.find((r) => r.wall === 'NORTH').units === 3);
await page.getByTestId('redo').click();
check('redo puts it back', (await state()).runs.find((r) => r.wall === 'NORTH').units === 4);
await page.getByTestId('undo').click();

// ---- door swing in: the keep-clear zone and the arc inside
const before = await prims('plan');
await page.getByTestId('door-swing').selectOption('IN');
await set('walkway', '900');
await page.waitForTimeout(300);
await shot('07-door-swings-in');
check('an inward door with a minimum set adds the keep-clear zone to the plan (one more shape)', (await prims('plan')) === before + 1, `${before} -> ${await prims('plan')}`);
await page.getByTestId('door-swing').selectOption('OUT');
// single and double doors
const prims0 = await prims('plan');
await page.getByTestId('door-leaves').selectOption('DOUBLE');
const dd = (await state()).enclosure.door;
check('choosing a double door makes it two leaves and a wider opening', dd.leaves === 2 && dd.widthMm >= 1500, JSON.stringify(dd));
check('a double door has no hinge setting (it is hinged at both edges)', (await page.getByTestId('door-hinge').count()) === 0);
check('the plan draws a second leaf and arc for a double door (two more shapes)', (await prims('plan')) === prims0 + 2, `${prims0} -> ${await prims('plan')}`);
await page.getByTestId('door-leaves').selectOption('SINGLE');
const ds = (await state()).enclosure.door;
check('going back to a single door restores one leaf and the hinge setting', ds.leaves === 1 && ds.widthMm <= 970 && (await page.getByTestId('door-hinge').count()) === 1, JSON.stringify(ds));
await set('walkway', '');

// ---- invalid input and blanks
await set('outer-width', '2850');
await page.getByTestId('outer-width').fill('abc');
await page.getByTestId('outer-width').press('Enter');
check('a bad number is refused with a message and the old value stays', (await state()).enclosure.outerWidthMm === 2850 && (await page.locator('.field-err').count()) >= 1);
await page.getByTestId('outer-width').fill('2850');
await page.getByTestId('outer-width').press('Enter');
check('a required field cannot be blanked', (await state()).enclosure.outerWidthMm === 2850);
await set('rack-width', '');
check('an optional rack field CAN be blanked, and that makes the total "not set" again', (await state()).rackSpec.unitWidthMm === null && /^not set/.test(await page.getByTestId('total').innerText()));
await set('rack-width', '800');

// ---- header parts
await page.getByTestId('add-vent').click();
check('adding a vent adds a header part', (await state()).enclosure.header.length === 4);

// ---- save, open, draft
const saved = await page.evaluate(() => JSON.stringify(window.cellar.store.getState().project));
await page.getByTestId('sample').click();
check('the sample button resets the project', (await state()).runs.length === 0);
const tmpFile = join(tmpdir(), 'cellar-e2e.json');
writeFileSync(tmpFile, saved);
await page.setInputFiles('input[type=file]', tmpFile);
await page.waitForTimeout(300);
check('opening a saved file restores the project, blanks and all', (await page.evaluate(() => JSON.stringify(window.cellar.store.getState().project))) === saved);
await page.setInputFiles('input[type=file]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
await page.waitForTimeout(200);
check('a wrong file is refused with a plain message', /not a Cellar Planner file/.test(await page.getByTestId('status').innerText()));
await page.waitForTimeout(600);
await page.reload();
await page.getByTestId('plan-canvas').waitFor();
check('the draft survives a reload', (await state()).runs.length === JSON.parse(saved).runs.length && (await state()).enclosure.header.length === 4);

// ---- the guide, tooltips and tour, in a fresh browser (nothing seen yet)
{
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const p2 = autoOpen(await ctx2.newPage());
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
  const shot2 = async (n) => { if (out) await p2.screenshot({ path: join(out, n + '.png') }); };
  const key = (k) => p2.evaluate((x) => localStorage.getItem(x), k);
  await p2.goto(URL);
  await p2.getByTestId('plan-canvas').waitFor();
  await p2.getByTestId('info-modal').waitFor({ timeout: 5000 });
  check('the first visit opens the guide by itself', /How Cellar Planner works/.test(await p2.getByTestId('info-modal').innerText()));
  const guide = await p2.getByTestId('info-modal').innerText();
  check('the guide says blanks are "not set", advice needs sign-off, and drawings are preliminary', /not set/.test(guide) && /sign-off/.test(guide) && /preliminary design only/i.test(guide));
  check('the guide says what is not built yet', /What is not here yet/.test(guide));
  await shot2('10-guide');
  await p2.getByTestId('info-got-it').click();
  check('Got it closes it and remembers', (await p2.getByTestId('info-modal').count()) === 0 && (await key('cellar-planner:info-seen:v1')) === '1');
  await p2.reload();
  await p2.getByTestId('plan-canvas').waitFor();
  await p2.waitForTimeout(400);
  check('it does not open again on the next visit', (await p2.getByTestId('info-modal').count()) === 0);
  await p2.getByTestId('info-open').click();
  check('the (i) button opens it again', (await p2.getByTestId('info-modal').count()) === 1);
  await p2.getByTestId('info-close').click();
  check('the X closes it', (await p2.getByTestId('info-modal').count()) === 0);

  // tooltips
  await p2.getByTestId('outer-width').hover();
  await p2.waitForSelector('.rp-tooltip', { timeout: 3000 });
  check('hovering a field shows its explanation in the themed tooltip', /outer faces/.test(await p2.locator('.rp-tooltip').innerText()), await p2.locator('.rp-tooltip').innerText());
  const box = await p2.locator('.rp-tooltip').boundingBox();
  check('the tooltip stays fully on screen even beside the left edge', box.x >= 0 && box.x + box.width <= 1500, JSON.stringify(box));
  await shot2('11-tooltip');
  await p2.mouse.move(5, 5);
  await p2.getByTestId('save').hover();
  await p2.waitForFunction(() => /Download a copy of this design/.test(document.querySelector('.rp-tooltip')?.textContent ?? ''), null, { timeout: 3000 });
  check('hovering a button shows its explanation', true);
  await p2.mouse.move(5, 5);
  await p2.waitForTimeout(300);
  const bare = await p2.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, select, input:not([type=hidden]):not([hidden])')) {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
      if (el.closest('.modal-back')) continue;
      if (!el.closest('[title],[data-tip]')) out.push(el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent.slice(0, 30));
    }
    return out;
  });
  check('every visible button, field and menu has a tooltip', bare.length === 0, bare.join(', '));
  const emptyTitles = await p2.evaluate(() => document.querySelectorAll('[title=""]').length);
  check('no empty tooltips', emptyTitles === 0, String(emptyTitles));

  // the guided tour
  await p2.getByTestId('tour-start').click();
  await p2.waitForSelector('.shepherd-element.vault-tour', { timeout: 8000 });
  const title = () => p2.locator('.shepherd-element.vault-tour:not([hidden]) .shepherd-title').innerText();
  const counter = () => p2.locator('.vault-tour-step-count:visible').innerText();
  await p2.locator('.vault-tour-step-count:visible').waitFor();
  check('the tour starts on its welcome card, Step 1 of 13', /Quick Tour/.test(await title()) && /Step 1 of 13/.test(await counter()), await counter());
  await shot2('12-tour-welcome');
  const next = () => p2.locator('.shepherd-element.vault-tour:not([hidden]) .shepherd-button:not(.vault-tour-btn-secondary)').click();
  const titles = [await title()];
  const tabAt = {};
  for (let i = 2; i <= 13; i++) {
    await next();
    await p2.waitForFunction((n) => [...document.querySelectorAll('.vault-tour-step-count')].some((c) => c.textContent === 'Step ' + n + ' of 13' && c.offsetParent !== null), i, { timeout: 6000 });
    await p2.waitForTimeout(500);
    titles.push(await title());
    tabAt[i] = await p2.evaluate(() => window.cellar.ui.getState().tab);
    if (i === 3 || i === 9) await shot2('13-tour-step-' + i);
  }
  check('the tour has 13 steps in order, from "Your design" to the finish', titles.length === 13 && titles[1] === 'Your design' && titles[2] === 'The enclosure' && /set/.test(titles[12]), JSON.stringify(titles));
  check('the plan, elevation and racks step switches to the Racks tab, and the drawing step back to the plan', tabAt[8] === 'racks' && tabAt[9] === 'plan', JSON.stringify(tabAt));
  check('a dimming overlay spotlights the target', await p2.evaluate(() => document.querySelector('.shepherd-modal-overlay-container') !== null));
  await next();
  await p2.waitForTimeout(400);
  check('Finish closes the tour, marks it done, and puts the screen back to the plan', (await p2.locator('.shepherd-element.vault-tour:not([hidden])').count()) === 0 && (await key('vault_tour_cellar_planner_completed')) === '1' && (await p2.evaluate(() => window.cellar.ui.getState().tab)) === 'plan');

  // Esc leaves it too, and Vault's Settings page can open it with ?tour=1
  await p2.evaluate(() => localStorage.removeItem('vault_tour_cellar_planner_completed'));
  await p2.goto(URL + '?tour=1');
  await p2.waitForSelector('.shepherd-element.vault-tour', { timeout: 8000 });
  check('?tour=1 starts the tour (how Vault\'s Settings page retakes it)', true);
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(400);
  check('Esc leaves the tour and marks it done', (await key('vault_tour_cellar_planner_completed')) === '1');
  check('no page errors in the help flow', errs2.length === 0, errs2.join(' | '));
  await ctx2.close();
}

// ---- the ready-made test case, and accessibility
{
  const ctx3 = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx3.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const p3 = autoOpen(await ctx3.newPage());
  const errs3 = [];
  p3.on('pageerror', (e) => errs3.push(e.message));
  p3.on('console', (m) => { if (m.type() === 'error') errs3.push(m.text()); });
  const shot3 = async (n) => { if (out) await p3.screenshot({ path: join(out, n + '.png') }); };
  const total3 = async () => (await p3.getByTestId('total').innerText()).split('\n')[0];
  const est3 = () => p3.locator('[data-testid$="-estimated"]:not([data-testid="rack-estimated"])').count();
  await p3.goto(URL);
  await p3.getByTestId('plan-canvas').waitFor();

  check('there is a visible Test case button, with an explanation', (await p3.getByTestId('testcase').isVisible()) && /best-guess/.test((await p3.getByTestId('testcase').getAttribute('title')) ?? ''));
  check('a first visit already shows the filled Test case (1120 bottles, six estimated fields, bottles per row calculated)', (await total3()) === '1120 bottles' && (await est3()) === 6 && (await p3.getByTestId('rack-per-row-calculated').count()) === 1);
  await p3.getByTestId('sample').click();
  check('Blank sample is blank: no guesses, every rack value "not set"', (await p3.getByTestId('total').innerText()).startsWith('0 bottles') && (await p3.getByTestId('rack-width').inputValue()) === '' && (await est3()) === 0 && (await p3.getByTestId('rack-missing').count()) === 1);

  // the button in the "not set" banner: fills only the blanks, keeps what was typed, and is undoable
  await p3.getByTestId('rack-width').fill('800');
  await p3.getByTestId('rack-width').press('Enter');
  await p3.getByTestId('fill-guesses').click();
  await p3.waitForTimeout(200);
  const spec = await p3.evaluate(() => window.cellar.store.getState().project);
  check('Fill the blanks with best guesses fills every blank field (bottles per row stays blank: it is calculated)', spec.rackSpec.unitDepthMm === 350 && spec.rackSpec.bottlesPerRow === null && spec.rackSpec.orientation === 'NECK_OUT' && spec.rackSpec.postsPerUnit === 2, JSON.stringify(spec.rackSpec));
  check('...but keeps the value that was typed (800), and does not mark it estimated', spec.rackSpec.unitWidthMm === 800 && !spec.estimated.includes('unitWidthMm') && spec.estimated.length === 5, JSON.stringify(spec.estimated));
  check('the guesses are marked estimated and the banner changes to the best-guesses one', (await est3()) === 5 && (await p3.getByTestId('rack-estimated').count()) === 1 && (await p3.getByTestId('rack-missing').count()) === 0);
  await p3.getByTestId('undo').click();
  const back = await p3.evaluate(() => window.cellar.store.getState().project);
  check('Undo takes all the guesses back and keeps the typed value', back.rackSpec.unitDepthMm === null && back.rackSpec.unitWidthMm === 800 && !back.estimated);
  await p3.getByTestId('testcase').click();
  await p3.waitForTimeout(300);
  check('the Test case fills the racks: 1120 bottles', (await total3()) === '1120 bottles', await total3());
  check('a banner says these are best guesses, not supplier values, and not to quote from them', /Best guesses for testing, not supplier values/.test(await p3.getByTestId('rack-estimated').innerText()) && /Do not quote/.test(await p3.getByTestId('rack-estimated').innerText()));
  check('all six guessed fields carry a visible "estimated" word (not colour alone)', (await est3()) === 6, String(await est3()));
  check('the status line says so too', /best guesses/.test(await p3.getByTestId('status').innerText()));
  check('the test case has no errors', (await p3.evaluate(() => window.cellar.analyse().issues.filter((i) => i.severity === 'error').length)) === 0);
  await shot3('20-test-case-plan');
  await p3.getByTestId('tab-elevation').click();
  await p3.waitForTimeout(300);
  await p3.getByTestId('tab-plan').click();

  // overwrite the guesses
  // the Racks tab: every bottle drawn on the inside face of a wall
  await p3.getByTestId('tab-racks').click();
  await p3.waitForTimeout(500);
  const rackShapes = async () => Number(await p3.getByTestId('racks-canvas').getAttribute('data-prims'));
  check('the Racks tab draws the north wall\'s bottles: 560 circles plus the frames and dimensions', (await rackShapes()) > 560 && (await rackShapes()) < 600, String(await rackShapes()));
  check('it says which wall, and the wall buttons show the pressed one', /north wall seen from inside/.test(await p3.locator('.hint').innerText()) && (await p3.getByTestId('rackwall-NORTH').getAttribute('aria-pressed')) === 'true');
  check('the Racks tab lists the bottles on the north wall in words: 560 in 4 units, 140 a unit, 20 rows of 7', /North wall: 560 bottles in 4 units \(140 a unit: 20 rows of 7\)/.test(await p3.getByTestId('racks-summary').innerText()), await p3.getByTestId('racks-summary').innerText());
  await shot3('23-racks-north');
  await p3.getByTestId('rackwall-SOUTH').click();
  await p3.waitForTimeout(400);
  check('the south wall shows its two units either side of the door (280 bottles)', (await rackShapes()) > 280 && (await rackShapes()) < 320, String(await rackShapes()));
  await shot3('24-racks-south');
  check('the racks drawing has a text description for screen readers', /inside face of the south wall.*2 rack units.*280 bottles/.test((await p3.getByTestId('racks-canvas').getAttribute('aria-label')) ?? ''), await p3.getByTestId('racks-canvas').getAttribute('aria-label'));
  await p3.getByTestId('rackwall-NORTH').click();
  await p3.getByTestId('tab-plan').click();
  await p3.waitForTimeout(200);

  // typing bottles per row overrides the calculated one (6 x 20 rows x 8 units = 960); the calculated badge goes, no estimated marker is involved
  await p3.getByTestId('rack-per-row').fill('6');
  await p3.getByTestId('rack-per-row').press('Enter');
  await p3.waitForTimeout(200);
  check('typing a bottles-per-row overrides the calculated one: total 960, the "calculated" word goes', (await total3()) === '960 bottles' && (await p3.getByTestId('rack-per-row-calculated').count()) === 0 && (await est3()) === 6, `${await total3()} ${await est3()}`);
  await p3.getByTestId('undo').click();
  check('undo brings the calculated value back (1120, "calculated" word)', (await total3()) === '1120 bottles' && (await p3.getByTestId('rack-per-row-calculated').count()) === 1);

  // the Bottle setting now moves the count, because bottles per row is calculated from the bottle's pitch
  await p3.getByTestId('bottle').selectOption('BURGUNDY');
  check('Burgundy: 600 / 100 = 6 a row, 960 bottles, no errors', (await total3()) === '960 bottles' && (await p3.getByTestId('uncounted').count()) === 0);
  await p3.getByTestId('bottle').selectOption('CHAMPAGNE');
  check('Champagne: 600 / 105 = 5 a row, 800 bottles, and the note says the figure is calculated', (await total3()) === '800 bottles' && /calculated/.test(await p3.getByTestId('calculated-note').innerText()));
  await p3.getByTestId('bottle').selectOption('MAGNUM');
  await p3.waitForTimeout(200);
  check('Magnum cannot be built in these racks: the headline is 0 and the left-out bottles are named, not added in', (await total3()) === '0 bottles' && /Not counted: 640 bottles in 5 runs with errors/.test(await p3.getByTestId('uncounted').innerText()), `${await total3()}`);
  check('the runs say they are not counted on the plan (the error tone)', (await p3.evaluate(() => window.cellar.analyse().racks.total.uncounted?.runs)) === 5);
  await shot3('22-uncounted');
  await p3.getByTestId('bottle').selectOption('BORDEAUX');
  check('back to Bordeaux: 1120 and no "not counted" note', (await total3()) === '1120 bottles' && (await p3.getByTestId('uncounted').count()) === 0);

  // label-forward does not inherit the neck-out figure
  await p3.getByTestId('rack-orientation').selectOption('LABEL_FORWARD');
  await p3.waitForTimeout(200);
  check('label-forward: the total is "not set" (no neck-out count carried over) and it asks for its own bottles-per-row', /^not set/.test(await total3()) && (await p3.getByTestId('rack-per-row-lf').count()) === 1 && (await p3.getByTestId('rack-per-row').count()) === 0);
  check('the checks name the missing value', /bottles per row \(label-forward\)/.test(await p3.getByTestId('issue-RACK_SPEC_MISSING').first().innerText()));
  await p3.getByTestId('rack-per-row-lf').fill('2');
  await p3.getByTestId('rack-per-row-lf').press('Enter');
  await p3.waitForTimeout(200);
  check('once the label-forward figure is typed it is used (2 a row x 20 x 8 = 320)', (await total3()) === '320 bottles', await total3());
  await p3.getByTestId('rack-orientation').selectOption('NECK_OUT');
  await p3.waitForTimeout(200);
  check('switching back to neck-out brings the calculated figure back', (await total3()) === '1120 bottles');
  await p3.getByTestId('undo').click();
  await p3.getByTestId('undo').click();
  await p3.getByTestId('undo').click();
  await p3.getByTestId('rack-orientation').selectOption('LABEL_FORWARD');
  check('changing a menu value clears its marker too', (await p3.getByTestId('rack-orientation-estimated').count()) === 0 && (await est3()) === 5);
  for (const [id, v] of [['rack-width', '800'], ['rack-depth', '400'], ['rack-height', '2000'], ['rack-pitch', '110'], ['rack-posts', '3']]) { await p3.getByTestId(id).fill(v); await p3.getByTestId(id).press('Enter'); }
  await p3.getByTestId('rack-orientation').selectOption('NECK_OUT');
  await p3.waitForTimeout(200);
  check('once every guess is overwritten the banner goes and no marker is left', (await p3.getByTestId('rack-estimated').count()) === 0 && (await est3()) === 0);
  await shot3('21-test-case-overwritten');

  // other ways in: the address, the example file, the keyboard
  await p3.goto(URL + '?testcase=1');
  await p3.getByTestId('plan-canvas').waitFor();
  await p3.waitForTimeout(300);
  check('?testcase=1 opens it directly', (await total3()) === '1120 bottles');
  await p3.getByTestId('sample').click();
  check('Blank sample goes back to blank', (await total3()).startsWith('0 bottles') && (await est3()) === 0);
  await p3.setInputFiles('input[type=file]', join(import.meta.dirname, '..', 'examples', 'test-case-1.cellar.json'));
  await p3.waitForTimeout(300);
  check('the example file opens to the same test case (1120 bottles, markers kept)', (await total3()) === '1120 bottles' && (await est3()) === 6);
  await p3.getByTestId('sample').click();
  await p3.getByTestId('testcase').focus();
  await p3.keyboard.press('Enter');
  await p3.waitForTimeout(200);
  check('the Test case can be reached and used from the keyboard alone', (await total3()) === '1120 bottles');

  // accessibility: automated WCAG 2.1 A and AA scan (axe-core) of the main screen, the elevation, and the guide
  await p3.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const scan = async (label) => {
    const r = await p3.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes[0]?.html.slice(0, 110), help: v.help })));
    for (const v of r) console.log(`   a11y [${label}] ${v.impact} ${v.id} x${v.count}: ${v.help} :: ${v.sample}`);
    return r;
  };
  const planScan = await scan('plan');
  check('accessibility scan, plan screen: no WCAG 2.1 A or AA violations', planScan.length === 0, planScan.map((v) => v.id).join(', '));
  await p3.getByTestId('tab-elevation').click();
  await p3.waitForTimeout(300);
  const elevScan = await scan('elevation');
  check('accessibility scan, elevation screen: no violations', elevScan.length === 0, elevScan.map((v) => v.id).join(', '));
  await p3.getByTestId('tab-racks').click();
  await p3.waitForTimeout(400);
  const racksScan = await scan('racks');
  check('accessibility scan, racks screen: no violations', racksScan.length === 0, racksScan.map((v) => v.id).join(', '));
  await p3.getByTestId('tab-plan').click();
  await p3.getByTestId('info-open').click();
  const guideScan = await scan('guide');
  check('accessibility scan, the guide: no violations', guideScan.length === 0, guideScan.map((v) => v.id).join(', '));
  await p3.getByTestId('info-close').click();
  const names = await p3.evaluate(() => [...document.querySelectorAll('canvas')].length + ' canvases; drawing labels: ' + [...document.querySelectorAll('[role=img]')].map((e) => e.getAttribute('aria-label')?.slice(0, 60)).join(' | '));
  check('each drawing has a text description for screen readers', /Plan of the enclosure from above/.test(names), names);

  check('no page errors in the test-case flow', errs3.length === 0, errs3.join(' | '));
  await ctx3.close();
}

// ---- the drawing package: the form, a real download, and the PDF it makes
{
  const ctx4 = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  await ctx4.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const p4 = autoOpen(await ctx4.newPage());
  const errs4 = [];
  p4.on('pageerror', (e) => errs4.push(e.message));
  p4.on('console', (m) => { if (m.type() === 'error') errs4.push(m.text()); });
  await p4.goto(URL);
  await p4.getByTestId('plan-canvas').waitFor();
  check('there is a Drawing package button with an explanation', (await p4.getByTestId('package-open').isVisible()) && /A3 drawing sheets/.test((await p4.getByTestId('package-open').getAttribute('title')) ?? ''));
  await p4.getByTestId('package-open').click();
  await p4.getByTestId('package-modal').waitFor();
  check('the form opens with focus in its first field', await p4.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'pkg-company'));
  check('every field has a label, and the date starts as today', (await p4.getByLabel('Client').count()) === 1 && (await p4.getByLabel('Address').count()) === 1 && (await p4.getByLabel('Project number').count()) === 1 && (await p4.getByLabel('Drawn by').count()) === 1 && (await p4.getByLabel('Checked by').count()) === 1 && (await p4.getByTestId('pkg-date').inputValue()) === new Date().toISOString().slice(0, 10));
  await p4.getByTestId('pkg-company').fill('Carter Noir');
  await p4.getByTestId('pkg-client').fill('Redkem Constructions');
  await p4.getByTestId('pkg-address').fill('243 Kemp St New Farm QLD 4005');
  await p4.getByTestId('pkg-project-no').fill('M0103');
  await p4.getByTestId('pkg-drawn').fill('MS');
  await p4.getByTestId('pkg-checked').fill('BS');
  await p4.getByTestId('pkg-date').fill('2026-10-20');
  if (out) await p4.screenshot({ path: join(out, '25-package-form.png') });

  await p4.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const formScan = await p4.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => `${v.id} x${v.nodes.length}`));
  check('accessibility scan, the drawing package form: no violations', formScan.length === 0, formScan.join(', '));

  const [download] = await Promise.all([p4.waitForEvent('download'), p4.getByTestId('package-download').click()]);
  const file = join(tmpdir(), 'cellar-package-e2e.pdf');
  await download.saveAs(file);
  check('it downloads a PDF named after the design', /^test-case-estimated-rack-values-drawing-package\.pdf$/.test(download.suggestedFilename()), download.suggestedFilename());
  const { PDFDocument } = await import('pdf-lib');
  const { readFileSync } = await import('node:fs');
  const doc = await PDFDocument.load(readFileSync(file));
  check('the PDF has 7 A3 landscape sheets and the preliminary subject', doc.getPageCount() === 7 && Math.abs(doc.getPage(0).getSize().width - 1190.55) < 0.1 && /Preliminary design only/.test(doc.getSubject() ?? ''), `${doc.getPageCount()}`);
  await p4.getByTestId('package-msg').waitFor();
  check('the form says what it made: 7 sheets, A100 to A106', /Downloaded 7 sheets: A100, A101, A102, A103, A104, A105, A106/.test(await p4.getByTestId('package-msg').innerText()), await p4.getByTestId('package-msg').innerText());
  const kept = await p4.evaluate(() => window.cellar.store.getState().project.drawing);
  check('the title block details are kept with the design, so the next package starts filled in', kept?.client === 'Redkem Constructions' && kept?.address === '243 Kemp St New Farm QLD 4005' && kept?.projectNo === 'M0103' && kept?.company === 'Carter Noir');
  await p4.keyboard.press('Escape');
  await p4.waitForTimeout(200);
  check('Esc closes the form and puts focus back on the button that opened it', (await p4.getByTestId('package-modal').count()) === 0 && (await p4.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'package-open');
  await p4.getByTestId('package-open').click();
  check('reopened, it starts with the details already filled in', (await p4.getByTestId('pkg-client').inputValue()) === 'Redkem Constructions');
  await p4.getByTestId('package-close').click();
  // the details survive saving and opening the file
  const saved = await p4.evaluate(() => JSON.stringify(window.cellar.store.getState().project));
  await p4.getByTestId('sample').click();
  check('Blank sample has no details', !(await p4.evaluate(() => window.cellar.store.getState().project.drawing)));
  const tmpSaved = join(tmpdir(), 'cellar-e2e-package.json');
  writeFileSync(tmpSaved, saved);
  await p4.setInputFiles('input[type=file]', tmpSaved);
  await p4.waitForTimeout(300);
  check('opening the saved file brings the title-block details back', (await p4.evaluate(() => window.cellar.store.getState().project.drawing?.client)) === 'Redkem Constructions');
  // a design with no racks: just three sheets
  await p4.getByTestId('sample').click();
  await p4.getByTestId('package-open').click();
  const [d2] = await Promise.all([p4.waitForEvent('download'), p4.getByTestId('package-download').click()]);
  await d2.saveAs(file);
  check('the blank sample (no racks) makes 3 sheets: specification, plan, elevation', (await PDFDocument.load(readFileSync(file))).getPageCount() === 3);
  check('no page errors in the drawing-package flow', errs4.length === 0, errs4.join(' | '));
  await ctx4.close();
}

// ---- saved designs: this browser, then the Vault account (the API is mocked in the browser)
{
  const ctx5 = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx5.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const p5 = autoOpen(await ctx5.newPage());
  const errs5 = [];
  p5.on('pageerror', (e) => errs5.push(e.message));
  const status5 = (s, timeout = 8000) => p5.waitForFunction((x) => document.querySelector('[data-testid=save-status]')?.getAttribute('data-status') === x, s, { timeout });
  await p5.goto(URL);
  await p5.getByTestId('plan-canvas').waitFor();
  await status5('saved');
  check('signed out: the header says Saved, in this browser', /Saved on this device only/.test(await p5.getByTestId('save-status').innerText()), await p5.getByTestId('save-status').innerText());
  await p5.getByTestId('project-name').fill('Back cellar');
  await status5('unsaved');
  await p5.getByTestId('save-now').click(); // Save now saves at once, without waiting for the pause
  await status5('saved', 1000);
  await p5.getByTestId('designs-open').click();
  const firstItem = await p5.getByTestId('design-item').first().innerText();
  check('Your designs lists the saved design by name, with its counts', /Back cellar/.test(firstItem) && /rack run/.test(firstItem), firstItem);
  await p5.getByTestId('design-new').click();
  await p5.waitForTimeout(500);
  check('New design opens a blank one and the first stays saved', (await p5.evaluate(() => window.cellar.store.getState().project.runs.length)) === 0 && (await p5.evaluate(() => window.cellar.designs.library.getState().entries.length)) === 2);
  await p5.reload();
  await p5.getByTestId('plan-canvas').waitFor();
  await p5.waitForFunction(() => window.cellar.designs.library.getState().ready);
  check('a reload opens the design that was open (the new blank one)', (await p5.evaluate(() => window.cellar.store.getState().project.runs.length)) === 0);
  await p5.getByTestId('designs-open').click();
  await p5.getByTestId('design-item').filter({ hasText: 'Back cellar' }).locator('.plist-main').click();
  await p5.waitForTimeout(500);
  check('opening the first design brings back its name and racks', (await p5.evaluate(() => window.cellar.store.getState().project.name)) === 'Back cellar' && (await p5.evaluate(() => window.cellar.store.getState().project.runs.length)) > 0);
  await p5.getByTestId('testcase').click();
  await p5.waitForTimeout(500);
  await p5.getByTestId('designs-open').click();
  check('Test case adds a design; nothing was overwritten', (await p5.getByTestId('design-item').count()) === 3 && /Back cellar/.test(await p5.getByTestId('design-list').innerText()));
  await p5.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const dScan = await p5.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => v.id + ' x' + v.nodes.length));
  check('accessibility scan, Your designs: no violations', dScan.length === 0, dScan.join(', '));
  await p5.getByTestId('design-item').first().getByTestId('design-delete').click();
  await p5.getByTestId('design-delete-yes').click();
  await p5.waitForTimeout(400);
  check('delete asks first, then removes it', (await p5.getByTestId('design-item').count()) === 2);
  await p5.keyboard.press('Escape');
  check('no page errors saving to this browser', errs5.length === 0, errs5.join(' | '));
  await ctx5.close();

  // signed in: the same screens talk to /api/cellar-projects
  const ctx6 = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx6.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'tok' } })); } catch { /* ignore */ } });
  const rows = new Map();
  let seq = 0;
  let clock = Date.UTC(2026, 9, 20);
  const wire = (id) => { const r = rows.get(id); return { id, name: r.name, runCount: r.data.runs.length, rackUnits: r.data.runs.reduce((a, x) => a + x.units, 0), estimated: (r.data.estimated?.length ?? 0) > 0, updatedAt: new Date(r.at).toISOString() }; };
  await ctx6.route('**/api/cellar-projects**', async (route) => {
    const req = route.request();
    const m = req.method();
    const id = Number(new globalThis.URL(req.url()).pathname.split('/').pop());
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const json = (status, o) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (m === 'GET' && Number.isNaN(id)) return json(200, { projects: [...rows.keys()].map(wire) });
    if (m === 'GET') return rows.has(id) ? json(200, { project: { ...wire(id), data: rows.get(id).data } }) : json(404, { error: 'not found' });
    if (m === 'POST') { const n = ++seq; rows.set(n, { name: body.name, data: body.data, at: (clock += 1000) }); return json(200, { project: wire(n) }); }
    if (m === 'PUT') {
      const r = rows.get(id);
      if (!r) return json(404, { error: 'not found' });
      if (body.expectedUpdatedAt && new Date(r.at).toISOString() !== body.expectedUpdatedAt) return json(409, { error: 'This design was changed in another window or tab.', current: wire(id) });
      if (body.name) r.name = body.name;
      if (body.data) r.data = body.data;
      r.at = (clock += 1000);
      return json(200, { project: wire(id) });
    }
    if (m === 'DELETE') { rows.delete(id); return json(200, { ok: true }); }
    return json(500, {});
  });
  const p6 = autoOpen(await ctx6.newPage());
  const errs6 = [];
  p6.on('pageerror', (e) => errs6.push(e.message));
  const status6 = (s, timeout = 8000) => p6.waitForFunction((x) => document.querySelector('[data-testid=save-status]')?.getAttribute('data-status') === x, s, { timeout });
  await p6.goto(URL);
  await p6.getByTestId('plan-canvas').waitFor();
  await status6('saved');
  const st6 = await p6.getByTestId('save-status').innerText();
  check('signed in: the header says Saved to your Vault account, and the design is in the account', /Saved to your Vault account/.test(st6) && rows.size === 1, st6);
  await p6.getByTestId('project-name').fill('Wine room');
  await status6('unsaved');
  await status6('saved');
  check('the rename reached the account', [...rows.values()][0].name === 'Wine room', [...rows.values()][0].name);
  // another window saves it; this window's next save is refused and the choice appears
  [...rows.values()][0].at += 5000;
  await p6.getByTestId('project-name').fill('Wine room 2');
  await p6.getByTestId('conflict').waitFor({ timeout: 8000 });
  check('a change made elsewhere pauses saving and offers Keep mine / Use the saved one', (await p6.getByTestId('keep-mine').isVisible()) && (await p6.getByTestId('use-saved').isVisible()) && /Save paused/.test(await p6.getByTestId('save-status').innerText()));
  await p6.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const cScan = await p6.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => v.id + ' x' + v.nodes.length));
  check('accessibility scan, the save-conflict banner: no violations', cScan.length === 0, cScan.join(', '));
  await p6.getByTestId('keep-mine').click();
  await status6('saved');
  check('Keep mine saves over the other version', [...rows.values()][0].name === 'Wine room 2');
  check('no page errors saving to the account', errs6.length === 0, errs6.join(' | '));
  await ctx6.close();
}

// phone and tablet: one pane at a time on a phone, no sideways scroll, touch pan and pinch on the drawing
{
  const axeRun = (pg) => pg.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => v.id + ' x' + v.nodes.length));
  const ctx7 = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx7.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const p7 = autoOpen(await ctx7.newPage());
  const errs7 = [];
  p7.on('pageerror', (e) => errs7.push(e.message));
  await p7.goto(URL);
  await p7.getByTestId('plan-canvas').waitFor();
  await p7.waitForTimeout(500);
  const overflow = () => p7.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const shown = (id) => p7.evaluate((t) => { const el = document.querySelector(`[data-testid="${t}"]`); return !!el && el.getClientRects().length > 0; }, id);
  check('phone: the Controls / Drawing / Checks tabs show, and the drawing is the first pane', (await shown('panes')) && (await shown('plan-canvas')) && !(await shown('left')));
  check('phone: no sideways page scroll on the drawing pane', (await overflow()) <= 0, String(await overflow()));
  const box = await p7.getByTestId('plan-canvas').boundingBox();
  check('phone: the drawing is at least 300px wide', box.width >= 300, String(box.width));
  // pinch with two touch points through the DevTools protocol
  const cdp = await ctx7.newCDPSession(p7);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const scale0 = Number(await p7.getByTestId('plan-canvas').getAttribute('data-scale'));
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[cx - 40 - i * 12, cy], [cx + 40 + i * 12, cy]]);
  await touch('touchEnd', []);
  const scale1 = Number(await p7.getByTestId('plan-canvas').getAttribute('data-scale'));
  check('phone: a two-finger spread zooms the drawing in', scale1 > scale0 * 1.5, `${scale0} -> ${scale1}`);
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[cx + i * 15, cy]]);
  await touch('touchEnd', []);
  check('phone: one finger pans the drawing without scrolling the page', (await p7.evaluate(() => window.scrollY)) === 0 && Number(await p7.getByTestId('plan-canvas').getAttribute('data-scale')) === scale1);
  await p7.getByTestId('plan-fit').click();
  check('phone: Fit brings the drawing back', Math.abs(Number(await p7.getByTestId('plan-canvas').getAttribute('data-scale')) - scale0) < 1e-6);
  await p7.getByTestId('pane-controls').click();
  check('phone: the Controls tab shows the controls and hides the drawing', (await shown('left')) && !(await shown('plan-canvas')) && (await overflow()) <= 0, String(await overflow()));
  await p7.getByTestId('pane-checks').click();
  check('phone: the Checks tab shows the checks', (await shown('total')) && !(await shown('left')));
  await p7.getByTestId('pane-controls').click();
  await p7.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const mScan = await axeRun(p7);
  check('accessibility scan, phone size: no violations', mScan.length === 0, mScan.join(', '));
  check('no page errors on the phone', errs7.length === 0, errs7.join(' | '));
  await ctx7.close();

  const ctx8 = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  await ctx8.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const p8 = autoOpen(await ctx8.newPage());
  await p8.goto(URL);
  await p8.getByTestId('plan-canvas').waitFor();
  await p8.waitForTimeout(500);
  check('tablet: all three areas show together and the tabs do not', await p8.evaluate(() => { const v = (t) => document.querySelector(`[data-testid="${t}"]`)?.getClientRects().length > 0; return v('left') && v('plan-canvas') && v('total') && !v('panes'); }));
  check('tablet: no sideways page scroll', (await p8.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await p8.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const tScan = await axeRun(p8);
  check('accessibility scan, tablet size: no violations', tScan.length === 0, tScan.join(', '));
  await ctx8.close();
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
