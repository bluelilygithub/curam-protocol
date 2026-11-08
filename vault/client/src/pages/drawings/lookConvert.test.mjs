// node client/src/pages/drawings/lookConvert.test.mjs
import assert from 'node:assert';
import { toClean, toSketch, lookDefaults, toHex, inkFromTheme, normaliseLook, DEFAULT_STROKE, CLEAN_FONT, SKETCH_FONT } from './lookConvert.mjs';
import { sceneSignature } from './sceneLogic.mjs';

const base = (o) => ({ version: 3, versionNonce: 11, isDeleted: false, roughness: 1, roundness: null, fillStyle: 'solid', strokeColor: DEFAULT_STROKE, ...o });
const rect = base({ id: 'r', type: 'rectangle', roundness: { type: 3 }, fillStyle: 'hachure', backgroundColor: '#ffc9c9' });
const diamond = base({ id: 'd', type: 'diamond', roundness: { type: 2 } });
const ellipse = base({ id: 'e', type: 'ellipse' });
const arrow = base({ id: 'a', type: 'arrow', roundness: { type: 2 }, roughness: 2 });
const line = base({ id: 'l', type: 'line' });
const text = base({ id: 't', type: 'text', fontFamily: SKETCH_FONT, roughness: 1 });
const pen = base({ id: 'p', type: 'freedraw' });
const image = base({ id: 'i', type: 'image' });
const gone = base({ id: 'x', type: 'rectangle', isDeleted: true });
const custom = base({ id: 'c', type: 'rectangle', strokeColor: '#e03131', customData: { mine: 1 } });
const all = [rect, diamond, ellipse, arrow, line, text, pen, image, gone, custom];

// ---- clean ----
const c = toClean(all, { ink: '#3b2a20' });
const by = (id) => c.elements.find((e) => e.id === id);
assert.strictEqual(by('r').roughness, 0);
assert.strictEqual(by('r').roundness, null, 'square corners');
assert.strictEqual(by('r').fillStyle, 'solid', 'hatching becomes a solid fill');
assert.strictEqual(by('r').backgroundColor, '#ffc9c9', "the person's fill colour is kept");
assert.strictEqual(by('r').strokeColor, '#3b2a20', "Excalidraw's black becomes Vault's text colour");
assert.strictEqual(by('d').roundness, null);
assert.strictEqual(by('a').roughness, 0, 'a cartoonist-level arrow is made steady');
assert.strictEqual(by('a').roundness, null, 'a curved arrow becomes a straight one');
assert.strictEqual(by('l').roughness, 0);
assert.strictEqual(by('t').fontFamily, CLEAN_FONT, 'text gets the plain font');
assert.strictEqual(by('t').strokeColor, '#3b2a20');
assert.strictEqual(by('c').strokeColor, '#e03131', 'a colour the person chose is never replaced');
assert.deepStrictEqual(by('c').customData.mine, 1, 'other custom data survives');
for (const id of ['p', 'i', 'x']) assert.strictEqual(by(id), all.find((e) => e.id === id), `${id} is untouched (same object)`);
assert.ok(c.changed >= 6 && c.changed <= 8, `changed count is sensible (${c.changed})`);
for (const id of ['r', 'd', 'a', 't']) {
  assert.ok(by(id).version > all.find((e) => e.id === id).version, `${id} has a new version, so a save sees the change`);
  assert.notStrictEqual(by(id).versionNonce, all.find((e) => e.id === id).versionNonce);
}
assert.notStrictEqual(sceneSignature(all, {}), sceneSignature(c.elements, {}), 'the drawing fingerprint moves');
assert.ok(all.every((e) => e.roughness !== undefined && e === all.find((x) => x.id === e.id)), 'the input list is not changed');
assert.strictEqual(all[0].roundness.type, 3, 'the input pieces are not changed');

// no ink given: the line colour is left alone
assert.strictEqual(toClean([rect]).elements[0].strokeColor, DEFAULT_STROKE);

// clean twice: the FIRST look is what is remembered, and a second pass changes nothing more
const again = toClean(c.elements, { ink: '#3b2a20' });
assert.strictEqual(again.changed, 0, 'already clean');
assert.strictEqual(again.elements.find((e) => e.id === 'r'), by('r'));

