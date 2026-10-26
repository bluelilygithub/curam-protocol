// node client/src/pages/passwordVault/vaultHealth.test.mjs   (part of npm run test:password-vault)

import assert from 'node:assert';
import { checkHealth } from './vaultHealth.mjs';
import { generatePassword } from '../../utils/passwordGen.mjs';

const now = new Date('2026-10-26T00:00:00Z');
const strong = () => generatePassword({ length: 24 });
const e = (id, title, password, extra = {}) => ({ id, title, password, createdAt: '2026-09-01T00:00:00Z', ...extra });

// a healthy vault has no findings
let r = checkHealth([e(1, 'A', strong()), e(2, 'B', strong())], now);
assert.deepStrictEqual(r.findings, []);
assert.strictEqual(r.checked, 2);

// reuse is reported on every entry that shares it, naming the others
const shared = strong();
r = checkHealth([e(1, 'Bank', shared), e(2, 'Shop', shared), e(3, 'Mail', strong())], now);
assert.deepStrictEqual(r.findings.map((f) => [f.entryId, f.kind]), [[1, 'reused'], [2, 'reused']]);
assert.match(r.findings[0].detail, /Same password as Shop/);
assert.strictEqual(r.counts.reused, 2);

// weak and missing
r = checkHealth([e(1, 'Router', 'admin'), e(2, 'Empty', ''), e(3, 'Fine', strong())], now);
assert.deepStrictEqual(r.findings.map((f) => [f.entryId, f.kind]).sort(), [[1, 'weak'], [2, 'missing']]);
assert.strictEqual(r.counts.weak, 1);

// old: measured from when the password was last changed, falling back to when it was saved
r = checkHealth([
  e(1, 'Old by change date', strong(), { passwordChangedAt: '2025-01-01T00:00:00Z' }),
  e(2, 'Old by save date', strong(), { createdAt: '2024-06-01T00:00:00Z' }),
  e(3, 'Changed lately', strong(), { createdAt: '2020-01-01T00:00:00Z', passwordChangedAt: '2026-08-01T00:00:00Z' }),
], now);
assert.deepStrictEqual(r.findings.map((f) => f.entryId).sort(), [1, 2]);
assert.ok(r.findings.every((f) => f.kind === 'old'));

// one entry can have several findings, ordered worst first; an empty vault is fine
const dup = 'password';
r = checkHealth([e(1, 'Z', dup, { createdAt: '2020-01-01T00:00:00Z' }), e(2, 'A', dup)], now);
assert.deepStrictEqual(r.findings.map((f) => f.kind), ['reused', 'reused', 'weak', 'weak', 'old']);
assert.deepStrictEqual(checkHealth([], now), { findings: [], counts: { reused: 0, weak: 0, old: 0, missing: 0 }, checked: 0 });

// a missing title or date does not throw
assert.doesNotThrow(() => checkHealth([{ id: 9, password: strong() }], now));

console.log('vaultHealth tests passed');
