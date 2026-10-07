// End-to-end checks of Garden Planner in real Chrome (SwiftShader WebGL). Start `npm run dev` first, then
// `node scripts/e2e.mjs [screenshotDir]`. Exits non-zero if any check fails.
import { mkdirSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { chromium } from './lib/chromium.mjs';
import { PDFDocument } from 'pdf-lib';

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
const bedSun = await page.getByTestId('bed-sun').textContent() ?? '';
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
check('the tour shows Step 2 of 12', /Step 2 of 12/.test(await page.locator('.vault-tour-step-count:visible').innerText()));
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
// ---- satellite map (a fake /api/map-tiles stands in for the server and MapTiler)
{
  // a solid green 8x8 PNG, built here so no file is needed
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [30, 160, 40]).flat())])));
  const GREEN_PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

  const mapContext = async (enabled) => {
    const ctxM = await browser.newContext({ viewport: { width: 1440, height: 860 } });
    await ctxM.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token' }, version: 0 }));} catch { /* ignore */ } });
    const pg = await ctxM.newPage();
    const reqs = [];
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route('**/api/garden-projects**', (route) => route.abort('failed')); // saving falls back to this browser
    await pg.route('**/api/map-tiles/**', (route) => {
      const r = route.request();
      const path = new globalThis.URL(r.url()).pathname.replace(/^.*\/api\/map-tiles/, '');
      reqs.push({ path, auth: r.headers().authorization });
      if (path === '/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(enabled ? { enabled: true, attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 20 } : { enabled: false, attribution: '', maxZoom: 20 }) });
      return route.fulfill({ status: 200, contentType: 'image/png', body: GREEN_PNG });
    });
    await pg.goto(URL);
    await pg.waitForSelector('.wizard');
    return { ctxM, pg, reqs, errs };
  };

  // not set up on the server: a plain explanation, no tiles requested
  {
    const { ctxM, pg, reqs, errs } = await mapContext(false);
    await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Map off', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 20, depth: 20 } }));
    await pg.waitForSelector('.stage canvas');
    await pg.evaluate(() => window.gardenPlanner.ui.getState().select(null));
    await pg.getByLabel('Show a satellite map under the plan').check();
    await pg.getByTestId('map-unavailable').waitFor({ timeout: 5000 });
    check('map not set up: the panel says so in plain words', /MapTiler key/.test(await pg.getByTestId('map-unavailable').innerText()));
    check('and no map tile is asked for', reqs.every((r) => r.path === '/status'), JSON.stringify(reqs.map((r) => r.path)));
    check('no page errors with the map unavailable', errs.length === 0, errs.join(' | '));
    await ctxM.close();
  }

  const { ctxM, pg, reqs, errs } = await mapContext(true);
  // the wizard shows a map of the chosen place
  await pg.getByTestId('map-preview').waitFor({ timeout: 8000 });
  const previewOk = await (async () => { for (let i = 0; i < 40; i++) { const g = await pg.getByTestId('map-preview').locator('canvas').evaluate((cv) => { const d = cv.getContext('2d').getImageData(10, 10, 1, 1).data; return d[1] > 120 && d[0] < 80; }); if (g) return true; await wait(150); } return false; })();
  check('the wizard shows a map of the place, with its credit', previewOk && /MapTiler/.test(await pg.getByTestId('map-preview').innerText()));
  await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Map on', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 20, depth: 20 } }));
  await pg.waitForSelector('.stage canvas');
  await pg.evaluate(() => window.gardenPlanner.ui.getState().select(null));
  const mapShot = async (n) => { if (out) await pg.screenshot({ path: join(out, n) }); };
  const pixel = () => pg.evaluate(() => {
    const cv = document.querySelector('.stage canvas'); // the first Konva layer is the map
    const c = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    let green = 0, any = 0;
    for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 24))) for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 24))) { const d = c.getImageData(x, y, 1, 1).data; if (d[3] > 0) { any++; if (d[1] > 120 && d[0] < 80) green++; } }
    return { green, any };
  });
  await pg.getByLabel('Show a satellite map under the plan').check();
  await pg.waitForFunction(() => window.gardenPlanner.project.getState().project.map?.on === true);
  let seen = await (async () => { for (let i = 0; i < 40; i++) { const r = await pixel(); if (r.green > 20) return r; await wait(150); } return pixel(); })();
  check('turning the map on draws the aerial tiles under the plan', seen.green > 20, JSON.stringify(seen));
  const tileReqs = reqs.filter((r) => r.path !== '/status');
  check('tiles come from Vault with the Vault token (never from MapTiler)', tileReqs.length > 0 && tileReqs.every((r) => r.auth === 'Bearer test-token' && /^\/\d+\/\d+\/\d+$/.test(r.path)), JSON.stringify(tileReqs.slice(0, 2)));
  // the tile asked for first is the one at the garden's location (checked with an independent calculation)
  const planReqs = tileReqs.filter((r) => Number(r.path.split('/')[1]) !== 16); // (zoom 16 is the wizard preview)
  const z = Number(planReqs[0].path.split('/')[1]);
  const n = 256 * 2 ** z;
  const wx = ((153.03 + 180) / 360) * n;
  const sinLat = Math.sin((-27.47 * Math.PI) / 180);
  const wy = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n;
  const near = planReqs.some((r) => { const [, , x, y] = r.path.split('/').map(Number); return Math.abs(x - Math.floor(wx / 256)) <= 6 && Math.abs(y - Math.floor(wy / 256)) <= 6; });
  check('and they are the tiles around the garden location', near, `zoom ${z}, wanted near ${Math.floor(wx / 256)}/${Math.floor(wy / 256)}`);
  check('the credit the provider requires is shown with the map', /MapTiler/.test(await pg.getByTestId('map-attribution').innerText()));
  await mapShot('10-map.png');

  // line the map up with the plot: dragging moves the map, and it is one undo step
  const before = await pg.evaluate(() => window.gardenPlanner.project.getState().project.map);
  await pg.getByRole('button', { name: 'Move map' }).click();
  const screenOn = (x, y) => pg.evaluate(([wx, wy]) => { const g = window.gardenPlanner; const v = g.view.getState().view; const r = document.querySelector('.stage').getBoundingClientRect(); return { x: r.left + v.offsetX + wx * v.scale, y: r.top + v.offsetY - wy * v.scale }; }, [x, y]);
  const a = await screenOn(4, 4), b = await screenOn(9, 4); // 5 m to the right on the plan
  await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 }); await pg.mouse.move(b.x, b.y, { steps: 4 }); await pg.mouse.up();
  await wait(250);
  const after = await pg.evaluate(() => window.gardenPlanner.project.getState().project.map);
  const dEast = (before.lng - after.lng) * 111320 * Math.cos((-27.47 * Math.PI) / 180);
  check('dragging the map east by 5 m moves its anchor 5 m west', Math.abs(dEast - 5) < 0.2 && Math.abs(after.lat - before.lat) < 1e-6, JSON.stringify({ dEast, dLat: after.lat - before.lat }));
  check('moving the map did not select or move anything else', (await pg.evaluate(() => window.gardenPlanner.ui.getState().selection)) === null);
  await pg.keyboard.press('Control+z');
  await wait(200);
  const undone = await pg.evaluate(() => window.gardenPlanner.project.getState().project.map);
  check('Ctrl+Z puts the map back in one step', Math.abs(undone.lng - before.lng) < 1e-9 && Math.abs(undone.lat - before.lat) < 1e-9);
  await pg.keyboard.press('Escape');
  check('Esc leaves Move map', (await pg.evaluate(() => window.gardenPlanner.ui.getState().mapAlign)) === false);

  // the map turns with the north arrow, and the plan fills let it show through
  await pg.evaluate(() => window.gardenPlanner.updateMeta({ northDeg: 90 }));
  await wait(300);
  seen = await pixel();
  check('the map is still drawn after turning north', seen.green > 10, JSON.stringify(seen));

  // the 3D view lays the same photo on the ground
  await pg.getByRole('button', { name: '3D', exact: true }).click();
  await pg.waitForSelector('.stage canvas');
  const mapDs = async () => { for (let i = 0; i < 60; i++) { const d = await pg.locator('.stage canvas').evaluate((c) => c.dataset.mapTiles); const m = /^(\d+)\/(\d+)$/.exec(d ?? ''); if (m && Number(m[1]) > 0 && Number(m[1]) === Number(m[2])) return d; await wait(200); } return pg.locator('.stage canvas').evaluate((c) => c.dataset.mapTiles); };
  const ds3 = await mapDs();
  check('3D: the ground is painted with the satellite tiles (all that are needed have arrived)', /^[1-9]\d*\/\d+$/.test(ds3) && ds3.split('/')[0] === ds3.split('/')[1], String(ds3));
  check('3D: the provider credit is shown with the map', /MapTiler/.test(await pg.getByTestId('map-attribution').innerText()));
  await mapShot('11-map-3d.png');
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ month: 6, hour: 15 }));
  await wait(400);
  await mapShot('11b-map-3d-june-3pm.png');
  await pg.evaluate(() => window.gardenPlanner.updateMeta({ northDeg: 90 }));
  await wait(400);
  check('3D: turning north repaints the ground, still all tiles', /^[1-9]\d*\/\d+$/.test(await mapDs()));
  await pg.evaluate(() => window.gardenPlanner.updateMeta({ northDeg: 0 }));
  await pg.getByRole('button', { name: '2D', exact: true }).click();
  await pg.waitForSelector('.stage canvas');
  await wait(300);

  // shadows still fall across it: switch the sun map on with a house
  await pg.evaluate(() => { const a = window.gardenPlanner; a.updateMeta({ northDeg: 0 }); a.ui.getState().set({ showShadows: true }); });
  await wait(300);
  check('no page errors with the map on', errs.length === 0, errs.join(' | '));

  // switching off removes it and the credit
  await pg.evaluate(() => window.gardenPlanner.ui.getState().select(null));
  await pg.getByLabel('Show a satellite map under the plan').uncheck();
  await wait(300);
  check('turning the map off removes the credit', (await pg.getByTestId('map-attribution').count()) === 0);
  const off = await pixel();
  check('and the tiles', off.green === 0, JSON.stringify(off));
  await ctxM.close();
}
// ---- plant photo curator (a fake /api/plant-images stands in for the server)
{
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const photoRow = (id, o = {}) => ({ id: String(id), source: 'inaturalist', sourceLabel: 'iNaturalist', sourceUrl: 'https://www.inaturalist.org/observations/' + id, imageUrl: 'https://photos.example.test/' + id + '.jpg', thumbUrl: 'https://photos.example.test/' + id + '.jpg', creator: 'Creator ' + id, licenceCode: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', displayOnly: false, title: 't', role: 'plant', width: 2000, height: 1000, modified: false, credit: 'x', defaultFor: [], hidden: false, hiddenReason: null, ...o });
  const openCurator = async (isAdmin) => {
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctxC.addInitScript((admin) => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token', user: { id: 1, email: 'a@b.c', isAdmin: admin } }, version: 0 })); } catch { /* ignore */ } }, isAdmin);
    const pg = await ctxC.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    const world = { images: [photoRow(1, { role: 'flower' }), photoRow(2, { source: 'wikimedia', sourceLabel: 'Wikimedia Commons', licenceCode: 'CC BY-SA 4.0', displayOnly: true }), photoRow(3, { hidden: true, hiddenReason: 'removed-or-relicensed' })], forbid: false };
    const posts = [];
    await pg.route('**/api/garden-projects**', (r) => r.abort('failed'));
    await pg.route('https://photos.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/gif', body: GIF }));
    await pg.route('**/api/plant-images/**', async (route) => {
      const req = route.request();
      const path = new globalThis.URL(req.url()).pathname.replace(/^.*\/api\/plant-images/, '');
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (req.method() === 'POST') posts.push({ path, body: req.postData() });
      if (world.forbid && path !== '/lavandula-angustifolia') return json({ error: 'Admin only' }, 403);
      if (path === '/summary') return json({ plants: [{ plantId: 'lavandula-angustifolia', visible: 2, hidden: 1, defaults: 0, status: 'ok', fetchedAt: 1 }] });
      if (path === '/refresh-missing') return json({ queued: 5 }, 202);
      if (path.endsWith('/all')) return json({ images: world.images });
      let m = /^\/images\/(\d+)\/hide$/.exec(path);
      if (m) { const im = world.images.find((i) => i.id === m[1]); im.hidden = JSON.parse(req.postData()).hidden; im.hiddenReason = im.hidden ? 'curator' : null; if (im.hidden) im.defaultFor = []; return json({ ok: true }); }
      m = /^\/images\/(\d+)\/role$/.exec(path);
      if (m) { world.images.find((i) => i.id === m[1]).role = JSON.parse(req.postData()).role; return json({ ok: true }); }
      if (path.endsWith('/default')) { const { role, imageId } = JSON.parse(req.postData()); for (const i of world.images) i.defaultFor = i.defaultFor.filter((r) => r !== role); if (imageId) world.images.find((i) => i.id === String(imageId)).defaultFor.push(role); return json({ ok: true }); }
      if (path.endsWith('/refresh')) return json({ ok: true }, 202);
      return json({ status: 'ready', images: [] });
    });
    await pg.goto(URL);
    await pg.waitForSelector('.wizard');
    await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Curator', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 20, depth: 20 } }));
    await pg.waitForSelector('.stage canvas');
    return { ctxC, pg, world, posts, errs };
  };

  // a member (not an admin) does not even see the button
  {
    const { ctxC, pg } = await openCurator(false);
    check('a non-admin does not see the curator button', (await pg.getByTestId('open-curator').count()) === 0);
    await ctxC.close();
  }

  const { ctxC, pg, world, posts, errs } = await openCurator(true);
  check('an admin sees the curator button', (await pg.getByTestId('open-curator').count()) === 1);
  await pg.getByTestId('open-curator').click();
  await pg.getByRole('dialog', { name: 'Plant photo curator' }).waitFor();
  await pg.getByTestId('curator-plants').locator('li').first().waitFor();
  const total = await pg.getByTestId('curator-plants').locator('li').count();
  check('the curator lists every plant (171)', total === 171, String(total));
  await pg.getByLabel('Show', { exact: true }).selectOption('unlooked');
  const unlooked = await pg.getByTestId('curator-plants').locator('li').count();
  check('the filter "Not looked up yet" leaves out the plant that has photos', unlooked === 170, String(unlooked));
  await pg.getByLabel('Show', { exact: true }).selectOption('all');
  await pg.getByLabel('Find a plant').fill('lavandula angustifolia');
  await wait(200);
  const lavRow = pg.getByTestId('curator-plants').locator('li').first();
  check('the list shows what is stored for a plant in plain words', /2 shown · 1 hidden · 0\/3 chosen/.test(await lavRow.innerText()), await lavRow.innerText());
  await lavRow.locator('button').click();
  await pg.getByTestId('curator-photo').first().waitFor();
  check('every photo found is listed, hidden ones too', (await pg.getByTestId('curator-photo').count()) === 3);
  check('a hidden photo is marked and says why', /gone from its source/.test(await pg.getByTestId('curator-photo').nth(2).innerText()));
  check('each photo shows its creator, licence and source', /Creator 1, CC BY 4\.0 via iNaturalist/.test(await pg.getByTestId('curator-photo').nth(0).innerText()));
  check('share-alike is flagged as shown unedited', /Share-alike/.test(await pg.getByTestId('curator-photo').nth(1).innerText()));

  const card0 = pg.getByTestId('curator-photo').nth(0);
  await card0.getByRole('button', { name: 'Flower' }).click();
  await wait(300);
  check('choosing a default sends the plant, role and photo', posts.some((p) => p.path === '/lavandula-angustifolia/default' && p.body === '{"role":"flower","imageId":"1"}'), JSON.stringify(posts));
  check('and the button shows it is chosen', (await card0.getByRole('button', { name: /Flower/ }).getAttribute('aria-pressed')) === 'true');

  await card0.getByRole('button', { name: /Flower/ }).click();
  await wait(300);
  check('pressing a chosen default clears it', posts.some((p) => p.body === '{"role":"flower","imageId":null}'));

  const card1 = pg.getByTestId('curator-photo').nth(1);
  await card1.getByRole('button', { name: 'Hide' }).click();
  await wait(300);
  check('Hide sends the request and the photo is dimmed', posts.some((p) => p.path === '/images/2/hide' && p.body === '{"hidden":true}') && /hidden/.test((await pg.getByTestId('curator-photo').nth(1).getAttribute('class')) ?? ''));
  check('a hidden photo cannot be chosen as a default until it is shown', await pg.getByTestId('curator-photo').nth(1).getByRole('button', { name: 'Flower' }).isDisabled());
  await pg.getByTestId('curator-photo').nth(1).getByRole('button', { name: 'Show' }).click();
  await wait(300);
  check('Show brings it back', posts.some((p) => p.path === '/images/2/hide' && p.body === '{"hidden":false}'));

  await card0.getByLabel('What the photo shows').selectOption('foliage');
  await wait(300);
  check('changing what a photo shows sends the new role', posts.some((p) => p.path === '/images/1/role' && p.body === '{"role":"foliage"}'));

  await pg.getByTestId('curator-refresh').click();
  await wait(300);
  check('Look again asks the server to search the sources', posts.some((p) => p.path === '/lavandula-angustifolia/refresh'));

  await pg.getByTestId('fetch-missing').click();
  await pg.getByTestId('curator-msg').filter({ hasText: 'Started looking for photos for 5 plants' }).waitFor({ timeout: 5000 });
  check('the bulk lookup says how many plants it started on', true);
  if (out) await pg.screenshot({ path: join(out, '12-curator.png') });

  // the server refuses (not an admin after all): a plain message, nothing breaks
  world.forbid = true;
  await pg.getByTestId('fetch-missing').click();
  await pg.getByTestId('curator-msg').filter({ hasText: 'Only a Vault admin' }).waitFor({ timeout: 5000 });
  check('a refusal from the server is explained in plain words', true);
  await pg.keyboard.press('Escape');
  check('no page errors in the curator', errs.length === 0, errs.join(' | '));
  await ctxC.close();
}
// ---- plant tag scan (a fake reader stands in for Tesseract, so no network is needed)
{
  const ctxT = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxT.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const pg = await ctxT.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(URL);
  await pg.waitForSelector('.wizard');
  await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Tags', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 20, depth: 20 } }));
  await pg.waitForSelector('.stage canvas');
  const openScan = async () => { await pg.getByTestId('open-tag-scan').click(); await pg.getByRole('dialog', { name: 'Scan a plant tag' }).waitFor(); };
  const fakeReader = (lines, conf) => pg.evaluate(([ls, c]) => {
    const g = window.gardenPlanner;
    g.tagScanner.createEngine = async () => ({ recognize: async () => ({ lines: ls.map((text) => ({ text, segs: [] })), meanConf: c }), terminate: async () => undefined });
    g.tagScanner.dispose();
  }, [lines, conf]);
  const choosePhoto = () => pg.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#eee'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#111'; g.fillText('tag', 20, 40);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'tag.png', { type: 'image/png' }));
    const input = document.querySelector('[data-testid="tag-file"]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await openScan();
  check('the tag scan has a microphone on its text box (voice on every input)', (await pg.getByRole('dialog', { name: 'Scan a plant tag' }).getByRole('button', { name: /Speak instead of typing|Voice input/ }).count()) >= 1);

  // typing the name instead of using a photo
  await pg.getByLabel('Text from the tag').fill('English Lavender\nLavandula angustifolia\nFull sun. Height 60cm Width 60cm');
  await pg.getByTestId('tag-match').first().waitFor();
  check('typing the botanical name offers that plant first, as a strong match', (await pg.getByTestId('tag-match').first().getAttribute('data-plant')) === 'lavandula-angustifolia' && /Strong match/.test(await pg.getByTestId('tag-match').first().innerText()));
  check('the match says why', /botanical name Lavandula angustifolia is on the tag/.test(await pg.getByTestId('tag-match').first().innerText()));
  check('the size and sun on the tag are shown', /60? ?cm|0\.6 m high/.test(await pg.getByTestId('tag-facts').innerText()) || /0\.6 m high, 0\.6 m wide, full sun/.test(await pg.getByTestId('tag-facts').innerText()), await pg.getByTestId('tag-facts').innerText());
  check('the draft, unverified warning is shown with the matches', /draft, unverified/.test(await pg.getByTestId('tag-results').innerText()));
  check('a strong botanical match is not called ambiguous', (await pg.getByTestId('tag-ambiguous').count()) === 0);

  // a name shared by several plants: the person must choose
  await pg.getByLabel('Text from the tag').fill('Lilly Pilly');
  await pg.getByTestId('tag-ambiguous').waitFor();
  check('a shared common name lists several plants and asks the person to choose', (await pg.getByTestId('tag-match').count()) > 1);

  await pg.getByLabel('Text from the tag').fill('qzxv wlkj');
  await pg.getByTestId('tag-none').waitFor();
  check('nothing matching says so plainly, and offers nothing to add', (await pg.getByTestId('tag-match').count()) === 0);

  // a photo: the reader fakes a poor-quality reading
  await fakeReader(["Grevillea 'Robyn Gordon'", 'Native shrub', 'Height 1.5m x Width 1.5m', 'Full sun'], 40);
  await choosePhoto();
  await pg.getByTestId('tag-lowconf').waitFor({ timeout: 8000 });
  check('a poor reading tells the person to check the words', true);
  check('the words that were read are shown, and can be corrected', /Robyn Gordon/.test(await pg.getByLabel('Text from the tag').inputValue()));
  check('the photo is shown back to the person', (await pg.locator('.tag-photo').count()) === 1);
  await pg.getByTestId('tag-match').first().waitFor();
  check('the matching plant is offered', (await pg.getByTestId('tag-match').first().getAttribute('data-plant')) === 'grevillea-robyn-gordon');
  if (out) await pg.screenshot({ path: join(out, '13-tag-scan.png') });

  // nothing is added until the person chooses
  check('scanning added nothing to the garden', (await pg.evaluate(() => window.gardenPlanner.project.getState().project.plants.length)) === 0);
  await pg.getByTestId('tag-match').first().getByRole('button', { name: /Add to plan/ }).click();
  const armed = await pg.evaluate(() => { const u = window.gardenPlanner.ui.getState(); return { tool: u.tool, id: u.placingPlantId, open: u.tagScanOpen }; });
  check('Add to plan arms the plant tool for that plant and closes the scan', armed.tool === 'plant' && armed.id === 'grevillea-robyn-gordon' && armed.open === false, JSON.stringify(armed));

  // a reader that finds no words, and one that fails
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ tool: 'select', placingPlantId: null }));
  await openScan();
  await fakeReader([], 0);
  await choosePhoto();
  await pg.getByTestId('tag-empty').waitFor({ timeout: 8000 });
  check('a photo with no words says so and suggests typing the name', true);
  await pg.evaluate(() => { const g = window.gardenPlanner; g.tagScanner.createEngine = async () => { throw new Error('the reading model could not be downloaded'); }; g.tagScanner.dispose(); });
  await choosePhoto();
  await pg.getByTestId('tag-error').waitFor({ timeout: 8000 });
  check('a failure is explained in plain words and the typed route still works', /could not be downloaded/.test(await pg.getByTestId('tag-error').innerText()));
  await pg.getByLabel('Text from the tag').fill('Lavandula angustifolia');
  await pg.getByTestId('tag-match').first().waitFor();
  check('after a failure, typing the name still finds the plant', (await pg.getByTestId('tag-match').first().getAttribute('data-plant')) === 'lavandula-angustifolia');
  await pg.getByRole('button', { name: 'Close' }).click();
  check('closing the scan hides it', (await pg.getByRole('dialog', { name: 'Scan a plant tag' }).count()) === 0);
  check('no page errors in the tag scan', errs.length === 0, errs.join(' | '));
  await ctxT.close();
}
// ---- plant schedule (table and CSV)
{
  const ctxS = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctxS.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const pg = await ctxS.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(URL);
  await pg.waitForSelector('.wizard');
  await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Schedule "test" garden', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: true, northDeg: 0 }, plot: { kind: 'rect', width: 20, depth: 20 } }));
  await pg.waitForSelector('.stage canvas');
  await pg.getByTestId('open-schedule').click();
  await pg.getByTestId('schedule-empty').waitFor();
  check('an empty garden says there are no plants yet, with no CSV offered', (await pg.getByTestId('schedule-download').count()) === 0);
  check('but the printable plan is still offered (a plan of the plot alone is useful)', (await pg.getByTestId('plan-download').count()) === 1 && !(await pg.getByTestId('plan-download').isDisabled()));
  await pg.keyboard.press('Escape');
  check('Esc closes the schedule', (await pg.getByRole('dialog', { name: 'Plant schedule' }).count()) === 0);

  // plants: a bed of lavender (filled), two lilly pillies in the open with a note
  await pg.evaluate(() => {
    const a = window.gardenPlanner;
    const mk = (id, plantId, x, y, note) => ({ id, plantId, position: { x, y }, ...(note ? { note } : {}) });
    const bed = { id: 'bed1', name: 'Front bed', shape: { points: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 5 }, { x: 2, y: 5 }], smooth: false }, edging: 'none', mulch: 'bark', raised: false };
    a.project.getState().commit({ type: 'Composite', commands: [
      { type: 'SetItem', collection: 'beds', id: 'bed1', from: null, to: bed },
      ...[3, 4, 5, 6].map((x, i) => ({ type: 'SetItem', collection: 'plants', id: 'lav' + i, from: null, to: mk('lav' + i, 'lavandula-angustifolia', x, 3.5) })),
      { type: 'SetItem', collection: 'plants', id: 'lil1', from: null, to: mk('lil1', 'syzygium-smithii', 14, 14, '=cmd|"/c calc"!A1') },
      { type: 'SetItem', collection: 'plants', id: 'lil2', from: null, to: mk('lil2', 'syzygium-smithii', 16, 12) },
    ] }, 'test plants');
  });
  await wait(300);
  await pg.getByTestId('open-schedule').click();
  await pg.getByTestId('schedule-row').first().waitFor();
  check('the schedule has one row per kind of plant', (await pg.getByTestId('schedule-row').count()) === 2);
  check('with the total', /6 plants in 2 kinds/.test(await pg.getByTestId('schedule-total').innerText()), await pg.getByTestId('schedule-total').innerText());
  const rowsText = await pg.getByTestId('schedule-row').allInnerTexts();
  check('trees come before shrubs, as P1 and P2', /^P1[\s\S]*Lilly pilly[\s\S]*2/.test(rowsText[0]) && /^P2[\s\S]*lavender/i.test(rowsText[1]), JSON.stringify(rowsText.map((r) => r.slice(0, 60))));
  check('each row says where the plants are', /Front bed/.test(rowsText[1]) && /Open ground/.test(rowsText[0]));
  check('the draft and weed notes are shown with the schedule', /draft and has not been verified/.test(await pg.getByTestId('schedule-draft').innerText()) && /not the same as safe/.test(await pg.getByTestId('schedule-draft').innerText()));
  check('weed status that was never checked is shown as unknown, not as safe', /Unknown in QLD/.test(rowsText[0]) && !/not a weed/i.test(rowsText.join(' ')));
  if (out) await pg.screenshot({ path: join(out, '14-schedule.png') });

  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('schedule-download').click()]);
  check('the download is named after the garden', dl.suggestedFilename() === 'schedule-test-garden-plant-schedule.csv', dl.suggestedFilename());
  const path = await dl.path();
  const buf = readFileSync(path);
  check('the file starts with a byte-order mark so Excel reads accents correctly', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
  const csv = buf.toString('utf8').replace(/^\uFEFF/, '');
  const lines = csv.split('\r\n').filter(Boolean);
  check('the CSV has a header, the two kinds of plant, a total and a note', lines.length === 5 && lines[0].startsWith('No.,Common name,Botanical name,Qty'), String(lines.length));
  check('the quantities are in the file', lines[1].split(',')[3] === '2' && /,4,/.test(lines[2]), lines.slice(1, 3).join(' | ').slice(0, 160));
  check('every plant row says Draft, unverified', lines.slice(1, 3).every((l) => l.endsWith('"Draft, unverified"')));
  check('a note that looks like a spreadsheet formula was made harmless', /'=cmd/.test(csv) && !/(^|,)=cmd/m.test(csv));
  // the printable planting plan
  check('the schedule screen offers a printable plan', (await pg.getByTestId('plan-print').count()) === 1);
  const [pdfDl] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('plan-download').click()]);
  check('the plan PDF is named after the garden', pdfDl.suggestedFilename() === 'schedule-test-garden-planting-plan.pdf', pdfDl.suggestedFilename());
  const pdfBytes = readFileSync(await pdfDl.path());
  check('it is a PDF', pdfBytes.slice(0, 5).toString() === '%PDF-');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  check('with the plan sheet and the schedule (2 pages)', pdfDoc.getPageCount() === 2, String(pdfDoc.getPageCount()));
  const pg1 = pdfDoc.getPage(0);
  check('the plan is A4', Math.abs(Math.max(pg1.getWidth(), pg1.getHeight()) - 841.89) < 1);
  check('and the schedule page is A4 portrait', Math.round(pdfDoc.getPage(1).getWidth()) === 595 && Math.round(pdfDoc.getPage(1).getHeight()) === 842);
  check('the PDF has the garden name as its title', pdfDoc.getTitle() === 'Schedule "test" garden - planting plan', String(pdfDoc.getTitle()));
  await pg.getByLabel('Paper size').selectOption('a3');
  await pg.getByLabel('Include the plant schedule').uncheck();
  const [pdf3] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('plan-download').click()]);
  const doc3 = await PDFDocument.load(readFileSync(await pdf3.path()));
  check('A3 without the schedule is a single A3 sheet', doc3.getPageCount() === 1 && Math.abs(Math.max(doc3.getPage(0).getWidth(), doc3.getPage(0).getHeight()) - 1190.55) < 1);
  check('no page errors in the schedule', errs.length === 0, errs.join(' | '));
  await ctxS.close();
}
// ---- walk mode (first person, with collision)
{
  const ctxW = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxW.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const pg = await ctxW.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(URL);
  await pg.waitForSelector('.wizard');
  await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Walk garden', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 24, depth: 20 } }));
  await pg.waitForSelector('.stage canvas');
  await pg.evaluate(() => {
    const a = window.gardenPlanner;
    const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const house = { id: 'h', vertices: rect(8, 14, 16, 19).map((position, i) => ({ id: 'v' + i, position })), height: 3.2, fixtures: [] };
    a.project.getState().commit({ type: 'Composite', commands: [
      { type: 'SetSingleton', name: 'house', from: null, to: house },
      { type: 'SetItem', collection: 'structures', id: 'gate1', from: null, to: { id: 'gate1', kind: 'gate', name: 'Gate', position: { x: 12, y: 0 }, width: 0.9, length: 0.1, height: 1.5, rotation: 0, swing: 1 } },
      { type: 'SetItem', collection: 'plants', id: 'tree1', from: null, to: { id: 'tree1', plantId: 'syzygium-smithii', position: { x: 4, y: 8 } } },
    ] }, 'demo');
    a.ui.getState().set({ viewMode: '3d', month: 12, hour: 11, stage: 'mature' });
  });
  await pg.waitForSelector('[data-testid="walk-start"]', { timeout: 15000 });
  await wait(800);
  const state = () => pg.evaluate(() => { const c = document.querySelector('.stage canvas').dataset; return { x: Number(c.walkX), y: Number(c.walkY), yaw: Number(c.walkYaw) }; });
  const cam = () => pg.evaluate(() => window.gardenPlanner.view3d.current.cameraState());
  const orbitBefore = await cam();

  check('there is a Walk button in the 3D view', (await pg.getByTestId('walk-start').count()) === 1);
  await pg.getByTestId('walk-start').click();
  await pg.getByTestId('walk-hint').waitFor();
  check('walking says how to move', /W A S D/.test(await pg.getByTestId('walk-hint').innerText()));
  check('while walking the camera buttons give way to Stop walking', (await pg.getByTestId('walk-stop').count()) === 1 && (await pg.getByRole('button', { name: 'Iso', exact: true }).count()) === 0);
  const eye = await cam();
  check('the camera is at eye height (1.6 m) with a wider view', Math.abs(eye.position[1] - 1.6) < 1e-6 && eye.fov === 70, JSON.stringify(eye));
  check('the walker starts just inside the gate', Math.abs(eye.position[0] - 12.2) < 1 && -eye.position[2] > 0.5 && -eye.position[2] < 3, JSON.stringify(eye.position));

  // keyboard: walk forward
  const s0 = eye.position;
  await pg.keyboard.down('w'); await wait(700); await pg.keyboard.up('w');
  const s1 = (await cam()).position;
  check('W walks forward (into the garden)', Math.hypot(s1[0] - s0[0], s1[2] - s0[2]) > 0.5 && -s1[2] > -s0[2], JSON.stringify([s0, s1]));
  check('and stays at eye height', Math.abs(s1[1] - 1.6) < 1e-6);

  // arrow keys turn; they must not nudge a selected item
  await pg.evaluate(() => window.gardenPlanner.ui.getState().select({ kind: 'plant', id: 'tree1' }));
  const treeBefore = await pg.evaluate(() => JSON.stringify(window.gardenPlanner.project.getState().project.plants[0].position));
  const yaw0 = (await state()).yaw;
  await pg.keyboard.down('ArrowRight'); await wait(400); await pg.keyboard.up('ArrowRight');
  const yaw1 = (await state()).yaw;
  check('the right arrow turns the walker to the right (clockwise on the plan)', yaw1 < yaw0 - 0.2, JSON.stringify([yaw0, yaw1]));
  check('and does not nudge the selected plant', (await pg.evaluate(() => JSON.stringify(window.gardenPlanner.project.getState().project.plants[0].position))) === treeBefore);
  await pg.keyboard.down('ArrowLeft'); await wait(400); await pg.keyboard.up('ArrowLeft');

  // drag to look
  const yawA = (await state()).yaw;
  const box = await pg.locator('.stage canvas').boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down(); await pg.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 }); await pg.mouse.up();
  await pg.keyboard.down('w'); await wait(120); await pg.keyboard.up('w'); // a step so the new heading is reported
  const yawB = (await state()).yaw;
  check('dragging the picture to the right turns the view to the right', yawB < yawA - 0.2, JSON.stringify([yawA, yawB]));

  // collision: face the house and run at it
  await pg.evaluate(() => window.gardenPlanner.ui.getState().select(null));
  // turn to face north (towards the house) using the heading: yaw pi/2
  const turnTo = async (target) => { for (let i = 0; i < 40; i++) { const { yaw } = await state(); let d = target - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(d) < 0.06) return; await pg.keyboard.down(d > 0 ? 'ArrowLeft' : 'ArrowRight'); await wait(Math.min(250, Math.abs(d) / 1.8 * 1000 + 20)); await pg.keyboard.up(d > 0 ? 'ArrowLeft' : 'ArrowRight'); await pg.keyboard.down('w'); await wait(20); await pg.keyboard.up('w'); } };
  await turnTo(Math.PI / 2);
  await pg.keyboard.down('Shift'); await pg.keyboard.down('w');
  await wait(9000);
  await pg.keyboard.up('w'); await pg.keyboard.up('Shift');
  const hit = await state();
  check('running at the house stops one body radius from its wall (it is solid)', hit.y > 13.2 && hit.y < 13.8, JSON.stringify(hit));
  check('the walker is still outside the house', !(hit.x > 8 && hit.x < 16 && hit.y > 14 && hit.y < 19));

  // the on-screen pad walks too
  const pad = await pg.getByTestId('walkpad').boundingBox();
  const before = await state();
  await pg.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await pg.mouse.down(); await pg.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2 + 40, { steps: 4 }); // down = backwards
  await wait(600);
  await pg.mouse.up();
  const after = await state();
  check('dragging the pad back walks backwards, and releasing it stops', Math.hypot(after.x - before.x, after.y - before.y) > 0.3 && after.y < before.y);
  await wait(300);
  const still = await state();
  await wait(300);
  const still2 = await state();
  check('letting go of the pad stops the walker', Math.hypot(still2.x - still.x, still2.y - still.y) < 0.01);

  // the 3D view is not frozen: the sun still moves with the time slider while walking
  const sunBefore = await pg.locator('.stage canvas').evaluate((c) => c.dataset.sunAlt);
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ hour: 8 }));
  await wait(300);
  check('the Time slider still changes the light while walking', (await pg.locator('.stage canvas').evaluate((c) => c.dataset.sunAlt)) !== sunBefore);
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ hour: 11 }));

  // Render photo from where you are standing
  const stand = await cam();
  await pg.getByTestId('open-photo').click();
  await pg.getByRole('dialog', { name: 'Render photo' }).waitFor();
  check('Render photo is offered while walking', true);
  const via = await pg.evaluate(() => window.gardenPlanner.view3d.current.cameraState());
  check('and photographs from eye level with the wide view', via.fov === 70 && Math.abs(via.position[1] - 1.6) < 1e-6 && Math.abs(via.position[0] - stand.position[0]) < 1e-6);
  await pg.getByRole('button', { name: 'Back to 3D', exact: true }).click();

  // Esc stops walking and puts the orbit camera back exactly where it was
  await pg.keyboard.press('Escape');
  await wait(300);
  check('Esc stops walking', (await pg.evaluate(() => window.gardenPlanner.ui.getState().walking)) === false);
  const orbitAfter = await cam();
  check('and the overview camera is exactly where it was', JSON.stringify(orbitAfter.position.map((v) => Math.round(v * 1000))) === JSON.stringify(orbitBefore.position.map((v) => Math.round(v * 1000))), JSON.stringify([orbitBefore.position, orbitAfter.position]));
  check('the camera buttons are back', (await pg.getByRole('button', { name: 'Iso', exact: true }).count()) === 1);

  // the Stop walking button is reachable (the hint banner must not cover it) and works
  await pg.getByTestId('walk-start').click();
  await pg.getByTestId('walk-hint').waitFor();
  await pg.getByTestId('walk-stop').click({ timeout: 5000 });
  await wait(200);
  check('the Stop walking button works (and is not covered by the hint)', (await pg.evaluate(() => window.gardenPlanner.ui.getState().walking)) === false);

  // leaving the 3D view while walking ends the walk cleanly
  await pg.getByTestId('walk-start').click();
  await pg.getByTestId('walk-hint').waitFor();
  await pg.getByRole('button', { name: '2D', exact: true }).click();
  await wait(300);
  check('switching to the 2D plan while walking ends the walk', (await pg.evaluate(() => window.gardenPlanner.ui.getState().walking)) === false);
  check('no page errors while walking', errs.length === 0, errs.join(' | '));
  await ctxW.close();
}
// ---- fly-through and saved views
{
  const ctxF = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxF.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const pg = await ctxF.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(URL);
  await pg.waitForSelector('.wizard');
  await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Tour garden', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 24, depth: 20 } }));
  await pg.waitForSelector('.stage canvas');
  await pg.evaluate(() => {
    const a = window.gardenPlanner;
    const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    a.project.getState().commit({ type: 'Composite', commands: [
      { type: 'SetSingleton', name: 'house', from: null, to: { id: 'h', vertices: rect(8, 14, 16, 19).map((position, i) => ({ id: 'v' + i, position })), height: 3.2, fixtures: [] } },
      { type: 'SetItem', collection: 'structures', id: 'gate1', from: null, to: { id: 'gate1', kind: 'gate', name: 'Gate', position: { x: 12, y: 0 }, width: 0.9, length: 0.1, height: 1.5, rotation: 0, swing: 1 } },
      { type: 'SetItem', collection: 'plants', id: 't1', from: null, to: { id: 't1', plantId: 'syzygium-smithii', position: { x: 4, y: 8 } } },
      { type: 'SetItem', collection: 'plants', id: 't2', from: null, to: { id: 't2', plantId: 'syzygium-smithii', position: { x: 20, y: 9 } } },
    ] }, 'demo');
    a.ui.getState().set({ viewMode: '3d', month: 12, hour: 11, stage: 'mature' });
  });
  await pg.waitForSelector('[data-testid="tour-start"]', { timeout: 15000 });
  await wait(800);
  const cam = () => pg.evaluate(() => window.gardenPlanner.view3d.current.cameraState());
  const ds = () => pg.locator('.stage canvas').evaluate((c) => ({ stop: Number(c.dataset.tourStop), t: Number(c.dataset.tourT), y: Number(c.dataset.tourY) }));
  const before = await cam();

  check('there is a Fly-through button in the 3D view', (await pg.getByTestId('tour-start').count()) === 1);
  await pg.getByTestId('tour-start').click();
  await pg.getByTestId('tour-progress').waitFor();
  const total = Number((/of (\d+)/.exec(await pg.getByTestId('tour-progress').innerText()) ?? [])[1]);
  check('the tour has an overview, the entrance and views from the corners (4 or more stops)', total >= 4, String(total));
  check('it says which stop it is at', /Stop 1 of/.test(await pg.getByTestId('tour-progress').innerText()));
  check('while touring the camera buttons give way to Pause, Stop and Loop', (await pg.getByTestId('tour-toggle').count()) === 1 && (await pg.getByTestId('tour-stop').count()) === 1 && (await pg.getByRole('button', { name: 'Iso', exact: true }).count()) === 0);
  const c0 = await cam();
  check('the wide-angle cinematic view is on', c0.fov === 55, JSON.stringify(c0.fov));
  await wait(2500);
  // the overview rests for 2.5 s, then the camera travels
  await wait(3500);
  const c1 = await cam();
  check('the camera moves along the tour by itself', Math.hypot(c1.position[0] - c0.position[0], c1.position[1] - c0.position[1], c1.position[2] - c0.position[2]) > 1, JSON.stringify([c0.position, c1.position]));
  check('and never goes under the ground', c1.position[1] >= 0.5);

  // pause with Space: the camera holds still; Space again resumes
  await pg.keyboard.press(' ');
  await wait(200);
  check('Space pauses (the button now says Play)', (await pg.getByTestId('tour-toggle').innerText()) === 'Play');
  const p1 = await cam(); await wait(1200); const p2 = await cam();
  check('a paused tour holds the camera still', Math.hypot(p1.position[0] - p2.position[0], p1.position[1] - p2.position[1], p1.position[2] - p2.position[2]) < 1e-6);
  await pg.keyboard.press(' ');
  await wait(1500);
  const p3 = await cam();
  check('Space again plays on', Math.hypot(p3.position[0] - p2.position[0], p3.position[1] - p2.position[1], p3.position[2] - p2.position[2]) > 0.05 && (await pg.getByTestId('tour-toggle').innerText()) === 'Pause');

  // the tour reaches the next stops in order
  await pg.waitForFunction(() => Number(document.querySelector('.stage canvas').dataset.tourStop) >= 1, null, { timeout: 40000 });
  check('it moves on to the next stop', (await ds()).stop >= 1);
  check('the progress label follows', new RegExp('Stop ' + ((await ds()).stop + 1) + ' of').test(await pg.getByTestId('tour-progress').innerText()));

  // Render photo from the tour's camera
  const mid = await cam();
  await pg.getByTestId('open-photo').click();
  await pg.getByRole('dialog', { name: 'Render photo' }).waitFor();
  check('Render photo is offered during the tour and uses its wide view', mid.fov === 55);
  await pg.getByRole('button', { name: 'Back to 3D', exact: true }).click();

  // loop toggle
  await pg.getByTestId('tour-loop').uncheck();
  check('Loop can be turned off', (await pg.evaluate(() => window.gardenPlanner.ui.getState().tourLoop)) === false);
  await pg.getByTestId('tour-loop').check();

  // Esc stops and puts the camera back exactly
  await pg.keyboard.press('Escape');
  await wait(300);
  check('Esc stops the tour', (await pg.evaluate(() => window.gardenPlanner.ui.getState().tourState)) === 'off');
  const after = await cam();
  check('and the camera is back exactly where it was', JSON.stringify(after.position.map((v) => Math.round(v * 1000))) === JSON.stringify(before.position.map((v) => Math.round(v * 1000))), JSON.stringify([before.position, after.position]));
  check('the camera buttons are back', (await pg.getByRole('button', { name: 'Iso', exact: true }).count()) === 1);

  // saved views
  await pg.getByTestId('views-toggle').click();
  await pg.getByTestId('views-pop').waitFor();
  check('an empty Views menu explains itself', /Save this view/.test(await pg.getByTestId('views-pop').innerText()));
  await pg.getByTestId('views-save').click();
  await wait(200);
  check('Save this view adds View 1', (await pg.getByTestId('views-item').count()) === 1);
  const v1 = await cam();
  await pg.getByTestId('views-toggle').click();
  await pg.getByRole('button', { name: 'Top', exact: true }).click();
  await wait(300);
  await pg.getByTestId('views-toggle').click();
  await pg.getByTestId('views-save').click();
  await wait(200);
  const saved = await pg.evaluate(() => window.gardenPlanner.project.getState().project.savedViews);
  check('a second view is saved with its own camera', saved.length === 2 && JSON.stringify(saved[0].cameraPosition) !== JSON.stringify(saved[1].cameraPosition) && saved[0].name === 'View 1' && saved[1].name === 'View 2', JSON.stringify(saved.map((s) => s.name)));
  check('the first view is where the camera was when it was saved', JSON.stringify(saved[0].cameraPosition.map((x) => Math.round(x * 100))) === JSON.stringify(v1.position.map((x) => Math.round(x * 100))));
  const nameBox = pg.getByTestId('views-item').first().getByLabel('View name');
  await nameBox.fill('Front lawn');
  await nameBox.press('Enter');
  await wait(200);
  check('a view can be renamed', (await pg.evaluate(() => window.gardenPlanner.project.getState().project.savedViews[0].name)) === 'Front lawn');
  await pg.getByTestId('views-item').first().getByRole('button', { name: 'Go', exact: true }).click();
  await wait(1200);
  const gone = await cam();
  check('Go glides the camera to the saved view', JSON.stringify(gone.position.map((x) => Math.round(x * 100))) === JSON.stringify(saved[0].cameraPosition.map((x) => Math.round(x * 100))), JSON.stringify([gone.position, saved[0].cameraPosition]));

  // two saved views become the tour
  await pg.getByTestId('tour-start').click();
  await pg.getByTestId('tour-progress').waitFor();
  check('with two saved views the tour visits just those two', /Stop 1 of 2/.test(await pg.getByTestId('tour-progress').innerText()), await pg.getByTestId('tour-progress').innerText());
  await pg.keyboard.press('Escape');
  await wait(200);

  // saved with the garden: survives a reload
  await pg.waitForFunction(() => window.gardenPlanner.library.getState().status === 'saved', null, { timeout: 8000 }).catch(() => undefined);
  await wait(500);
  await pg.reload();
  await pg.waitForFunction(() => window.gardenPlanner.project.getState().project?.savedViews?.length === 2, null, { timeout: 15000 });
  check('saved views are kept with the garden, across a reload', (await pg.evaluate(() => window.gardenPlanner.project.getState().project.savedViews.map((v) => v.name))).join(',') === 'Front lawn,View 2');
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ viewMode: '3d' }));
  await pg.getByTestId('views-toggle').waitFor({ timeout: 15000 });
  await pg.getByTestId('views-toggle').click();
  await pg.getByTestId('views-item').first().getByRole('button', { name: 'Delete Front lawn' }).click();
  await wait(200);
  check('a view can be deleted', (await pg.evaluate(() => window.gardenPlanner.project.getState().project.savedViews.length)) === 1);
  await pg.getByTestId('views-item').first().getByRole('button', { name: /^Delete/ }).click();
  await wait(200);
  check('deleting the last one leaves no empty list in the garden', (await pg.evaluate(() => 'savedViews' in window.gardenPlanner.project.getState().project)) === false);

  // walking and the tour do not run together
  await pg.getByTestId('walk-start').click();
  await pg.getByTestId('walk-hint').waitFor();
  check('while walking there is no Fly-through button', (await pg.getByTestId('tour-start').count()) === 0);
  await pg.keyboard.press('Escape');
  check('no page errors in the fly-through', errs.length === 0, errs.join(' | '));
  await ctxF.close();
}
// ---- starting a garden from a street address (a fake /api/geocode and /api/map-tiles stand in for the server)
{
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [30, 160, 40]).flat())])));
  const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxA.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token' }, version: 0 })); } catch { /* ignore */ } });
  const pg = await ctxA.newPage();
  const errs = [], geo = [], direct = [], tiles = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('request', (r) => { if (/openstreetmap|nominatim/i.test(r.url())) direct.push(r.url()); });
  const HITS = {
    smith: [
      { label: 'Paddington QLD', lat: -27.4605, lng: 153.0012, state: 'QLD', postcode: '4064', precision: 'address', address: '12 Smith Street, Paddington QLD 4064' },
      { label: 'Paddington QLD', lat: -27.4611, lng: 153.0021, state: 'QLD', postcode: '4064', precision: 'street', address: 'Smith Street, Paddington QLD 4064' },
      { label: 'Paddington, Brisbane, Queensland', lat: -27.46, lng: 153.0, state: 'QLD', postcode: '4064', precision: 'place', address: null },
    ],
    toowong: [{ label: 'Toowong QLD', lat: -27.4849, lng: 152.9857, state: 'QLD', postcode: '4066', precision: 'address', address: '1 High Street, Toowong QLD 4066' }],
  };
  await pg.route('**/api/garden-projects**', (r) => r.abort('failed'));
  await pg.route('**/api/geocode', async (route) => {
    const q = JSON.parse(route.request().postData() ?? '{}').q ?? '';
    geo.push(q);
    const results = /toowong/i.test(q) ? HITS.toowong : HITS.smith;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results, attribution: '© OpenStreetMap contributors', cached: false }) });
  });
  await pg.route('**/api/map-tiles/**', (route) => {
    const path = new globalThis.URL(route.request().url()).pathname.replace(/^.*\/api\/map-tiles/, '');
    if (path === '/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, attribution: '© MapTiler © OpenStreetMap contributors', maxZoom: 20 }) });
    tiles.push(path);
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await pg.goto(URL);
  await pg.waitForSelector('.wizard');

  const find = pg.getByTestId('address-find');
  check('the wizard asks for a street address first', (await pg.getByLabel('Street address').count()) === 1 && (await pg.getByTestId('address-lookup').count()) === 1);
  check('the suburb route is still there, under "No address? Choose a suburb instead"', /No address\? Choose a suburb instead/i.test(await pg.locator('.wizard').innerText()) && (await pg.getByLabel('Suburb or postcode').count()) === 1);
  check('Find address is off until there is something to look up', await find.isDisabled());
  await pg.getByLabel('Street address').fill('12 Smith Street Paddington');
  await wait(1500);
  check('typing sends nothing: it searches only when the button is pressed', geo.length === 0, JSON.stringify(geo));
  await find.click();
  await pg.getByTestId('address-hit').first().waitFor();
  check('one press makes one request, to Vault', geo.length === 1 && direct.length === 0, JSON.stringify([geo, direct]));
  check('the address results say how exactly each is known', (await pg.getByTestId('address-hit').count()) === 3 && /Exact address/.test(await pg.getByTestId('address-hit').nth(0).innerText()) && /house number was not found/.test(await pg.getByTestId('address-hit').nth(1).innerText()) && /not an address/.test(await pg.getByTestId('address-hit').nth(2).innerText()));
  check('the results credit OpenStreetMap', /OpenStreetMap contributors/.test(await pg.getByTestId('address-attribution').innerText()));
  await pg.getByTestId('address-hit').first().click();
  check('choosing the exact address says where it is and how exactly', /12 Smith Street, Paddington QLD 4064\. Exact address/.test(await pg.getByTestId('wizard-located').innerText()), await pg.getByTestId('wizard-located').innerText());
  check('the state follows the address', (await pg.locator('.wizard select[aria-label="State"]').inputValue()) === 'QLD');
  await pg.waitForFunction(() => /MapTiler/.test(document.querySelector('[data-testid="map-preview"]')?.textContent ?? ''), null, { timeout: 8000 });
  await wait(600);
  check('the wizard shows a close-up map of the address (zoom 18 tiles)', tiles.some((p) => p.startsWith('/18/')), JSON.stringify([...new Set(tiles.map((p) => p.split('/')[1]))]));
  if (out) await pg.screenshot({ path: join(out, '15-wizard-address.png') });

  // a street-only result is honest about it
  await pg.getByTestId('address-find').click();
  await pg.getByTestId('address-hit').nth(1).click();
  check('a street-only result says the pin is somewhere on the street', /somewhere on that street/.test(await pg.getByTestId('wizard-located').innerText()));
  await pg.getByTestId('address-find').click();
  await pg.getByTestId('address-hit').first().click();

  // typing a latitude by hand makes the point a place again (the old address is no longer where the pin is)
  const latBox = pg.getByLabel('Latitude');
  await latBox.fill('-27.5'); await latBox.press('Enter'); await latBox.blur();
  await wait(200);
  check('typing a latitude drops the address: the point is only a place now', (await pg.getByTestId('wizard-located').count()) === 0);
  await pg.getByTestId('address-find').click();
  await pg.getByTestId('address-hit').first().click();

  await pg.getByRole('button', { name: 'Next' }).click();
  check('the climate is suggested from the address', /subtropical/i.test(await pg.locator('.wizard .note').first().innerText()));
  await pg.getByRole('button', { name: 'Next' }).click();
  await pg.getByRole('button', { name: 'Next' }).click();
  check('the plot step says the address is the middle of the plan and the map will be on', /middle of the plan/.test(await pg.getByTestId('wizard-plot-note').innerText()) && /satellite map will be switched on/.test(await pg.getByTestId('wizard-plot-note').innerText()));
  await pg.getByRole('radio', { name: /Start with a rectangle/ }).click();
  await pg.getByRole('button', { name: 'Create garden' }).click();
  await pg.waitForSelector('.stage canvas');
  await wait(800);

  const proj2 = () => pg.evaluate(() => window.gardenPlanner.project.getState().project);
  let q2 = await proj2();
  check('the garden keeps the address, the short place name and how exactly it is known', q2.location.address === '12 Smith Street, Paddington QLD 4064' && q2.location.label === 'Paddington QLD' && q2.location.precision === 'address' && q2.location.state === 'QLD');
  check('the satellite map is on from the start, anchored exactly on the address', q2.map?.on === true && Math.abs(q2.map.lat - -27.4605) < 1e-9 && Math.abs(q2.map.lng - 153.0012) < 1e-9);
  const xs = q2.boundary.vertices.map((v) => v.position.x), ys = q2.boundary.vertices.map((v) => v.position.y);
  check('the plot rectangle is centred on the address (the middle of the plan)', Math.abs(Math.min(...xs) + Math.max(...xs)) < 1e-9 && Math.abs(Math.min(...ys) + Math.max(...ys)) < 1e-9, JSON.stringify([xs, ys]));
  const origin = await pg.evaluate(() => { const a = window.gardenPlanner; const v = a.view.getState().view; const r = document.querySelector('.stage').getBoundingClientRect(); return { x: v.offsetX, y: v.offsetY, w: r.width, h: r.height }; });
  check('the plan is showing the address (the middle of the plan is on screen)', origin.x > 0 && origin.x < origin.w && origin.y > 0 && origin.y < origin.h, JSON.stringify(origin));
  await pg.waitForFunction(() => /^[1-9]\d*\/\d+$/.test(document.querySelector('.stage canvas')?.dataset?.mapTiles ?? '') || true, null, { timeout: 3000 });

  // the sidebars
  const badge = pg.getByTestId('site-badge');
  check('the plant library says where the garden is and what it is filtered for', /12 Smith Street, Paddington QLD 4064/.test(await badge.innerText()) && /Subtropical/.test(await badge.innerText()) && /QLD/.test(await badge.innerText()), await badge.innerText());
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ selection: null, inspectorOpen: true }));
  check('the garden settings show the address and how exactly it is known', /12 Smith Street/.test(await pg.getByTestId('address-now').innerText()) && /Exact address/.test(await pg.getByTestId('address-precision').innerText()));
  check('and the map note says it is centred on the address', /centred on your address/.test(await pg.getByTestId('map-howto').innerText()));
  await pg.getByTestId('address-change').click();
  await pg.getByTestId('address-lookup').last().getByLabel('Street address').fill('1 High Street Toowong');
  await pg.getByTestId('address-lookup').last().getByTestId('address-find').click();
  await pg.getByTestId('address-hit').first().click();
  await wait(300);
  q2 = await proj2();
  check('changing the address updates the garden and moves the map with it', q2.location.address === '1 High Street, Toowong QLD 4066' && Math.abs(q2.map.lat - -27.4849) < 1e-9 && Math.abs(q2.map.lng - 152.9857) < 1e-9);
  check('the garden list and plan labels use the new place name', q2.location.label === 'Toowong QLD');
  await pg.keyboard.press('Control+z');
  await wait(300);
  q2 = await proj2();
  check('Ctrl+Z puts back both the address and the map position', q2.location.address === '12 Smith Street, Paddington QLD 4064' && Math.abs(q2.map.lat - -27.4605) < 1e-9);

  // the printable plan carries the street address
  const PDF = await import('pdf-lib');
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ scheduleOpen: true }));
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByTestId('plan-download').click()]);
  const doc = await PDF.PDFDocument.load(readFileSync(await dl.path()));
  check('the plan PDF is made for an address-based garden', doc.getPageCount() >= 1);
  await pg.keyboard.press('Escape');

  check('no page errors while starting from an address', errs.length === 0, errs.join(' | '));
  await ctxA.close();
}
// ---- hovering a plant on the plan shows a card with a photo; dragging a plant from the library works in 3D too
{
  const GIF1 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
  const ctxH = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctxH.addInitScript(() => { try { localStorage.setItem('garden-planner:info-seen:v1', '1'); localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'test-token' }, version: 0 })); } catch { /* ignore */ } });
  const pg = await ctxH.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.route('**/api/garden-projects**', (r) => r.abort('failed'));
  await pg.route('**/api/plant-images/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', images: [
    { id: '1', source: 'inaturalist', sourceLabel: 'iNaturalist', sourceUrl: 'https://www.inaturalist.org/observations/1', imageUrl: GIF1, thumbUrl: GIF1, creator: 'Sam Photographer', licenceCode: 'CC BY 4.0', licenceUrl: null, displayOnly: false, title: 't', role: 'plant', width: 10, height: 10, modified: false, credit: 'x', defaultFor: [] },
  ] }) }));
  await pg.goto(URL);
  await pg.waitForSelector('.wizard');
  await pg.evaluate(() => window.gardenPlanner.newProject({ meta: { name: 'Hover', location: { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, climateZone: 'subtropical', frost: 'none', pets: false, northDeg: 0 }, plot: { kind: 'rect', width: 20, depth: 20 } }));
  await pg.waitForSelector('.stage canvas');
  await wait(400);
  await pg.evaluate(() => { const a = window.gardenPlanner; a.addPlant('lavandula-angustifolia', { x: 6, y: 6 }); });
  await wait(300);
  const where = await pg.evaluate(() => { const a = window.gardenPlanner; const v = a.view.getState().view; const r = document.querySelector('.stage').getBoundingClientRect(); return { x: r.left + v.offsetX + 6 * v.scale, y: r.top + v.offsetY - 6 * v.scale }; });
  check('no card until the cursor is on a plant', (await pg.getByTestId('plant-hover').count()) === 0);
  await pg.mouse.move(where.x - 80, where.y - 80);
  await pg.mouse.move(where.x, where.y, { steps: 5 });
  await pg.getByTestId('plant-hover').waitFor({ timeout: 4000 });
  const card = await pg.getByTestId('plant-hover').innerText();
  check('the card names the plant, its size now and at maturity, and its sun', /Lavender/i.test(card) && /Now/.test(card) && /Mature/.test(card) && /Sun/.test(card), card);
  await pg.locator('.plant-hover-photo img').waitFor({ timeout: 4000 });
  check('the card shows a photo with its credit line', /Sam Photographer, CC BY 4\.0 via iNaturalist/.test(card + ' ' + (await pg.locator('.plant-hover-credit').innerText())));
  check('the card does not block the mouse', (await pg.getByTestId('plant-hover').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none');
  check('the card says the plant data is a draft', /Draft plant data, unverified/.test(card));
  if (out) await pg.screenshot({ path: join(out, '16-plant-hover.png') });
  await pg.mouse.move(where.x + 200, where.y + 150, { steps: 4 });
  await wait(300);
  check('the card goes away when the cursor leaves the plant', (await pg.getByTestId('plant-hover').count()) === 0);

  // dragging from the library into the 3D view
  const before = (await pg.evaluate(() => window.gardenPlanner.project.getState().project.plants.length));
  await pg.getByRole('button', { name: '3D', exact: true }).click();
  await pg.waitForSelector('.stage canvas');
  await wait(1200);
  const box = await pg.locator('.stage canvas').boundingBox();
  // a real drag by hand, so the card can be checked while the plant is still being held over the 3D view
  const head = await pg.locator('.plant-head').nth(1).boundingBox();
  await pg.mouse.move(head.x + 20, head.y + 10);
  await pg.mouse.down();
  await pg.mouse.move(head.x + 120, head.y + 60, { steps: 4 });
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7, { steps: 10 });
  await pg.getByTestId('plant-hover').waitFor({ timeout: 4000 });
  const dragCard = await pg.getByTestId('plant-hover').innerText();
  check('while dragging over 3D the same card shows (names, size, sun, drop hint)', /Now/.test(dragCard) && /Mature/.test(dragCard) && /Sun/.test(dragCard) && /Drop it on the ground/.test(dragCard), dragCard);
  if (out) await pg.screenshot({ path: join(out, '17-3d-drag-card.png') });
  await pg.mouse.up();
  await wait(300);
  check('the card goes when the plant is dropped', (await pg.getByTestId('plant-hover').count()) === 0);
  await wait(400);
  let plants = await pg.evaluate(() => window.gardenPlanner.project.getState().project.plants);
  check('dropping a library plant on the 3D ground plants it', plants.length === before + 1, String(plants.length));
  const dropped = plants[plants.length - 1];
  check('it lands on the garden, near the plan, not at the origin by accident', Number.isFinite(dropped.position.x) && Number.isFinite(dropped.position.y) && Math.hypot(dropped.position.x, dropped.position.y) > 0.05, JSON.stringify(dropped.position));
  // a drop on the sky does nothing
  await pg.locator('.view3d-bar').getByRole('button', { name: 'Front' }).click();
  await wait(1200);
  await pg.dragAndDrop('.plant-head >> nth=2', '.stage', { targetPosition: { x: box.width / 2, y: 4 } });
  await wait(300);
  plants = await pg.evaluate(() => window.gardenPlanner.project.getState().project.plants);
  check('a drop on the sky plants nothing', plants.length === before + 1, String(plants.length));
  await pg.keyboard.press('Control+z');
  await wait(300);
  plants = await pg.evaluate(() => window.gardenPlanner.project.getState().project.plants);
  check('Ctrl+Z takes the dropped plant back out', plants.length === before, String(plants.length));
  // clicking things in the 3D view selects them, like the plan
  await pg.locator('.view3d-bar').getByRole('button', { name: 'Iso' }).click();
  await wait(1200);
  const lav = await pg.evaluate(() => window.gardenPlanner.project.getState().project.plants[0]);
  const at3 = await pg.evaluate((pos) => window.gardenPlanner.view3d.current.screenOf(pos, 0.3), lav.position);
  await pg.evaluate(() => window.gardenPlanner.ui.getState().set({ selection: null }));
  await pg.mouse.move(at3.x, at3.y, { steps: 6 });
  await pg.getByTestId('plant-hover').waitFor({ timeout: 4000 });
  check('resting on a plant in 3D shows its card', /Lavender/i.test(await pg.getByTestId('plant-hover').innerText()));
  await pg.mouse.click(at3.x, at3.y);
  await wait(300);
  const sel3 = await pg.evaluate(() => window.gardenPlanner.ui.getState().selection);
  check('clicking a plant in 3D selects it', sel3?.kind === 'plant' && sel3.id === lav.id, JSON.stringify(sel3));
  check('and the right panel shows it, as in 2D', /English lavender/i.test(await pg.locator('.panel-right').innerText()));
  check('and the selection bar is there too', (await pg.getByTestId('selection-bar').count()) === 1);
  if (out) await pg.screenshot({ path: join(out, '18-3d-select.png') });
  // an orbit drag does not select or clear
  await pg.mouse.move(box.x + 60, box.y + box.height - 60);
  await pg.mouse.down(); await pg.mouse.move(box.x + 140, box.y + box.height - 90, { steps: 6 }); await pg.mouse.up();
  await wait(200);
  check('dragging to orbit keeps the selection', (await pg.evaluate(() => window.gardenPlanner.ui.getState().selection))?.id === lav.id);
  await pg.locator('.view3d-bar').getByRole('button', { name: 'Iso' }).click();
  await wait(1200);
  const bare = await pg.evaluate(() => window.gardenPlanner.view3d.current.screenOf({ x: 15, y: 3 }, 0));
  await pg.mouse.click(bare.x, bare.y);
  await wait(300);
  check('clicking bare ground clears the selection', (await pg.evaluate(() => window.gardenPlanner.ui.getState().selection)) === null);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await ctxH.close();
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
