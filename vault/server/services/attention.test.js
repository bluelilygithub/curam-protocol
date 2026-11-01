'use strict';
// node server/services/attention.test.js   (npm run test:attention)
const assert = require('node:assert/strict');
const { buildAttentionItems } = require('./attention');

assert.deepEqual(buildAttentionItems(), [], 'nothing waiting gives an empty list');
assert.deepEqual(buildAttentionItems({ tasksOverdue: { count: 0 }, suggestionsNew: { count: 0 } }), [], 'zero counts are left out');

const items = buildAttentionItems({
  suggestionsNew: { count: 4 },
  tasksToday: { count: 1, sample: ['Ring Sam'] },
  youtubeNew: { count: 3, sample: ['Bread 101', 'Rye'] },
  expensePending: { count: 2 },
  remindersDue: { count: 1, sample: ['Renew domain'] },
  tasksOverdue: { count: 3, sample: ['A', 'B', 'C', 'D'] },
  invoicesOverdue: { count: 1, total: 1250.5, sample: ['INV-2026-004'] },
});
assert.deepEqual(items.map((i) => i.id), ['invoices-overdue', 'tasks-overdue', 'reminders-due', 'expense-review', 'tasks-today', 'youtube-new', 'suggestions-new'], 'worst first, then the fixed order');
assert.deepEqual(items.map((i) => i.severity), ['high', 'high', 'normal', 'normal', 'normal', 'normal', 'low']);

const byId = Object.fromEntries(items.map((i) => [i.id, i]));
assert.equal(byId['invoices-overdue'].title, '1 invoice overdue', 'singular');
assert.equal(byId['tasks-overdue'].title, '3 tasks overdue', 'plural');
assert.equal(byId['invoices-overdue'].detail, '$1,250.50 unpaid. INV-2026-004');
assert.equal(byId['tasks-overdue'].detail, 'A, B, C, ...', 'only three names, then an ellipsis');
assert.equal(byId['tasks-overdue'].to, '/tasks');
assert.equal(byId['suggestions-new'].count, 4);
assert.equal(byId['youtube-new'].title, '3 new videos from what you follow on YouTube');
assert.equal(byId['youtube-new'].to, '/youtube?tab=following');
assert.equal(byId['youtube-new'].detail, 'Bread 101, Rye, ...', 'the count says there are more than the two named');

// the sample is capped at three by the database, so the count decides whether to add the ellipsis
assert.equal(buildAttentionItems({ tasksOverdue: { count: 9, sample: ['A', 'B', 'C'] } })[0].detail, 'A, B, C, ...');
assert.equal(buildAttentionItems({ tasksOverdue: { count: 2, sample: ['A', 'B'] } })[0].detail, 'A, B');

// a long title is cut so the line stays short
const long = buildAttentionItems({ tasksOverdue: { count: 1, sample: ['x'.repeat(200)] } })[0];
assert.ok(long.detail.length <= 40);

console.log('attention: ok');
