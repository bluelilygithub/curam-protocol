// node client/src/pages/videos/joinLimits.test.mjs
import assert from 'node:assert';
import { detectJoinLimits, orderedJoinLimits, JOIN_LIMITS } from './joinLimits.mjs';

let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`); }

test('a description Join can do trips nothing', () => {
  assert.deepStrictEqual(detectJoinLimits('Play the outside shots first, then the inside, with a slow dissolve between them.'), []);
  assert.deepStrictEqual(detectJoinLimits(''), []);
  assert.deepStrictEqual(detectJoinLimits(null), []);
});

test('each limit is detected from natural wording', () => {
  assert.deepStrictEqual(detectJoinLimits('add some smooth chilled music'), ['music']);
  assert.deepStrictEqual(detectJoinLimits('trim the first 3 seconds off each clip'), ['trim']);
  assert.deepStrictEqual(detectJoinLimits('put a title on the first clip'), ['text']);
  assert.deepStrictEqual(detectJoinLimits('make the last clip slow-mo'), ['look']);
  assert.deepStrictEqual(detectJoinLimits('generate a missing shot of the inside'), ['newfootage']);
  assert.deepStrictEqual(detectJoinLimits('one is portrait and the rest are landscape'), ['shape']);
});

test('a mixed request flags several limits, triggered ones first', () => {
  const req = 'join the three clips with fades, add chilled music and a title at the start';
  const hit = detectJoinLimits(req);
  assert.ok(hit.includes('music') && hit.includes('text'));
  const ordered = orderedJoinLimits(req);
  assert.strictEqual(ordered.length, JOIN_LIMITS.length);
  const firstUntriggered = ordered.findIndex((l) => !l.triggered);
  assert.ok(ordered.slice(0, firstUntriggered).every((l) => l.triggered));
  assert.ok(ordered.slice(firstUntriggered).every((l) => !l.triggered));
});

test('every limit names a way around it', () => {
  for (const l of JOIN_LIMITS) {
    assert.ok(l.title && l.why && l.workaround && l.pattern instanceof RegExp, l.id);
  }
});

console.log(`\n${passed} passed`);
