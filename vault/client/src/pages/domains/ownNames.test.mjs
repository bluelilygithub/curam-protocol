// node client/src/pages/domains/ownNames.test.mjs   (names spotted in what someone wrote)
import assert from 'node:assert';
import { noticeOwnNames } from './ownNames.mjs';

// the description that started this: an artist and a book title in plain sentences
{
  const text = 'I need names for a domain to promote my book which is about a prominent female Tasmanian portrait artist named artist named Dorothy Stoner. The website is intended to promote the book called the suitcase and also to promote events which are scheduled to release the exhibitions';
  assert.deepStrictEqual(noticeOwnNames(text), ['Dorothy Stoner', 'The Suitcase']);
}
// quoted titles
assert.deepStrictEqual(noticeOwnNames('A site for my book "The Staircase Suitcase" and its launch'), ['The Staircase Suitcase']);
assert.deepStrictEqual(noticeOwnNames('The exhibition is “Stairs of Light” this spring'), ['Stairs Of Light']);
// called / titled / entitled, in any case, stopping at the end of the title
assert.deepStrictEqual(noticeOwnNames('my memoir entitled Letters From Hobart, which I wrote last year'), ['Letters From Hobart']);
assert.deepStrictEqual(noticeOwnNames('a podcast titled night shift stories about nurses'), ['Night Shift Stories']);
assert.deepStrictEqual(noticeOwnNames('the book called the suitcase and also events'), ['The Suitcase']);
// "named" needs a capitalised name: "named artist" is not a name
assert.deepStrictEqual(noticeOwnNames('an artist named painter who is local'), []);
assert.deepStrictEqual(noticeOwnNames('a painter named Dorothy Stoner who lived in Hobart'), ['Dorothy Stoner']);
// runs of capitalised words; one capitalised word alone is not a name
assert.deepStrictEqual(noticeOwnNames('Portraits by Margaret Preston and Tasmanian landscapes'), ['Margaret Preston']);
assert.deepStrictEqual(noticeOwnNames('A Tasmanian bakery'), []);
// a leading "The" or "My" at the start of a sentence is not part of the name
assert.deepStrictEqual(noticeOwnNames('My Dorothy Stoner exhibition'), ['Dorothy Stoner']);
// nothing to find, nothing suggested
assert.deepStrictEqual(noticeOwnNames('we sell bespoke wine fridges to hotels'), []);
assert.deepStrictEqual(noticeOwnNames(''), []);
assert.deepStrictEqual(noticeOwnNames(null), []);
// names already in the box are not suggested again, whatever the spacing or case
assert.deepStrictEqual(noticeOwnNames('the book called the suitcase by Dorothy Stoner', 'the suitcase'), ['Dorothy Stoner']);
assert.deepStrictEqual(noticeOwnNames('the book called the suitcase by Dorothy Stoner', 'Dorothy  stoner\nThe Suitcase'), []);
// no repeats, and at most four
assert.deepStrictEqual(noticeOwnNames('Dorothy Stoner named Dorothy Stoner and "Dorothy Stoner"'), ['Dorothy Stoner']);
assert.strictEqual(noticeOwnNames('"Alpha One" "Beta Two" "Gamma Three" "Delta Four" "Epsilon Five"').length, 4);

console.log('ownNames tests passed');
