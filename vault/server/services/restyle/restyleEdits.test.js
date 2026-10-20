'use strict';

// node server/services/restyle/restyleEdits.test.js   (npm run test:restyle-edits). Tests the CSS tool's edit model, selectors and
// accessibility checks (client/src/pages/restyle/*.mjs) in node, with jsdom for the parts that need a page.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');
const postcss = require('postcss');

const load = (f) => import(pathToFileURL(path.join(__dirname, '../../../client/src/pages/restyle', f)).href);

(async () => {
  const E = await load('editModel.mjs');
  const S = await load('selectors.mjs');
  const A = await load('a11y.mjs');

  // ---- changes: set, keep the first "was", clear, remove ----
  const card = { selector: '.card h2', label: 'h2 in .card', state: '', media: '' };
  let edits = E.setProps([], card, [{ prop: 'fontSize', value: '28px', was: '16px' }, { prop: 'color', value: '#111', was: 'rgb(0, 0, 0)' }]);
  assert.strictEqual(edits.length, 1);
  edits = E.setProps(edits, card, [{ prop: 'fontSize', value: '32px', was: '28px' }]);
  assert.strictEqual(edits[0].props.fontSize.value, '32px');
  assert.strictEqual(edits[0].props.fontSize.was, '16px', 'the original value is kept, not the last one');
  const before = JSON.stringify(edits);
  E.setProps(edits, card, [{ prop: 'color', value: '#222' }]);
  assert.strictEqual(JSON.stringify(edits), before, 'setProps does not change the list it was given');
  edits = E.setProps(edits, { ...card, state: 'hover' }, [{ prop: 'color', value: '#fff', was: '#111' }]);
  edits = E.setProps(edits, { ...card, media: '(max-width: 480px)' }, [{ prop: 'fontSize', value: '20px', was: '32px' }]);
  assert.strictEqual(edits.length, 3, 'state and screen size make separate rules');
  assert.strictEqual(E.countChanges(edits), 4);
  assert.strictEqual(E.removeProp(edits, { ...card, state: 'hover' }, 'color').length, 2, 'a rule left empty is removed');
  assert.strictEqual(E.clearSelector(edits, '.card h2').length, 0);
  assert.strictEqual(E.clearSelector(edits, '.other').length, 3);

  // ---- the stylesheet ----
  const css = E.generateCss(edits, [{ id: 't1', kind: 'color', name: 'Main colour', value: '#cc785c' }], { important: true, comments: false });
  const root = postcss.parse(css);   // it is valid CSS
  assert.match(css, /:root \{\s*--brand-main-colour: #cc785c;/);
  assert.match(css, /\.card h2 \{\s*font-size: 32px !important;\s*color: #111 !important;/);
  assert.match(css, /\.card h2:hover \{\s*color: #fff !important;/);
  const media = css.slice(css.indexOf('@media'));
  assert.match(media, /@media \(max-width: 480px\) \{[\s\S]*font-size: 20px !important/);
  assert.ok(css.indexOf('.card h2 {') < css.indexOf('@media'), 'rules for all screens come before the small-screen ones');
  assert.ok(root.nodes.length >= 3);
  assert.ok(!/!important/.test(E.generateCss(edits, [], { important: false })), 'no !important when switched off');
  assert.match(E.generateCss(edits, [], { comments: true }), /\/\* h2 in \.card \*\//);
  const preview = E.generateCss(edits, [], { preview: true, comments: false });
  assert.match(preview, /\.card h2:hover, \.card h2\[data-restyle-force-hover\] \{/, 'the preview can show a state without the mouse');
  assert.ok(!/data-restyle/.test(E.generateCss(edits, [], { preview: false })), 'the export never carries the preview helpers');
  assert.strictEqual(E.generateCss([], []), '');
  // a phone-only rule comes after a tablet rule, so it wins
  const both = E.generateCss([
    ...E.setProps([], { selector: 'p', label: 'p', state: '', media: '(max-width: 480px)' }, [{ prop: 'fontSize', value: '14px' }]),
    ...E.setProps([], { selector: 'p', label: 'p', state: '', media: '(max-width: 768px)' }, [{ prop: 'fontSize', value: '16px' }]),
  ], [], { comments: false });
  assert.ok(both.indexOf('(max-width: 768px)') < both.indexOf('(max-width: 480px)'));
  // lists of selectors get the state on every part
  assert.strictEqual(E.selectorWithState('h1, h2', 'hover'), 'h1:hover, h2:hover');
  assert.strictEqual(E.selectorWithState('h1, h2', ''), 'h1, h2');
  // animations bring their movement with them, only the ones used
  const anim = E.generateCss(E.setProps([], { selector: '.hero', label: '.hero', state: '', media: '' }, [{ prop: 'animation', value: 'restyleFadeIn 0.6s ease both' }]), [], { comments: false });
  assert.match(anim, /animation: restyleFadeIn 0\.6s ease both !important/);
  assert.match(anim, /@keyframes restyleFadeIn/);
  assert.ok(!/restyleBounce/.test(anim));
  assert.ok(!/@keyframes/.test(E.generateCss(E.setProps([], { selector: '.x', label: '.x', state: '', media: '' }, [{ prop: 'animation', value: 'none' }]), [], {})));
  // unknown properties never reach the output
  assert.ok(!/evil/.test(E.generateCss(E.setProps([], { selector: '.x', label: '.x', state: '', media: '' }, [{ prop: 'evil', value: 'x' }, { prop: 'color', value: 'red' }]), [])));

  // ---- the same stylesheet passes the server's sanitiser unchanged in substance (so a shared preview shows what the tool showed) ----
  const { sanitizeEditsCss } = require('./sanitizeCss');
  const kept = sanitizeEditsCss(E.generateCss(edits, [{ id: 't1', kind: 'color', name: 'Main colour', value: '#cc785c' }], { comments: true }));
  assert.match(kept, /--brand-main-colour/);
  assert.match(kept, /\.card h2:hover/);
  assert.match(kept, /@media \(max-width: 480px\)/);
  assert.match(sanitizeEditsCss(anim), /@keyframes restyleFadeIn/);

  // ---- change list, report ----
  const rows = E.changeRows(edits);
  assert.strictEqual(rows.length, 4);
  const hover = rows.find((r) => r.when.includes('mouse'));
  assert.strictEqual(hover.what, 'the text color');
  assert.strictEqual(hover.was, '#111');
  assert.ok(rows.find((r) => r.when.includes('phones')), 'the screen size is named');
  const report = E.changeReport(edits, [{ id: 't1', kind: 'color', name: 'Main colour', value: '#cc785c' }], { title: 'Home page', sourceUrl: 'https://example.com/', date: new Date('2026-10-20T00:00:00Z') });
  assert.match(report, /^# Changes to Home page/);
  assert.match(report, /2026-10-20/);
  assert.match(report, /h2 in \.card: the text size: 16px -> 32px/);
  assert.match(report, /Main colour \(color\): #cc785c {2}-> {2}var\(--brand-main-colour\)/);
  assert.match(report, /```css[\s\S]*```/);

  // ---- tokens ----
  assert.strictEqual(E.slug('  Main Colour! '), 'main-colour');
  assert.strictEqual(E.slug('***'), 'brand');
  assert.strictEqual(E.tokenRef({ name: 'Main colour' }), 'var(--brand-main-colour)');
  assert.strictEqual(E.uniqueTokenName([{ id: 1, name: 'Main colour' }], 'Main colour'), 'Main colour-2');
  assert.strictEqual(E.uniqueTokenName([{ id: 1, name: 'Main colour' }], 'Main colour', 1), 'Main colour', 'a token may keep its own name');
  assert.strictEqual(E.toHex('rgb(204, 120, 92)'), '#cc785c');
  assert.strictEqual(E.toHex('#ABC'), '#aabbcc');
  assert.strictEqual(E.toHex('#11223344'), '#112233');
  assert.strictEqual(E.toHex('red'), null);
  assert.ok(E.BRAND_TARGETS.every((t) => E.PROPERTIES.some((p) => p.key === t.prop)), 'every brand target changes a real property');
  assert.ok(E.ANIMATION_PRESETS.filter((a) => a.keyframes).every((a) => a.value.startsWith(a.name) && a.keyframes.includes(a.name)));

  // ---- selectors, on a real document ----
  const dom = new JSDOM(`<body>
    <div class="wrap"><div class="card"><h2 class="title">One</h2><p>a</p></div><div class="card"><h2 class="title">Two</h2><p>b</p></div></div>
    <ul class="menu"><li><a href="#">A</a></li><li><a href="#">B</a></li></ul>
    <section id="hero"><span>x</span><span>y</span></section>
    <p class="3d weird:name">odd</p></body>`);
  const doc = dom.window.document;
  const unique = (el) => { const sel = S.uniqueSelector(el); assert.strictEqual(doc.querySelectorAll(sel).length, 1, `${sel} matches one element`); assert.strictEqual(doc.querySelector(sel), el, `${sel} matches the right one`); return sel; };
  const titles = doc.querySelectorAll('.title');
  unique(titles[0]); unique(titles[1]);
  assert.notStrictEqual(S.uniqueSelector(titles[0]), S.uniqueSelector(titles[1]));
  unique(doc.querySelectorAll('.menu li a')[1]);
  assert.strictEqual(S.uniqueSelector(doc.querySelector('#hero')), '#hero', 'an id is enough');
  assert.match(unique(doc.querySelectorAll('#hero span')[1]), /^#hero/, 'a child of an id starts from the id');
  unique(doc.querySelector('p.weird\\:name'));
  assert.strictEqual(S.cssEscape('a b'), 'a\\ b');
  assert.strictEqual(S.labelFor(titles[0]), 'h2.title');
  const scopes = S.scopeOptionsFor(titles[0]);
  assert.deepStrictEqual(scopes.map((o) => o.selector), ['.title', '.card h2', '.wrap h2', 'h2'], 'its own class, the class of each parent, and every item of its kind');
  assert.deepStrictEqual(scopes.map((o) => o.count), [2, 2, 2, 2], 'each choice says how many items it reaches');
  assert.ok(scopes.every((o) => o.count === doc.querySelectorAll(o.selector).length));
  assert.strictEqual(scopes.find((o) => o.selector === 'h2').label, 'Every <h2> on the page');
  assert.strictEqual(S.scopeOptionsFor(doc.querySelector('.menu li a')).find((o) => o.selector === 'a').count, 2, 'a plain link with no class can still be widened to every link');
  const alone = S.scopeOptionsFor(doc.querySelector('section'));
  assert.ok(alone.every((o) => o.count <= 1), 'a one-off item has nothing to widen to (the picker hides choices that reach only one item)');
  // edits made with a unique selector reach only that element; a scope selector reaches them all
  const style = doc.createElement('style');
  style.textContent = E.generateCss(E.setProps([], { selector: S.uniqueSelector(titles[0]), label: 'x', state: '', media: '' }, [{ prop: 'color', value: '#123456' }]), [], { comments: false });
  doc.head.appendChild(style);
  assert.strictEqual(dom.window.getComputedStyle(titles[0]).color, 'rgb(18, 52, 86)');
  assert.notStrictEqual(dom.window.getComputedStyle(titles[1]).color, 'rgb(18, 52, 86)');

  // ---- accessibility maths ----
  assert.deepStrictEqual(A.parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepStrictEqual(A.parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepStrictEqual(A.parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepStrictEqual(A.parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.strictEqual(A.parseColor('nonsense'), null);
  assert.strictEqual(A.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), 21);
  assert.strictEqual(A.contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 }), 1);
  assert.ok(Math.abs(A.contrastRatio(A.parseColor('#767676'), { r: 255, g: 255, b: 255 }) - 4.54) < 0.02, '#767676 on white is the well-known 4.54');
  assert.strictEqual(A.isLargeText(24, 400), true);
  assert.strictEqual(A.isLargeText(19, 700), true);
  assert.strictEqual(A.isLargeText(19, 400), false);
  assert.deepStrictEqual(A.over({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 }), { r: 128, g: 128, b: 128, a: 1 });

  const page = new JSDOM(`<body style="background:#ffffff">
    <p id="ok" style="color:#000000;font-size:16px">Readable text here</p>
    <p id="low" style="color:#bbbbbb;font-size:16px">Pale grey on white is hard to read</p>
    <div style="background:#000000"><p id="onDark" style="color:#ffffff;font-size:16px">White on black</p></div>
    <h2 id="bigLow" style="color:#888888;font-size:30px">Large and a bit pale</h2>
    <p id="tiny" style="color:#000000;font-size:9px">Tiny print</p>
    <img id="noAlt" src="x.png"><img id="decor" alt="" src="y.png"><img id="withAlt" alt="A chair" src="z.png">
    <p id="hidden" style="display:none;color:#eeeeee">hidden</p></body>`);
  const win = page.window;
  const el = (id) => win.document.getElementById(id);
  assert.strictEqual(A.checkTextContrast(el('ok'), win).passes, true);
  const low = A.checkTextContrast(el('low'), win);
  assert.strictEqual(low.passes, false);
  assert.strictEqual(low.required, 4.5);
  assert.strictEqual(A.checkTextContrast(el('onDark'), win).bg, '#000000', 'the background is found on the parent');
  assert.strictEqual(A.checkTextContrast(el('onDark'), win).passes, true);
  const big = A.checkTextContrast(el('bigLow'), win);
  assert.strictEqual(big.large, true);
  assert.strictEqual(big.required, 3);
  assert.strictEqual(big.passes, true, '#888 on white is 3.54: fine for large text (3), too low for normal text (4.5)');
  const scan = A.scanDocument(win.document);
  const kinds = (k) => scan.issues.filter((i) => i.kind === k).map((i) => i.el.id);
  assert.deepStrictEqual(kinds('contrast'), ['low'], 'only the genuinely low-contrast text is reported');
  assert.deepStrictEqual(kinds('alt'), ['noAlt'], 'alt="" (a decorative picture) is fine, a missing alt is not');
  assert.deepStrictEqual(kinds('small'), ['tiny']);
  assert.ok(!scan.issues.some((i) => i.el.id === 'hidden'), 'hidden text is ignored');
  assert.ok(scan.checked >= 5);
  assert.ok(scan.issues.every((i) => typeof i.message === 'string' && i.message.length > 10));

  // ---- phone / tablet upright or on its side ----
  assert.deepStrictEqual(E.previewScreen('phone', 'portrait'), { width: 390, height: null, canTurn: true });
  assert.deepStrictEqual(E.previewScreen('phone', 'landscape'), { width: 844, height: 390, canTurn: true }, 'on its side the sizes swap');
  assert.deepStrictEqual(E.previewScreen('tablet', 'landscape'), { width: 1024, height: 768, canTurn: true });
  assert.deepStrictEqual(E.previewScreen('desktop', 'landscape'), { width: null, height: null, canTurn: false }, 'a desktop window has no sides');
  assert.strictEqual(E.previewScreen('nothing', 'portrait').canTurn, false);

  console.log('restyle edit-model tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
