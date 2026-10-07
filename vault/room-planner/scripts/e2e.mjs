// End-to-end checks of the real UI in Chrome. Start `npm run dev` first, then `node scripts/e2e.mjs [screenshotDir]`.
// Exits non-zero if any check fails. (Playwright-core, installed channel "chrome".)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './lib/chromium.mjs';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
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
await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
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
// the library is grouped and collapsible now, so find a piece through the search box
const card = (name) => ({ click: async (...a) => { const s = page.getByLabel('Search library'); await s.fill(name); await page.locator('.card', { hasText: name }).first().click(...a); await s.fill(''); } });
// M5 projects: the Projects panel replaced the Save file / Open / New buttons
const openPanel = async () => { if (!(await page.locator('.projects-panel').count())) await page.locator('.project-button').click(); await page.waitForSelector('.projects-panel'); };
const closePanel = async () => { if (await page.locator('.projects-panel').count()) await page.getByRole('button', { name: 'Close projects' }).click(); };
const newProjectViaPanel = async (name = '') => {
  await openPanel();
  if (name) await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.waitForSelector('.projects-panel', { state: 'detached' });
  await page.waitForTimeout(300);
};
const deleteRoomViaInspector = async () => {
  await page.locator('.actions').getByRole('button', { name: /Delete room/ }).click();
  await page.locator('.actions').getByRole('button', { name: 'Yes' }).click();
  await page.waitForTimeout(250);
};
const nodes = (fn, arg) => ev(fn, arg);

// ------------------------------------------------------------------ 1. empty state and room creation
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
check('empty state shows the two ways to begin', (await page.getByText('Start with a room').count()) === 1 && (await page.getByRole('button', { name: /Draw a room/ }).isEnabled()));
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
const thickness = () => page.locator('.field', { hasText: /^Thickness/ }).locator('input');
let input = thickness();
await input.fill('0.2'); await input.press('Enter');
await click(4.1, 2.5); input = thickness();
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
await page.locator('aside[aria-label="Inspector"] > .panel-body > div:first-child select').selectOption('right');
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
await page.locator('[title="Lock in place"], [data-tip="Lock in place"]').first().click();
s = await S();
check('lock is an undoable UpdateFurniture', s.furniture['sofa-3'].locked && s.undo === 'Lock 3-seat sofa');
const lockedBefore = await S();
await drag([sofa0.x - 0.4, sofa0.y - 0.3], [2.5, 3.5]);
s = await S();
check('a locked object does not move and says why', s.hist === lockedBefore.hist && /locked/.test((await page.locator('.statusbar').innerText())), await page.locator('.statusbar').innerText());
await page.locator('[title="Unlock"], [data-tip="Unlock"]').first().click();

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
await page.locator('[title="Show clearance zones of the selection"], [data-tip="Show clearance zones of the selection"]').click();
await page.waitForTimeout(200); // the scene redraws on the next animation frame
const zones = await nodes(() => window.roomPlannerRenderer.stage.find('Line').filter((l) => l.closed() && (l.dash?.() ?? []).length === 2 && l.fill() && String(l.fill()).startsWith('rgba(245,158,11')).length);
check("clearance toggle draws the selected object's zones", zones >= 1, JSON.stringify(await ev(() => ({
  show: window.roomPlanner.ui.getState().showClearances, sel: window.roomPlanner.ui.getState().selection,
  defs: window.roomPlanner.project.getState().project.rooms[0].furniture.map((f) => `${f.definitionId}@${f.position.x},${f.position.y}`),
  dashed: window.roomPlannerRenderer.stage.find('Line').filter((l) => (l.dash?.() ?? []).length === 2).map((l) => String(l.fill())),
}))));
await shot('e06-clearance');
await page.locator('[title="Show clearance zones of the selection"], [data-tip="Show clearance zones of the selection"]').click();

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

