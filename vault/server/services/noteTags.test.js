'use strict';

// node server/services/noteTags.test.js   (part of npm run test:notes)

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { normalizeTag, normalizeTags, MAX_TAG_LENGTH, MAX_TAGS_PER_NOTE } = require('./noteTags');

(async () => {
  assert.strictEqual(normalizeTag('  #Budget  '), 'budget');
  assert.strictEqual(normalizeTag('##Tax   Time'), 'tax time');
  assert.strictEqual(normalizeTag('a,b;c'), 'a b c');
  assert.strictEqual(normalizeTag('line\nbreak\ttab'), 'line break tab');
  assert.strictEqual(normalizeTag('x'.repeat(100)).length, MAX_TAG_LENGTH);
  assert.strictEqual(normalizeTag('###'), '');
  assert.strictEqual(normalizeTag(undefined), '');
  assert.strictEqual(normalizeTag(42), '42');

  assert.deepStrictEqual(normalizeTags(['A', 'a', ' #a ', 'B', '', null]), ['a', 'b']);
  assert.strictEqual(normalizeTags('not an array'), null, 'a route can answer 400');
  assert.strictEqual(normalizeTags(undefined), null);
  assert.deepStrictEqual(normalizeTags([]), []);
  assert.strictEqual(normalizeTags(Array.from({ length: 50 }, (_, i) => `t${i}`)).length, MAX_TAGS_PER_NOTE);

  // the browser's copy of the rule must give the same answer as the server's
  const client = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages/notes/noteTags.mjs')).href);
  assert.strictEqual(client.MAX_TAG_LENGTH, MAX_TAG_LENGTH);
  assert.strictEqual(client.MAX_TAGS_PER_NOTE, MAX_TAGS_PER_NOTE);
  for (const s of ['  #Budget  ', '##Tax   Time', 'a,b;c', 'line\nbreak', 'x'.repeat(100), '###', '', ' Ünï Côdé ', '#  spaced out ', 'a\u0007b']) {
    assert.strictEqual(client.normalizeTag(s), normalizeTag(s), `same rule for ${JSON.stringify(s)}`);
  }

  console.log('noteTags tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
