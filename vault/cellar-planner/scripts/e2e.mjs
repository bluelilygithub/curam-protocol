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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
// the first-visit guide has its own checks below; the main run starts with it already seen
await ctx.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
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
check('the rack values start blank, with a banner saying so', (await page.getByTestId('rack-missing').count()) === 1 && /not set/.test(await page.getByTestId('rack-missing').innerText()));
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
  const p2 = await ctx2.newPage();
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
  await p2.waitForFunction(() => /Download this design/.test(document.querySelector('.rp-tooltip')?.textContent ?? ''), null, { timeout: 3000 });
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
  check('the plan-and-elevation step switches to the elevation, and the drawing step back to the plan', tabAt[8] === 'elevation' && tabAt[9] === 'plan', JSON.stringify(tabAt));
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
  const p3 = await ctx3.newPage();
  const errs3 = [];
  p3.on('pageerror', (e) => errs3.push(e.message));
  p3.on('console', (m) => { if (m.type() === 'error') errs3.push(m.text()); });
  const shot3 = async (n) => { if (out) await p3.screenshot({ path: join(out, n + '.png') }); };
  const total3 = async () => (await p3.getByTestId('total').innerText()).split('\n')[0];
  const est3 = () => p3.locator('[data-testid$="-estimated"]:not([data-testid="rack-estimated"])').count();
  await p3.goto(URL);
  await p3.getByTestId('plan-canvas').waitFor();

  check('there is a visible Test case button, with an explanation', (await p3.getByTestId('testcase').isVisible()) && /best-guess/.test((await p3.getByTestId('testcase').getAttribute('title')) ?? ''));
  check('a first visit already shows the filled Test case (1120 bottles, seven estimated fields)', (await total3()) === '1120 bottles' && (await est3()) === 7);
  await p3.getByTestId('sample').click();
  check('Blank sample is blank: no guesses, every rack value "not set"', (await p3.getByTestId('total').innerText()).startsWith('0 bottles') && (await p3.getByTestId('rack-width').inputValue()) === '' && (await est3()) === 0 && (await p3.getByTestId('rack-missing').count()) === 1);

  // the button in the "not set" banner: fills only the blanks, keeps what was typed, and is undoable
  await p3.getByTestId('rack-width').fill('800');
  await p3.getByTestId('rack-width').press('Enter');
  await p3.getByTestId('fill-guesses').click();
  await p3.waitForTimeout(200);
  const spec = await p3.evaluate(() => window.cellar.store.getState().project);
  check('Fill the blanks with best guesses fills every blank field', spec.rackSpec.unitDepthMm === 350 && spec.rackSpec.bottlesPerRow === 7 && spec.rackSpec.orientation === 'NECK_OUT' && spec.rackSpec.postsPerUnit === 2, JSON.stringify(spec.rackSpec));
  check('...but keeps the value that was typed (800), and does not mark it estimated', spec.rackSpec.unitWidthMm === 800 && !spec.estimated.includes('unitWidthMm') && spec.estimated.length === 6, JSON.stringify(spec.estimated));
  check('the guesses are marked estimated and the banner changes to the best-guesses one', (await est3()) === 6 && (await p3.getByTestId('rack-estimated').count()) === 1 && (await p3.getByTestId('rack-missing').count()) === 0);
  await p3.getByTestId('undo').click();
  const back = await p3.evaluate(() => window.cellar.store.getState().project);
  check('Undo takes all the guesses back and keeps the typed value', back.rackSpec.unitDepthMm === null && back.rackSpec.unitWidthMm === 800 && !back.estimated);
  await p3.getByTestId('testcase').click();
  await p3.waitForTimeout(300);
  check('the Test case fills the racks: 1120 bottles', (await total3()) === '1120 bottles', await total3());
  check('a banner says these are best guesses, not supplier values, and not to quote from them', /Best guesses for testing, not supplier values/.test(await p3.getByTestId('rack-estimated').innerText()) && /Do not quote/.test(await p3.getByTestId('rack-estimated').innerText()));
  check('all seven guessed fields carry a visible "estimated" word (not colour alone)', (await est3()) === 7, String(await est3()));
  check('the status line says so too', /best guesses/.test(await p3.getByTestId('status').innerText()));
  check('the test case has no errors', (await p3.evaluate(() => window.cellar.analyse().issues.filter((i) => i.severity === 'error').length)) === 0);
  await shot3('20-test-case-plan');
  await p3.getByTestId('tab-elevation').click();
  await p3.waitForTimeout(300);
  await p3.getByTestId('tab-plan').click();

  // overwrite the guesses
  await p3.getByTestId('rack-per-row').fill('8');
  await p3.getByTestId('rack-per-row').press('Enter');
  await p3.waitForTimeout(200);
  check('overwriting a value updates the total (8 units x 20 rows x 8 = 1280) and drops only that marker', (await total3()) === '1280 bottles' && (await est3()) === 6 && (await p3.getByTestId('rack-per-row-estimated').count()) === 0 && (await p3.getByTestId('rack-width-estimated').count()) === 1, `${await total3()} ${await est3()}`);
  await p3.getByTestId('undo').click();
  check('undo puts the guess and its marker back', (await total3()) === '1120 bottles' && (await est3()) === 7);
  await p3.getByTestId('rack-orientation').selectOption('LABEL_FORWARD');
  check('changing a menu value clears its marker too', (await p3.getByTestId('rack-orientation-estimated').count()) === 0 && (await est3()) === 6);
  for (const [id, v] of [['rack-width', '800'], ['rack-depth', '400'], ['rack-height', '2000'], ['rack-pitch', '110'], ['rack-posts', '3'], ['rack-per-row', '9']]) { await p3.getByTestId(id).fill(v); await p3.getByTestId(id).press('Enter'); }
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
  check('the example file opens to the same test case (1120 bottles, markers kept)', (await total3()) === '1120 bottles' && (await est3()) === 7);
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

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
