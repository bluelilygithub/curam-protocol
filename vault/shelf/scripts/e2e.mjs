// End-to-end checks of the real tray UI in Chrome, against the development sample data (the sample clips include hostile ones on purpose).
// Start `npm run dev` first, then `node scripts/e2e.mjs [screenshotDir]`. Exits non-zero if any check fails. (playwright-core, installed Chrome.)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.SHELF_URL ?? 'http://127.0.0.1:5177/';
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  -> ${extra}`}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const run = async (scheme) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 430 }, colorScheme: scheme });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new globalThis.URL(URL).origin }).catch(() => {});
  const page = await ctx.newPage();
  const problems = [];
  const dialogs = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 200)}`); });
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); }); // any alert() from a hostile clip would land here
  const shot = async (name) => { if (out) await page.screenshot({ path: join(out, `${scheme}-${name}.png`) }); };
  const preview = page.locator('section[aria-label=Preview]');
  const cards = () => page.locator('[role=option]');
  const choose = async (n) => { // card number n (1 based) in the current list: scroll it into the window, then click it
    await page.evaluate((i) => { const el = document.querySelector('[role=listbox]'); el.scrollLeft = Math.max(0, (i - 1) * 182 - 200); }, n);
    await page.waitForTimeout(120);
    await page.locator(`[role=option] kbd`).first().waitFor({ timeout: 100 }).catch(() => {});
    const card = page.locator(`[data-clip-id=clip-${String(n).padStart(3, '0')}]`);
    await card.click();
    await page.waitForTimeout(160);
  };

  await page.goto(URL);
  await page.locator('[role=option]').first().waitFor();
  await page.waitForTimeout(300);
  const tag = (s) => `[${scheme}] ${s}`;

  // ---- shelf and windowing
  check(tag('filter chips show the counts: All 100'), (await page.locator('[role=tab]').first().innerText()).includes('100'));
  const rendered = await cards().count();
  check(tag('only the cards in view exist in the page (windowing), not all 100'), rendered > 0 && rendered < 20, `rendered ${rendered}`);
  check(tag('the newest copy is chosen and previewed on the right'), (await preview.innerText()).includes('Call Dana back'));
  await shot('01-shelf');

  // ---- Vault's look: tokens, fonts, hover, transitions
  const token = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  check(tag("default look is Vault's Warm Sand (bg, surface, border, primary, text, muted)"),
    (await Promise.all(['--color-bg', '--color-surface', '--color-border', '--color-primary', '--color-text', '--color-muted'].map(token))).join(',').toLowerCase() === '#f5f5f0,#eeeee8,#d8d8d0,#cc785c,#1a1a1a,#888888');
  check(tag('the page follows the chosen theme, not the operating system (same colours with the OS in dark or light mode)'), (await token('--color-bg')).toLowerCase() === '#f5f5f0');
  check(tag("the UI font is Vault's default, DM Sans, and it is really loaded from the bundle"),
    (await page.evaluate(async () => { await document.fonts.ready; return { family: getComputedStyle(document.body).fontFamily, loaded: [...document.fonts].some((f) => f.family === 'DM Sans' && f.status === 'loaded') }; })).family.includes('DM Sans')
    && (await page.evaluate(() => [...document.fonts].some((f) => f.family === 'DM Sans' && f.status === 'loaded'))));
  check(tag("code uses Vault's code font, DM Mono"), (await page.evaluate(async () => { await document.fonts.load('400 12px "DM Mono"'); return [...document.fonts].some((f) => f.family === 'DM Mono' && f.status === 'loaded'); })));
  const accent = page.getByRole('tab', { name: /^All/ });
  const accentBg = await accent.evaluate((e) => getComputedStyle(e).backgroundColor);
  check(tag('the chosen filter chip is painted in the theme primary colour'), accentBg === 'rgb(204, 120, 92)', accentBg);
  const save = preview.getByRole('button', { name: /Save as Note/ });
  const before = await save.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, border: getComputedStyle(e).borderColor, opacity: getComputedStyle(e).opacity }));
  await save.hover(); await page.waitForTimeout(320);
  const after = await save.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, border: getComputedStyle(e).borderColor, opacity: getComputedStyle(e).opacity }));
  check(tag('hover changes only the opacity, never a colour (Vault rule)'), after.bg === before.bg && after.color === before.color && after.border === before.border && Number(after.opacity) < Number(before.opacity), JSON.stringify({ before, after }));
  await page.mouse.move(5, 5);
  check(tag('transitions are 200 ms'), (await save.evaluate((e) => getComputedStyle(e).transitionDuration)).split(',').every((d) => d.trim() === '0.2s'));

  // ---- previews by kind
  await choose(3);
  check(tag('colour: swatch with HEX / RGB / HSL'), (await preview.innerText()).includes('rgb(204, 120, 92)') && (await preview.innerText()).includes('hsl('));
  await choose(5);
  const th = await preview.locator('th').allInnerTexts();
  check(tag('CSV: a real grid with a header row'), th.join('|').includes('Supplier') && (await preview.locator('tbody tr').count()) === 4, th.join('|'));
  check(tag('CSV: a quoted cell with a comma stays one cell'), (await preview.innerText()).includes('Bolt & Nut, Co'));
  await shot('02-table');
  await choose(4);
  check(tag('code: syntax highlighted'), (await preview.locator('.hljs span[class^=hljs-]').count()) > 5 && (await preview.innerText()).includes('JavaScript'));
  await shot('03-code');
  await choose(2);
  check(tag('link: shown as text, not opened'), (await preview.innerText()).includes('https://www.curam-ai.com.au/pricing') && (await preview.locator('a').count()) === 0);
  await choose(6);
  const imgOk = await preview.locator('img').evaluate((i) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).maxWidth === '300px').catch(() => false);
  check(tag('picture: real thumbnail, at most 300px wide'), imgOk);
  await shot('04-image');
  await choose(13);
  check(tag('TSV (spreadsheet paste) becomes a grid'), (await preview.locator('th').count()) === 3);
  await choose(15);
  check(tag('JSON is recognised as code'), (await preview.innerText()).includes('JSON'));
  await choose(16);
  check(tag('markdown table becomes a grid, cells trimmed'), (await preview.locator('th').allInnerTexts()).join('|') === 'Task|Owner|Due');

  // ---- hostile clips
  await choose(9);
  const okSvg = await preview.locator('img').getAttribute('src');
  check(tag('SVG: drawn as a picture from a blob: address'), !!okSvg && okSvg.startsWith('blob:'));
  await choose(10);
  const badSrc = await preview.locator('img').getAttribute('src');
  const svgText = await page.evaluate(async (s) => (await fetch(s)).text(), badSrc);
  check(tag('hostile SVG: script, handlers, foreignObject, remote image all removed'), !/script|onload|onclick|foreignObject|iframe|evil\.example|<image/i.test(svgText), svgText.slice(0, 200));
  check(tag('hostile SVG: still draws what was harmless, and says it was cleaned'), /<rect/.test(svgText) && (await preview.innerText()).includes('Unsafe parts were removed'));
  await shot('05-svg-cleaned');
  await choose(11);
  const frame = preview.locator('iframe');
  const sandbox = await frame.getAttribute('sandbox');
  const srcdoc = (await frame.getAttribute('srcdoc')) ?? '';
  check(tag('hostile HTML: frame is fully sandboxed (no script, no navigation)'), sandbox === '', `sandbox=${sandbox}`);
  check(tag('hostile HTML: srcdoc has no script, form, remote picture or link'), !/<script|<form|<input|<iframe|evil\.example|href=|onerror|onclick/i.test(srcdoc.replace(/<meta[^>]*>/, '')), srcdoc.slice(0, 300));
  check(tag('hostile HTML: a network-blocking policy is in the frame'), /default-src 'none'/.test(srcdoc));
  await shot('06-html-cleaned');
  check(tag('no hostile clip ran any script (no alert/confirm/prompt fired)'), dialogs.length === 0, dialogs.join(' / '));

  // ---- secret
  await choose(8);
  const maskedText = await preview.innerText();
  check(tag('masked secret: explained, and every send button is disabled'), /never sent to Vault/.test(maskedText) && (await preview.locator('button[aria-disabled=true]').count()) >= 3);
  await shot('07-secret');

  // ---- actions
  await choose(1);
  const finance = preview.getByRole('button', { name: /Ingest to Finance/ });
  check(tag('a button the key cannot do is greyed, with the reason on hover'), (await finance.isDisabled()) && (await finance.getAttribute('title'))?.includes('Finance is switched off'));
  await preview.getByRole('button', { name: /Save as Note/ }).click();
  await page.locator('[role=status]').getByText('Pushed to Vault').waitFor({ timeout: 3000 }).then(() => check(tag('dispatch shows the "Pushed to Vault" toast'), true)).catch(() => check(tag('dispatch shows the "Pushed to Vault" toast'), false));
  await shot('08-toast');
  await page.waitForTimeout(2600);
  check(tag('the toast fades away by itself'), (await page.locator('[role=status]').innerText()).trim() === '');

  // ---- redaction
  await choose(7);
  await preview.getByRole('button', { name: /Ask Redaction/ }).click();
  await preview.getByText(/possible details? found/).waitFor({ timeout: 3000 });
  const marks = await preview.locator('mark').allInnerTexts();
  check(tag('redaction: email, TFN, bank and phone are marked in the text'), marks.length >= 4 && marks.some((m) => m.includes('@')) && marks.some((m) => m.includes('123 456 782')), marks.join(' | '));
  check(tag('redaction: says plainly that names are not found'), /does not find names/.test(await preview.innerText()));
  await shot('09-redaction');
  await preview.getByRole('button', { name: /Back to preview/ }).click();
  check(tag('redaction: back returns to the normal preview'), (await preview.locator('mark').count()) === 0);

  // ---- filters and keyboard
  await page.getByRole('tab', { name: /^Images/ }).click();
  await page.waitForTimeout(150);
  const kinds = await cards().evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  check(tag('Images filter shows only pictures and drawings'), kinds.length >= 3 && kinds.every((t) => /Image|SVG/.test(t)), kinds.length + ' cards');
  await page.getByRole('tab', { name: /^Tables/ }).click();
  await page.waitForTimeout(150);
  check(tag('Tables filter shows only grids'), (await cards().evaluateAll((els) => els.every((e) => /Table/.test(e.textContent ?? '')))) === true);
  await page.getByRole('tab', { name: /^Links/ }).click();
  await page.waitForTimeout(150);
  check(tag('Links filter shows only links'), (await cards().evaluateAll((els) => els.length > 0 && els.every((e) => /Link/.test(e.textContent ?? '')))) === true);
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.waitForTimeout(150);
  const first = await page.locator('[role=option][aria-selected=true]').getAttribute('data-clip-id'); // the choice survives a change of filter
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  const second = await page.locator('[role=option][aria-selected=true]').getAttribute('data-clip-id');
  check(tag('arrow keys move the choice to the next card'), Number(second?.slice(5)) === Number(first?.slice(5)) + 1, `${first} -> ${second}`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(120);
  check(tag('and back again'), (await page.locator('[role=option][aria-selected=true]').getAttribute('data-clip-id')) === first);
  await page.keyboard.press('3');
  await page.waitForTimeout(120);
  check(tag('number keys pick a card'), (await page.locator('[role=option][aria-selected=true]').getAttribute('data-clip-id')) === 'clip-003');
  await page.keyboard.press('Enter');
  await page.locator('[role=status]').getByText('Copied').waitFor({ timeout: 2000 }).then(() => check(tag('Enter copies the choice'), true)).catch(() => check(tag('Enter copies the choice'), false));
  await page.keyboard.press('End');
  await page.waitForTimeout(500);
  const last = await page.locator('[role=option][aria-selected=true]').getAttribute('data-clip-id');
  check(tag('End goes to the oldest copy, scrolls to it, and still only a few cards exist'), last === 'clip-100' && (await cards().count()) < 20, `${last}, ${await cards().count()} cards`);
  await shot('10-end-of-shelf');
  await page.keyboard.press('Home');
  await page.waitForTimeout(700);

  // ---- a new copy arrives
  await page.evaluate(() => window.__shelfMock.addText('A brand new copy from another app'));
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector('[role=listbox]').scrollLeft = 0; });
  await page.waitForTimeout(200);
  const newest = await cards().first().innerText();
  check(tag('a new copy appears at the front when the shell says the list changed'), newest.includes('brand new copy'), newest);
  check(tag('and the All count goes up to 101'), (await page.locator('[role=tab]').first().innerText()).includes('101'));
  await page.keyboard.press('Home');
  await page.waitForTimeout(200);

  // ---- settings
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await shot('11-settings');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.keyboard.press('Control+C');
  check(tag('settings: a reserved shortcut (Ctrl+C) is refused with a reason'), /already use/.test(await page.locator('[role=alert]').first().innerText()));
  await page.keyboard.press('Control+Alt+K');
  await page.waitForTimeout(150);
  check(tag('settings: a new shortcut is recorded and shown'), (await page.locator('kbd').first().innerText()) === 'Ctrl+Alt+K');
  await page.getByPlaceholder('https://your-app.up.railway.app').fill('http://my-vault.example.com');
  await page.getByPlaceholder(/vsh_/).fill('vsh_x').catch(() => {});
  await page.locator('input[type=password]').fill('vsh_' + 'a'.repeat(64));
  await page.getByRole('button', { name: 'Save and check' }).click();
  check(tag('settings: a plain-http Vault address is refused'), /https/.test(await page.locator('[role=alert]').last().innerText()));
  await page.getByPlaceholder('https://your-app.up.railway.app').fill('https://my-vault.up.railway.app/settings');
  await page.getByRole('button', { name: 'Save and check' }).click();
  await page.getByRole('button', { name: 'Checking…' }).waitFor({ timeout: 2000 }).catch(() => {});
  await page.getByRole('button', { name: 'Save and check' }).waitFor({ timeout: 4000 });
  check(tag('settings: a good address and key connect, and the address is kept as just its origin'), (await page.getByPlaceholder('https://your-app.up.railway.app').inputValue()) === 'https://my-vault.up.railway.app');
  check(tag('settings: the key box is empty after saving (the key is not kept in the page)'), (await page.locator('input[type=password]').inputValue()) === '');
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  check(tag('settings: the key is not in browser storage either'), !stored.includes('vsh_'), stored.slice(0, 200));
  await page.getByPlaceholder('keepass.exe').fill('C:\\Program Files\\x.exe');
  await page.getByRole('button', { name: 'Add' }).click();
  check(tag('settings: a program path is refused'), /no folders/.test(await page.locator('[role=alert]').last().innerText()));
  await page.getByPlaceholder('keepass.exe').fill('KeePass');
  await page.getByRole('button', { name: 'Add' }).click();
  check(tag('settings: an excluded program is added in tidy form'), (await page.getByText('keepass.exe').count()) >= 1);
  await page.getByRole('switch', { name: /Ingest to Finance/ }).uncheck().catch(async () => { await page.getByLabel(/Ingest to Finance/).uncheck(); });

  // ---- appearance: every Vault theme and font can be chosen, and each one really changes the page
  await page.getByRole('heading', { name: 'Appearance' }).waitFor();
  const themeNames = ['Warm Sand', 'Dark Slate', 'Forest', 'Midnight Blue', 'Paper White'];
  const expectBg = { 'Warm Sand': '#f5f5f0', 'Dark Slate': '#0f1117', Forest: '#f0f4f0', 'Midnight Blue': '#0d1b2a', 'Paper White': '#ffffff' };
  check(tag('Appearance offers all five Vault themes'), (await page.getByRole('radio').count()) === 5);
  for (const name of themeNames) {
    await page.getByRole('radio', { name }).click();
    await page.waitForTimeout(250);
    const bg = (await token('--color-bg')).toLowerCase();
    const scheme = await page.evaluate(() => document.documentElement.dataset.scheme);
    check(tag('theme ' + name + ": the page takes Vault's exact background and the right light/dark setting"), bg === expectBg[name] && scheme === (['Dark Slate', 'Midnight Blue'].includes(name) ? 'dark' : 'light'), bg + ' ' + scheme);
    await shot('theme-' + name.toLowerCase().replace(' ', '-'));
  }
  await page.getByRole('radio', { name: 'Warm Sand' }).click();
  for (const font of ['Inter', 'Lato', 'Merriweather', 'JetBrains Mono', 'DM Sans']) {
    await page.getByLabel('Font').selectOption({ label: font });
    await page.waitForTimeout(250);
    const ok = await page.evaluate(async (f) => { await document.fonts.load('400 14px "' + f + '"'); return { used: getComputedStyle(document.body).fontFamily.includes(f), loaded: [...document.fonts].some((x) => x.family === f && x.status === 'loaded') }; }, font);
    check(tag('font ' + font + ': used by the page and loaded from the bundle'), ok.used && ok.loaded, JSON.stringify(ok));
  }
  await shot('12-settings-privacy');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForTimeout(200);
  await choose(1);
  check(tag('an action switched off in settings disappears from the preview'), (await preview.getByRole('button', { name: /Ingest to Finance/ }).count()) === 0);
  await shot('13-after-settings');

  // ---- narrow window still works
  await page.setViewportSize({ width: 900, height: 400 });
  await page.waitForTimeout(250);
  check(tag('a narrower window still shows cards and a preview'), (await cards().count()) > 0 && (await preview.innerText()).length > 10);
  await shot('14-narrow');

  const real = problems.filter((p) => !/favicon/i.test(p));
  check(tag('no page errors or console errors'), real.length === 0, real.join(' ; '));
  await ctx.close();
};

for (const scheme of (process.env.SCHEMES ?? 'light,dark').split(',')) await run(scheme);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
