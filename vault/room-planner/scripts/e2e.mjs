// End-to-end checks of the real UI in Chrome. Start `npm run dev` first, then `node scripts/e2e.mjs [screenshotDir]`.
// Exits non-zero if any check fails. (Playwright-core, installed channel "chrome".)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`);
  if (!ok) failures++;
};
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text().slice(0, 200)}`); });

const shot = async (name) => { if (out) await page.screenshot({ path: join(out, `${name}.png`) }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const S = () => ev(() => {
  const s = window.roomPlanner.project.getState();
  const r = s.project.rooms[0];
  const u = window.roomPlanner.ui.getState();
  return {
    rooms: s.project.rooms.length, hist: s.historyLength(), undo: s.undoLabel, redo: s.redoLabel, canUndo: s.canUndo, canRedo: s.canRedo,
    walls: r?.walls.map((w) => w.thickness), selection: u.selection, tool: u.tool, placing: u.placing, status: u.status?.text,
    furniture: Object.fromEntries((r?.furniture ?? []).map((f) => [f.definitionId, { id: f.id, x: f.position.x, y: f.position.y, rot: f.rotation, w: f.width, l: f.length, h: f.height, el: f.elevation, locked: !!f.locked, meta: f.metadata ?? null }])),
    fixtures: (r?.fixtures ?? []).map((f) => ({ id: f.id, type: f.type, wallId: f.wallId, off: f.offsetAlongWall, w: f.width, h: f.height, el: f.elevation, hinge: f.hingeSide, swing: f.swingAngle })),
  };
});
const at = (x, y) => ev(([x, y]) => {
  const r = document.querySelector('[data-testid=stage]').getBoundingClientRect();
  const v = window.roomPlanner.view.getState().view;
  return { x: r.left + v.offsetX + x * v.scale, y: r.top + v.offsetY - y * v.scale };
}, [x, y]);
const click = async (x, y, o = {}) => { const p = await at(x, y); await page.mouse.click(p.x, p.y, o); await page.waitForTimeout(60); };
const moveTo = async (x, y, steps = 6) => { const p = await at(x, y); await page.mouse.move(p.x, p.y, { steps }); };
const drag = async (a, b, { hold = false, steps = 12, shift = false } = {}) => {
  const p = await at(...a); const q = await at(...b);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps });
  if (!hold) { await page.mouse.up(); if (shift) await page.keyboard.up('Shift'); await page.waitForTimeout(80); }
};
const card = (name) => page.locator('.card', { hasText: name }).first();
const nodes = (fn, arg) => ev(fn, arg);

// ------------------------------------------------------------------ 1. empty state and room creation
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
check('empty state shows the two ways to begin', (await page.getByText('Start with a room').count()) === 1 && (await page.getByRole('button', { name: /Draw a room/ }).isDisabled()));
check('Undo/Redo disabled at the start', (await page.getByRole('button', { name: /^Undo/ }).isDisabled()) && (await page.getByRole('button', { name: /^Redo/ }).isDisabled()));
await page.getByRole('button', { name: /Start from a rectangle/ }).click();
await page.waitForTimeout(250);
let s = await S();
check('Start from a rectangle = one undoable CreateRoom', s.rooms === 1 && s.hist === 1 && s.undo === 'Create room');
await shot('e01-room');
await page.keyboard.press('Control+z');
s = await S();
check('undo returns to the empty state (prompt is back)', s.rooms === 0 && (await page.getByText('Start with a room').count()) === 1);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);
s = await S();
check('redo brings the room back', s.rooms === 1);

// ------------------------------------------------------------------ 2. unequal wall thickness (numeric, inspector)
await click(2, -0.07);
s = await S();
check('SELECT tool selects a wall', s.selection.length === 1 && s.selection[0].kind === 'wall');
let input = page.locator('.panel.right input').first();
await input.fill('0.2'); await input.press('Enter');
await click(4.1, 2.5); input = page.locator('.panel.right input').first();
await input.fill('300mm'); await input.press('Enter');
s = await S();
check('thickness edits commit as EditWall (mm accepted, quantized)', s.walls[0] === 0.2 && s.walls[1] === 0.3 && s.walls[2] === 0.15, JSON.stringify(s.walls));
await input.fill('abc');
check('a bad value shows a message and an invalid state', (await page.locator('.field-msg').count()) === 1);
await input.press('Enter');
s = await S();
check('invalid input reverts on Enter (no change)', s.walls[1] === 0.3);
await page.keyboard.press('Escape');
await shot('e02-walls');

// ------------------------------------------------------------------ 3. door and window with the wall-snap ghost
await card('Door').click();
await moveTo(1.5, 0.3);
check('door ghost follows the pointer', (await page.getByText(/rotates|Move into the plan/).count()) >= 1);
await click(1.5, 0.3);
await card('Window').click();
await moveTo(3.5, 3.0); await click(3.5, 3.0);
s = await S();
check('door and window placed with default sizes', s.fixtures.length === 2 && s.fixtures.some((f) => f.type === 'door' && f.w === 0.82 && f.h === 2.04 && f.el === 0) && s.fixtures.some((f) => f.type === 'window' && f.w === 1.2 && f.h === 1.2 && f.el === 0.9), JSON.stringify(s.fixtures));
check('placing selects the new fixture and shows the fixture inspector', (await page.getByText('Hinge side').count()) + (await page.getByText('Offset along wall').count()) >= 1);
await shot('e03-fixtures');
const doorId = s.fixtures.find((f) => f.type === 'door').id;
await click(1.5, -0.05);
s = await S();
check('fixtures are selectable (click the opening)', s.selection[0]?.id === doorId);
const widthField = page.locator('.field', { hasText: /^Width/ }).locator('input');
await widthField.fill('0.9'); await widthField.press('Enter');
s = await S();
check('fixture width edit = UpdateFixture', s.fixtures.find((f) => f.id === doorId).w === 0.9 && s.undo === 'Edit Door');
await page.locator('.field', { hasText: /^Offset along wall/ }).locator('input').fill('0.2');
await page.keyboard.press('Enter');
s = await S();
check('an invalid fixture offset is rejected (reverts) with a message', s.fixtures.find((f) => f.id === doorId).off === 1.5);
await page.waitForTimeout(650); // outside the 500 ms pick-cycle window (B6)
await click(1.5, -0.05);
await page.locator('select').selectOption('right');
s = await S();
check('hinge side is editable', s.fixtures.find((f) => f.id === doorId).hinge === 'right');
await page.waitForTimeout(650);
await click(1.5, -0.05);
await page.getByRole('button', { name: /Delete/ }).last().click();
s = await S();
check('fixture delete = DeleteFixture, undo restores it', s.fixtures.length === 1 && s.undo === 'Delete Door');
await page.keyboard.press('Control+z');
s = await S();
check('undo restores the deleted door', s.fixtures.length === 2);

// ------------------------------------------------------------------ 4. furniture
await card('3-seat sofa').click();
await moveTo(2.0, 4.1); await click(2.0, 4.1);
await card('Coffee table').click();
await moveTo(2.0, 2.9); await click(2.0, 2.9);
await card('Wardrobe').click();
await moveTo(3.2, 1.3); await click(3.2, 1.3);
s = await S();
check('sofa, coffee table and wardrobe placed', ['sofa-3', 'coffee-table', 'wardrobe'].every((d) => s.furniture[d]), JSON.stringify(Object.keys(s.furniture)));
check('placement labels the history entry', s.undo === 'Place Wardrobe');
await shot('e04-furniture');

// scene graph checks: blueprint glyph + front marker on everything, dashed only above the cut-plane
const scene = await nodes(() => {
  const r = window.roomPlannerRenderer;
  const groups = r.stage.find('Group').filter((g) => g.getLayer() === r.stage.getLayers()[1]);
  return groups.map((g) => {
    const kids = g.getChildren();
    const marker = kids.filter((k) => k.className === 'Line' && k.closed() && k.fill() && k.points().length === 6).length;
    const dashed = kids.some((k) => (k.dash?.() ?? []).length > 0 && k.className !== 'Line' ? true : (k.className === 'Line' && (k.dash?.() ?? []).length > 0));
    return { n: kids.length, marker, dashed, w: Math.round(g.scaleX()) };
  });
});
check('every furniture drawing has a front marker and is more than a bare rectangle', scene.length === 3 && scene.every((g) => g.marker === 1 && g.n > 3), JSON.stringify(scene));
check('only the wardrobe (above the 1.2 m cut-plane) is drawn dashed', scene.filter((g) => g.dashed).length === 1, JSON.stringify(scene));

// move: one drag, one history entry, label
let before = await S();
await click(2.0, 2.9);
await drag([2.0, 2.9], [2.0, 2.3]);
s = await S();
check('a drag adds exactly one history entry', s.hist === before.hist + 1 && s.undo === 'Move Coffee table', `${before.hist}->${s.hist} ${s.undo}`);
check('the table moved', Math.abs(s.furniture['coffee-table'].y - before.furniture['coffee-table'].y) > 0.3);

// rotate key
await page.keyboard.press('r');
s = await S();
check('R rotates the selection 45 degrees (stored value)', near(s.furniture['coffee-table'].rot, Math.PI / 4, 1e-6) && s.undo === 'Rotate Coffee table');
await page.keyboard.press('r'); await page.keyboard.press('r'); await page.keyboard.press('r');
s = await S();
check('four presses of R = 180 degrees with no drift', near(s.furniture['coffee-table'].rot, Math.PI, 1e-9));
for (let i = 0; i < 4; i++) await page.keyboard.press('r');
s = await S();
check('eight presses of R return to exactly 0', s.furniture['coffee-table'].rot === 0);

// resize with a handle
const t0 = (await S()).furniture['coffee-table'];
await click(t0.x, t0.y);
await drag([t0.x + t0.w / 2, t0.y], [t0.x + t0.w / 2 + 0.4, t0.y]);
s = await S();
check('right-edge handle grows the width, one entry', near(s.furniture['coffee-table'].w, t0.w + 0.4, 0.06) && s.undo === 'Resize Coffee table', JSON.stringify(s.furniture['coffee-table']));

// rotate handle
const t1 = s.furniture['coffee-table'];
const handleY = t1.y + t1.l / 2 + 24 / 100;
const rad = handleY - t1.y;
await drag([t1.x, handleY], [t1.x + rad * Math.cos((75 * Math.PI) / 180), t1.y + rad * Math.sin((75 * Math.PI) / 180)]); // 15 degrees clockwise: stays valid
s = await S();
check('rotation handle rotates 1:1 and snaps to 15-degree steps', s.undo === 'Rotate Coffee table' && near((s.furniture['coffee-table'].rot * 180) / Math.PI % 15, 0, 0.11) || near((s.furniture['coffee-table'].rot * 180) / Math.PI % 15, 15, 0.11), String((s.furniture['coffee-table'].rot * 180) / Math.PI));

// invalid drag: animate back, nothing committed
before = await S();
const sofa0 = before.furniture['sofa-3'];
await click(sofa0.x, sofa0.y);
await drag([sofa0.x, sofa0.y], [0.1, sofa0.y], { hold: true });
check('invalid drag shows the constraint message while dragging', (await page.locator('.statusbar .msg.hard').count()) === 1, await page.locator('.statusbar').innerText());
await shot('e05-invalid');
await page.mouse.up();
await page.waitForTimeout(500);
s = await S();
check('release in an invalid place: nothing committed, object back where it was', s.hist === before.hist && near(s.furniture['sofa-3'].x, sofa0.x, 0.001));

// zero store updates while dragging
await click(sofa0.x, sofa0.y);
await ev(() => { const a = window.roomPlanner; window.__n = { p: 0, u: 0, v: 0 }; a.project.subscribe(() => window.__n.p++); a.ui.subscribe(() => window.__n.u++); a.view.subscribe(() => window.__n.v++); });
await drag([sofa0.x, sofa0.y], [sofa0.x - 0.4, sofa0.y - 0.3], { hold: true, steps: 40 });
const during = await ev(() => ({ ...window.__n }));
await page.mouse.up();
await page.waitForTimeout(100);
const after = await ev(() => ({ ...window.__n }));
check('40 pointer moves caused zero project/ui/view store updates', during.p === 0 && during.u === 0 && during.v === 0, JSON.stringify(during));
check('the release committed exactly one project update', after.p === 1, JSON.stringify(after));

// lock
await click(sofa0.x - 0.4, sofa0.y - 0.3);
await page.getByTitle('Lock in place').first().click();
s = await S();
check('lock is an undoable UpdateFurniture', s.furniture['sofa-3'].locked && s.undo === 'Lock 3-seat sofa');
const lockedBefore = await S();
await drag([sofa0.x - 0.4, sofa0.y - 0.3], [2.5, 3.5]);
s = await S();
check('a locked object does not move and says why', s.hist === lockedBefore.hist && /locked/.test((await page.locator('.statusbar').innerText())), await page.locator('.statusbar').innerText());
await page.getByTitle('Unlock').first().click();

// metadata
await click(s.furniture['sofa-3'].x, s.furniture['sofa-3'].y);
const vendor = page.locator('.field', { hasText: /^Vendor/ }).locator('input');
await vendor.fill('Acme'); await vendor.press('Enter');
s = await S();
check('metadata edit = one command (vendor)', s.furniture['sofa-3'].meta?.vendor === 'Acme' && s.undo === 'Edit 3-seat sofa');
await page.keyboard.press('Control+z');
// (focus left the input on Enter; the shortcut applies to the canvas)
s = await S();
check('undo reverts the metadata edit', s.furniture['sofa-3'].meta === null);

// ------------------------------------------------------------------ 5. clearance overlay, marquee, group ops
await click(s.furniture['sofa-3'].x, s.furniture['sofa-3'].y);
await page.getByTitle('Show clearance zones of the selection').click();
await page.waitForTimeout(200); // the scene redraws on the next animation frame
const zones = await nodes(() => window.roomPlannerRenderer.stage.find('Line').filter((l) => l.closed() && (l.dash?.() ?? []).length === 2 && l.fill() && String(l.fill()).startsWith('rgba(245,158,11')).length);
check("clearance toggle draws the selected object's zones", zones >= 1, JSON.stringify(await ev(() => ({
  show: window.roomPlanner.ui.getState().showClearances, sel: window.roomPlanner.ui.getState().selection,
  defs: window.roomPlanner.project.getState().project.rooms[0].furniture.map((f) => `${f.definitionId}@${f.position.x},${f.position.y}`),
  dashed: window.roomPlannerRenderer.stage.find('Line').filter((l) => (l.dash?.() ?? []).length === 2).map((l) => String(l.fill())),
}))));
await shot('e06-clearance');
await page.getByTitle('Show clearance zones of the selection').click();

await page.keyboard.press('Escape');
before = await S();
await drag([0.15, 4.85], [4.06, 0.1]); // marquee over everything inside the walls
s = await S();
check('marquee selects fully-contained furniture', s.selection.length >= 3 && s.selection.every((x) => x.kind === 'furniture' || x.kind === 'fixture'), JSON.stringify(s.selection.map((x) => x.kind)));
await page.keyboard.press('Escape');
const a1 = (await S()).furniture;
await click(a1['wardrobe'].x, a1['wardrobe'].y);
await page.keyboard.down('Shift'); await click(a1['coffee-table'].x, a1['coffee-table'].y); await page.keyboard.up('Shift');
s = await S();
check('shift-click adds to the selection', s.selection.length === 2);
before = await S();
await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
s = await S();
check('arrow keys nudge the group: one Composite per key press', s.hist === before.hist + 2 && near(s.furniture['wardrobe'].x, before.furniture['wardrobe'].x - 0.02, 0.0011));
await page.keyboard.press('Delete');
s = await S();
check('Delete removes the group as ONE entry', !s.furniture['wardrobe'] && !s.furniture['coffee-table'] && s.undo === 'Delete 2 objects');
await page.keyboard.press('Control+z');
s = await S();
check('undo restores both', !!s.furniture['wardrobe'] && !!s.furniture['coffee-table']);

// ------------------------------------------------------------------ 6. measure, save/open, reload
await page.keyboard.press('Escape');
await page.keyboard.press('4');
await click(1, 1); await click(3, 1);
const allText = await ev(() => window.roomPlannerRenderer.stage.find('Text').map((t) => t.text()));
check('measure tool shows the distance, and the room area label is present', allText.some((t) => t.startsWith('2.000 m')) && allText.some((t) => t.includes('²')), JSON.stringify(allText));
await page.keyboard.press('1');
check('shortcut 1 returns to Select', (await S()).tool === 'select');

const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save file/ }).click()]);
const saved = await download.createReadStream().then((st) => new Promise((res) => { let d = ''; st.on('data', (c) => (d += c)); st.on('end', () => res(d)); }));
check('Save file downloads valid project JSON', JSON.parse(saved).schemaVersion === 1 && JSON.parse(saved).rooms[0].furniture.length === 3);
await page.waitForTimeout(500);
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
s = await S();
check('reload restores the project from this browser', s.rooms === 1 && Object.keys(s.furniture).length === 3, JSON.stringify({ rooms: s.rooms, f: Object.keys(s.furniture) }));
check('...but undo history starts fresh and the UI does not pretend otherwise', !s.canUndo && !s.canRedo && (await page.getByRole('button', { name: /^Undo/ }).isDisabled()));
check('the autosave label never mentions undo', !/undo/i.test(await page.locator('.save').innerText()));
await page.getByRole('button', { name: /New/ }).click().catch(() => {});
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: /^New$/ }).click().catch(() => {});
await page.waitForTimeout(300);
s = await S();
check('New clears the project (after confirmation)', s.rooms === 0);
await page.locator('input[type=file]').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
await page.waitForTimeout(500);
s = await S();
check('Open loads a saved file', s.rooms === 1 && Object.keys(s.furniture).length === 3);
await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{nope') });
await page.waitForTimeout(300);
check('a bad file is explained, nothing is lost', (await S()).rooms === 1 && /Could not open/.test(await page.locator('.statusbar').innerText()));
await shot('e07-final');

// ------------------------------------------------------------------ 7. touch targets on a coarse-pointer device
const touch = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
const tp = await touch.newPage();
await tp.goto(URL);
await tp.waitForSelector('[data-testid=stage] canvas');
const small = await tp.evaluate(() => [...document.querySelectorAll('button:not([disabled]), input:not([hidden]), select, .card')]
  .filter((el) => el.offsetParent !== null)
  .map((el) => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('title') || el.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter((x) => x.h < 44 || x.w < 44));
check('every visible control is at least 44 Ã— 44 px on a touch device', small.length === 0, JSON.stringify(small));
await touch.close();

check('no console errors or warnings', problems.length === 0, problems.slice(0, 5).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);




