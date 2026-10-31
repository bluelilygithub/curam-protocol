import assert from 'node:assert/strict';
import { buildPreviewDoc, toggleScreen, resolveScreens, cardLayout, MAX_SCREENS, DEFAULT_SELECTION } from './devicePreviewModel.mjs';
import { deviceById, customScreen } from '../../utils/deviceCatalog.mjs';

// document
const doc = buildPreviewDoc({ headInnerHTML: '<title>x</title>', bodyInnerHTML: '<p>hi</p>', cssFiles: [{ css: 'a{color:red}' }, { css: 'b{color:blue}' }] });
assert.ok(doc.startsWith('<!DOCTYPE html>'));
assert.ok(doc.includes('width=device-width'), 'the page sees a real device width');
assert.ok(doc.indexOf('a{color:red}') < doc.indexOf('b{color:blue}'), 'style files keep their order');
assert.ok(doc.includes('<p>hi</p>'));
assert.ok(!buildPreviewDoc({ cssFiles: [{ css: 'a{}</style><script>alert(1)</script>' }] }).includes('</style><script>'), 'a style file cannot close its own element');
assert.ok(buildPreviewDoc().includes('<body></body>'), 'an empty page still builds');

// choosing devices
let r = toggleScreen([], 'iphone-14');
assert.deepEqual(r, { selection: ['iphone-14'], refused: false });
r = toggleScreen(r.selection, 'iphone-14');
assert.deepEqual(r.selection, [], 'choosing it again removes it');
const full = ['a', 'b', 'c', 'd'];
assert.equal(MAX_SCREENS, 4);
assert.deepEqual(toggleScreen(full, 'e'), { selection: full, refused: true }, 'a fifth is refused');
assert.deepEqual(toggleScreen(full, 'a').selection, ['b', 'c', 'd'], 'but one can always be removed');

// resolving
const custom = customScreen(500, 900);
assert.deepEqual(resolveScreens(['iphone-14', 'custom', 'ghost'], [custom]).map((d) => d.id), ['iphone-14', 'custom'], 'unknown ids are dropped');
for (const id of DEFAULT_SELECTION) assert.ok(deviceById(id), `${id} exists`);

// layout
const phone = deviceById('iphone-14');
let l = cardLayout(phone, { zoom: '1' });
assert.deepEqual([l.width, l.height, l.scale, l.outerWidth, l.outerHeight], [390, 844, 1, 390, 844]);
l = cardLayout(phone, { zoom: 'fit', fitHeight: 422 });
assert.equal(l.scale, 0.5);
assert.deepEqual([l.outerWidth, l.outerHeight], [195, 422]);
l = cardLayout(phone, { zoom: '0.5' });
assert.deepEqual([l.outerWidth, l.outerHeight], [195, 422]);
l = cardLayout(phone, { zoom: '2' });
assert.equal(l.scale, 1, 'never enlarged');
l = cardLayout(phone, { zoom: '1', landscape: true });
assert.deepEqual([l.width, l.height], [844, 390], 'a phone on its side');
l = cardLayout(deviceById('laptop-1440'), { zoom: '1', landscape: true });
assert.deepEqual([l.width, l.height], [1440, 900], 'a laptop is never turned');
l = cardLayout(phone, { zoom: 'bad' });
assert.ok(l.scale > 0 && l.scale <= 1, 'a bad zoom falls back to fit');

console.log('devicePreviewModel: ok');
