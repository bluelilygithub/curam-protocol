import assert from 'node:assert';
import { normalizeTag, addTag, removeTag, suggestTags, splitTags, MAX_TAG_LENGTH, MAX_TAGS_PER_NOTE } from './noteTags.mjs';

assert.strictEqual(normalizeTag('  #Budget  '), 'budget');
assert.strictEqual(normalizeTag('##Tax   Time'), 'tax time', 'inner spaces collapse');
assert.strictEqual(normalizeTag('a,b'), 'a b', 'a comma never ends up inside a tag');
assert.strictEqual(normalizeTag(''), '');
assert.strictEqual(normalizeTag('###'), '');
assert.strictEqual(normalizeTag(null), '');
assert.strictEqual(normalizeTag('x'.repeat(100)).length, MAX_TAG_LENGTH);
assert.strictEqual(normalizeTag('Ünï Côdé'), 'ünï côdé');

assert.deepStrictEqual(addTag(['a'], ' B '), ['a', 'b']);
assert.deepStrictEqual(addTag(['a'], '#A'), ['a'], 'same tag in another case is a repeat');
assert.deepStrictEqual(addTag(['a'], '  '), ['a']);
const full = Array.from({ length: MAX_TAGS_PER_NOTE }, (_, i) => `t${i}`);
assert.strictEqual(addTag(full, 'one more').length, MAX_TAGS_PER_NOTE, 'capped');
assert.deepStrictEqual(removeTag(['a', 'b'], 'a'), ['b']);
assert.deepStrictEqual(addTag(undefined, 'x'), ['x']);

assert.deepStrictEqual(splitTags('budget, Tax Time; ideas\nbudget'), ['budget', 'tax time', 'ideas', 'budget'], 'repeats are handled by addTag');
assert.deepStrictEqual(splitTags(' , ; '), []);

const all = [{ tag: 'budget', count: 3 }, { tag: 'tax time', count: 2 }, { tag: 'client budget', count: 1 }, 'ideas'];
assert.deepStrictEqual(suggestTags(all, ['ideas'], ''), ['budget', 'tax time', 'client budget'], 'tags already on the note are not offered');
assert.deepStrictEqual(suggestTags(all, [], 'bud'), ['budget', 'client budget'], 'starts-with first, then contains');
assert.deepStrictEqual(suggestTags(all, [], 'zzz'), []);
assert.strictEqual(suggestTags(Array.from({ length: 30 }, (_, i) => `t${i}`), [], '').length, 8);

console.log('ok - note tags: one rule for what a tag is, add/remove, suggestions while typing');
