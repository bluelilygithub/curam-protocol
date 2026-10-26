// Password generator and a rough strength guess, for the Password Vault. Everything runs in the browser and nothing is sent anywhere.
// Randomness is the browser's secure generator (crypto.getRandomValues), never Math.random. Test: node client/src/utils/passwordGen.test.mjs

export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITS = '0123456789';
export const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
export const AMBIGUOUS = 'Il1O0o'; // look alike in many fonts

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;
export const DEFAULT_OPTIONS = { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true };

const defaultRandomValues = (arr) => globalThis.crypto.getRandomValues(arr);

// A uniform whole number from 0 to max-1. Values that would make some numbers likelier than others (modulo bias) are thrown away.
export function randomInt(max, getRandomValues = defaultRandomValues) {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) throw new RangeError('max must be a whole number from 1 to 2^32');
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function setsFor(o) {
  const strip = (s) => (o.avoidAmbiguous ? [...s].filter((c) => !AMBIGUOUS.includes(c)).join('') : s);
  const sets = [];
  if (o.lower) sets.push(strip(LOWER));
  if (o.upper) sets.push(strip(UPPER));
  if (o.digits) sets.push(strip(DIGITS));
  if (o.symbols) sets.push(strip(SYMBOLS));
  return sets;
}

/** Clean up whatever the controls hold: length kept in range, a missing option falls back to the default. */
export function normaliseOptions(options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  o.length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(Number(o.length) || DEFAULT_OPTIONS.length)));
  return o;
}

/** A random password. Always contains at least one character of each kind that is switched on. */
export function generatePassword(options = {}, getRandomValues = defaultRandomValues) {
  const o = normaliseOptions(options);
  const sets = setsFor(o);
  if (!sets.length) throw new Error('Choose at least one kind of character.');
  const pool = sets.join('');
  const out = sets.map((s) => s[randomInt(s.length, getRandomValues)]); // one of each kind first
  while (out.length < o.length) out.push(pool[randomInt(pool.length, getRandomValues)]);
  for (let i = out.length - 1; i > 0; i--) { // Fisher-Yates, so the guaranteed ones are not always at the front
    const j = randomInt(i + 1, getRandomValues);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** Bits of randomness in a password made with these options (length x log2 of the characters it draws from). */
export function generatedBits(options = {}) {
  const o = normaliseOptions(options);
  const pool = setsFor(o).join('').length;
  return pool ? Math.round(o.length * Math.log2(pool)) : 0;
}

const COMMON = ['password', 'passw0rd', 'letmein', 'welcome', 'qwerty', 'qwertyuiop', 'asdfgh', 'abc123', 'iloveyou', 'admin', 'login', 'monkey', 'dragon', 'football', 'baseball', 'master', 'sunshine', 'princess', 'trustno1', '123456', '12345678', '111111', 'changeme', 'default', 'secret'];

const LEVELS = [
  { max: 28, label: 'Very weak', level: 0 },
  { max: 40, label: 'Weak', level: 1 },
  { max: 60, label: 'Fair', level: 2 },
  { max: 80, label: 'Strong', level: 3 },
  { max: Infinity, label: 'Very strong', level: 4 },
];

/**
 * A rough guess at how hard a typed password would be to crack: its length and the kinds of character it uses, reduced for repeats,
 * runs like abc or 123, and common words. It is a guide, not a promise: it cannot know a password that is a pet's name or was leaked.
 */
export function estimateStrength(password) {
  const pw = String(password || '');
  if (!pw) return { bits: 0, label: 'Empty', level: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
  let effective = pw.length;
  // a character repeated, or a straight run up or down, adds almost nothing
  for (let i = 1; i < pw.length; i++) {
    const d = pw.charCodeAt(i) - pw.charCodeAt(i - 1);
    if (d === 0 || ((d === 1 || d === -1) && i >= 2 && pw.charCodeAt(i - 1) - pw.charCodeAt(i - 2) === d)) effective -= 0.85;
  }
  // a well-known word is worth about one character, not its length: 'password1!' is weak, but a long phrase that happens to contain 'master' is not
  const lower = pw.toLowerCase();
  for (const c of COMMON) if (lower.includes(c)) effective -= c.length - 1;
  let bits = Math.max(0, effective) * Math.log2(pool || 1);
  if (new Set(pw).size <= 2) bits = Math.min(bits, 10);
  bits = Math.round(bits);
  const band = LEVELS.find((l) => bits < l.max);
  return { bits, label: band.label, level: band.level };
}
