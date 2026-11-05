'use strict';

// node server/services/webExtractorTutor.test.js   (npm run test:web-extractor-tutor). No model is called.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS, buildTutorPrompt, cleanMessages, normalizeTutorReply, askWebExtractorTutor,
} = require('./webExtractorTutor');

(async () => {
  const tools = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages/webExtractor/webExtractorTools.mjs')).href);
  const { GUIDE_TOOLS, WEB_EXTRACTOR_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, parseSpokenUrl, parseSpokenList, parseSpokenSelector, toCsv, tableToObjects, linksToRows, tableToRows, PALETTE_PAGES, readableOn, paletteToCss, paletteToRows } = tools;

  // ---- the guide knows exactly the tools and buttons the page can show (fails if one is added to or removed from either list alone) ----
  assert.deepStrictEqual(CATALOG.map((t) => t.id).sort(), GUIDE_TOOLS.map((t) => t.id).sort(), 'the guide catalogue matches the page');
  assert.strictEqual(new Set(CATALOG.map((t) => t.id)).size, CATALOG.length, 'no duplicate ids');
  for (const t of CATALOG) {
    assert.ok(t.group && t.does && t.label, `${t.id} is described`);
    assert.strictEqual(t.label, GUIDE_TOOLS.find((g) => g.id === t.id).label, `${t.id} uses the page's own name`);
  }
  const modeIds = WEB_EXTRACTOR_TOOLS.map((t) => t.id);
  assert.ok(GUIDE_TOOLS.every((g) => modeIds.includes(g.mode)), 'every Open button goes to a real tool');
  // every tool in the left-hand list has its hover text, group tip and blurb
  for (const t of WEB_EXTRACTOR_TOOLS) {
    assert.ok(TOOL_TIPS[t.id], `${t.id} has a hover tip`);
    assert.ok(TOOL_BLURBS[t.id], `${t.id} has a blurb`);
    assert.ok(GROUPS.includes(t.group), `${t.id} is in a listed group`);
    assert.strictEqual(CATALOG.find((c) => c.id === t.id).group, t.group, `${t.id} is in the same group in the guide`);
  }
  for (const g of GROUPS) assert.ok(GROUP_TIPS[g], `group ${g} has a tip`);

  // ---- the facts the guide must not get wrong ----
  assert.match(CATALOG.find((t) => t.id === 'exclude-sections').does, /whole heading word/);
  assert.match(CATALOG.find((t) => t.id === 'styled').does, /HTML source.*As fetched.*The copy/s, 'Exact scrape offers the HTML source');
  assert.match(CATALOG.find((t) => t.id === 'styled').notes, /rather than showing a words-only copy/, 'a refused page is not replaced by a words-only copy');
  assert.match(CATALOG.find((t) => t.id === 'download-images').does, /up to 60/);
  assert.match(CATALOG.find((t) => t.id === 'palette').notes, /inside pictures/, 'colours in pictures are not read');
  assert.match(CATALOG.find((t) => t.id === 'palette').does, /Click a swatch to copy/);
  assert.match(CATALOG.find((t) => t.id === 'palette-pages').notes, /Up to six pages, not a whole website/);
  assert.match(NOT_POSSIBLE.join(' '), /except Colour palette/, 'the one-page rule names its exception');
  assert.match(CATALOG.find((t) => t.id === 'download-pdf').notes, /show as \?/);
  const gaps = NOT_POSSIBLE.join(' ');
  for (const needle of [/sign-in/, /JavaScript/, /crawling/, /history or library/, /AI on the page/]) assert.match(gaps, needle);
  assert.match(RULES.join(' '), /never extract anything by themselves/);

  // ---- safety rules are in the instructions ----
  assert.match(SYSTEM, /cannot see any page or any result/);
  assert.match(SYSTEM, /ONLY the tools and rules/);
  assert.match(SYSTEM, /Never invent a button/i);

  // ---- the prompt carries every tool, the rules, the gaps, the conversation ----
  const prompt = buildTutorPrompt({ messages: [{ role: 'user', content: 'get the text' }], currentTool: 'images' });
  for (const t of CATALOG) assert.ok(prompt.includes(`tool "${t.id}"`), `prompt lists ${t.id}`);
  assert.match(prompt, /THINGS IT DOES NOT DO/);
  assert.match(prompt, /Person: get the text/);
  assert.match(prompt, /currently has the "images" tool open/);

  // ---- conversation hygiene and the model's answer is untrusted ----
  const msgs = cleanMessages([{ role: 'system', content: 'x' }, { role: 'user', content: '  hi \n there ' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `q${i}` }))]);
  assert.ok(msgs.length <= 10 && msgs.every((m) => m.role === 'user' || m.role === 'assistant'));
  let r = normalizeTutorReply(JSON.stringify({ verdict: 'doable', answer: 'Use it.', steps: [{ tool: 'article', do: 'Press Extract.' }, { tool: 'teleporter', do: 'x' }] }));
  assert.deepStrictEqual(r.steps.map((s) => s.tool), ['article'], 'unknown ids are dropped');
  assert.strictEqual(r.steps[0].label, 'Article content');
  r = normalizeTutorReply({ verdict: 'doable', answer: 'x', steps: [] });
  assert.strictEqual(r.verdict, 'question', 'doable with no steps is not an answer');
  r = normalizeTutorReply({ verdict: 'beyond', answer: 'No.', steps: [{ tool: 'images', do: 'x' }] });
  assert.strictEqual(r.steps.length, 0, 'a beyond answer shows no steps');
  assert.ok(VERDICTS.includes(normalizeTutorReply({ verdict: 'accountant', answer: 'x', steps: [] }).verdict));
  assert.ok(!/[{}]/.test(normalizeTutorReply('not json {oops').answer));

  // ---- ask() with a fake model ----
  let seen = null; let logged = null;
  const deps = {
    getModels: async () => ({ standard: 'test-model', light: 'light-model' }),
    callModel: async (model, p, opts) => { seen = { model, prompt: p, system: opts.system }; return { text: JSON.stringify({ verdict: 'doable', answer: 'ok', steps: [{ tool: 'download-images', do: 'Press Download all.' }] }), model, inputTokens: 1, outputTokens: 1 }; },
    logUsage: (u) => { logged = u; },
  };
  const out = await askWebExtractorTutor(7, { messages: [{ role: 'user', content: 'save all the pictures' }] }, deps);
  assert.strictEqual(out.steps[0].tool, 'download-images');
  assert.strictEqual(seen.model, 'test-model', 'uses the workspace model, never a hardcoded id');
  assert.deepStrictEqual({ u: logged.userId, f: logged.feature }, { u: 7, f: 'web_extractor_guide' });
  await assert.rejects(askWebExtractorTutor(1, { messages: [] }, deps), /Type what you want to do/);

  // ---- speech helpers for the microphone on the address and sections boxes ----
  assert.strictEqual(parseSpokenUrl('example dot com slash news'), 'example.com/news');
  assert.strictEqual(parseSpokenUrl('H T T P S colon slash slash www dot Example dot com'), 'https://www.example.com');
  assert.strictEqual(parseSpokenUrl('my dash site dot com dot'), 'my-site.com');
  assert.strictEqual(parseSpokenUrl('   '), null);
  assert.strictEqual(parseSpokenList('Author comma Date comma newsletter signup'), 'Author, Date, newsletter signup');
  assert.strictEqual(parseSpokenList(''), null);
  assert.strictEqual(parseSpokenSelector('dot product dash card'), '.product-card');
  assert.strictEqual(parseSpokenSelector('Hash story space P'), '#story p');
  assert.strictEqual(parseSpokenSelector('ul dot list space greater than space li'), 'ul.list > li');
  assert.strictEqual(parseSpokenSelector(' '), null);

  // ---- CSV and JSON for Links and Tables ----
  assert.strictEqual(toCsv([['a', 'b,c'], ['say "hi"', 'x\ny']]), '﻿a,"b,c"\r\n"say ""hi""","x\ny"');
  assert.strictEqual(toCsv([['=SUM(A1)', '+1', '@x', '-cmd', '-5', '-0.5', 'plain']]), "﻿'=SUM(A1),'+1,'@x,'-cmd,-5,-0.5,plain", 'formula starts are defused, plain negative numbers are not');
  assert.strictEqual(toCsv([[null, undefined, 0]]), '﻿,,0');
  const table = { headers: ['Item', 'Item', ''], rows: [['Pen', '2', 'x'], ['Book']], colCount: 3 };
  assert.deepStrictEqual(tableToObjects(table), [{ Item: 'Pen', 'Item (2)': '2', 'column 3': 'x' }, { Item: 'Book', 'Item (2)': '', 'column 3': '' }], 'repeated and missing headings get distinct keys; short rows are padded');
  assert.deepStrictEqual(tableToObjects({ headers: null, rows: [['a', 'b']], colCount: 2 }), [{ 'column 1': 'a', 'column 2': 'b' }]);
  assert.deepStrictEqual(tableToRows({ headers: ['H'], rows: [['r']] }), [['H'], ['r']]);
  assert.deepStrictEqual(tableToRows({ headers: null, rows: [['r']] }), [['r']]);

  // ---- the Colour palette helpers ----
  assert.deepStrictEqual(PALETTE_PAGES.map(([n]) => n), [1, 3, 6], 'the page choices are the ones the server accepts');
  assert.strictEqual(readableOn('#ffffff'), '#000000', 'black words on white');
  assert.strictEqual(readableOn('#000000'), '#ffffff', 'white words on black');
  assert.strictEqual(readableOn('#9b5b46'), '#ffffff', 'white words on a mid-dark brown');
  assert.strictEqual(readableOn('#f4efe6'), '#000000');
  assert.strictEqual(readableOn('nonsense'), '#000000', 'a bad value never throws');
  const pal = {
    suggested: { primary: '#9b5b46', accent: null, background: '#f4efe6', text: '#222222' },
    colors: [
      { hex: '#9b5b46', rgb: [155, 91, 70], hsl: [15, 38, 46], kind: 'brand', count: 7, share: 41.2, roles: { background: 2, text: 1, border: 1, other: 0 }, variables: ['--brand'] },
      { hex: '#f4efe6', rgb: [244, 239, 230], hsl: [40, 38, 93], kind: 'neutral', count: 3, share: 17.6, roles: { background: 3, text: 0, border: 0, other: 0 }, variables: [] },
    ],
  };
  assert.strictEqual(paletteToCss(pal), ':root {\n  --color-primary: #9b5b46;\n  --color-background: #f4efe6;\n  --color-text: #222222;\n\n  --brand-1: #9b5b46;\n  --neutral-1: #f4efe6;\n}');
  assert.strictEqual(paletteToCss({ colors: [] }), ':root {\n}', 'an empty palette is still valid CSS');
  const palRows = paletteToRows(pal);
  assert.strictEqual(palRows[0].length, palRows[1].length, 'every row has a cell for each heading');
  assert.deepStrictEqual(palRows[1].slice(0, 6), ['#9b5b46', '155, 91, 70', '15, 38%, 46%', 'Brand', 7, 41.2]);
  assert.strictEqual(palRows[2][3], 'Grey, white or black');
  assert.match(toCsv(palRows), /^\uFEFFHex,RGB,HSL/, 'opens in Excel with its heading row');
  const linkRows = linksToRows([{ text: 'About', href: 'https://e.com/a', type: 'internal', nofollow: false, occurrences: 2 }]);
  assert.deepStrictEqual(linkRows[1], ['About', 'https://e.com/a', 'This site', '', 2]);
  assert.strictEqual(linkRows[0].length, linkRows[1].length);

  console.log('webExtractorTutor tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
