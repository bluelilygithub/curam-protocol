// End-to-end checks of projects and rooms in real Chrome: several rooms per project, the Projects panel, autosave, a second window
// (conflict), and the Vault-account mode against a fake /api/room-projects. Start `npm run dev` first, then
// `node scripts/e2e-projects.mjs [screenshotDir]` (set RP_URL if 127.0.0.1 does not answer). Exits non-zero if any check fails.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './lib/chromium.mjs';

const URL = process.env.RP_URL ?? 'http://localhost:5174/room-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const problems = [];
const watch = (page, allow = []) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !allow.some((a) => m.text().includes(a))) problems.push(`console.error: ${m.text().slice(0, 200)}`); });
};
const ready = (page) => page.waitForFunction(() => window.roomPlanner?.library.getState().ready, null, { timeout: 20000 });
const S = (page) => page.evaluate(() => {
  const a = window.roomPlanner;
  const p = a.project.getState();
  const lib = a.library.getState();
  return {
    docRooms: p.document?.rooms.map((r) => ({ id: r.id, name: r.name, furniture: r.furniture.length })) ?? [], activeId: p.activeRoomId,
    viewRooms: p.project?.rooms.length ?? 0, hist: p.historyLength(), undo: p.undoLabel, name: p.document?.name,
    status: lib.status, kind: lib.kind, note: lib.note, entries: lib.entries.map((e) => ({ id: e.id, name: e.name, rooms: e.roomCount })), currentId: lib.currentId, error: lib.error,
  };
});
const settle = async (page, status = 'saved', timeout = 8000) => page.waitForFunction((st) => window.roomPlanner.library.getState().status === st, status, { timeout }).then(() => true).catch(() => false);
const openPanel = async (page) => { if (!(await page.locator('.projects-panel').count())) await page.locator('.project-button').click(); await page.waitForSelector('.projects-panel'); };
const closePanel = async (page) => { if (await page.locator('.projects-panel').count()) await page.getByRole('button', { name: 'Close projects' }).click(); };
const addRoom = async (page, how) => { await page.getByRole('button', { name: /Add room/ }).click(); await page.getByRole('menuitem', { name: how }).click(); await wait(250); };
const shot = async (page, name) => { if (out) await page.screenshot({ path: join(out, `${name}.png`) }); };

