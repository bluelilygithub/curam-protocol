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
assert.deepEqual(buildAttentionItems({ geoCheckReady: { count: 1, sample: ['before release 4.2'] } }).map((i) => [i.title, i.to]), [['1 country check ready in Device preview', '/device-preview?view=countries']]);

// a long title is cut so the line stays short
const long = buildAttentionItems({ tasksOverdue: { count: 1, sample: ['x'.repeat(200)] } })[0];
assert.ok(long.detail.length <= 40);

// a PDF → HTML page finished in the background and not opened yet
const web = buildAttentionItems({ pdfHtmlReady: { count: 1, sample: ['Blue Webpage Draft 2'] } })[0];
assert.equal(web.id, 'pdf-html-ready');
assert.equal(web.title, '1 web page ready in PDF → HTML');
assert.equal(web.to, '/pdf?tool=pdftohtml');
assert.equal(buildAttentionItems({ pdfHtmlReady: { count: 0, sample: [] } }).length, 0);

console.log('attention: ok');

// ---- the Home sidebar: one box per area ----
const { buildAttentionSummary } = require('./attention');
assert.deepEqual(buildAttentionSummary(), [], 'every source off: no boxes');
const areas = buildAttentionSummary({
  tasksOverdue: { count: 2, sample: ['A', 'B'] }, tasksToday: { count: 0 },
  remindersDue: { count: 0 },
  ticketsMine: { count: 3 }, ticketsOverdue: { count: 1, sample: ['Fix login'] },
  inboxNeeds: { count: 0 }, followUpDrafts: { count: 2 },
});
assert.deepEqual(areas.map((a) => a.id), ['tasks', 'notes', 'tickets', 'emails'], 'fixed order; plans and invoices are off for this person');
const area = Object.fromEntries(areas.map((a) => [a.id, a]));
assert.equal(area.tasks.total, 2);
assert.deepEqual(area.tasks.lines.map((l) => l.text), ['2 tasks overdue'], 'nothing due today: that line is left out');
assert.deepEqual(area.notes.lines, [], 'on but nothing waiting: kept, with no lines');
assert.deepEqual(area.tickets.lines.map((l) => [l.text, l.to]), [['1 ticket of yours overdue', '/tickets?view=overdue'], ['3 tickets assigned to you', '/tickets?view=mine']]);
assert.equal(area.emails.lines[0].text, '2 follow-up drafts to approve');
console.log('attention summary: ok');

// Two-step login key broken (admins only; the route adds authKeyBroken only for an admin): top of the list and its own first box
const keyItems = buildAttentionItems({ authKeyBroken: { count: 1 }, tasksOverdue: { count: 1, sample: ['A'] } });
assert.equal(keyItems[0].id, 'auth-key-broken', 'first, ahead of other high items');
assert.equal(keyItems[0].title, "Two-step login is broken: members can't sign in");
const keyAreas = buildAttentionSummary({ authKeyBroken: { count: 1 }, tasksOverdue: { count: 0 } });
assert.equal(keyAreas[0].id, 'signin');
assert.equal(keyAreas[0].lines[0].severity, 'high');
assert.ok(!buildAttentionSummary({ tasksOverdue: { count: 0 } }).some((a) => a.id === 'signin'), 'no box when the key works');
console.log('attention auth key: ok');
