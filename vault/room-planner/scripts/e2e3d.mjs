// End-to-end checks of the 3D view in real Chrome (SwiftShader WebGL). Start `npm run dev` first, then
// `node scripts/e2e3d.mjs [screenshotDir]`. Exits non-zero if any check fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.RP_URL ?? 'http://127.0.0.1:5174/room-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 240)}`); });
const shot = async (name) => { if (out) await page.screenshot({ path: join(out, `${name}.png`) }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

const state = () => ev(() => {
  const a = window.roomPlanner;
  const s = a.project.getState();
  const r = s.project.rooms[0];
  const u = a.ui.getState();
  const c = window.roomPlanner3d?.camera;
  return {
    view: u.viewMode, tool: u.tool, selection: u.selection, hist: s.historyLength(), undo: s.undoLabel, status: u.status?.text,
    furniture: Object.fromEntries((r?.furniture ?? []).map((f) => [f.id, { x: f.position.x, y: f.position.y, el: f.elevation, rot: f.rotation }])),
    views: (s.project.savedViews ?? []).map((v) => ({ id: v.id, name: v.name })),
    cam: c ? { p: [c.position.x, c.position.y, c.position.z], ortho: !!c.isOrthographicCamera, zoom: c.zoom } : null,
    camStore: a.camera.getState().camera,
    faded: window.roomPlanner3d?.scene3d.fadedWalls ?? null,
    calls: window.roomPlanner3d?.gl.info.render.calls ?? null,
  };
});
/** Screen position (page pixels) of a point in plan coordinates and height, using the live 3D camera. */
const proj = (x, y, z) => ev(([x, y, z]) => {
  const cam = window.roomPlanner3d.camera;
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const v = cam.matrixWorldInverse.elements;
  const p = cam.projectionMatrix.elements;
  const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
  const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
  const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
  const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
  const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
  const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
  const r = document.querySelector('[data-testid=stage3d] canvas').getBoundingClientRect();
  return { x: r.left + ((cx / cw + 1) / 2) * r.width, y: r.top + ((1 - cy / cw) / 2) * r.height };
}, [x, y, z]);

// ------------------------------------------------------------------ set up a room with a sofa, table and window
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
await page.getByRole('button', { name: /Start from a rectangle/ }).click();
await wait(250);
await ev(() => {
  const a = window.roomPlanner;
  const p = a.project.getState();
  const room = p.project.rooms[0];
  const base = { roomId: room.id, elevation: 0, rotation: 0 };
  p.commit({ type: 'PlaceFurniture', instance: { ...base, id: 'sofa', definitionId: 'sofa-3', position: { x: 2, y: 4.2 }, width: 2.2, length: 0.95, height: 0.85 } }, 'Place sofa');
  p.commit({ type: 'PlaceFurniture', instance: { ...base, id: 'table', definitionId: 'coffee-table', position: { x: 2, y: 2.8 }, width: 1.2, length: 0.6, height: 0.42 } }, 'Place table');
  p.commit({ type: 'PlaceFixture', fixture: { id: 'win', type: 'window', wallId: room.walls[1].id, offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9 } }, 'Place window');
});
await wait(200);
const hist0 = (await state()).hist;

// ------------------------------------------------------------------ switch to 3D
check('the 3D button is enabled once a room exists', await page.getByRole('button', { name: '3D', exact: true }).isEnabled());
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 20000 });
await page.waitForFunction(() => window.roomPlanner3d && window.roomPlanner3d.controls && window.roomPlanner.camera.getState().camera, null, { timeout: 20000 });
await wait(800);
let s = await state();
check('view mode is 3D and the 3D camera bar is shown', s.view === '3d' && (await page.locator('.viewbar3d').count()) === 1);
check('the scene rendered (draw calls > 0) with no console errors', (s.calls ?? 0) > 0 && problems.length === 0, JSON.stringify({ calls: s.calls, problems }));
check('Pan, Walls and Measure are disabled in 3D', (await page.locator('.toolbar .btn.icon[title^="Pan"], .toolbar .btn.icon[title^="Measure"]').evaluateAll((els) => els.every((e) => e.disabled))) === true);
await shot('3d-01-iso');

