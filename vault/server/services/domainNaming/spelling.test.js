'use strict';
// node server/services/domainNaming/spelling.test.js
const assert = require('assert');
const { syllables, spellingRisk } = require('./spelling');

// syllables
assert.strictEqual(syllables('bloom'), 1);
assert.strictEqual(syllables('banana'), 3);
assert.strictEqual(syllables('lumina'), 3);
assert.strictEqual(syllables('make'), 1, 'a silent final e does not count');
assert.strictEqual(syllables('table'), 2, 'but -le does');
assert.strictEqual(syllables('tree'), 1);
assert.strictEqual(syllables('a'), 1);
assert.strictEqual(syllables(''), 0);
assert.strictEqual(syllables('123'), 0);

// easy names score low and have no notes
for (const n of ['bloom', 'harbour', 'tasman', 'lumen']) {
  const r = spellingRisk(n);
  assert.ok(r.score <= 20, `${n} is easy (${r.score}: ${r.notes.join('; ')})`);
}
// names people get wrong score high, with the reason
{
  const r = spellingRisk('phoenix');
  assert.ok(r.score >= 20 && r.notes.some((n) => /ph sounds like f/.test(n)), `phoenix: ${JSON.stringify(r)}`);
  assert.ok(spellingRisk('knight').notes.some((n) => /silent letter/.test(n)));
  assert.ok(spellingRisk('kafe').notes.some((n) => /k or a c/.test(n)));
  assert.ok(spellingRisk('lumio').notes.some((n) => /-io or -eo/.test(n)), 'the brief example: Lumio / Lumeo');
  assert.ok(spellingRisk('strengths').notes.some((n) => /consonants/.test(n)));
  assert.ok(spellingRisk('bright').notes.some((n) => /gh/.test(n)));
}
// numbers and hyphens are called out
assert.ok(spellingRisk('shop4u').notes.some((n) => /number/.test(n)));
assert.ok(spellingRisk('blue-lily').notes.some((n) => /hyphen/.test(n)));
// a harder name scores higher than an easier one
assert.ok(spellingRisk('phoenix').score > spellingRisk('harbour').score);
// at most three notes, strongest first, score capped
{
  const r = spellingRisk('xphkneeghzzzaiouuuu-9');
  assert.ok(r.notes.length <= 3);
  assert.ok(r.score <= 100);
}
assert.deepStrictEqual(spellingRisk('').notes, []);
assert.strictEqual(spellingRisk(null).score, 0);

console.log('spelling tests passed');
