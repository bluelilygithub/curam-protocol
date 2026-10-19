import assert from 'node:assert';
import { negatedWords, negationTip } from './promptTips.mjs';

assert.deepStrictEqual(negatedWords('no electronic souds'), ['electronic']);
assert.deepStrictEqual(negatedWords('slow cello, without any drums, no synth pads'), ['drums', 'synth']);
assert.deepStrictEqual(negatedWords('Avoid the electronic sounds. Don\'t add vocals'), ['electronic', 'add']);
assert.deepStrictEqual(negatedWords('no drums, no drums, no bass, no synth, no choir'), ['drums', 'bass', 'synth'], 'no repeats, at most three');
assert.deepStrictEqual(negatedWords('solo cello, warm and slow, cathedral reverb'), [], 'a plain description has none');
assert.deepStrictEqual(negatedWords('a piano nocturne, nothing fancy'), [], '"no" inside another word is not a negation');
assert.deepStrictEqual(negatedWords(''), []);
assert.deepStrictEqual(negatedWords(null), []);

const tip = negationTip('no electronic souds');
assert.ok(tip && tip.includes('“electronic”') && /Describe what you do want/.test(tip));
assert.strictEqual(negationTip('solo cello, warm and slow'), null);

console.log('ok - prompt tips: negations are spotted, plain descriptions are left alone');