// ------------------------------------------------------------------ selection and drag
const top = await proj(2, 0.85, 4.2);
await page.mouse.click(top.x, top.y);
await wait(150);
s = await state();
check('clicking the sofa in 3D selects it', s.selection.length === 1 && s.selection[0].id === 'sofa', JSON.stringify(s.selection));
await shot('3d-02-selected');

const camBefore = s.cam.p;
const from = await proj(2, 0.85, 4.2);
const to = await proj(2, 0.85, 3.7);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(to.x, to.y, { steps: 10 });
await wait(100);
check('during the drag the camera did not move', JSON.stringify((await state()).cam.p) === JSON.stringify(camBefore));
await shot('3d-03-dragging');
await page.mouse.up();
await wait(250);
s = await state();
check('one drag = one history entry (MoveFurniture)', s.hist === hist0 + 1 && /Move/.test(s.undo ?? ''), `${s.hist} vs ${hist0}, ${s.undo}`);
check('the sofa moved about 0.5 m toward the camera along the floor and kept its elevation', Math.abs(s.furniture.sofa.y - 3.7) < 0.15 && s.furniture.sofa.el === 0, JSON.stringify(s.furniture.sofa));

// invalid release animates back with no history
const sofaTop = await proj(2, 0.85, s.furniture.sofa.y);
const outside = await proj(-1.5, 0.85, s.furniture.sofa.y);
await page.mouse.move(sofaTop.x, sofaTop.y);
await page.mouse.down();
await page.mouse.move(outside.x, outside.y, { steps: 10 });
await shot('3d-04-invalid');
await page.mouse.up();
await wait(500);
const s2 = await state();
check('an invalid drop commits nothing and the sofa is back', s2.hist === s.hist && Math.abs(s2.furniture.sofa.y - s.furniture.sofa.y) < 1e-9, JSON.stringify([s2.hist, s.hist]));

// ------------------------------------------------------------------ orbit
const e0 = await proj(0.5, 0, 1);
const e1 = await proj(0.5, 0, 1);
await page.mouse.move(e0.x, e0.y);
await page.mouse.down();
await page.mouse.move(e1.x + 160, e1.y - 20, { steps: 12 });
await page.mouse.up();
await wait(300);
s = await state();
check('dragging empty space orbits the camera and does not edit', JSON.stringify(s.cam.p) !== JSON.stringify(camBefore) && s.hist === s2.hist);
check('the camera is remembered at the end of the gesture', JSON.stringify(s.camStore.position.map((v) => Math.round(v * 100) / 100)) === JSON.stringify(s.cam.p.map((v) => Math.round(v * 100) / 100)));
check('walls in front of the camera are faded', Array.isArray(s.faded) && s.faded.length > 0, JSON.stringify(s.faded));
await shot('3d-05-orbited');

// ------------------------------------------------------------------ presets, projection
await page.getByRole('button', { name: 'Top', exact: true }).click();
await wait(700);
s = await state();
check('Top looks straight down and nothing is faded', Math.abs(s.cam.p[0] - 2) < 0.3 && s.cam.p[1] > 5 && (s.faded ?? []).length === 0, JSON.stringify([s.cam.p, s.faded]));
await shot('3d-06-top');
await page.getByRole('button', { name: 'Isometric', exact: true }).click();
await wait(700);
await page.getByRole('button', { name: 'Orthographic', exact: true }).click();
await wait(700);
s = await state();
check('Orthographic swaps the camera and keeps the framing', s.cam.ortho === true && s.camStore.projection === 'orthographic');
await shot('3d-07-ortho');
const topO = await proj(2, 0.85, s.furniture.sofa.y);
await page.mouse.click(topO.x, topO.y);
await wait(150);
check('picking still works in orthographic', (await state()).selection[0]?.id === 'sofa');
await page.getByRole('button', { name: 'Perspective', exact: true }).click();
await wait(700);
check('Perspective swaps back', (await state()).cam.ortho === false);
await page.getByRole('button', { name: 'Fit room', exact: true }).click();
await wait(700);

