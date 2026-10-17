// The Jobs page, in real Chrome: opened from Vault (?embedded=1) the planner lands on the list of jobs; search narrows it; Open fills the planner with that job.
// Run the dev server first (`npm run dev`, port 5176), then: node scripts/e2e-jobs.mjs
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
const URL = process.env.CELLAR_URL ?? 'http://localhost:5176/cellar-planner-app/';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); if (!ok) failed++; };
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await ctx.addInitScript(() => { try { localStorage.setItem('cellar-planner:info-seen:v1', '1'); } catch { /* fine */ } });

// first visit (standalone) makes the Test case; rename it, then add two more jobs
await p.goto(URL); await p.getByTestId('plan-canvas').waitFor();
await p.getByTestId('project-name').fill('Smith wine room'); await p.getByTestId('save-now').click();
await p.waitForFunction(() => window.cellar.designs.library.getState().status === 'saved');
await p.getByTestId('designs-open').click();
await p.getByTestId('design-new').click(); await p.waitForTimeout(800);
await p.getByTestId('project-name').fill('Adams cellar'); await p.getByTestId('save-now').click();
await p.waitForFunction(() => window.cellar.designs.library.getState().status === 'saved');

// opened from Vault: lands on the Jobs page, not on the drawing
await p.goto(URL + '?embedded=1'); await p.getByTestId('jobs-page').waitFor({ timeout: 8000 });
check('opened from Vault, the planner lands on the Jobs page', (await p.getByTestId('jobs-page').count()) === 1 && (await p.getByTestId('plan-canvas').isVisible()) === false);
check('it lists both jobs', (await p.getByTestId('design-item').count()) === 2 && /2 saved/.test(await p.getByTestId('jobs-count').innerText()));
await p.getByTestId('jobs-search').fill('smith');
check('search narrows the list by name', (await p.getByTestId('design-item').count()) === 1 && /Smith wine room/.test(await p.getByTestId('design-list').innerText()));
await p.getByTestId('jobs-search').fill('nobody');
check('a search with no match says so', /No job matches/.test(await p.getByTestId('design-list').innerText()));
await p.getByTestId('jobs-search').fill('smith');
await p.getByTestId('job-open').click();
await p.getByTestId('plan-canvas').waitFor();
check('Open fills the planner with that job (name and racks)', (await p.getByTestId('project-name').inputValue()) === 'Smith wine room' && (await p.evaluate(() => window.cellar.store.getState().project.runs.length)) > 0);
check('the Jobs page closes after opening', (await p.getByTestId('jobs-page').count()) === 0);
await p.getByTestId('designs-open').click();
check('the Jobs button brings the page back, marking the open job', /open now/.test(await p.getByTestId('design-list').innerText()));
await p.getByTestId('jobs-continue').click();
check('Back to the job returns to the drawing without changing anything', (await p.getByTestId('jobs-page').count()) === 0 && (await p.getByTestId('project-name').inputValue()) === 'Smith wine room');
check('no page errors', errs.length === 0, errs.join(' | '));
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
