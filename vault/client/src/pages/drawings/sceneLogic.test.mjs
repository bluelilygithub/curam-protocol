// node client/src/pages/drawings/sceneLogic.test.mjs
import assert from 'node:assert';
import { sceneSignature, fileNameFor, titleFromFileName, isDarkColour, readSceneFile, saveLabel, pieceCount, filterDrawings } from './sceneLogic.mjs';

const el = (id, version = 1, nonce = 10) => ({ id, version, versionNonce: nonce });

// the signature moves when something is drawn, edited or deleted, and not otherwise
const a = sceneSignature([el('a'), el('b')], {});
assert.strictEqual(a, sceneSignature([el('a'), el('b')], {}), 'same drawing, same signature');
assert.notStrictEqual(a, sceneSignature([el('a'), el('b'), el('c')], {}), 'a piece added');
assert.notStrictEqual(a, sceneSignature([el('a', 2, 11), el('b')], {}), 'a piece edited');
assert.notStrictEqual(a, sceneSignature([el('a'), el('b', 1, 99)], {}), 'a piece changed with the same version');
assert.notStrictEqual(a, sceneSignature([el('b'), el('a')], {}), 'order matters (layers)');
assert.notStrictEqual(a, sceneSignature([el('a'), el('b')], { f1: {} }), 'a picture added');
assert.ok(sceneSignature([], {}).startsWith('0.'));
assert.doesNotThrow(() => sceneSignature(undefined, undefined));

assert.strictEqual(fileNameFor('Floor plan: v2/final', 'png'), 'Floor plan v2final.png');
assert.strictEqual(fileNameFor('', 'svg'), 'drawing.svg');
assert.strictEqual(fileNameFor('   ', 'excalidraw'), 'drawing.excalidraw');
assert.ok(fileNameFor('x'.repeat(300), 'png').length <= 84);
assert.strictEqual(titleFromFileName('Floor_plan.excalidraw'), 'Floor plan');
assert.strictEqual(titleFromFileName('.excalidraw'), 'Imported drawing');

assert.strictEqual(isDarkColour('#ffffff'), false);
assert.strictEqual(isDarkColour('#1a1a1a'), true);
assert.strictEqual(isDarkColour('#000'), true);
assert.strictEqual(isDarkColour('rgb(250, 247, 242)'), false);
assert.strictEqual(isDarkColour('rgba(20, 20, 30, 0.9)'), true);
assert.strictEqual(isDarkColour('not a colour'), false);
assert.strictEqual(isDarkColour(''), false);

assert.deepStrictEqual(readSceneFile(JSON.stringify({ type: 'excalidraw', elements: [] })).ok, true);
assert.match(readSceneFile('{nope').error, /not readable/);
assert.match(readSceneFile(JSON.stringify({ type: 'excalidrawlib', library: [] })).error, /shape library/);
assert.match(readSceneFile(JSON.stringify({ type: 'excalidraw' })).error, /not an Excalidraw drawing/);
assert.match(readSceneFile('null').error, /not an Excalidraw drawing/);

assert.strictEqual(saveLabel('saving'), 'Saving…');
assert.strictEqual(saveLabel('saved', new Date('2026-11-08T10:05:00')).startsWith('Saved at'), true);
assert.strictEqual(saveLabel('saved'), 'Saved');
assert.match(saveLabel('changed'), /another tab/);
assert.strictEqual(saveLabel('error', null, 'Too big'), 'Too big');
assert.match(saveLabel('error'), /still here/);
assert.strictEqual(saveLabel('idle'), '');

assert.deepStrictEqual([0, 1, 5, undefined].map(pieceCount), ['Empty', '1 piece', '5 pieces', 'Empty']);
const list = [{ title: 'Garden plan' }, { title: 'Kitchen floor plan' }, { title: 'Logo ideas' }];
assert.strictEqual(filterDrawings(list, '').length, 3);
assert.deepStrictEqual(filterDrawings(list, 'plan').map((d) => d.title), ['Garden plan', 'Kitchen floor plan']);
assert.deepStrictEqual(filterDrawings(list, 'floor PLAN').map((d) => d.title), ['Kitchen floor plan'], 'every word must match, in any case');
assert.strictEqual(filterDrawings(list, 'zzz').length, 0);

console.log('sceneLogic tests: all ok');