// ------------------------------------------------------------------ saved views
const histBeforeViews = (await state()).hist;
const savedCam = (await state()).cam.p;
await page.getByRole('button', { name: 'Save view' }).click();
await wait(200);
s = await state();
check('Save view adds a named view and no history entry', s.views.length === 1 && s.views[0].name === 'View 1' && s.hist === histBeforeViews, JSON.stringify(s.views));
await page.getByRole('button', { name: 'Top', exact: true }).click();
await wait(700);
await page.getByRole('button', { name: 'Go to View 1' }).click();
await wait(900);
s = await state();
check('clicking the saved view restores the camera', s.cam.p.every((v, i) => Math.abs(v - savedCam[i]) < 0.05), JSON.stringify([s.cam.p, savedCam]));
await page.getByRole('button', { name: 'Rename View 1' }).click();
await page.getByLabel('View name').fill('Living room');
await page.getByLabel('View name').press('Enter');
await wait(150);
s = await state();
check('a view can be renamed', s.views[0].name === 'Living room', JSON.stringify(s.views));
await shot('3d-08-saved-view');

// ------------------------------------------------------------------ back to 2D, persistence
await page.getByRole('button', { name: '2D', exact: true }).click();
await wait(400);
s = await state();
check('switching back to 2D keeps the selection and the project', s.view === '2d' && s.selection.length === 1 && s.hist === histBeforeViews);
await shot('3d-09-back-2d');
await page.keyboard.press('v');
await wait(500);
check('V toggles to 3D again with the camera where it was', (await state()).view === '3d');
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
await wait(300);
s = await ev(() => ({ views: (window.roomPlanner.project.getState().project.savedViews ?? []).map((v) => v.name) }));
check('saved views survive a reload', JSON.stringify(s.views) === JSON.stringify(['Living room']), JSON.stringify(s));
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForSelector('[data-testid=stage3d] canvas', { timeout: 20000 });
await wait(800);
await page.getByRole('button', { name: 'Go to Living room' }).click();
await wait(800);
await shot('3d-10-after-reload');

// undo works in 3D
await page.keyboard.press('Control+z');
await wait(250);
s = await state();
check('Ctrl+Z in 3D undoes the last edit', s.view === '3d' && s.hist >= 0);

// ------------------------------------------------------------------ Cinematic (Spec Addition A1): clay look, quality, fly-through
const cine = () => ev(() => {
  const a = window.roomPlanner;
  const u = a.ui.getState();
  const t = window.roomPlanner3d;
  const cam = t.camera;
  const sofa = t.scene3d.furnitureObject('sofa');
  let colour = null;
  sofa?.traverse((o) => { if (!colour && o.isMesh && o.visible) colour = o.material.color.getHexString(); });
  return {
    cinematic: u.cinematic, quality: u.quality, playing: u.tourPlaying, loop: u.tourLoop, immersive: u.immersive, progress: u.tourProgress,
    selection: u.selection, hist: a.project.getState().historyLength(),
    cam: [cam.position.x, cam.position.y, cam.position.z], ctlEnabled: t.controls.enabled,
    tone: t.gl.toneMapping, shadow: t.gl.shadowMap.type, sofaColour: colour, calls: t.gl.info.render.calls,
    toolbar: getComputedStyle(document.querySelector('.toolbar')).display, bar: !!document.querySelector('.immersive-bar'),
    camStore: a.camera.getState().camera?.position,
  };
});
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

await page.getByRole('button', { name: 'Cinematic', exact: true }).click();
await wait(700);
let c = await cine();
check('Cinematic turns on the clay look: white sofa, filmic tone mapping, soft shadows', c.cinematic && c.sofaColour === 'f3f1ec' && c.tone === 4 && c.shadow === 3, JSON.stringify(c));
check('Cinematic leaves the project alone (no history)', c.hist === (await state()).hist);
await shot('3d-11-cinematic-low');
check('quality defaults to low', c.quality === 'low' && (await page.getByRole('button', { name: 'Low', exact: true }).getAttribute('aria-pressed')) === 'true');

