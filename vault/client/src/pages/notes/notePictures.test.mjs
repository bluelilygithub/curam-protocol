// node client/src/pages/notes/notePictures.test.mjs
import assert from 'node:assert';
import { pictureToken, pictureify, pictureIds, drawingNoteBody, PICTURE_SRC } from './notePictures.mjs';
import { chipify } from './noteTodos.mjs';

assert.strictEqual(pictureToken(41), '{picture:41}');
assert.strictEqual(pictureToken('7'), '{picture:7}');

// a marker line becomes an image; every other line, and the number of lines, stay as they were
const body = 'Plan\n\n{picture:41}\n\n- [ ] Call Sam {task:5}\nend';
const shown = pictureify(body);
assert.strictEqual(shown.split('\n').length, body.split('\n').length, 'line numbers do not move (a to-do box is found by its line)');
assert.strictEqual(shown.split('\n')[2], '![Picture](vault-picture:41)');
assert.strictEqual(shown.split('\n')[4], '- [ ] Call Sam {task:5}', 'other lines are untouched');
assert.ok(PICTURE_SRC.test('vault-picture:41'));
assert.ok(!PICTURE_SRC.test('vault-picture:x') && !PICTURE_SRC.test('https://x/vault-picture:1'));

// only a marker alone on its line counts
assert.strictEqual(pictureify('see {picture:41} here'), 'see {picture:41} here');
assert.strictEqual(pictureify('  {picture:41}  '), '![Picture](vault-picture:41)', 'spaces around it are fine');
assert.strictEqual(pictureify('{picture:}'), '{picture:}');
assert.strictEqual(pictureify('{picture:4a}'), '{picture:4a}');
assert.strictEqual(pictureify('{picture:41}\r\nnext'), '![Picture](vault-picture:41)\r\nnext', 'Windows line ends are kept');

// a marker inside a code block is shown as typed
const fenced = 'text\n```\n{picture:9}\n```\n{picture:10}';
assert.strictEqual(pictureify(fenced).split('\n')[2], '{picture:9}');
assert.strictEqual(pictureify(fenced).split('\n')[4], '![Picture](vault-picture:10)');
assert.deepStrictEqual(pictureIds(fenced), [10]);
assert.deepStrictEqual(pictureIds('{picture:1}\ntext\n{picture:2}\n{picture:1}'), [1, 2, 1]);
assert.deepStrictEqual(pictureIds(''), []);
assert.deepStrictEqual(pictureIds(null), []);

// it works together with the to-do markers (Preview runs both)
const both = chipify(pictureify('{picture:3}\n- [ ] Do it {task:8}'));
assert.ok(both.includes('![Picture](vault-picture:3)') && both.includes('[task](vault-task:8)'));

// the note made from a drawing
const made = drawingNoteBody({ attachmentId: 41, title: 'Kitchen [v2]\nplan', drawingPath: '/drawings/12' });
assert.strictEqual(made.split('\n')[0], '{picture:41}');
assert.ok(made.includes('[Kitchen v2 plan](/drawings/12)'), 'brackets and line breaks in a title cannot break the link');
assert.deepStrictEqual(pictureIds(made), [41]);
assert.ok(drawingNoteBody({ attachmentId: 1, title: '', drawingPath: '/drawings/1' }).includes('[Diagram](/drawings/1)'));

console.log('notePictures tests: all ok');