// ---- back to sketch: exactly what was drawn ----
const s = toSketch(c.elements);
const sb = (id) => s.elements.find((e) => e.id === id);
for (const orig of [rect, diamond, arrow, text, custom]) {
  for (const k of ['roughness', 'roundness', 'fillStyle', 'strokeColor', 'fontFamily']) {
    assert.deepStrictEqual(sb(orig.id)[k], orig[k], `${orig.id}.${k} is back exactly`);
  }
}
assert.strictEqual(sb('r').customData, undefined, 'the remembered look is removed once restored');
assert.deepStrictEqual(sb('c').customData, { mine: 1 }, 'but other custom data stays');
assert.strictEqual(sb('a').roughness, 2, 'the arrow is as rough as it was');
assert.strictEqual(sb('p'), pen);

// round trip several times: stable
let cur = all;
for (let i = 0; i < 3; i += 1) cur = toSketch(toClean(cur, { ink: '#3b2a20' }).elements).elements;
for (const orig of [rect, diamond, arrow, text]) {
  for (const k of ['roughness', 'roundness', 'fillStyle', 'strokeColor', 'fontFamily']) assert.deepStrictEqual(cur.find((e) => e.id === orig.id)[k], orig[k], `after 3 round trips ${orig.id}.${k}`);
}

// pieces drawn while clean get ordinary sketch settings on the way back
const newWhileClean = [base({ id: 'n1', type: 'rectangle', roughness: 0, roundness: null }), base({ id: 'n2', type: 'text', fontFamily: CLEAN_FONT, roughness: 0 }), base({ id: 'n3', type: 'diamond', roughness: 0 }), base({ id: 'n4', type: 'arrow', roughness: 0 })];
const back = toSketch(newWhileClean).elements;
assert.deepStrictEqual([back[0].roughness, back[0].roundness], [1, { type: 3 }]);
assert.strictEqual(back[1].fontFamily, SKETCH_FONT);
assert.deepStrictEqual(back[2].roundness, { type: 2 });
assert.strictEqual(back[3].roughness, 1);
const untouched = toSketch([rect]);
assert.strictEqual(untouched.elements[0], rect, 'a piece already in the sketch look is returned as it is');
assert.strictEqual(untouched.changed, 0);

// empty and odd input
assert.deepStrictEqual(toClean([]).elements, []);
assert.deepStrictEqual(toClean(undefined).elements, []);
assert.deepStrictEqual(toSketch(null).elements, []);
assert.strictEqual(toClean([null, undefined]).elements.length, 2);

// ---- defaults for new pieces ----
const dc = lookDefaults('clean', { ink: '#3b2a20' });
assert.deepStrictEqual([dc.currentItemRoughness, dc.currentItemRoundness, dc.currentItemFontFamily, dc.currentItemStrokeColor, dc.currentItemArrowType], [0, 'sharp', CLEAN_FONT, '#3b2a20', 'sharp']);
assert.strictEqual(lookDefaults('clean').currentItemStrokeColor, DEFAULT_STROKE);
const ds = lookDefaults('sketch');
assert.deepStrictEqual([ds.currentItemRoughness, ds.currentItemRoundness, ds.currentItemFontFamily, ds.currentItemStrokeColor], [1, 'round', SKETCH_FONT, DEFAULT_STROKE]);

// ---- colours from the Vault theme ----
assert.strictEqual(toHex('#ABC'), '#aabbcc');
assert.strictEqual(toHex('rgb(59, 42, 32)'), '#3b2a20');
assert.strictEqual(toHex('nope'), null);
assert.strictEqual(inkFromTheme('#3b2a20', false), '#3b2a20', 'a light theme gives its text colour');
assert.strictEqual(inkFromTheme('#f5f0e8', true), null, 'a dark theme gives none (the canvas inverts colours)');
assert.strictEqual(inkFromTheme('#1e1e1e', false), null, 'no point replacing black with the same black');
assert.strictEqual(inkFromTheme('', false), null);
assert.strictEqual(normaliseLook('clean'), 'clean');
assert.strictEqual(normaliseLook('x'), 'sketch');
assert.strictEqual(normaliseLook(undefined), 'sketch');

console.log('lookConvert tests: all ok');