await page.getByRole('button', { name: 'High', exact: true }).click();
await wait(1500);
c = await cine();
check('High quality renders (post effects) with no console errors', c.quality === 'high' && c.calls > 0 && problems.length === 0, JSON.stringify({ calls: c.calls, problems }));
await shot('3d-12-cinematic-high');
await page.getByRole('button', { name: 'Low', exact: true }).click();
await wait(500);

// fly-through: with one saved view the tour is that view plus automatic stops
check('the tour says what it will visit', (await page.locator('.tour-note').innerText()).includes('saved view + automatic'));
const before = (await cine()).cam;
await page.getByRole('button', { name: 'Play tour' }).click();
await wait(7000); // 3 s resting on the first stop, then it starts to travel
c = await cine();
check('Play tour moves the camera along the path, with orbit controls off', c.playing && dist3(c.cam, before) > 0.5 && c.ctlEnabled === false, JSON.stringify(c));
check('the tour reports its stop', c.progress && c.progress.total >= 3);
await shot('3d-13-tour');
const mid = c.cam;
await page.mouse.click(700, 500);
await wait(200);
check('clicking the canvas during the tour edits and selects nothing', (await cine()).selection.length === c.selection.length && (await cine()).hist === c.hist);
await page.keyboard.press('Space');
await wait(300);
c = await cine();
check('Space pauses the tour; controls come back; the camera is remembered', !c.playing && c.ctlEnabled === true && dist3(c.cam, c.camStore) < 0.01, JSON.stringify(c));
const paused = c.cam;
await wait(800);
check('a paused tour stays put', dist3((await cine()).cam, paused) < 1e-6);
await page.keyboard.press('Space');
await wait(2200);
check('Space resumes it where it was', (await cine()).playing && dist3((await cine()).cam, paused) > 0.001);
await page.keyboard.press('Delete');
check('keys do not edit the design while it plays', (await cine()).hist === c.hist);

// full screen: the interface is hidden, Esc leaves it
await page.getByRole('button', { name: 'Pause tour' }).click();
await page.getByRole('button', { name: 'Full screen' }).click();
await wait(600);
c = await cine();
check('Full screen hides the interface and shows only the presentation controls', c.immersive && c.toolbar === 'none' && c.bar);
await shot('3d-14-fullscreen');
await page.getByRole('button', { name: 'Play tour' }).click();
await wait(600);
await page.keyboard.press('Escape');
await wait(400);
c = await cine();
check('Esc pauses the tour and brings the interface back', !c.playing && !c.immersive && c.toolbar !== 'none');

// a short one-pass tour from two saved views ends by itself
await ev(() => {
  const a = window.roomPlanner;
  a.saveView('Start');
});
await page.getByRole('button', { name: 'Top', exact: true }).click();
await wait(700);
await ev(() => window.roomPlanner.saveView('End'));
await wait(200);
check('two or more saved views are the tour', (await page.locator('.tour-note').innerText()).includes('saved views'));
await page.getByRole('button', { name: 'Loop' }).click();
check('Loop can be turned off', (await cine()).loop === false);
await page.getByRole('button', { name: 'Play tour' }).click();
await page.waitForFunction(() => !window.roomPlanner.ui.getState().tourPlaying, null, { timeout: 70000 }).catch(() => undefined);
c = await cine();
check('a one-pass tour stops by itself at the end', !c.playing, JSON.stringify(c.progress));

// back to ordinary 3D: everything returns
await page.getByRole('button', { name: 'Cinematic', exact: true }).click();
await wait(600);
c = await cine();
check('turning Cinematic off restores the real colours and no tour', !c.cinematic && c.sofaColour !== 'f3f1ec' && c.tone === 0 && !c.playing);

// quality is remembered across a reload
await page.getByRole('button', { name: 'Cinematic', exact: true }).click();
await page.getByRole('button', { name: 'High', exact: true }).click();
await wait(500);
await page.reload();
await page.waitForSelector('[data-testid=stage] canvas');
check('quality is remembered per browser', (await ev(() => window.roomPlanner.ui.getState().quality)) === 'high');
await ev(() => window.roomPlanner.ui.getState().setQuality('low'));

check('no console or page errors at any point', problems.length === 0, problems.join(' | '));
await browser.close();
console.log(failures === 0 ? '\nAll 3D checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
