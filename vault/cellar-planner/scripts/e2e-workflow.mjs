// Drives the technician workflow features of the staff Cellar Planner in real Chrome: dragging rack runs on the plan, one-click fixes for errors, the
// status strip, and hiding/resizing/focusing the side panels. Run the dev server first (`npm run dev`, port 5176), then:
//   node scripts/e2e-workflow.mjs [screenshot dir]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.CELLAR_URL ?? 'http://localhost:5176/cellar-planner-app/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function open(w = 1500, h = 1000) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/api/**', (r) => r.abort());
  await page.goto(URL);
  await page.getByTestId('plan-canvas').waitFor();
  await page.waitForTimeout(700);
  return { page, ctx, errors };
}
const project = (page) => page.evaluate(() => window.cellar.store.getState().project);
const notice = (page) => page.getByTestId('status').innerText().catch(() => '');
const errorsOf = (page) => page.evaluate(() => window.cellar.analyse().issues.filter((i) => i.severity === 'error').length);
const edit = (page, fn) => page.evaluate(`(${fn.toString()})(window.cellar.store.getState())`);
/** Screen position of a point in plan millimetres. */
const screenOf = async (page, mx, my) => {
  const c = page.getByTestId('plan-canvas'); const box = await c.boundingBox();
  const [scale, ox, oy] = await c.evaluate((el) => [Number(el.dataset.scale), Number(el.dataset.ox), Number(el.dataset.oy)]);
  return { x: box.x + ox + mx * scale, y: box.y + oy + my * scale, scale };
};
const scan = async (page, label) => {
  await page.addScriptTag({ path: join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js') });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => `${x.id} x${x.nodes.length}: ${x.nodes[0].target.join(' ')}`));
  check(`accessibility scan, ${label}: no violations`, v.length === 0, v.join(' | '));
};

// The first visit is the Test case: inside 2750 x 1565, the south door opening 890..1860, units 600 wide and 350 deep.
// south-1 sits at start 0 (plan x 50..650, y 1265..1615).
// ================================================================ dragging runs
{
  const { page, ctx, errors } = await open();
  const startOf = async (id) => (await project(page)).runs.find((r) => r.id === id).startMm;
  check('the test case starts clean with south-1 at 0', (await startOf('south-1')) === 0 && (await errorsOf(page)) === 0);
  const home = await screenOf(page, 350, 1440); // the middle of south-1
  await page.mouse.move(home.x, home.y);
  await page.waitForTimeout(150);
  const tip = await page.getByTestId('run-tip').innerText().catch(() => '');
  check('resting the pointer on a run says what it is and how to move it', /south-1: 1 unit/.test(tip) && /Drag it along the wall/.test(tip), tip);
  check('and the cursor says the run can be moved', await page.getByTestId('plan-canvas').evaluate((el) => el.classList.contains('over-run')));

  // drag right by ~200 mm: a free position, lands exactly there
  await page.mouse.down();
  await page.mouse.move(home.x + 100 * home.scale, home.y, { steps: 4 });
  await page.mouse.move(home.x + 200 * home.scale, home.y, { steps: 4 });
  const ghostDuring = Number(await page.getByTestId('plan-canvas').getAttribute('data-ghost'));
  check('while dragging, an outline of where it would land is drawn', ghostDuring === 2, String(ghostDuring));
  if (out) await page.screenshot({ path: join(out, 'drag-ghost.png') });
  await page.mouse.up();
  const s1 = await startOf('south-1');
  check('releasing puts the run there (about 200 mm along the wall)', s1 >= 195 && s1 <= 205, String(s1));
  check('the outline is gone and the design has no errors', Number(await page.getByTestId('plan-canvas').getAttribute('data-ghost')) === 0 && (await errorsOf(page)) === 0);
  check('the line under the header says what moved', /Moved south-1 to \d+ mm/.test(await notice(page)), await notice(page));
  await page.evaluate(() => window.cellar.store.getState().undo());
  check('one Undo puts it back (a drag is one step)', (await startOf('south-1')) === 0);

  // drag to near the door edge: snaps to 290 (its end meets the door opening at 890)
  await page.mouse.move(home.x, home.y); await page.mouse.down();
  await page.mouse.move(home.x + 285 * home.scale, home.y, { steps: 6 });
  await page.mouse.up();
  check('near the door opening it snaps to it exactly (290 mm)', (await startOf('south-1')) === 290, String(await startOf('south-1')));
  check('and says what it snapped to', /snapped to the door opening/.test(await notice(page)), await notice(page));
  await page.evaluate(() => window.cellar.store.getState().undo());

  // drag onto the door: refused, springs back, says why
  await page.mouse.move(home.x, home.y); await page.mouse.down();
  await page.mouse.move(home.x + 700 * home.scale, home.y, { steps: 8 });
  const redGhost = Number(await page.getByTestId('plan-canvas').getAttribute('data-ghost'));
  await page.mouse.up();
  check('onto the door: it springs back to where it was', (await startOf('south-1')) === 0, String(await startOf('south-1')));
  check('and says why, in plain words', /Can't put south-1 there: .*door/i.test(await notice(page)), await notice(page));
  check('(an outline was shown while dragging)', redGhost === 2);
  check('the design still has no errors', (await errorsOf(page)) === 0);

  // a drag that goes nowhere changes nothing; dragging empty floor pans the drawing instead
  const before = JSON.stringify((await project(page)).runs);
  await page.mouse.move(home.x, home.y); await page.mouse.down(); await page.mouse.up();
  check('a plain click on a run changes nothing', JSON.stringify((await project(page)).runs) === before);
  const c = page.getByTestId('plan-canvas');
  const ox0 = Number(await c.getAttribute('data-ox'));
  const empty = await screenOf(page, 1400, 700);
  await page.mouse.move(empty.x, empty.y); await page.mouse.down(); await page.mouse.move(empty.x + 60, empty.y + 10, { steps: 4 }); await page.mouse.up();
  check('dragging empty floor pans the drawing, as before', Number(await c.getAttribute('data-ox')) > ox0 + 40 && JSON.stringify((await project(page)).runs) === before);

  // the east/west walls drag along y; the end of the wall is a limit
  const west = await screenOf(page, 225, 700); // west-1: x 50..400, y 400..1000
  await page.mouse.move(west.x, west.y); await page.mouse.down();
  await page.mouse.move(west.x, west.y + 100 * west.scale, { steps: 4 });
  await page.mouse.up();
  const w1 = await startOf('west-1');
  check('a run on the west wall moves along the wall (north to south)', w1 > 350 && w1 <= 1565 - 600, String(w1));
  check('with no errors', (await errorsOf(page)) === 0);
  await page.evaluate(() => window.cellar.store.getState().undo());
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ one-click fixes
{
  const { page, ctx, errors } = await open();
  await edit(page, (s) => s.edit((p) => ({ ...p, runs: p.runs.map((r) => (r.id === 'north-1' ? { ...r, startMm: 600 } : r)) })));
  await page.waitForTimeout(300);
  check('a run past the end of its wall is an error', (await errorsOf(page)) >= 1);
  const btn = page.getByTestId('fix-RUN_OUTSIDE');
  check('the error has a one-click fix, named for what it does', (await btn.innerText()) === 'Move north-1 to 350 mm', await btn.innerText().catch(() => 'none'));
  check('with the detail on hover', /nearest place it fits/.test(await btn.getAttribute('title')));
  await scan(page, 'a fix button showing');
  if (out) await page.screenshot({ path: join(out, 'fix-button.png') });
  await btn.click();
  await page.waitForTimeout(200);
  check('pressing it fixes it: the run moved and no errors remain', (await project(page)).runs.find((r) => r.id === 'north-1').startMm === 350 && (await errorsOf(page)) === 0);
  check('and says what it did', /Fixed: Move north-1 to 350 mm\./.test(await notice(page)), await notice(page));
  await page.evaluate(() => window.cellar.store.getState().undo());
  check('Undo takes the fix back', (await project(page)).runs.find((r) => r.id === 'north-1').startMm === 600 && (await errorsOf(page)) >= 1);

  // several problems: Fix all
  await edit(page, (s) => s.edit((p) => ({ ...p, runs: p.runs.map((r) => (r.id === 'south-1' ? { ...r, startMm: 500 } : r)), enclosure: { ...p.enclosure, door: { ...p.enclosure.door, heightMm: 5000 } } })));
  await page.waitForTimeout(300);
  const n = await errorsOf(page);
  check('three kinds of error at once', n >= 3, String(n));
  const all = page.getByTestId('fix-all');
  check('Fix all offers to do them together, with a count', /Fix all \(\d+\)/.test(await all.innerText()), await all.innerText().catch(() => 'none'));
  await all.click();
  await page.waitForTimeout(300);
  check('Fix all clears every error', (await errorsOf(page)) === 0);
  check('and says how many it fixed', /Fixed \d+ problems?\. Undo takes them all back\./.test(await notice(page)), await notice(page));
  await page.evaluate(() => window.cellar.store.getState().undo());
  check('one Undo takes all of them back', (await errorsOf(page)) === n);
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ the status strip and the panels
{
  const { page, ctx, errors } = await open();
  const total = (await page.getByTestId('total').innerText()).match(/\d+/)[0];
  check('the strip shows the bottle total, the same as the Checks panel', new RegExp(`^${total}\\b`).test(await page.getByTestId('strip-bottles').innerText()), await page.getByTestId('strip-bottles').innerText());
  check('and the rack units and no price (no catalogue here)', /^8 units/.test(await page.getByTestId('strip-units').innerText()) && /no price/.test(await page.getByTestId('strip-price').innerText()));
  check('0 errors to start', /^0 errors/.test(await page.getByTestId('strip-checks').innerText()));
  await edit(page, (s) => s.edit((p) => ({ ...p, runs: p.runs.map((r) => (r.id === 'north-1' ? { ...r, startMm: 600 } : r)) })));
  await page.waitForTimeout(200);
  const e1 = await page.getByTestId('strip-checks').innerText();
  check('an error shows in the strip at once, in red', /^1 error/.test(e1) && (await page.getByTestId('strip-checks').evaluate((el) => el.classList.contains('bad'))), e1);
  await page.evaluate(() => window.cellar.store.getState().undo());

  // hide, remember, focus
  const leftW = async () => (await page.getByTestId('left').boundingBox())?.width ?? 0;
  check('the controls panel starts at its standard width', Math.abs((await leftW()) - 330) < 4, String(await leftW()));
  await page.getByTestId('toggle-left').click();
  check('Hide controls hides the panel and the button says how to bring it back', (await page.getByTestId('left').isHidden()) && /Show controls/.test(await page.getByTestId('toggle-left').innerText()));
  const wide = (await page.getByTestId('plan-canvas').boundingBox()).width;
  await page.reload(); await page.getByTestId('plan-canvas').waitFor(); await page.waitForTimeout(500);
  check('the choice is remembered after a reload', await page.getByTestId('left').isHidden());
  check('and the drawing has more room', (await page.getByTestId('plan-canvas').boundingBox()).width >= wide - 4);
  await page.getByTestId('toggle-left').click();
  check('Show controls brings it back', await page.getByTestId('left').isVisible());

  // resize with the keyboard and with the mouse
  const sep = page.getByTestId('resizer');
  await sep.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  check('the arrow keys resize the controls panel (20 mm steps)', Math.abs((await leftW()) - 370) < 4, String(await leftW()));
  const sb = await sep.boundingBox();
  await page.mouse.move(sb.x + 4, sb.y + 200); await page.mouse.down(); await page.mouse.move(sb.x + 104, sb.y + 200, { steps: 5 }); await page.mouse.up();
  check('dragging the divider resizes it too', Math.abs((await leftW()) - 470) < 8, String(await leftW()));
  await page.mouse.move(sb.x + 4, sb.y + 200); // (moves are harmless)
  await page.reload(); await page.getByTestId('plan-canvas').waitFor(); await page.waitForTimeout(500);
  check('the width is remembered', Math.abs((await leftW()) - 470) < 8, String(await leftW()));
  const sb2 = await page.getByTestId('resizer').boundingBox();
  await page.mouse.move(sb2.x + 4, sb2.y + 200); await page.mouse.down(); await page.mouse.move(sb2.x - 900, sb2.y + 200, { steps: 6 }); await page.mouse.up();
  check('it cannot be made narrower than 240 px', (await leftW()) >= 238, String(await leftW()));

  await page.getByTestId('toggle-right').click();
  check('Hide checks hides that panel; the strip still shows the error count', (await page.getByTestId('checks-panel').isHidden()) && (await page.getByTestId('strip-checks').isVisible()));
  await page.getByTestId('strip-checks').click();
  check('pressing the error count brings the checks back', await page.getByTestId('checks-panel').isVisible());

  await page.getByTestId('toggle-focus').click();
  check('Focus hides both panels', (await page.getByTestId('left').isHidden()) && (await page.getByTestId('checks-panel').isHidden()));
  const focused = (await page.getByTestId('plan-canvas').boundingBox()).width;
  check('and the drawing takes the room', focused > 1100, String(focused));
  await page.keyboard.press('Escape');
  check('Escape leaves focus and the panels come back', (await page.getByTestId('left').isVisible()) && (await page.getByTestId('checks-panel').isVisible()));
  await scan(page, 'status strip and panels');
  if (out) await page.screenshot({ path: join(out, 'strip.png') });
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ the title bar is reachable at every width (a 24-inch screen at 125% scaling is ~1536 px)
for (const w of [1920, 1536, 1440, 1366, 1100]) {
  const { page, ctx, errors } = await open(w, 900);
  await edit(page, (s) => s.edit((p) => ({ ...p, name: p.name + ' ' }))); // an unsaved change, so Save now shows
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const t = document.querySelector('.toolbar');
    const btns = [...t.querySelectorAll('button, input')].filter((e) => e.offsetParent !== null);
    const out = btns.map((e) => { const b = e.getBoundingClientRect(); return { id: e.getAttribute('data-testid') || (e.textContent || '').trim().slice(0, 14), right: b.right, left: b.left, top: b.top }; });
    return { w: window.innerWidth, past: out.filter((x) => x.right > window.innerWidth + 0.5 || x.left < -0.5).map((x) => x.id), n: out.length, rows: new Set(out.map((x) => Math.round(x.top / 10))).size, scrollable: t.querySelector('.toolbar-row').scrollWidth > t.querySelector('.toolbar-row').clientWidth + 1 };
  });
  check(`${w}px wide: every title-bar button is on screen (${r.n} buttons, none cut off)`, r.past.length === 0, JSON.stringify(r.past));
  check(`${w}px wide: the bar wraps instead of hiding a scroll`, !r.scrollable);
  const sv = page.getByTestId('save-now');
  check(`${w}px wide: Save now is visible`, await sv.isVisible());
  await sv.click();
  await page.waitForTimeout(500);
  check(`${w}px wide: pressing Save now works and the status settles`, !(await page.getByTestId('save-now').isVisible().catch(() => false)) || /Saved|saved/.test(await page.getByTestId('save-status').innerText()), await page.getByTestId('save-status').innerText());
  if (w === 1536 && out) await page.screenshot({ path: join(out, 'toolbar-1536.png'), clip: { x: 0, y: 0, width: 1536, height: 160 } });
  check(`${w}px wide: no script errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// on a phone the bar stays ONE row that swipes sideways (so it does not eat the screen), with Save near the front
{
  const { page, ctx } = await open(390, 800);
  await edit(page, (s) => s.edit((p) => ({ ...p, name: p.name + ' ' }))); await page.waitForTimeout(300);
  const h = await page.evaluate(() => document.querySelector('.toolbar').getBoundingClientRect().height);
  check('on a phone the title bar is one short row (not a tall wrapped block)', h < 90, String(h));
  const sv = await page.getByTestId('save-now').boundingBox();
  check('and Save now is within the first screen-width of it', !!sv && sv.x + sv.width <= 390, JSON.stringify(sv));
  await ctx.close();
}

// ================================================================ the bottles/checks sidebar: close it, reveal it
{
  const { page, ctx, errors } = await open();
  const right = page.getByTestId('checks-panel');
  check('the sidebar has its own close button, with a tooltip', /Hide this panel/.test(await page.getByTestId('close-right').getAttribute('title')));
  await page.getByTestId('close-right').click();
  check('closing hides the bottles and checks sidebar', await right.isHidden());
  check('a tab at the edge says how to bring it back', /Bottles and checks/.test(await page.getByTestId('reveal-right').innerText()));
  check('the strip still shows the bottle count while it is closed', /\d+/.test(await page.getByTestId('strip-bottles').innerText()));
  await page.reload(); await page.getByTestId('plan-canvas').waitFor(); await page.waitForTimeout(500);
  check('it stays closed after a reload', await right.isHidden());
  await page.getByTestId('reveal-right').click();
  check('the edge tab reveals it again', (await right.isVisible()) && (await page.getByTestId('reveal-right').count()) === 0);
  await page.getByTestId('toggle-left').click();
  check('the controls panel has the same edge tab', /Controls/.test(await page.getByTestId('reveal-left').innerText()));
  await page.getByTestId('reveal-left').click();
  check('and it brings the controls back', await page.getByTestId('left').isVisible());
  await page.getByTestId('toggle-focus').click();
  check('in focus mode there are no edge tabs (Leave focus is on the strip)', (await page.getByTestId('reveal-right').count()) === 0 && (await page.getByTestId('reveal-left').count()) === 0);
  await page.keyboard.press('Escape');
  await page.getByTestId('close-right').click();
  await scan(page, 'sidebar closed with its edge tab');
  if (out) await page.screenshot({ path: join(out, 'sidebar-closed.png') });
  await page.getByTestId('reveal-right').click();
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ================================================================ phone and tablet
{
  const { page, ctx, errors } = await open(390, 800);
  check('on a phone the strip is there and the panel buttons are not', (await page.getByTestId('status-strip').isVisible()) && (await page.getByTestId('toggle-left').isHidden()));
  check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await edit(page, (s) => s.edit((p) => ({ ...p, runs: p.runs.map((r) => (r.id === 'north-1' ? { ...r, startMm: 600 } : r)) })));
  await page.waitForTimeout(200);
  await page.getByTestId('strip-checks').click();
  check('pressing the error count on a phone opens the Checks pane', await page.getByTestId('checks-panel').isVisible());
  check('and the fix button is there to press', await page.getByTestId('fix-RUN_OUTSIDE').isVisible());
  const h = (await page.getByTestId('fix-RUN_OUTSIDE').boundingBox()).height;
  console.log('INFO  fix button height on a (non-touch) phone viewport:', Math.round(h));
  await scan(page, 'phone with a fix button');
  check('no script errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
