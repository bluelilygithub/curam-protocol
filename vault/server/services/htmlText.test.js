'use strict';
// node server/services/htmlText.test.js   (part of npm run test:youtube)
const assert = require('node:assert/strict');
const { decodeHtml, decodeFields } = require('./htmlText');

assert.equal(decodeHtml('&quot;You&rsquo;re actually not seeing how bad [Dublin city] can get.&quot; | Cleaning Up Ireland'), '"You’re actually not seeing how bad [Dublin city] can get." | Cleaning Up Ireland');
assert.equal(decodeHtml('It&#39;s &amp; that&#x27;s &lt;fine&gt;'), "It's & that's <fine>");
assert.equal(decodeHtml('&amp;quot;'), '&quot;', 'decoded once only');
assert.equal(decodeHtml('Tom &unknownthing; Jerry'), 'Tom &unknownthing; Jerry');
assert.equal(decodeHtml('&#0; &#99999999;'), '&#0; &#99999999;', 'impossible characters are left alone');
assert.equal(decodeHtml(null), '');
assert.equal(decodeHtml('plain'), 'plain');
assert.deepEqual(decodeFields([{ title: 'A &amp; B', channel: 'C&#39;s', n: 1 }], ['title', 'channel']), [{ title: 'A & B', channel: "C's", n: 1 }]);
assert.deepEqual(decodeFields(null, ['title']), []);

console.log('htmlText: ok');
