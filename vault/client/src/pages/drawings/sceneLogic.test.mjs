// node client/src/pages/drawings/sceneLogic.test.mjs
import assert from 'node:assert';
import { sceneSignature, fileNameFor, titleFromFileName, isDarkColour, readSceneFile, saveLabel, pieceCount, filterDrawings, arrangeDrawings } from './sceneLogic.mjs';

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

// the repository: filter by client / project, then sort
{
  const L = [
    { id: 1, title: 'beta', clientId: 5, clientProjectId: 9, updatedAt: '2026-11-02T00:00:00Z' },
    { id: 2, title: 'Alpha', clientId: 5, clientProjectId: null, updatedAt: '2026-11-03T00:00:00Z' },
    { id: 3, title: 'gamma 10', clientId: null, updatedAt: '2026-11-01T00:00:00Z' },
    { id: 4, title: 'gamma 9', clientId: 6, updatedAt: 'not a date' },
  ];
  const ids = (o) => arrangeDrawings(L, o).map((d) => d.id);
  assert.deepStrictEqual(ids({}), [2, 1, 3, 4], 'newest change first; a bad date sorts last');
  assert.deepStrictEqual(ids({ sort: 'oldest' }), [4, 3, 1, 2]);
  assert.deepStrictEqual(ids({ sort: 'name' }), [2, 1, 4, 3], 'A to Z, ignoring case, numbers in number order');
  assert.deepStrictEqual(ids({ clientId: '5' }), [2, 1], 'a client id from a select (text) matches');
  assert.deepStrictEqual(ids({ clientId: 'none' }), [3], 'filed nowhere');
  assert.deepStrictEqual(ids({ clientProjectId: 9 }), [1]);
  assert.strictEqual(arrangeDrawings(L, {}).length, 4);
  assert.strictEqual(L[0].id, 1, 'the list given is not reordered');
}

console.log('sceneLogic tests: all ok');