// ================================================================== A. this browser
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
  const page = await ctx.newPage();
  watch(page);
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid=stage] canvas');
  await ready(page);
  let s = await S(page);
  check('a fresh browser opens "Untitled project", saved in this browser', s.kind === 'local' && s.entries.length === 1 && s.name === 'Untitled project' && s.status === 'saved', JSON.stringify(s));
  check('the toolbar shows the project name and where it is saved', (await page.locator('.project-button').innerText()).includes('Untitled project') && /Saved/.test(await page.locator('.save-status').innerText()) && /Saved in this browser/.test((await page.locator('.save-status').getAttribute('title')) ?? ''));

  await page.getByRole('button', { name: /Start from a rectangle/ }).click();
  await wait(300);
  s = await S(page);
  check('the first room is "Room 1" and the room bar shows it', s.docRooms.length === 1 && s.docRooms[0].name === 'Room 1' && (await page.getByRole('button', { name: 'Room Room 1', exact: true }).count()) === 1);
  check('an edit shows "Unsaved changes", then autosaves', /Unsaved/.test(await page.locator('.save-status').innerText()) && (await settle(page)));
  check('Save is hidden when everything is saved, and the status says Saved', (await page.getByRole('button', { name: 'Save', exact: true }).count()) === 0 && /Saved/.test(await page.locator('.save-status').innerText()));

  await addRoom(page, /Rectangle/);
  s = await S(page);
  check('Add room → Rectangle adds "Room 2" and opens it; the editor sees one room', s.docRooms.length === 2 && s.docRooms[1].name === 'Room 2' && s.activeId === s.docRooms[1].id && s.viewRooms === 1, JSON.stringify(s.docRooms));
  await shot(page, 'p01-two-rooms');

  await page.getByRole('button', { name: 'Room Room 1', exact: true }).click();
  await wait(200);
  await page.evaluate(() => {
    const a = window.roomPlanner;
    const room = a.project.getState().project.rooms[0];
    a.project.getState().commit({ type: 'PlaceFurniture', instance: { id: 'sofa', definitionId: 'sofa-3', roomId: room.id, position: { x: 2, y: 4 }, elevation: 0, rotation: 0, width: 2.2, length: 0.95, height: 0.85 } }, 'Place sofa');
  });
  await page.getByRole('button', { name: 'Room Room 2', exact: true }).click();
  await wait(200);
  s = await S(page);
  check('rooms keep their own contents: Room 2 has no sofa', s.docRooms.find((r) => r.name === 'Room 2').furniture === 0 && s.docRooms.find((r) => r.name === 'Room 1').furniture === 1);
  const histBefore = s.hist;
  await page.getByRole('button', { name: 'Room Room 1', exact: true }).click();
  await wait(200);
  s = await S(page);
  check('switching rooms adds no history', s.hist === histBefore);

  // rename by double-click
  await page.getByRole('button', { name: 'Room Room 1', exact: true }).dblclick();
  await page.getByLabel('Room name').first().fill('Kitchen');
  await page.getByLabel('Room name').first().press('Enter');
  await wait(250);
  s = await S(page);
  check('double-click renames a room (one undo step)', s.docRooms.some((r) => r.name === 'Kitchen') && s.undo === 'Rename room');

  await addRoom(page, /Copy of this room/);
  s = await S(page);
  const copy = s.docRooms.find((r) => r.name === 'Kitchen (copy)');
  check('Copy of this room duplicates it with its furniture and opens the copy', !!copy && copy.furniture === 1 && s.activeId === copy.id && s.undo === 'Duplicate room', JSON.stringify(s.docRooms));
  await shot(page, 'p02-copy');

  // delete with the inline confirm; No keeps it, Yes removes it, undo brings it back
  await page.getByRole('button', { name: /Delete room Kitchen \(copy\)/ }).click();
  check('deleting asks inline (no browser dialog)', (await page.getByRole('group', { name: /Delete Kitchen \(copy\)\?/ }).count()) === 1);
  await page.getByRole('group', { name: /Delete Kitchen \(copy\)\?/ }).getByRole('button', { name: 'No' }).click();
  check('No keeps the room', (await S(page)).docRooms.length === 3);
  await page.getByRole('button', { name: /Delete room Kitchen \(copy\)/ }).click();
  await page.getByRole('group', { name: /Delete Kitchen \(copy\)\?/ }).getByRole('button', { name: 'Yes' }).click();
  await wait(250);
  s = await S(page);
  check('Yes deletes the room and opens a neighbour', s.docRooms.length === 2 && s.activeId !== null && !s.docRooms.some((r) => r.name === 'Kitchen (copy)'));
  await page.keyboard.press('Control+z');
  await wait(200);
  s = await S(page);
  check('Ctrl+Z brings the deleted room back, open again', s.docRooms.length === 3 && s.docRooms.find((r) => r.id === s.activeId)?.name === 'Kitchen (copy)');

  // draw a new room: the banner, Cancel
  await addRoom(page, /Draw a room/);
  s = await S(page);
  check('Draw a room with rooms present: the open room steps aside and a banner explains', s.activeId === null && s.viewRooms === 0 && (await page.getByText('Draw a new room').count()) === 1);
  await shot(page, 'p03-drawing');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await wait(200);
  s = await S(page);
  check('Cancel brings the open room back', s.activeId !== null && s.docRooms.length === 3);

  // Inspector name
  await page.locator('input[aria-label="Room name"]').first().fill('Pantry');
  await page.locator('input[aria-label="Room name"]').first().press('Enter');
  await wait(250);
  check('the Inspector renames the room too', (await S(page)).docRooms.some((r) => r.name === 'Pantry'));
  check('the inspector\'s Delete room asks inline', (await (async () => { await page.locator('.actions').getByRole('button', { name: /Delete room/ }).click(); const ok = (await page.locator('.actions').getByRole('button', { name: 'No' }).count()) === 1; await page.locator('.actions').getByRole('button', { name: 'No' }).click(); return ok; })()));

  // projects panel
  await settle(page);
  await openPanel(page);
  await shot(page, 'p04-panel');
  await page.getByLabel('New project name').fill('Flat B');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.waitForSelector('.projects-panel', { state: 'detached' });
  await wait(400);
  s = await S(page);
  check('New project (typed name) opens an empty project; the first was saved first', s.name === 'Flat B' && s.docRooms.length === 0 && s.entries.length === 2 && s.entries.find((e) => e.name === 'Untitled project').rooms === 3, JSON.stringify(s.entries));
  check('the empty project shows the start prompt', (await page.getByText('Start with a room').count()) === 1);

  await openPanel(page);
  await page.getByRole('button', { name: 'Rename Flat B' }).click();
  await page.getByLabel('New name for Flat B').fill('Flat C');
  await page.keyboard.press('Enter');
  await wait(400);
  s = await S(page);
  check('Rename changes the name in the list and the open project', s.entries.some((e) => e.name === 'Flat C') && s.name === 'Flat C' && s.status === 'saved', JSON.stringify([s.entries, s.name, s.status]));
  await page.getByRole('button', { name: 'Duplicate Untitled project' }).click();
  await wait(400);
  s = await S(page);
  check('Duplicate adds a "(copy)" with the same rooms', s.entries.some((e) => e.name === 'Untitled project (copy)' && e.rooms === 3), JSON.stringify(s.entries));
  await page.getByRole('button', { name: 'Open Untitled project', exact: true }).click();
  await page.waitForSelector('.projects-panel', { state: 'detached' });
  await wait(400);
  s = await S(page);
  check('Open switches project; its three rooms are back', s.docRooms.length === 3 && s.name === 'Untitled project');

  await openPanel(page);
  await page.getByRole('button', { name: 'Delete Untitled project (copy)' }).click();
  check('deleting a project asks inline', (await page.getByRole('group', { name: /Delete Untitled project \(copy\)\?/ }).count()) === 1);
  await page.getByRole('group', { name: /Delete Untitled project \(copy\)\?/ }).getByRole('button', { name: 'No' }).click();
  check('No keeps it', (await S(page)).entries.length === 3);
  await page.getByRole('button', { name: 'Delete Untitled project (copy)' }).click();
  await page.getByRole('group', { name: /Delete Untitled project \(copy\)\?/ }).getByRole('button', { name: 'Yes' }).click();
  await wait(400);
  check('Yes deletes it', (await S(page)).entries.length === 2 && !(await S(page)).entries.some((e) => e.name.endsWith('(copy)')));
  await page.keyboard.press('Escape');
  await wait(200);
  check('Esc closes the panel', (await page.locator('.projects-panel').count()) === 0);

  // reload reopens the last project with its rooms
  await settle(page);
  await page.reload();
  await page.waitForSelector('[data-testid=stage] canvas');
  await ready(page);
  await wait(300);
  s = await S(page);
  check('reload reopens the last project with every room', s.name === 'Untitled project' && s.docRooms.length === 3, JSON.stringify(s));

  // two windows: the conflict
  const page2 = await ctx.newPage();
  watch(page2);
  await page2.goto(URL);
  await page2.waitForSelector('[data-testid=stage] canvas');
  await ready(page2);
  await wait(300);
  await addRoom(page, /Rectangle/);
  check('window 1 saves its new room', await settle(page, 'saved', 8000));
  await addRoom(page2, /Rectangle/); // window 2 still has the old version
  check('window 2 is told it was changed elsewhere', await settle(page2, 'conflict', 8000) && (await page2.getByRole('alert').innerText()).includes('another window'));
  await shot(page2, 'p05-conflict');
  const rooms1 = (await S(page)).docRooms.length;
  await page2.getByRole('button', { name: 'Reload the saved version' }).click();
  await wait(500);
  s = await S(page2);
  check('"Reload the saved version" takes window 1\'s work', s.docRooms.length === rooms1 && s.status === 'saved', JSON.stringify([s.docRooms.length, rooms1, s.status]));
  await addRoom(page, /Rectangle/);
  await settle(page);
  await addRoom(page2, /Rectangle/);
  await settle(page2, 'conflict', 8000);
  await page2.getByRole('button', { name: 'Keep mine and overwrite' }).click();
  check('"Keep mine and overwrite" saves window 2\'s version', await settle(page2, 'saved', 8000));
  await page2.close();
  await ctx.close();
}

