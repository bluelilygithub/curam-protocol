// node client/src/pages/domains/spoken.test.mjs   (what a speech engine hears, made into a domain, name or handle)
import assert from 'node:assert';
import { spokenName, spokenHandle, spokenBrand } from './spoken.mjs';

assert.strictEqual(spokenName('acme wine dot com dot au'), 'acmewine.com.au');
assert.strictEqual(spokenName('Acme Wine dot com'), 'acmewine.com');
assert.strictEqual(spokenName('my brand dash name dot io.'), 'mybrand-name.io');
assert.strictEqual(spokenName('blue lily.'), 'bluelily', 'a sentence full stop is dropped');
assert.strictEqual(spokenName('example.com'), 'example.com', 'already a domain');
assert.strictEqual(spokenName('  Example Dot Com  '), 'example.com', 'case and spacing do not matter');
assert.strictEqual(spokenName('what is this? 123'), 'whatisthis123', 'stray punctuation is dropped');
assert.strictEqual(spokenName(''), '');
assert.strictEqual(spokenName(null), '');
// the word "dot" inside a word is left alone
assert.strictEqual(spokenName('dotty wines'), 'dottywines');
assert.strictEqual(spokenName('polka dot dresses'), 'polka.dresses', 'a spoken dot is a dot: the person can correct it');
assert.strictEqual(spokenHandle('my brand underscore name'), 'mybrand_name');
assert.strictEqual(spokenHandle('my brand dot name'), 'mybrandname', 'handles drop dots');
assert.strictEqual(spokenBrand('Blue Lily'), 'bluelily');

console.log('spoken tests passed');
