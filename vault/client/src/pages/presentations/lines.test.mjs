// node client/src/pages/presentations/lines.test.mjs
import assert from 'node:assert/strict';
import { parseLines, syncDraft } from './lines.mjs';

assert.deepEqual(parseLines(' One \n\nTwo words\r\n'), ['One', 'Two words']);
assert.deepEqual(parseLines(undefined), []);

// typing keeps spaces and new lines in the box while the deck gets the clean list
assert.equal(syncDraft('First point ', ['First point']), 'First point ', 'a trailing space survives');
assert.equal(syncDraft('First point\n', ['First point']), 'First point\n', 'a new line survives');
assert.equal(syncDraft('First point\n\nSecond', ['First point', 'Second']), 'First point\n\nSecond');

// a change from elsewhere replaces the box
assert.equal(syncDraft('Old text', ['New', 'List']), 'New\nList');
assert.equal(syncDraft('', []), '');

console.log('presentations lines: ok');
