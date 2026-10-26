// node client/src/utils/passwordGen.test.mjs   (part of npm run test:password-vault)

import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  AMBIGUOUS, DIGITS, LOWER, MAX_LENGTH, MIN_LENGTH, SYMBOLS, UPPER,
  estimateStrength, generatePassword, generatedBits, normaliseOptions, randomInt,
} from './passwordGen.mjs';

// ---- randomInt: in range, and uniform even when the range does not divide 2^32 (the modulo-bias case)
assert.throws(() => randomInt(0), RangeError);
assert.throws(() => randomInt(1.5), RangeError);
assert.strictEqual(randomInt(1), 0);
const counts = new Array(7).fill(0);
for (let i = 0; i < 70000; i++) counts[randomInt(7)]++;
for (const c of counts) assert.ok(c > 9400 && c < 10600, `uniform over 7 values (got ${counts})`);

// bias rejection really happens: a generator that returns the top of the range once must be asked again
let calls = 0;
const stub = (a) => { calls++; a[0] = calls === 1 ? 0xffffffff : 5; return a; };
assert.strictEqual(randomInt(10, stub), 5);
assert.strictEqual(calls, 2, 'a biased value was thrown away');

// ---- generation: right length, only wanted characters, at least one of each kind, no look-alikes
for (let n = 0; n < 300; n++) {
  const pw = generatePassword({ length: 12 });
  assert.strictEqual(pw.length, 12);
  assert.ok(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw), `one of each kind: ${pw}`);
  assert.ok(![...pw].some((c) => AMBIGUOUS.includes(c)), `no look-alikes: ${pw}`);
}
assert.ok(/^[a-z]+$/.test(generatePassword({ length: 30, upper: false, digits: false, symbols: false })));
assert.ok(/^[0-9]+$/.test(generatePassword({ length: 30, lower: false, upper: false, symbols: false })));
assert.ok([...generatePassword({ length: 200, avoidAmbiguous: false, symbols: false })].some((c) => AMBIGUOUS.includes(c)), 'look-alikes are allowed when asked for');
assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false }), /at least one/);

// length is held in range
assert.strictEqual(generatePassword({ length: 1 }).length, MIN_LENGTH);
assert.strictEqual(generatePassword({ length: 5000 }).length, MAX_LENGTH);
assert.strictEqual(normaliseOptions({ length: 'abc' }).length, 20);

// every kind appears in the right share over many passwords (not stuck on the front)
const first = { digit: 0, symbol: 0 };
for (let i = 0; i < 2000; i++) { const c = generatePassword({ length: 16 })[0]; if (DIGITS.includes(c)) first.digit++; if (SYMBOLS.includes(c)) first.symbol++; }
assert.ok(first.digit > 100 && first.symbol > 100, 'the guaranteed characters are shuffled into place');

// no two in a big batch are the same
assert.strictEqual(new Set(Array.from({ length: 2000 }, () => generatePassword({ length: 16 }))).size, 2000);

// works with a plain (non-crypto-secure) source too, and uses whatever source it is given
const seqSource = (a) => { crypto.randomFillSync(a); return a; };
assert.strictEqual(generatePassword({ length: 14 }, seqSource).length, 14);

// ---- bits
// default pool: 24 lower + 24 upper + 8 digits + 23 symbols (look-alikes removed) = 79 characters
assert.strictEqual(generatedBits({ length: 20 }), Math.round(20 * Math.log2(79)));
assert.ok(generatedBits({ length: 20 }) > 110);
assert.ok(generatedBits({ length: 10, upper: false, symbols: false, digits: false }) < generatedBits({ length: 10 }));
assert.strictEqual(generatedBits({ lower: false, upper: false, digits: false, symbols: false }), 0);

// ---- strength guess
const s = (p) => estimateStrength(p);
assert.strictEqual(s('').label, 'Empty');
assert.ok(s('password').level === 0, 'a common word is very weak');
assert.ok(s('Password123!').level <= 1, 'a common word with decoration is still weak');
assert.ok(s('test-master-phrase-alpha-92').level >= 2, 'a phrase that merely contains a common word is not rejected');
assert.ok(s('letmein').level === 0 && s('qwerty123').level <= 1);
assert.ok(s('aaaaaaaaaaaaaaaa').level === 0, 'repeats add nothing');
assert.ok(s('abcdefghijkl').level <= 1, 'a straight run adds almost nothing');
assert.ok(s('123456789012').level <= 1);
assert.ok(s('correct horse battery staple').level >= 3, 'a long passphrase is strong');
assert.ok(s(generatePassword({ length: 24 })).level === 4, 'a generated 24 character password is very strong');
assert.ok(s('k7#Pq2').level <= 1, 'short is weak whatever it contains');
assert.ok(s('Tr0ub4dor&3').bits > s('Tr0ub4d').bits, 'longer scores higher');

console.log('passwordGen tests passed');
