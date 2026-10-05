// End-to-end checks of Garden Planner in real Chrome (SwiftShader WebGL). Start `npm run dev` first, then
// `node scripts/e2e.mjs [screenshotDir]`. Exits non-zero if any check fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.GP_URL ?? 'http://127.0.0.1:5175/garden-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 240)}`); });
const shot = async (name) => { if (out) await page.screenshot({ path: join(out, `${name}.png`) }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const proj = () => ev(() => window.gardenPlanner.project.getState().project);
const ui = () => ev(() => { const s = window.gardenPlanner.ui.getState(); return { tool: s.tool, stage: s.stage, month: s.month, viewMode: s.viewMode, selection: s.selection, placing: s.placingPlantId }; });

/** screen position of a world point on the 2D plan */
const screen = (x, y) => ev(([wx, wy]) => {
  const a = window.gardenPlanner;
  const v = a.view.getState().view;
  const r = document.querySelector('.stage').getBoundingClientRect();
  return { x: r.left + v.offsetX + wx * v.scale, y: r.top + v.offsetY - wy * v.scale };
}, [x, y]);
const clickWorld = async (x, y) => { const p = await screen(x, y); await page.mouse.click(p.x, p.y); };
const dragWorld = async (a, b) => {
  const pa = await screen(a[0], a[1]), pb = await screen(b[0], b[1]);
  await page.mouse.move(pa.x, pa.y); await page.mouse.down(); await page.mouse.move((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, { steps: 4 }); await page.mouse.move(pb.x, pb.y, { steps: 4 }); await page.mouse.up();
};

await page.goto(URL);
await page.waitForSelector('.wizard', { timeout: 15000 });
check('first visit opens the new-garden wizard', true);
await shot('01-wizard');

// ---- wizard: Brisbane, check the climate suggestion
// signed out: Look up explains itself and sends nothing
const outRequests = [];
page.on('request', (r) => { if (/geocode|nominatim|openstreetmap/i.test(r.url())) outRequests.push(r.url()); });
await page.getByLabel('Suburb or postcode').fill('Paddington');
await page.getByRole('button', { name: 'Look up' }).click();
await wait(300);
check('signed out: Look up says to sign in and makes no request', (await page.locator('.wizard').innerText()).includes('signed in to Vault') && outRequests.length === 0, outRequests.join(','));
await page.selectOption('select[aria-label="Pick a place"]', 'Brisbane QLD');
await page.getByRole('button', { name: 'Next' }).click();
const climateText = await page.locator('.wizard .note').first().innerText();
check('Brisbane is suggested as subtropical', /subtropical/i.test(climateText), climateText);
const zoneVal = await page.locator('.wizard select[aria-label="Climate zone"]').inputValue();
check('climate zone select starts on the suggestion', zoneVal === 'subtropical', zoneVal);
const frostVal = await page.locator('.wizard select[aria-label="Frost"]').inputValue();
check('frost starts on none for subtropical', frostVal === 'none', frostVal);
await page.getByRole('button', { name: 'Next' }).click(); // north
await page.getByRole('button', { name: 'Next' }).click(); // plot
await page.getByRole('radio', { name: /Start with a rectangle/ }).click();
await shot('02-wizard-plot');
await page.getByRole('button', { name: 'Create garden' }).click();
await wait(300);
let p = await proj();
check('creating the garden makes a 4-corner boundary', p?.boundary?.vertices.length === 4, JSON.stringify(p?.boundary?.vertices?.length));
check('location and climate carried into the project', p.location.label === 'Brisbane QLD' && p.climateZone === 'subtropical' && p.location.state === 'QLD');
await shot('03-new-garden');

// ---- every text and number input has a mic (spec 0.2)
const missingMic = await ev(() => {
  const bad = [];
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([hidden]), textarea')) {
    if (!el.closest('.vi-wrap')?.querySelector('[data-mic]')) bad.push(el.getAttribute('aria-label') || el.placeholder || el.type);
  }
  return bad;
});
check('every text and number input has a mic button', missingMic.length === 0, missingMic.join(', '));

// ---- draw a bed by dragging a rectangle with the real mouse
await page.getByRole('button', { name: 'Bed', exact: true }).click();
await dragWorld([2, 2], [6, 5]);
await wait(200);
p = await proj();
check('dragging with the Bed tool makes one bed', p.beds.length === 1, String(p.beds.length));
check('the bed is a 4 m x 3 m rectangle (snapped to grid)', p.beds[0] && Math.abs(p.beds[0].shape.points[2].x - p.beds[0].shape.points[0].x - 4) < 0.01);
check('tool returns to Select after drawing', (await ui()).tool === 'select');
check('the new bed is selected and the Inspector shows it', (await page.locator('.panel-right .tab[aria-selected="true"]').innerText()) === 'Bed');
await shot('04-bed');

// ---- polygon by clicking, closed by clicking the first point
await page.getByRole('button', { name: 'Lawn', exact: true }).click();
for (const [x, y] of [[8, 2], [12, 2], [12, 6], [8, 6]]) await clickWorld(x, y);
await clickWorld(8, 2);
await wait(200);
p = await proj();
check('clicking corners then the first dot closes a lawn', p.lawns.length === 1 && p.lawns[0].shape.points.length === 4, String(p.lawns.length));

// ---- path with double-click to finish
await page.getByRole('button', { name: 'Path', exact: true }).click();
await clickWorld(2, 8); await clickWorld(8, 9);
const pe = await screen(12, 9); await page.mouse.dblclick(pe.x, pe.y);
await wait(200);
p = await proj();
check('a path finishes on double-click', p.paths.length === 1 && p.paths[0].points.length >= 3, JSON.stringify(p.paths[0]?.points?.length));

// ---- a structure and a house
await page.getByRole('button', { name: 'House', exact: true }).click();
await dragWorld([1, 12], [9, 20]);
await wait(150);
p = await proj();
check('the house is drawn', !!p.house && p.house.vertices.length === 4);
await ev(() => { window.gardenPlanner.ui.getState().set({ structureKind: 'shed' }); });
await page.getByRole('button', { name: 'Shed', exact: true }).click();
await clickWorld(13, 14);
await wait(150);
p = await proj();
check('a shed is placed', p.structures.length === 1 && p.structures[0].kind === 'shed');

// ---- plants from the library
await ev(() => { window.gardenPlanner.ui.getState().set({ selection: null, tool: 'select' }); });
await page.fill('input[aria-label="Search plants"]', 'lilly pilly');
await wait(200);
const names = await page.locator('.plant-names strong').allInnerTexts();
check('search finds lilly pillies', names.length >= 2 && names.every((n) => /lilly pilly|riberry/i.test(n)), names.join(' | '));
await page.locator('.plant-head').first().click();
await page.getByRole('button', { name: /Add to plan/ }).click();
check('Add to plan arms the Plant tool', (await ui()).tool === 'plant');
await clickWorld(15, 3);
await wait(200);
p = await proj();
check('a click plants one plant', p.plants.length === 1, String(p.plants.length));
check('placing finishes: back to Select with the new plant selected', (await ui()).tool === 'select' && (await ui()).selection?.kind === 'plant' && (await ui()).selection.id === p.plants[0].id);
check('the selection bar offers Duplicate and Delete', (await page.getByTestId('selection-bar').getByRole('button', { name: /Duplicate/ }).count()) === 1 && (await page.getByTestId('selection-bar').getByRole('button', { name: /Delete/ }).count()) === 1);
await page.getByTestId('selection-bar').getByRole('button', { name: /Duplicate/ }).click();
await wait(200);
p = await proj();
const firstId = p.plants[0].id;
const selNow = (await ui()).selection;
check('Duplicate makes a copy and selects the copy', p.plants.length === 2 && selNow?.id !== firstId && p.plants.some((q) => q.id === selNow?.id), String(p.plants.length));
check('the copy is beside the original, not on top of it', Math.hypot(p.plants[0].position.x - p.plants[1].position.x, p.plants[0].position.y - p.plants[1].position.y) > 0.3);
// drag a plant from the library and release it on the plan
await page.locator('.plant-head').first().scrollIntoViewIfNeeded();
const dropAt = await screen(15, 8);
await page.evaluate(({ x, y }) => {
  const dt = new DataTransfer();
  const id = window.gardenPlanner.project.getState().project.plants[0].plantId;
  dt.setData('application/x-garden-plant', id);
  const el = document.querySelector('.stage');
  el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
}, dropAt);
await wait(200);
p = await proj();
check('dropping a plant from the library plants it where released and selects it', p.plants.length === 3 && Math.hypot(p.plants[2].position.x - 15, p.plants[2].position.y - 8) < 1.0 && (await ui()).selection?.id === p.plants[2].id, JSON.stringify(p.plants[2]?.position));
await page.getByTestId('selection-bar').getByRole('button', { name: /Delete/ }).click();
await wait(200);
p = await proj();
check('Delete in the selection bar removes it', p.plants.length === 2 && (await ui()).selection === null, String(p.plants.length));
// a row of copies
await ev(() => { const g = window.gardenPlanner; g.ui.getState().select({ kind: 'plant', id: g.project.getState().project.plants[0].id }); });
await wait(150);
await page.getByTestId('selection-bar').getByRole('button', { name: /Row/ }).click();
await page.getByTestId('row-panel').locator('input').first().fill('4');
await page.getByTestId('row-panel').locator('input').first().blur();
await page.getByTestId('row-panel').getByLabel('Spacing').fill('2');
await page.getByTestId('row-panel').getByLabel('Spacing').blur();
await page.getByTestId('row-panel').getByRole('button', { name: 'Make row' }).click();
await wait(200);
p = await proj();
const orig = p.plants[0];
const rowPts = p.plants.slice(2);
check('Make row adds the requested number of copies', p.plants.length === 6 && rowPts.length === 4, String(p.plants.length));
check('the copies are in a straight line, evenly spaced', rowPts.every((q, i) => Math.abs(q.position.y - orig.position.y) < 1e-6 && Math.abs(q.position.x - (orig.position.x + 2 * (i + 1))) < 1e-6), JSON.stringify(rowPts.map((q) => q.position)));
await page.keyboard.press('Control+z');
await wait(200);
check('one undo removes the whole row', (await proj()).plants.length === 2, String((await proj()).plants.length));
await ev(() => { window.gardenPlanner.ui.getState().select(null); });
// Shift-click keeps planting
await page.getByRole('button', { name: /Add to plan/ }).click();
const sp = await screen(18, 3); await page.keyboard.down('Shift'); await page.mouse.click(sp.x, sp.y); await page.keyboard.up('Shift');
await wait(200);
check('Shift-click keeps the Plant tool armed', (await ui()).tool === 'plant' && (await proj()).plants.length === 3);
await page.keyboard.press('Escape');
await ev(() => { const a = window.gardenPlanner; a.undo(); a.ui.getState().set({ tool: 'select', selection: null }); });
await wait(150);
check('back to two plants for the steps below', (await proj()).plants.length === 2);

// ---- fill the bed from the Inspector
await clickWorld(4, 3.5);
await wait(150);
check('clicking the bed selects it', (await ui()).selection?.kind === 'bed');
await page.selectOption('select[aria-label="Plant to fill the bed with"]', 'dianella-caerulea-little-jess');
await page.getByRole('button', { name: /Fill bed/ }).click();
await wait(200);
p = await proj();
check('Fill bed plants the bed at spacing (staggered grid)', p.plants.length > 20, String(p.plants.length));
const inBed = p.plants.filter((q) => q.position.x >= 2 && q.position.x <= 6 && q.position.y >= 2 && q.position.y <= 5).length;
check('the filled plants are inside the bed', inBed === p.plants.length - 2, `${inBed} of ${p.plants.length - 2}`);
await shot('05-filled');

// ---- growth and season controls
await page.getByRole('radio', { name: 'Planted' }).click();
check('growth stage control changes the stage', (await ui()).stage === 'planted');
await shot('06-planted');
await page.getByRole('radio', { name: 'Mature' }).click();
await page.locator('input[aria-label="Month"]').fill('7');
check('month slider changes the month', (await ui()).month === 7);

// ---- sun and shade (Brisbane: the sun is in the north)
await page.locator('input[aria-label="Month"]').fill('6');
await page.locator('input[aria-label="Time of day"]').fill('12');
const readout = await page.getByTestId('sun-readout').innerText();
check('June midday in Brisbane: the sun is about 39 degrees up, in the north', /Sun (3[89]|40)° up, N$/.test(readout), readout);
check('the clock shows the chosen time', (await page.getByTestId('clock').innerText()) === '12:00 pm');
await page.getByRole('button', { name: 'Sun map' }).click();
await page.getByTestId('sun-legend').waitFor();
check('Sun map shows a key with the default 6 h and 3 h thresholds', /Full sun: 6 h or more/.test(await page.getByTestId('sun-legend').innerText()) && /Shade: under 3 h/.test(await page.getByTestId('sun-legend').innerText()));
await shot('05b-sun-map-june');
await page.getByLabel('Full sun from').fill('8');
await page.getByLabel('Full sun from').press('Enter');
check('the thresholds are settings: the key follows a change', /Full sun: 8 h or more/.test(await page.getByTestId('sun-legend').innerText()) && /Part shade: 3 to 8 h/.test(await page.getByTestId('sun-legend').innerText()));
check('and the setting is remembered in this browser', await ev(() => JSON.parse(localStorage.getItem('garden-planner:sun:v1')).fullSunHours === 8));
await page.getByLabel('Full sun from').fill('6');
await page.getByLabel('Full sun from').press('Enter');
await page.getByRole('button', { name: 'Shadows' }).click();
await page.locator('input[aria-label="Time of day"]').fill('15');
check('the time slider moves the sun readout', /Sun \d+° up, (NNW|NW|WNW)/.test(await page.getByTestId('sun-readout').innerText()), await page.getByTestId('sun-readout').innerText());
await shot('05c-shadows-3pm');
await page.locator('input[aria-label="Time of day"]').fill('4');
check('at 4 am the sun is down', (await page.getByTestId('sun-readout').innerText()).includes('Sun is down'));
await page.locator('input[aria-label="Time of day"]').fill('12');
await page.getByRole('button', { name: 'Shadows' }).click();
await page.getByRole('button', { name: 'Sun map' }).click();
await ev(() => { const a = window.gardenPlanner; a.ui.getState().select({ kind: 'bed', id: a.project.getState().project.beds[0].id }); }); // (the bed is full of plants, so clicking it would pick a plant)
await wait(700);
const bedSun = await page.getByTestId('bed-sun').innerText();
check('a selected bed reports its hours of sun for the month and the two extremes', /June: [\d.]+ h, (full sun|part shade|shade)/.test(bedSun) && /December: [\d.]+ h/.test(bedSun), bedSun);
await ev(() => { window.gardenPlanner.ui.getState().set({ selection: null }); });

// ---- time zone and daylight saving shown beside the Time slider
check('Brisbane in June: standard time, shown with its zone', /Australia\/Brisbane · standard time \(UTC\+10\)/.test(await page.getByTestId('zone').innerText()), await page.getByTestId('zone').innerText());
await ev(() => window.gardenPlanner.updateMeta({ location: { label: 'Sydney NSW', lat: -33.87, lng: 151.21, state: 'NSW' } }));
await page.locator('input[aria-label="Month"]').fill('1');
check('Sydney in January: daylight saving is on, UTC+11', /Australia\/Sydney · daylight saving on \(UTC\+11\)/.test(await page.getByTestId('zone').innerText()), await page.getByTestId('zone').innerText());
await page.locator('input[aria-label="Time of day"]').fill('13');
const syd = await page.getByTestId('sun-readout').innerText();
check('Sydney at 1 pm in January is solar noon: the sun is nearly overhead', /Sun (7[5-9]|8\d)° up/.test(syd), syd);
await page.locator('input[aria-label="Time of day"]').fill('12');
const sydEarly = await page.getByTestId('sun-readout').innerText();
check('...and at noon it is already a little lower', Number(/Sun (\d+)°/.exec(sydEarly)[1]) <= Number(/Sun (\d+)°/.exec(syd)[1]), sydEarly);
await ev(() => window.gardenPlanner.undo());
await page.locator('input[aria-label="Month"]').fill('6');
check('Undo puts the garden back in Brisbane (no daylight saving)', /Australia\/Brisbane · standard time/.test(await page.getByTestId('zone').innerText()));

// ---- undo / redo through the real keyboard
const before = (await proj()).plants.length;
await page.keyboard.press('Control+z');
await wait(100);
check('Ctrl+Z undoes the fill in one step', (await proj()).plants.length === 2, String((await proj()).plants.length));
await page.keyboard.press('Control+Shift+z');
await wait(100);
check('Ctrl+Shift+Z redoes it', (await proj()).plants.length === before);

// ---- suitability: a frost-tender tropical plant disappears in an alpine, heavy-frost garden
await page.fill('input[aria-label="Search plants"]', 'frangipani');
await wait(150);
check('frangipani is offered in subtropical Brisbane', (await page.locator('.plant-names strong').count()) === 1);
await ev(() => window.gardenPlanner.updateMeta({ climateZone: 'alpine', frost: 'heavy' }));
await wait(200);
check('frangipani is left out of the main list in an alpine heavy-frost garden', (await page.locator('.plant-list .plant-names strong').count()) === 0);
const setAside = await page.getByTestId('hidden-plants').evaluate((e) => e.textContent); // (a closed <details> hides its text from innerText)
check('but it is not hidden silently: it is listed as set aside, with the reason and the draft label', /Frangipani/.test(setAside) && /climate|frost/.test(setAside) && /draft, unverified/.test(setAside), setAside.slice(0, 200));
check('the library says the weed filter is incomplete', /weed filter is incomplete/i.test(await page.getByTestId('library-weed-note').innerText()));
await page.getByLabel('Suits my garden').uncheck();
await wait(150);
check('turning off "Suits my garden" shows it again', (await page.locator('.plant-list .plant-names strong').count()) === 1);
await page.getByLabel('Suits my garden').check();
await ev(() => window.gardenPlanner.undo());

// ---- guided tour opens, shows its step counter and finishes
await page.getByRole('button', { name: 'Take the guided tour' }).click();
await page.waitForSelector('.shepherd-element.vault-tour', { timeout: 8000 }).catch((e) => { console.log('tour did not open; problems so far:', problems, 'tour els:', 0); throw e; });
check('the guided tour starts', true);
await page.getByRole('button', { name: /Start Tour/ }).click();
await page.locator('.vault-tour-step-count:visible').waitFor();
check('the tour shows Step 2 of 9', /Step 2 of 9/.test(await page.locator('.vault-tour-step-count:visible').innerText()));
await wait(450); // the card takes focus a moment after it appears
await page.keyboard.press('Escape');
await wait(300);
check('Esc leaves the tour and marks it done', (await ev(() => localStorage.getItem('vault_tour_garden_planner_completed'))) === '1');

// ---- 3D
await page.fill('input[aria-label="Search plants"]', '');
await page.getByRole('button', { name: '3D', exact: true }).click();
await wait(1500);
check('3D view shows a canvas', (await page.locator('.stage canvas').count()) === 1);
await shot('07-3d');
{
  const sunAt = async (hour, month) => {
    await ev(([h, m]) => window.gardenPlanner.ui.getState().set({ hour: h, month: m }), [hour, month]);
    await wait(500);
    return page.locator('.stage canvas').evaluate((c) => ({ ...c.dataset }));
  };
  const noonJune = await sunAt(12, 6);
  check('3D, June midday: the light comes from the NORTH side of the garden (north is away from the viewer, so negative z)', Number(noonJune.sunDz) < -10 && Number(noonJune.sunAlt) > 37 && Number(noonJune.sunAlt) < 41, JSON.stringify(noonJune));
  const morning = await sunAt(8, 6);
  check('3D, June 8 am: the light comes from the east (positive x) and lower down', Number(morning.sunDx) > 15 && Number(morning.sunAlt) < Number(noonJune.sunAlt), JSON.stringify(morning));
  const evening = await sunAt(16, 6);
  check('3D, June 4 pm: the light comes from the west (negative x)', Number(evening.sunDx) < -15, JSON.stringify(evening));
  const summer = await sunAt(12, 12);
  check('3D, December midday: the sun is nearly overhead', Number(summer.sunAlt) > 80, JSON.stringify(summer));
  const night = await sunAt(4, 6);
  check('3D, 4 am: the sun light is off', Number(night.sunIntensity) === 0, JSON.stringify(night));
  await sunAt(15, 6);
  await shot('07b-3d-june-3pm');
  await sunAt(12, 12);
}
await page.locator('.view3d-bar').getByRole('button', { name: 'Top' }).click();
await wait(500);
await shot('08-3d-top');
await page.getByRole('radio', { name: 'Planted' }).click();
await page.locator('input[aria-label="Month"]').fill('11');
await wait(600);
await shot('09-3d-planted-nov');
await page.getByRole('button', { name: '2D', exact: true }).click();
await wait(300);

// ---- persistence across a reload
await wait(600);
await page.reload();
await page.waitForSelector('.toolbar');
await wait(400);
p = await proj();
check('the garden is still there after a reload (autosave)', p?.beds?.length === 1 && p.plants.length === before, JSON.stringify([p?.beds?.length, p?.plants?.length]));

check('no page errors or console errors', problems.length === 0, problems.slice(0, 4).join(' | '));

// ---- checks: problems with reasons, the draft label, and fixes
{
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx3.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const page3 = await ctx3.newPage();
  const probs3 = [];
  page3.on('pageerror', (e) => probs3.push(e.message));
  await page3.goto(URL);
  await page3.waitForSelector('.wizard');
  await page3.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Checks garden', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: true, northDeg: 0 }, plot: { kind: 'rect', width: 24, depth: 34 } }));
  await page3.evaluate(() => {
    const a = window.gardenPlanner;
    a.setHouse([{ x: 6, y: 14 }, { x: 18, y: 14 }, { x: 18, y: 20 }, { x: 6, y: 20 }]);
    a.addPlant('syzygium-smithii', { x: 12, y: 12.5 });       // a tree 1.5 m from the house
    a.addPlant('syzygium-smithii', { x: 12.1, y: 12.5 });     // trunk clash with it
    a.addPlant('ficus-carica', { x: 23.5, y: 5 });            // over the boundary, invasive roots
    a.addPlant('gardenia-augusta-florida', { x: 3, y: 3 });   // toxic to pets
    a.addPlant('lantana-camara', { x: 5, y: 25 });            // listed as a weed in Queensland
    a.addPath([{ x: 0, y: 1 }, { x: 6, y: 1 }]);              // 1 m wide by default
    const p = a.project.getState().project;
    a.updateSelected({ kind: 'path', id: p.paths[0].id }, { ...p.paths[0], width: 0.6 }, 'Narrow the path');
  });
  await page3.waitForFunction(() => window.gardenPlanner.checks.getState().runs > 0 && !window.gardenPlanner.checks.getState().computing, null, { timeout: 15000 });
  await page3.getByTestId('checks-tab').click();
  await page3.getByTestId('checks-panel').waitFor();
  const summary = await page3.getByTestId('checks-summary').innerText();
  check('the Checks tab summarises what it found', /\d+ to fix/.test(summary) && /\d+ to check/.test(summary), summary);
  check('the tab badge counts the problems', Number(await page3.getByTestId('checks-count').innerText()) >= 6);
  for (const type of ['spacing', 'boundary', 'house_distance', 'weed', 'pets', 'path_width']) {
    check('Checks lists a ' + type + ' problem', (await page3.getByTestId('issue-' + type).count()) >= 1);
  }
  const plantDataTypes = ['spacing', 'boundary', 'house_distance', 'weed', 'pets'];
  const unlabelled = [];
  for (const type of plantDataTypes) for (const t of await page3.getByTestId('issue-' + type).allInnerTexts()) if (!t.includes('draft, unverified')) unlabelled.push(type);
  check('every check that uses plant data says "draft, unverified" in its message', unlabelled.length === 0, unlabelled.join(','));
  check('the path message (no plant data) does not claim to be draft plant data', !(await page3.getByTestId('issue-path_width').innerText()).includes('draft, unverified'));
  check('the panel says plant data is draft', /draft, unverified/.test(await page3.getByTestId('checks-draft-note').innerText()));
  check('the weed filter is described as incomplete here too', /incomplete/.test(await page3.getByTestId('weed-note').innerText()));
  await page3.getByRole('button', { name: /Show \d+ notes?/ }).click();
  const unknown = await page3.getByTestId('issue-weed_unknown').innerText();
  check('weed status that is not recorded is shown as unknown, never as not a weed', /unknown/.test(unknown) && !/not a weed"?\s*(is|\.)/.test(unknown.replace(/unknown, not "not a weed"/, '')), unknown.slice(0, 160));
  if (out) await page3.screenshot({ path: join(out, '10-checks.png') });
  // Show selects what the issue is about
  await page3.getByTestId('issue-pets').first().getByRole('button', { name: 'Show' }).click();
  check('Show selects the plant on the plan', (await page3.evaluate(() => window.gardenPlanner.ui.getState().selection?.kind)) === 'plant');
  // Fix position: the later of two clashing plants moves, and the problem goes away
  const before = await page3.evaluate(() => window.gardenPlanner.checks.getState().issues.filter((i) => i.type === 'spacing' && i.severity === 'error').length);
  await page3.getByTestId('issue-spacing').first().getByRole('button', { name: 'Fix position' }).click();
  await page3.waitForFunction((n) => window.gardenPlanner.checks.getState().issues.filter((i) => i.type === 'spacing' && i.severity === 'error').length < n && !window.gardenPlanner.checks.getState().computing, before, { timeout: 15000 });
  check('Fix position clears the clash', true);
  check('and it is one undoable step', await page3.evaluate(() => window.gardenPlanner.project.getState().undoLabel === 'Fix position'));
  // widen the narrow path
  await page3.getByTestId('issue-path_width').getByRole('button', { name: /Widen to 0.9 m/ }).click();
  await page3.waitForFunction(() => window.gardenPlanner.checks.getState().issues.every((i) => i.type !== 'path_width') && !window.gardenPlanner.checks.getState().computing, null, { timeout: 15000 });
  check('Widen fixes the narrow path', (await page3.evaluate(() => window.gardenPlanner.project.getState().project.paths[0].width)) === 0.9);
  // settings change the result
  await page3.getByLabel('Narrowest path').fill('1.2');
  await page3.getByLabel('Narrowest path').press('Enter');
  await page3.waitForFunction(() => window.gardenPlanner.checks.getState().issues.some((i) => i.type === 'path_width'), null, { timeout: 15000 });
  check('the narrowest-path setting is configurable and re-runs the check', true);
  check('and it is remembered in this browser', await page3.evaluate(() => JSON.parse(localStorage.getItem('garden-planner:checks:v1')).pathMinWidth === 1.2));
  check('no page errors while checking', probs3.length === 0, probs3.join(' | '));
  await ctx3.close();
}

// ---- signed in to Vault: gardens save to the account (a fake /api/garden-projects stands in for the server)
{
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx2.addInitScript(() => {
    try {
      localStorage.setItem('garden-planner:info-seen:v1', '1');
      localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token' }, version: 0 }));
    } catch { /* ignore */ }
  });
  const page2 = await ctx2.newPage();
  const rows = [];
  let seq = 0;
  let offline = false;
  const images = new Map();
  let imgSeq = 0;
  const seen = [];
  const puts = [];
  await page2.route('**/api/garden-projects**', async (route) => {
    const req = route.request();
    const url = new globalThis.URL(req.url());
    const path = url.pathname.replace(/^.*\/api\/garden-projects/, '');
    seen.push(`${req.method()} ${path || '/'} auth=${req.headers().authorization}`);
    if (offline) return route.abort('failed');
    if (path === '/images' && req.method() === 'POST') {
      const id = ++imgSeq; images.set('srv-' + id, { type: req.headers()['content-type'], bytes: req.postDataBuffer() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ image: { id: 'srv-' + id } }) });
    }
    if (path.startsWith('/images/')) {
      const im = images.get(decodeURIComponent(path.slice(8)));
      return im ? route.fulfill({ status: 200, contentType: im.type, body: im.bytes }) : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"nope"}' });
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const wire = (r) => ({ id: r.id, name: r.name, plantCount: r.data.plants.length, location: r.data.location.label, updatedAt: r.updatedAt });
    const tick = () => new Date(Date.UTC(2026, 9, 6, 0, 0, ++seq)).toISOString();
    if (req.method() === 'GET' && !path) return json({ projects: rows.map(wire) });
    const id = Number(path.slice(1));
    const row = rows.find((r) => r.id === id);
    if (req.method() === 'GET') return row ? json({ project: { ...wire(row), data: row.data } }) : json({ error: 'nope' }, 404);
    const body = req.postDataJSON();
    if (req.method() === 'PUT' || req.method() === 'POST') puts.push({ method: req.method(), bytes: req.postData().length, hasDataUrl: req.postData().includes('dataUrl') });
    if (req.method() === 'POST') { const r = { id: ++seq + 100, name: body.name, data: body.data, updatedAt: tick() }; rows.push(r); return json({ project: wire(r) }); }
    if (req.method() === 'PUT') {
      if (!row) return json({ error: 'nope' }, 404);
      if (body.expectedUpdatedAt && body.expectedUpdatedAt !== row.updatedAt) return json({ error: 'changed elsewhere', current: wire(row) }, 409);
      if (body.name) row.name = body.name; if (body.data) row.data = body.data; row.updatedAt = tick();
      return json({ project: wire(row) });
    }
    return json({ ok: true });
  });
  // place lookup through Vault's /api/geocode (stand-in): one request per press, never while typing, attribution shown
  const geoCalls = [];
  const directOsm = [];
  page2.on('request', (r) => { if (/nominatim|openstreetmap\.org\/search/i.test(r.url())) directOsm.push(r.url()); });
  await page2.route('**/api/geocode**', (route) => {
    const req = route.request();
    geoCalls.push({ url: req.url(), method: req.method(), body: req.postData(), auth: req.headers().authorization });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cached: false, attribution: '© OpenStreetMap contributors', results: [{ label: 'Paddington, Brisbane, Queensland', lat: -27.46, lng: 153.0, state: 'QLD', postcode: '4064' }] }) });
  });
  const probs2 = [];
  page2.on('pageerror', (e) => probs2.push(e.message));
  await page2.goto(URL);
  await page2.waitForSelector('.wizard');
  check('signed in: the library comes from the account', (await page2.locator('.statusbar').innerText()).includes('Opening') || seen.some((s) => s.startsWith('GET /')));
  check('signed in: the Vault token is sent as a bearer token', seen.some((s) => s.includes('auth=Bearer test-token')));
  await page2.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Account garden', location: { label: 'Perth WA', lat: -31.95, lng: 115.86, state: 'WA' }, climateZone: 'warm_temperate', frost: 'light', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 12, depth: 20 } }));
  await page2.waitForFunction(() => window.gardenPlanner.library.getState().status === 'saved', null, { timeout: 8000 });
  check('a new garden is saved to the server with its name and data', rows.some((r) => r.name === 'Account garden' && r.data.boundary?.vertices.length === 4), JSON.stringify(rows.map((r) => r.name)));
  check('the status bar says it is saved to Vault', (await page2.locator('.statusbar').innerText()).includes('Saved ✓ to Vault'));
  await page2.evaluate(() => window.gardenPlanner.addPlant('x', { x: 1, y: 1 }));
  await page2.waitForFunction(() => window.gardenPlanner.library.getState().status === 'saved', null, { timeout: 8000 });
  await wait(300);
  check('an edit autosaves to the server', rows.length === 1 && rows[0].data.plants.length === 1, JSON.stringify([rows.length, rows[0]?.data.plants.length]));
  // offline: the edit is kept (browser draft) and the app says so; when the server is back it saves
  offline = true;
  await page2.evaluate(() => window.gardenPlanner.addPlant('y', { x: 2, y: 2 }));
  await page2.waitForFunction(() => window.gardenPlanner.library.getState().status === 'error', null, { timeout: 9000 });
  check('offline: the status says it is not saved', (await page2.locator('.statusbar').innerText()).includes('Not saved'));
  const draft = await page2.evaluate(() => JSON.parse(localStorage.getItem('garden-planner:draft:v1') || 'null'));
  check('offline: the browser draft still has the edit', draft?.plants?.length === 2, JSON.stringify(draft?.plants?.length));
  offline = false;
  await page2.evaluate(() => window.gardenPlanner.projects.saveNow());
  await page2.waitForFunction(() => window.gardenPlanner.library.getState().status === 'saved', null, { timeout: 8000 });
  check('back online: the offline edit reaches the server', rows[0].data.plants.length === 2);
  await page2.reload();
  await page2.waitForSelector('.toolbar');
  await page2.waitForFunction(() => window.gardenPlanner?.project.getState().project?.name === 'Account garden', null, { timeout: 8000 });
  check('after a reload the garden is loaded from the account', (await page2.evaluate(() => window.gardenPlanner.project.getState().project.plants.length)) === 2);
  // ---- place lookup
  await page2.evaluate(() => window.gardenPlanner.ui.getState().set({ wizardOpen: true, projectsOpen: false }));
  const box = page2.getByLabel('Suburb or postcode');
  await box.pressSequentially('Paddington', { delay: 60 });
  await wait(1500);
  check('typing in the place box makes no lookup request (no type-ahead)', geoCalls.length === 0, String(geoCalls.length));
  await box.press('Enter');
  await wait(500);
  check('pressing Enter in the box does not search either', geoCalls.length === 0, String(geoCalls.length));
  await page2.getByRole('button', { name: 'Look up' }).click();
  await page2.locator('.hits button').first().waitFor();
  check('Look up makes exactly one request, to Vault, with the token', geoCalls.length === 1 && geoCalls[0].url.endsWith('/api/geocode') && geoCalls[0].method === 'POST' && geoCalls[0].body.includes('Paddington') && geoCalls[0].auth === 'Bearer test-token', JSON.stringify(geoCalls));
  check('the page never calls OpenStreetMap directly', directOsm.length === 0, directOsm.join(','));
  check('the results show "© OpenStreetMap contributors" linking to its copyright page', (await page2.getByTestId('osm-attribution').innerText()).includes('© OpenStreetMap contributors') && (await page2.getByTestId('osm-attribution').locator('a').getAttribute('href')) === 'https://www.openstreetmap.org/copyright');
  await page2.getByRole('button', { name: 'Look up' }).click();
  await wait(400);
  check('pressing Look up again for the same text is answered without another request', geoCalls.length === 1, String(geoCalls.length));
  await page2.locator('.hits button').first().click();
  check('choosing a result fills the place and keeps the attribution visible', (await page2.getByTestId('osm-attribution').count()) === 1 && (await page2.getByLabel('Latitude').inputValue()) === '-27.46');

  // ---- tracing picture: stored once, apart from the design
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page2.evaluate(() => window.gardenPlanner.ui.getState().set({ wizardOpen: true, projectsOpen: false }));
  await page2.getByRole('button', { name: 'Next' }).click();
  await page2.getByRole('button', { name: 'Next' }).click();
  await page2.getByRole('button', { name: 'Next' }).click();
  await page2.getByRole('radio', { name: /Trace a picture/ }).click();
  await page2.setInputFiles('input[type=file][aria-label="Choose a picture to trace"]', { name: 'plan.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') });
  await page2.locator('.pic-preview').waitFor();
  const imagesBefore = images.size;
  await page2.getByRole('button', { name: 'Create garden' }).click();
  await page2.waitForFunction(() => window.gardenPlanner.library.getState().status === 'saved' && window.gardenPlanner.project.getState().project.underlay, null, { timeout: 8000 });
  const pic = await page2.evaluate(() => window.gardenPlanner.project.getState().project.underlay);
  check('the picture is uploaded once, as a JPEG, to the account', images.size === imagesBefore + 1 && [...images.values()].pop().type === 'image/jpeg', String(images.size));
  check('the garden design references it (srv-…) and does not embed it', /^srv-\d+$/.test(pic.imageId) && !('dataUrl' in pic), JSON.stringify(Object.keys(pic)));
  check('nothing sent to the garden endpoints ever embedded a picture', puts.every((q) => !q.hasDataUrl) && puts.every((q) => q.bytes < 20000), JSON.stringify(puts.slice(-2)));
  check('the status bar shows the new garden saved', (await page2.locator('.statusbar').innerText()).includes('Saved'));
  await page2.reload();
  await page2.waitForFunction(() => window.gardenPlanner?.project.getState().project?.underlay, null, { timeout: 8000 });
  await wait(500);
  check('after a reload the picture is fetched from the account (not the design)', seen.some((s) => s.startsWith('GET /images/srv-')));
  // ---- migration: a garden saved by the first server build with the picture embedded
  rows.push({ id: 900, name: 'Old garden', updatedAt: new Date(Date.UTC(2026, 9, 7)).toISOString(), data: { schemaVersion: 1, id: 'old', name: 'Old garden', location: { label: 'Hobart TAS', lat: -42.88, lng: 147.33, state: 'TAS' }, climateZone: 'cool_temperate', frost: 'moderate', pets: false, northDeg: 0, boundary: null, house: null, zones: [], beds: [], paths: [], lawns: [], structures: [], plants: [], underlay: { name: 'old.png', dataUrl: 'data:image/png;base64,' + PNG_B64, widthPx: 1, heightPx: 1, metresPerPixel: 5, origin: { x: 0, y: 0 }, rotation: 0, opacity: 0.6 } } });
  const imagesBeforeOld = images.size;
  await page2.evaluate(() => window.gardenPlanner.projects.refresh());
  await page2.evaluate(() => window.gardenPlanner.openProject('900'));
  await page2.waitForFunction(() => { const u = window.gardenPlanner.project.getState().project?.underlay; return u && !u.dataUrl && u.imageId.startsWith('srv-'); }, null, { timeout: 8000 });
  await page2.waitForFunction(() => window.gardenPlanner.library.getState().status === 'saved', null, { timeout: 8000 });
  await wait(300);
  const migrated = rows.find((r) => r.id === 900);
  check('opening an old garden moves its embedded picture into storage', images.size === imagesBeforeOld + 1);
  check('and the saved design now references it instead of embedding it', !!migrated.data.underlay.imageId && !('dataUrl' in migrated.data.underlay), JSON.stringify(Object.keys(migrated.data.underlay)));
  check('no page errors while saving to the account', probs2.length === 0, probs2.join(' | '));
  await ctx2.close();
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
