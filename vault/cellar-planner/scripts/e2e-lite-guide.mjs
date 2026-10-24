// The website help chat, end to end: the REAL page script (lite-wordpress/cellar-lite-guide.js) on a stand-in website page that holds the REAL built
// planner in an iframe, talking to the REAL guide routes (server/routes/cellarLiteGuideRouter.js) with an in-memory table, a fake model and a fake mailbox.
// Checks: hidden while the owner has it off; appears when on; an answer with "Show me" buttons that move the planner to that step; the planner's own
// "which step" report reaches the question; sending the chat reaches the admin only; limits give a kind message; the page stays clean (no errors).
// Needs the built lite bundle (npm run build:lite) and Chrome. Run: node scripts/e2e-lite-guide.mjs
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const ROOT = join(import.meta.dirname, '..', '..');
const require = createRequire(join(ROOT, 'cellar-planner', 'package.json'));
const { chromium } = require('playwright-core');
const express = require(ROOT + '/node_modules/express');
const { createCellarLiteGuideRouter } = require(ROOT + '/server/routes/cellarLiteGuideRouter.js');
const { createCellarLiteConfigRouters } = require(ROOT + '/server/routes/cellarLiteConfigRouter.js');
const tutorEmail = require(ROOT + '/server/routes/tutorEmail.js');

let clock = 0;
const state = { enabled: false, sent: [], asked: [], reply: null };
const settingsRow = () => ({ rows: [{ value: JSON.stringify({ guide: { enabled: state.enabled } }), updatedAt: new Date() }] });
const pool = { async query(sql) {
  if (/FROM workspace_settings/i.test(sql)) return settingsRow();
  if (/SELECT id FROM users/i.test(sql)) return { rows: [{ id: 1 }] };
  if (/FROM usage_logs/i.test(sql)) return { rows: [{ n: '0' }] };
  if (/SELECT email FROM users/i.test(sql)) return { rows: [{ email: 'boss@example.com' }] };
  throw new Error('unexpected sql ' + sql);
} };
const ask = async (userId, input) => { state.asked.push(input); return state.reply ?? { verdict: 'doable', answer: 'Measure inside the walls, then type the size.', steps: [{ tool: 'space', label: 'Space', group: 'Steps', do: 'Type the width, depth and height.' }, { tool: 'review', label: 'Review & quote', group: 'Steps', do: 'Press Request a quote when happy.' }], missing: '', tip: 'Round to the nearest centimetre.' }; };
const mail = Object.assign(async (m) => { state.sent.push(m); }, { isConfigured: async () => true });
const api = express();
api.use('/api/cellar-lite/config', createCellarLiteConfigRouters({ pool, now: () => (clock += 60000) }).publicRouter);
api.use('/api/cellar-lite/guide', createCellarLiteGuideRouter({ pool, ask, tutorEmail, sendEmail: mail }));
const apiServer = await new Promise((r) => { const s = api.listen(8813, () => r(s)); });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const serveDist = (req, res) => {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const f = join(ROOT, 'cellar-planner/dist-lite', p);
  if (!existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
};
const lite = await new Promise((r) => { const s = http.createServer(serveDist).listen(8812, () => r(s)); });
const fillJs = readFileSync(join(ROOT, 'cellar-planner/lite-wordpress/cellar-lite-fill.js'), 'utf8')
  .replace("'https://www.wiwc.com.au'", "'http://localhost:8812'").replace("'https://wiwc.com.au/contact/'", "'http://localhost:8811/contact.html'").replace("'https://wiwc.com.au/cellar-lite/'", "'http://localhost:8811/'");
assert.ok(fillJs.includes('localhost:8811/'), 'the page script addresses were pointed at the test servers');
const guideJs = readFileSync(join(ROOT, 'cellar-planner/lite-wordpress/cellar-lite-guide.js'), 'utf8')
  .replace("'https://curam-vault.up.railway.app'", "'http://localhost:8813'").replace("'https://www.wiwc.com.au'", "'http://localhost:8812'");
assert.ok(guideJs.includes('localhost:8813') && guideJs.includes('localhost:8812'), 'the script addresses were pointed at the test servers');
const site = await new Promise((r) => {
  const s = http.createServer((req, res) => {
    if (req.url.startsWith('/cellar-lite-guide.js')) { res.setHeader('content-type', 'text/javascript'); return res.end(guideJs); }
    if (req.url.startsWith('/fill.js')) { res.setHeader('content-type', 'text/javascript'); return res.end(fillJs); }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><body style="margin:0"><div id="menu" style="position:fixed;top:0;left:0;right:0;height:90px;background:#222;color:#fff;z-index:99999">Site menu</div><h1 style="margin-top:100px">Our wine cellar planner</h1><iframe id="p" title="Wine cellar planner" src="http://localhost:8812/" style="width:100%;height:1400px;border:0"></iframe><script src="/fill.js"></script></body></html>');
  }).listen(8811, () => r(s));
});

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log('PASS ', name); } catch (e) { failed++; console.log('FAIL ', name, '\n     ', String(e.stack).split('\n').slice(0, 4).join('\n      ')); } };
const newPage = async (width = 1200) => {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  return { page, errors };
};
const planner = (page) => page.frameLocator('#p');