// ================================================================== B. a Vault account (fake /api/room-projects)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
  await ctx.addInitScript(() => { if (!localStorage.getItem('vault-auth') && !localStorage.getItem('__cleared')) localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'tok-123', user: { id: 1 } }, version: 0 })); });
  const page = await ctx.newPage();
  watch(page, ['401', 'Failed to load resource']);
  const db = []; let seq = 0; let clock = Date.UTC(2026, 9, 3, 12, 0, 0); let revoked = false; const seenAuth = [];
  const tick = () => new Date((clock += 1000)).toISOString();
  const wire = (r) => ({ id: r.id, name: r.name, roomCount: r.roomCount, updatedAt: r.updatedAt });
  await page.route('**/api/room-projects**', async (route) => {
    const req = route.request();
    seenAuth.push(req.headers().authorization);
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (revoked || req.headers().authorization !== 'Bearer tok-123') return json(401, { error: 'Unauthorized' });
    const path = new globalThis.URL(req.url()).pathname.replace('/api/room-projects', '').replace(/^\//, '');
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    if (req.method() === 'GET' && path === '') return json(200, { projects: db.map(wire) });
    if (req.method() === 'POST') { const r = { id: ++seq, name: body.name, data: body.data, roomCount: body.data.rooms.length, updatedAt: tick() }; db.push(r); return json(200, { project: wire(r) }); }
    const r = db.find((x) => String(x.id) === path);
    if (!r) return json(404, { error: 'That project was not found.' });
    if (req.method() === 'GET') return json(200, { project: { ...wire(r), data: r.data } });
    if (req.method() === 'DELETE') { db.splice(db.indexOf(r), 1); return json(200, { ok: true }); }
    if (req.method() === 'PUT') {
      if (body.expectedUpdatedAt && body.expectedUpdatedAt !== r.updatedAt) return json(409, { error: 'changed', current: wire(r) });
      if (body.name) r.name = body.name;
      if (body.data) { r.data = body.data; r.roomCount = body.data.rooms.length; }
      r.updatedAt = tick();
      return json(200, { project: wire(r) });
    }
    return json(404, {});
  });
  await page.goto(URL);
  await page.waitForSelector('[data-testid=stage] canvas');
  await ready(page);
  let s = await S(page);
  check('signed in to Vault: projects are saved to the account', s.kind === 'server' && /Vault account/.test(s.note) && s.entries.length === 1 && db.length === 1, JSON.stringify([s.kind, s.note, db.length]));
  check('the toolbar says so', /Saved to your Vault account/.test((await page.locator('.save-status').getAttribute('title')) ?? ''));
  check('requests carry the Vault token', seenAuth.length > 0 && seenAuth.every((h) => h === 'Bearer tok-123'));
  await page.getByRole('button', { name: /Start from a rectangle/ }).click();
  await settle(page, 'unsaved', 3000);
  check('an edit is autosaved to the account', await settle(page, 'saved', 8000) && db[0].data.rooms.length === 1 && db[0].roomCount === 1);
  await addRoom(page, /Rectangle/);
  await settle(page);
  check('rooms are saved with the project', db[0].data.rooms.length === 2 && db[0].roomCount === 2);
  await page.reload();
  await page.waitForSelector('[data-testid=stage] canvas');
  await ready(page);
  await wait(300);
  s = await S(page);
  check('reload reopens it from the account', s.docRooms.length === 2 && s.kind === 'server');
  await openPanel(page);
  await page.getByLabel('New project name').fill('Account project 2');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.waitForSelector('.projects-panel', { state: 'detached' });
  await wait(400);
  check('New project is created on the account', db.length === 2 && db[1].name === 'Account project 2');
  await openPanel(page);
  await page.getByRole('button', { name: 'Rename Account project 2' }).click();
  await page.getByLabel('New name for Account project 2').fill('Renamed on server');
  await page.keyboard.press('Enter');
  await wait(500);
  check('Rename reaches the account', db.some((r) => r.name === 'Renamed on server'));
  await page.getByRole('button', { name: 'Delete Renamed on server' }).click();
  await page.getByRole('group', { name: /Delete Renamed on server\?/ }).getByRole('button', { name: 'Yes' }).click();
  await wait(500);
  check('Delete reaches the account, and another project opens', db.length === 1 && (await S(page)).entries.length === 1);
  await page.keyboard.press('Escape');
  // the session ends
  revoked = true;
  await page.getByRole('button', { name: /Add room/ }).click();
  await page.getByRole('menuitem', { name: /Rectangle/ }).click();
  await settle(page, 'error', 8000);
  s = await S(page);
  check('when the Vault session ends, saving says so and the work stays in this browser', s.status === 'error' && /session has ended/.test(s.error ?? '') && (await page.getByRole('alert').innerText()).includes('session has ended'), JSON.stringify([s.status, s.error]));
  await shot(page, 'p06-session-ended');
  await ctx.close();
}

// ================================================================== C. signed in but Vault not reachable → this browser
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('vault_room_planner_info_seen', '1'); } catch { /* ignore */ } }); // the How This Works modal would cover the page on a first visit
  await ctx.addInitScript(() => { localStorage.setItem('vault-auth', JSON.stringify({ state: { token: 'tok-123' }, version: 0 })); });
  const page = await ctx.newPage();
  watch(page, ['Failed to load resource', 'ERR_FAILED', 'net::']);
  await page.route('**/api/room-projects**', (route) => route.abort());
  await page.goto(URL);
  await page.waitForSelector('[data-testid=stage] canvas');
  await ready(page);
  const s = await S(page);
  check('signed in but Vault unreachable: falls back to this browser and says why', s.kind === 'local' && /could not be reached/i.test(s.note), JSON.stringify([s.kind, s.note]));
  await ctx.close();
}

check('no console or page errors', problems.length === 0, problems.join(' | '));
await browser.close();
console.log(failures === 0 ? '\nAll project and room checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
