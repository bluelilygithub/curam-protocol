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
const guideJs = readFileSync(join(ROOT, 'cellar-planner/lite-wordpress/cellar-lite-guide.js'), 'utf8')
  .replace("'https://curam-vault.up.railway.app'", "'http://localhost:8813'").replace("'https://www.wiwc.com.au'", "'http://localhost:8812'");
assert.ok(guideJs.includes('localhost:8813') && guideJs.includes('localhost:8812'), 'the script addresses were pointed at the test servers');
const site = await new Promise((r) => {
  const s = http.createServer((req, res) => {
    if (req.url.startsWith('/guide.js')) { res.setHeader('content-type', 'text/javascript'); return res.end(guideJs); }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><body style="margin:0"><h1>Our wine cellar planner</h1><iframe id="p" title="Wine cellar planner" src="http://localhost:8812/" style="width:100%;height:1400px;border:0"></iframe><script src="/guide.js"></script></body></html>');
  }).listen(8811, () => r(s));
});

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log('PASS ', name); } catch (e) { failed++; console.log('FAIL ', name, '\n     ', String(e.stack).split('\n').slice(0, 4).join('\n      ')); } };
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
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
  await page.locator('#clg .chip').first().click();
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
  await page.locator('#clg .go').first().click();
  await page.locator('#clg ol li').first().waitFor();
  await page.getByRole('button', { name: 'Show me: Review & quote' }).click();
  await page.waitForTimeout(500);
  await page.locator('#clg textarea').fill('what now?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#clg .bot').length >= 4 || document.querySelectorAll('#clg .me').length >= 2 && !document.querySelector('#clg .bot:last-child')?.textContent.startsWith('Checking'));
  assert.equal(state.asked.at(-1).currentTool, 'review');
  await page.context().close();
});

await t('send to the team: reaches the admin only, even if the page tries to name someone else', async () => {
  state.enabled = true; state.sent.length = 0;
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  assert.equal(await page.getByText('Send this chat to the team').isVisible(), false, 'not offered before there is a chat');
  await page.locator('#clg .chip').first().click();
  await page.locator('#clg ol li').first().waitFor();
  await page.getByText('Send this chat to the team').click();
  await page.locator('#clg-contact').fill('sam@visitor.com');
  await page.locator('#clg .tbox .go').click();
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
  await page.locator('#clg .go').first().click();
  await page.getByText(/asked a lot of questions/).waitFor();
  assert.equal(await page.locator('#clg .go').first().isDisabled(), false);
  await page.context().close();
});

await t('the visitor text is never turned into markup', async () => {
  state.enabled = true;
  state.reply = { verdict: 'doable', answer: '<img src=x onerror="window.__pwned=1">hi', steps: [{ tool: 'space', label: '<b>Space</b>', group: 'Steps', do: '<script>window.__pwned=1</script>' }], missing: '', tip: '' };
  const { page } = await newPage();
  await page.goto('http://localhost:8811/'); await planner(page).getByTestId('lite-stepper').waitFor();
  await page.locator('#clg .open').click();
  await page.locator('#clg textarea').fill('<h1>x</h1>');
  await page.locator('#clg .go').first().click();
  await page.locator('#clg ol li').first().waitFor();
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('#clg .list h1, #clg .list img, #clg .list script').count(), 0);
  state.reply = null;
  await page.context().close();
});

await browser.close(); apiServer.close(); lite.close(); site.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