await t('off: no help button on the page', async () => {
  state.enabled = false;
  const { page, errors } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#clg').count(), 0);
  assert.deepEqual(errors, []);
  await page.context().close();
});

await t('on: button appears; asking gives an answer; "Show me" moves the planner to that step', async () => {
  state.enabled = true;
  const { page, errors } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').waitFor({ timeout: 8000 });
  await page.locator('#clg .open').click();
  assert.equal(await page.locator('#clg .panel').isVisible(), true);
  await page.locator('#clg .starter').first().click();
  await page.locator('#clg ol li').first().waitFor();
  assert.match(await page.locator('#clg .bot').last().innerText(), /Measure inside the walls/);
  // the planner starts on step 1; the second tip's button should take it to the last step
  await page.getByRole('button', { name: 'Show me: Review & quote' }).click();
  await planner(page).getByRole('heading', { name: /Review|quote|summary/i }).first().waitFor({ timeout: 5000 });
  const stepText = await planner(page).getByTestId('lite-stepper').innerText();
  assert.match(stepText, /Review/);
  assert.ok(state.asked.at(-1).messages.at(-1).content.startsWith('How do I measure'));
  assert.deepEqual(errors, []);
  await page.context().close();
});

await t('the planner reports its step, and the next question carries it', async () => {
  state.enabled = true;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  await page.getByRole('button', { name: 'Show me: Review & quote' }).count(); // none yet
  await page.locator('#clg textarea').fill('and the next bit?');
  await page.locator('#clg .send').first().click();
  await page.locator('#clg ol li').first().waitFor();
  await page.getByRole('button', { name: 'Show me: Review & quote' }).click();
  await page.waitForTimeout(500);
  await page.locator('#clg textarea').fill('what now?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#clg .me').length >= 2 && !document.querySelector('#clg .busy'));
  assert.equal(state.asked.at(-1).currentTool, 'review');
  await page.context().close();
});

await t('send to the team: reaches the admin only, even if the page tries to name someone else', async () => {
  state.enabled = true; state.sent.length = 0;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  assert.equal(await page.locator('#clg .elink').isVisible(), false, 'not offered before there is a chat');
  await page.locator('#clg .starter').first().click();
  await page.locator('#clg ol li').first().waitFor();
  await page.locator('#clg .elink').click();
  await page.locator('#clg-contact').fill('sam@visitor.com');
  await page.locator('#clg .ebox .pbtn').click();
  await page.getByText('Sent. The team will see this chat.').waitFor();
  assert.deepEqual(state.sent.map((m) => m.to), ['boss@example.com']);
  assert.equal(state.sent[0].replyTo, 'sam@visitor.com');
  assert.match(state.sent[0].html, /Measure inside the walls/);
  await page.context().close();
});

await t('a server refusal is shown kindly, and the question can be asked again', async () => {
  state.enabled = true;
  const { page } = await newPage();
  await page.route('http://localhost:8813/api/cellar-lite/guide', (r) => r.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'You have asked a lot of questions. Please try again later, or use the Request a quote button and the team will help.' }) }));
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  await page.locator('#clg textarea').fill('hello');
  await page.locator('#clg .send').first().click();
  await page.getByText(/asked a lot of questions/).waitFor();
  await page.locator('#clg textarea').fill('hello again');
  assert.equal(await page.locator('#clg .send').first().isDisabled(), false, 'the question can be asked again');
  await page.context().close();
});

await t('the visitor text is never turned into markup', async () => {
  state.enabled = true;
  state.reply = { verdict: 'doable', answer: '<img src=x onerror="window.__pwned=1">hi', steps: [{ tool: 'space', label: '<b>Space</b>', group: 'Steps', do: '<script>window.__pwned=1</script>' }], missing: '', tip: '' };
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  await page.locator('#clg textarea').fill('<h1>x</h1>');
  await page.locator('#clg .send').first().click();
  await page.locator('#clg ol li').first().waitFor();
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('#clg .list h1, #clg .list img, #clg .list script').count(), 0);
  state.reply = null;
  await page.context().close();
});