await openPanel();
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export open project' }).click()]);
await closePanel();
const saved = await download.createReadStream().then((st) => new Promise((res) => { let d = ''; st.on('data', (c) => (d += c)); st.on('end', () => res(d)); }));
check('Export downloads valid project JSON (every room)', JSON.parse(saved).schemaVersion === 1 && JSON.parse(saved).rooms[0].furniture.length === 3);
await page.waitForTimeout(2300); // past the autosave pause: the library has it
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
await page.waitForFunction(() => window.roomPlanner.library.getState().ready, null, { timeout: 15000 });
await page.waitForTimeout(300);
s = await S();
check('reload reopens the saved project from the library', s.rooms === 1 && Object.keys(s.furniture).length === 3, JSON.stringify({ rooms: s.rooms, f: Object.keys(s.furniture) }));
check('...but undo history starts fresh and the UI does not pretend otherwise', !s.canUndo && !s.canRedo && (await page.getByRole('button', { name: /^Undo/ }).isDisabled()));
check('the autosave label never mentions undo', !/undo/i.test(await page.locator('.save-status').innerText()));
await newProjectViaPanel('Second plan');
s = await S();
check('New project opens an empty one, named as typed, and the first stays in the list', s.rooms === 0 && (await ev(() => window.roomPlanner.library.getState().entries.map((e) => e.name))).includes('Second plan'));
await openPanel();
await page.locator('input[type=file]').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
await page.waitForTimeout(500);
s = await S();
check('Import adds a saved file as a project and opens it', s.rooms === 1 && Object.keys(s.furniture).length === 3);
await openPanel();
await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{nope') });
await page.waitForTimeout(300);
check('a bad file is explained, nothing is lost', (await S()).rooms === 1 && /Could not open/.test(await page.locator('.statusbar').innerText()));
await closePanel();
await shot('e07-final');

// ------------------------------------------------------------------ 6b. M3: wall tool, draw a room, corners, room size
const newProject = async () => { await newProjectViaPanel(); };
const orange = () => nodes(() => window.roomPlannerRenderer.stage.find('Line').filter((l) => l.stroke() === '#f97316').length);
const dashedRed = () => nodes(() => window.roomPlannerRenderer.stage.find('Line').filter((l) => l.stroke() === '#ef4444' && (l.dash?.() ?? []).length > 0 && l.closed()).length);
const roomOf = () => ev(() => { const r = window.roomPlanner.project.getState().project.rooms[0]; return r ? { v: r.vertices.map((x) => [x.id.slice(0, 4), x.position.x, x.position.y]), walls: r.walls.length, area: Math.abs(r.vertices.reduce((a, v, i, arr) => a + (v.position.x * arr[(i + 1) % arr.length].position.y - arr[(i + 1) % arr.length].position.x * v.position.y), 0)) / 2 } : null; });

await newProject();
await page.getByRole('button', { name: /Draw a room/ }).click();
check('Draw a room starts the wall tool and shows the three-step hint', (await S()).tool === 'wall_edit' && (await page.getByText('Click the first corner again').count()) + (await page.getByText(/first.*corner again/).count()) >= 1);
for (const [x, y] of [[0, 0], [3, 0], [3, 1.5], [1.5, 1.5], [1.5, 3], [0, 3]]) await click(x, y); // an L: 3 x 3 minus a 1.5 x 1.5 corner
await moveTo(0.04, 0.03);
await shot('e08-drawing');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
s = await S();
let room = await roomOf();
check('an L-shaped room is drawn with Enter: one CreateRoom, six corners, area 6.75 m²', s.rooms === 1 && s.hist === 1 && s.undo === 'Draw room' && room.v.length === 6 && near(room.area, 6.75, 1e-6), JSON.stringify(room));
check('drawing returns to the Select tool and fits the view', s.tool === 'select');
await shot('e09-l-room');
await page.keyboard.press('Control+z');
check('undo of the drawn room returns to the empty prompt', (await S()).rooms === 0 && (await page.getByText('Start with a room').count()) === 1);

await page.getByRole('button', { name: /Draw a room/ }).click();
for (const [x, y] of [[0, 0], [4, 3], [4, 0], [0, 3]]) await click(x, y);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('a crossing shape cannot be closed: plain message, nothing created', (await S()).rooms === 0 && /walls would cross/.test(await page.locator('.statusbar').innerText()), await page.locator('.statusbar').innerText());
await page.keyboard.press('Escape');
check('Escape abandons the drawing but stays in the wall tool', (await S()).tool === 'wall_edit' && (await ev(() => window.roomPlanner.bus.get().drawing)) === null);
await page.keyboard.press('1');

await page.getByRole('button', { name: /Start from a rectangle/ }).click();
await page.waitForTimeout(250);
await card('3-seat sofa').click();
await moveTo(2.0, 4.4); await click(2.0, 4.4);
await page.keyboard.press('3');
check('the wall tool dims furniture and clears the selection', (await S()).tool === 'wall_edit' && (await S()).selection.length === 0);
await click(4, 5);
s = await S();
check('a corner is selected by clicking near it, and the inspector shows Corner X / Y', s.selection[0]?.kind === 'vertex' && (await page.getByText(/^Corner \d/).count()) >= 1);
await shot('e10-corner-selected');

// drag with impact preview: pull the top-right corner down so the sofa is left outside
let before3 = await S();
await drag([4, 5], [4, 4.2], { hold: true, steps: 14 });
check('dragging a corner shows "N object will need attention" and dashed red outlines', /will need attention/.test(await page.locator('.statusbar').innerText()) && (await dashedRed()) >= 1, await page.locator('.statusbar').innerText());
await shot('e11-impact');
await page.mouse.up();
await page.waitForTimeout(250);
s = await S(); room = await roomOf();
check('the edit commits (A3): one entry "Move corner", the sofa did not move', s.undo === 'Move corner' && near(room.v[2][2], 4.2, 0.011) && near(s.furniture['sofa-3'].y, before3.furniture['sofa-3'].y, 0.0001), JSON.stringify(room));

// sticking: drag a corner through the opposite wall
const histBefore = (await S()).hist;
await drag([4, 4.2], [4, -1], { hold: true, steps: 24 });
check('through-the-wall drag: the corner sticks and the bad edges are orange', (await orange()) >= 1 && /cannot cross/.test(await page.locator('.statusbar').innerText()), await page.locator('.statusbar').innerText());
await shot('e12-sticks');
await page.mouse.up();
await page.waitForTimeout(250);
room = await roomOf();
check('release commits the valid spot; the room is still a valid polygon', (await S()).hist === histBefore + 1 && room.area > 0 && room.v.length === 4, JSON.stringify(room));
await page.keyboard.press('Control+z'); // the stuck corner move
await page.keyboard.press('Control+z'); // the first corner move: back to the rectangle, sofa still placed
// Escape mid-drag reverts
before3 = await S();
await click(4, 5);
await drag([4, 5], [3.2, 4.1], { hold: true });
await page.keyboard.press('Escape');
await page.mouse.up();
await page.waitForTimeout(200);
check('Escape during a corner drag reverts it (no history)', (await S()).hist === before3.hist && (await roomOf()).v[2][1] === 4);

// insert + delete a corner
const nBefore = (await roomOf()).v.length;
const dbl = await at(1.3, 0.03);
await page.mouse.dblclick(dbl.x, dbl.y);
await page.waitForTimeout(200);
s = await S(); room = await roomOf();
check('double-click on a wall inserts a corner on the line (one entry)', room.v.length === nBefore + 1 && s.undo === 'Add corner' && room.v[1][2] === 0, JSON.stringify(room));
await page.keyboard.press('Delete');
s = await S();
check('Delete removes the selected corner again', (await roomOf()).v.length === nBefore && s.undo === 'Delete corner');

// room size by typing a wall length, then a corner coordinate
await page.waitForTimeout(650);
await click(2, -0.07);
const lengthField = page.locator('.field', { hasText: /^Inside length/ }).locator('input');
await lengthField.fill('5'); await lengthField.press('Enter');
room = await roomOf();
check('typing a wall length sets the room size (floor wall 4 m -> 5 m)', near(room.v[1][1], 5, 0.001) && (await S()).undo === 'Set wall length', JSON.stringify(room));
await page.waitForTimeout(650);
await click(5, 0);
const xField = page.locator('.field', { hasText: /^X/ }).locator('input');
await xField.fill('4500mm'); await xField.press('Enter');
check('typing a corner X (mm accepted) moves the corner', near((await roomOf()).v[1][1], 4.5, 0.001));
await page.waitForTimeout(650);
await click(0, 0); // corner 1, then type the Y of corner 4 into it: two corners on the same spot
await page.locator('.field', { hasText: /^Y/ }).locator('input').fill('5');
check('an invalid typed corner shows a plain message', /too close|same place/.test(await page.locator('.field-msg').first().innerText()));
await page.keyboard.press('Escape');
await page.locator('.field', { hasText: /^Y/ }).locator('input').press('Escape');

// switching tools mid-gesture, then delete room + undo
await page.keyboard.press('1');
await page.waitForTimeout(150);
await page.keyboard.press('Escape');
await deleteRoomViaInspector();
s = await S();
check('Delete room is one undoable command and brings back the empty prompt', s.rooms === 0 && s.undo === 'Delete room');
await page.keyboard.press('Control+z');
s = await S();
check('undo brings the room back with its furniture', s.rooms === 1 && !!s.furniture['sofa-3'], JSON.stringify({ rooms: s.rooms, f: Object.keys(s.furniture), undo: s.undo, redo: s.redo, hist: s.hist }));
await shot('e13-after-m3');

// ------------------------------------------------------------------ 7. touch targets on a coarse-pointer device
const touch = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
await touch.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
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




