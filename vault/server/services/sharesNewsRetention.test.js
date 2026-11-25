'use strict';

// node server/services/sharesNewsRetention.test.js   No database: the clamp for the Settings → Shares briefing retention.

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@127.0.0.1:1/x';
const assert = require('assert');
const { clampRetentionDays } = require('./sharesNewsService');

assert.strictEqual(clampRetentionDays('90'), 90, 'stored as text in settings');
assert.strictEqual(clampRetentionDays(undefined), 45, 'unset → default 45');
assert.strictEqual(clampRetentionDays(''), 45);
assert.strictEqual(clampRetentionDays('abc'), 45);
assert.strictEqual(clampRetentionDays('0'), 45, '0 is not "keep nothing"');
assert.strictEqual(clampRetentionDays('-5'), 45);
assert.strictEqual(clampRetentionDays('3'), 7, 'floor of 7 days');
assert.strictEqual(clampRetentionDays('5000'), 730, 'cap of two years');
assert.strictEqual(clampRetentionDays('90.6'), 91, 'whole days');

console.log('sharesNewsRetention.test.js: all passed');
process.exit(0);