await t('the round button sits beside the planner title (and scrolls with it, not with the screen); the chat itself drags, stays on screen, and double-click puts it back', async () => {
  state.enabled = true;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  const dot = page.locator('#clg .open'); await dot.waitFor({ timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('clg')?.classList.contains('a'), null, { timeout: 8000 });
  const title = () => planner(page).locator('.lite-head h1').boundingBox();
  const beside = async () => {
    const t = await title(), b = await dot.boundingBox();
    return { dy: Math.abs((b.y + b.height / 2) - (t.y + t.height / 2)), gap: b.x - (t.x + t.width), t, b };
  };
  const s0 = await beside();
  assert.ok(s0.dy < 6, 'level with the title: ' + JSON.stringify(s0));
  assert.ok(s0.gap > 0 && s0.gap < 400, 'just to the right of the title: ' + JSON.stringify(s0));
  await page.mouse.move(s0.b.x + 20, s0.b.y + 20); await page.mouse.down(); await page.mouse.move(s0.b.x - 200, s0.b.y + 150, { steps: 5 }); await page.mouse.up();
  const s1 = await beside();
  assert.ok(Math.abs(s1.b.x - s0.b.x) < 2 && Math.abs(s1.b.y - s0.b.y) < 2, 'the button does not drag: ' + JSON.stringify([s0.b, s1.b]));
  await page.evaluate(() => window.scrollTo(0, 260)); await page.waitForTimeout(300);
  const s2 = await beside();
  assert.ok(s2.dy < 6 && Math.abs(s2.t.y - s0.t.y) > 100, 'it moves with the title when the page scrolls: ' + JSON.stringify([s0.t, s2.t]));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await dot.click();
  assert.equal(await page.locator('#clg .panel').isVisible(), true, 'a click opens the chat');
  const pb = await page.locator('#clg .panel').boundingBox();
  assert.ok(pb.x + pb.width <= 1200 && pb.y + pb.height <= 800 && pb.x >= 0 && pb.y >= 0, 'the chat opens fully on the screen, not at the title: ' + JSON.stringify(pb));
  const head = page.locator('#clg .head'); const h0 = await head.boundingBox();
  await page.mouse.move(h0.x + 150, h0.y + 10); await page.mouse.down(); await page.mouse.move(h0.x - 100, h0.y + 60, { steps: 5 }); await page.mouse.move(-500, 400, { steps: 3 }); await page.mouse.up();
  const p1 = await page.locator('#clg .panel').boundingBox();
  assert.ok(p1.x >= 0 && p1.y >= 0 && p1.x + p1.width <= 1200 && p1.y + p1.height <= 800, 'the chat stays fully on the screen: ' + JSON.stringify(p1));
  await page.reload(); await page.locator('#clg .open').waitFor({ timeout: 8000 });
  await page.locator('#clg .open').click();
  const p2 = await page.locator('#clg .panel').boundingBox();
  assert.ok(Math.abs(p2.x - p1.x) < 3, 'the chat position is remembered');
  await page.locator('#clg .head .t').dblclick();
  const p3 = await page.locator('#clg .panel').boundingBox();
  assert.ok(p3.x > p1.x + 100, 'double-click puts the chat back');
  await page.context().close();
});

await t('on a phone-width screen the button still sits beside the title and the header buttons stay clear of it', async () => {
  state.enabled = true;
  const { page } = await newPage(390);
  await page.addInitScript(() => { try { sessionStorage.setItem('cellar-lite:phone-notice:v1', '1'); } catch (e) { /* fine */ } });
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  const dot = page.locator('#clg .open'); await dot.waitFor({ timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('clg')?.classList.contains('a'), null, { timeout: 8000 });
  const t0 = await planner(page).locator('.lite-head h1').boundingBox(), b = await dot.boundingBox();
  assert.ok(Math.abs((b.y + b.height / 2) - (t0.y + t0.height / 2)) < 6 && b.x >= t0.x + t0.width && b.x + b.width <= 390, 'beside the title, inside the screen: ' + JSON.stringify([t0, b]));
  const btns = await planner(page).locator('.lite-help-btns .btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const frameBox = await page.locator('#p').boundingBox();
  const clash = btns.some((r) => r.x + frameBox.x < b.x + b.width && r.x + frameBox.x + r.w > b.x && r.y + frameBox.y < b.y + b.height && r.y + frameBox.y + r.h > b.y);
  assert.ok(!clash, 'the header buttons do not sit under the chat button');
  await page.context().close();
});

await t('resizable: wider/narrower button and a drag corner, remembered', async () => {
  state.enabled = true;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  const w0 = (await page.locator('#clg .panel').boundingBox()).width;
  await page.getByRole('button', { name: 'Make the help chat wider' }).click();
  const w1 = (await page.locator('#clg .panel').boundingBox()).width;
  assert.ok(w1 > w0 + 250, 'wider: ' + w0 + ' to ' + w1);
  await page.getByRole('button', { name: 'Make the help chat narrower' }).click();
  const g = await page.locator('#clg .grip').boundingBox(); const before = await page.locator('#clg .panel').boundingBox();
  await page.mouse.move(g.x + 8, g.y + 8); await page.mouse.down(); await page.mouse.move(g.x - 120, g.y - 100, { steps: 5 }); await page.mouse.up();
  const after = await page.locator('#clg .panel').boundingBox();
  assert.ok(after.width > before.width + 80, 'the corner resizes: ' + Math.round(before.width) + 'x' + Math.round(before.height) + ' to ' + Math.round(after.width) + 'x' + Math.round(after.height));
  await page.reload(); await page.locator('#clg .open').click();
  assert.ok(Math.abs((await page.locator('#clg .panel').boundingBox()).width - after.width) < 3, 'the size is remembered');
  await page.context().close();
});

await t('microphone: speech is added to the end of what is typed, and stops when asked', async () => {
  state.enabled = true;
  const { page } = await newPage();
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class { constructor() { window.__rec = this; } start() { this.on = true; } stop() { this.on = false; if (this.onend) this.onend(); } };
    window.__say = (text) => window.__rec.onresult({ results: [[{ transcript: text }]] });
  });
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  await page.locator('#clg textarea').fill('how do I');
  await page.locator('#clg .mic').click();
  assert.equal(await page.locator('#clg .mic').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => window.__say('measure the door'));
  assert.equal(await page.locator('#clg textarea').inputValue(), 'how do I measure the door');
  await page.locator('#clg .mic').click();
  assert.equal(await page.locator('#clg .mic').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => window.__rec.on), false);
  await page.context().close();
});

