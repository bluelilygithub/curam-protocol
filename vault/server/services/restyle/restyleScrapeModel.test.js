'use strict';

// node server/services/restyle/restyleScrapeModel.test.js   (npm run test:restyle-scrape-model). What "Download a page's CSS" hands over:
// the combined CSS file, the Markdown and JSON settings reports, safe file names, and brand colours taken from the page.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { summariseCss } = require('./cssSettings');

(async () => {
  const M = await import(pathToFileURL(path.join(__dirname, '../../../client/src/pages/restyle/scrapeModel.mjs')).href);

  const files = [
    { filename: 'base.css', url: 'https://example.com/css/base.css', source: 'imported', importedBy: 'main.css', media: '', css: 'body { margin: 0 }', bytes: 18 },
    { filename: 'main.css', url: 'https://example.com/css/main.css', source: 'linked', media: '', css: '.hero { color: #cc785c }\n', bytes: 25 },
    { filename: 'theme.css', url: 'https://example.com/shop/theme.css', source: 'linked', media: 'print', css: '.p { display: none }', bytes: 20 },
    { filename: 'Styles inside the page', url: '', source: 'embedded', media: '', css: '.x { color: #333; padding: 8px }', bytes: 31 },
  ];
  const result = {
    url: 'https://example.com/shop/', finalUrl: 'https://example.com/shop/', title: 'The Shop', rendered: false,
    files, summary: summariseCss(files.map((f) => f.css)), flags: ['1 style file could not be fetched (blocked, missing or timed out).'],
  };

  // ---- sizes and file names ----
  assert.strictEqual(M.sizeLabel(900), '900 B');
  assert.strictEqual(M.sizeLabel(2048), '2.0 KB');
  assert.strictEqual(M.sizeLabel(250 * 1024), '250 KB');
  assert.strictEqual(M.sizeLabel(3 * 1024 * 1024), '3.0 MB');
  assert.deepStrictEqual(files.map(M.fileNameFor), ['01-base.css', '02-main.css', '03-theme.css', '04-Styles-inside-the-page.css']);
  assert.strictEqual(M.fileNameFor({ filename: '../../etc/passwd' }, 0), '01-etc-passwd.css', 'a file name from a page can never climb out of a folder');
  assert.strictEqual(M.fileNameFor({ filename: '' }, 11), '12-styles.css');
  assert.strictEqual(M.fileNameFor({ filename: 'a b?.css' }, 0), '01-a-b.css');

  // ---- the combined file ----
  const combined = M.combineCss(files, { url: result.finalUrl, title: result.title });
  assert.match(combined, /^\/\* CSS of "The Shop" https:\/\/example\.com\/shop\/ \*\//);
  assert.ok(combined.indexOf('===== base.css') < combined.indexOf('===== main.css'), 'the combined file keeps the page order');
  assert.match(combined, /===== theme\.css \(linked from the page: https:\/\/example\.com\/shop\/theme\.css; for print\) =====/, 'the screens a file is for are noted');
  assert.match(combined, /===== Styles inside the page \(written inside the page\) =====/);
  assert.match(combined, /\.hero \{ color: #cc785c \}/);
  assert.match(M.combineCss([{ filename: 'a*/b.css', css: 'x{}', source: 'linked', url: '', media: '' }]), /===== a\* \/b\.css/, 'a file name cannot close the comment');
  assert.match(M.combineCss([], {}), /0 style files/);

  // ---- the settings report ----
  const md = M.settingsMarkdown(result, { date: new Date('2026-10-20T00:00:00Z') });
  assert.match(md, /^# Design settings of The Shop/);
  assert.match(md, /2026-10-20/);
  assert.match(md, /4 style files/);
  assert.match(md, /## Colours[\s\S]*`#cc785c` \| 1 \|/);
  assert.match(md, /## Style files[\s\S]*main\.css \| linked from the page/);
  assert.match(md, /## Spacing[\s\S]*`8px`/);
  assert.match(md, /## Notes[\s\S]*could not be fetched/);
  assert.match(M.settingsMarkdown({ ...result, summary: summariseCss([]), files: [], flags: [] }), /_None found\._/);
  assert.ok(!/\|\|/.test(M.settingsMarkdown({ ...result, summary: summariseCss(['a { font-family: "A|B", serif }']) })), 'a | in a value cannot break the table');

  // ---- the data version ----
  const json = JSON.parse(M.settingsJson(result));
  assert.strictEqual(json.files.length, 4);
  assert.ok(json.files.every((f) => f.css === undefined), 'the JSON has the settings, not the CSS text (that is in the .css files)');
  assert.strictEqual(json.files[0].importedBy, 'main.css');
  assert.ok(json.settings.colors.some((c) => c.value === '#cc785c'));
  assert.strictEqual(json.title, 'The Shop');

  // ---- brand colours from the page ----
  assert.deepStrictEqual(M.topColours({ colors: [{ value: '#333', count: 3 }, { value: 'rgb(204, 120, 92)', count: 2 }, { value: '#333333', count: 1 }, { value: 'hsl(1,2%,3%)', count: 1 }, { value: '#abc', count: 1 }] }), ['#333333', '#cc785c', '#aabbcc'], 'plain colours only, no repeats, in order of use');
  assert.strictEqual(M.topColours({ colors: Array.from({ length: 20 }, (_, i) => ({ value: `#${String(i).padStart(2, '0')}0000`, count: 1 })) }, 6).length, 6);
  assert.deepStrictEqual(M.topColours({ colors: [] }), []);

  console.log('restyle scrape-model tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