await t('the email link is a plain text link, and its Send button is the same colour as the chat Send button', async () => {
  state.enabled = true;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  await page.locator('#clg .starter').first().click(); await page.locator('#clg ol li').first().waitFor();
  const link = await page.locator('#clg .elink').evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, td: c.textDecorationLine }; });
  assert.ok(/underline/.test(link.td) && /rgba\(0, 0, 0, 0\)|transparent/.test(link.bg), 'a plain text link: ' + JSON.stringify(link));
  await page.locator('#clg .elink').click();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const send = await page.locator('#clg .ebox .pbtn').evaluate((e) => getComputedStyle(e).backgroundColor);
  const ask = await page.locator('#clg .send').evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.equal(send, ask);
  await page.context().close();
});

await t('the page script loads the help chat by itself (nothing extra to add to the page)', async () => {
  state.enabled = true;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').waitFor({ timeout: 8000 });
  await page.context().close();
});

await t('pop-ups and the tour card appear in the middle of what the visitor sees, not the middle of the long frame', async () => {
  state.enabled = false;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(500);
  const inView = async (sel) => page.evaluate((s) => {
    const f = document.getElementById('p'); const fr = f.getBoundingClientRect();
    const el = f.contentDocument ? f.contentDocument.querySelector(s) : null;
    return el ? { mid: fr.top + el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2, vh: window.innerHeight } : null;
  }, sel).catch(() => null);
  // the frame is cross-origin in this test, so measure through the frame's own coordinates instead
  const rectIn = async (sel) => planner(page).locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, h: r.height, innerH: window.innerHeight }; });
  await planner(page).getByTestId('lite-help-open').click();
  await planner(page).getByTestId('lite-help').waitFor();
  const frameTop = await page.evaluate(() => document.getElementById('p').getBoundingClientRect().top);
  const m = await rectIn('[data-testid="lite-help"] .modal');
  const mid = frameTop + m.top + m.h / 2;
  const top = frameTop + m.top;
  assert.ok(top + m.h <= 800, 'the bottom of the Help pop-up is on screen: it ends at ' + Math.round(top + m.h));
  assert.ok(top >= 90, 'the top of the Help pop-up is below the site menu (90 px): it starts at ' + Math.round(top));
  assert.ok(mid > 100 && mid < 700, 'the Help pop-up is centred on the screen: its middle is at ' + Math.round(mid) + ' of 800 (frame ' + m.innerH + ' tall)');
  await planner(page).getByTestId('info-got-it').count();
  await planner(page).getByTestId('lite-help-close').evaluate((el) => el.click());
  await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(400);
  await planner(page).getByRole('button', { name: 'Take the tour' }).click();
  await planner(page).locator('.shepherd-element').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(900);
  const frameTop2 = await page.evaluate(() => document.getElementById('p').getBoundingClientRect().top);
  const c = await rectIn('.shepherd-element');
  const cmid = frameTop2 + c.top + c.h / 2;
  assert.ok(frameTop2 + c.top >= 90, 'the tour card starts below the site menu: ' + Math.round(frameTop2 + c.top));
  assert.ok(cmid > 0 && cmid < 800, 'the tour card is on the visible screen: its middle is at ' + Math.round(cmid) + ' of 800 (frame ' + c.innerH + ' tall)');
  void inView;
  await page.context().close();
});

await browser.close(); apiServer.close(); lite.close(); site.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
