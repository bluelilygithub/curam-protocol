'use strict';

// "Needs attention": the one short list of things waiting on the person, worst first. Pure (no database), so the ranking and wording are
// tested in attention.test.js; routes/attention.js does the counting and hands the numbers here.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const money = (n) => { const v = Number(n || 0); const d = Number.isInteger(v) ? 0 : 2; return '$' + v.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d }); };
// The first few names, then "..." when there are more than shown (`count` = how many there really are; the sample itself is capped).
const names = (list, count, max = 3) => {
  const all = (list || []).filter(Boolean);
  const shown = all.slice(0, max).map((s) => String(s).trim().slice(0, 40));
  return shown.join(', ') + (Math.max(count || 0, all.length) > shown.length ? ', ...' : '');
};

/**
 * raw = {
 *   invoicesOverdue: { count, total, sample[] }, tasksOverdue: { count, sample[] }, remindersDue: { count, sample[] },
 *   expensePending: { count }, tasksToday: { count, sample[] }, suggestionsNew: { count }
 * }  (any key may be missing: that source is off for this person or had nothing)
 * Returns [{ id, severity: 'high'|'normal'|'low', title, detail, to, count }], most urgent first, empty ones left out.
 */
function buildAttentionItems(raw = {}) {
  const out = [];
  const add = (id, severity, count, title, detail, to) => { if (count > 0) out.push({ id, severity, title, detail: detail || '', to, count }); };

  const inv = raw.invoicesOverdue || {};
  add('invoices-overdue', 'high', inv.count, `${plural(inv.count, 'invoice', 'invoices')} overdue`,
    inv.total ? `${money(inv.total)} unpaid. ${names(inv.sample, inv.count)}`.trim() : names(inv.sample, inv.count), '/finance');

  const od = raw.tasksOverdue || {};
  add('tasks-overdue', 'high', od.count, `${plural(od.count, 'task', 'tasks')} overdue`, names(od.sample, od.count), '/tasks');

  const rem = raw.remindersDue || {};
  add('reminders-due', 'normal', rem.count, `${plural(rem.count, 'note reminder', 'note reminders')} due`, names(rem.sample, rem.count), '/notes');

  const exp = raw.expensePending || {};
  add('expense-review', 'normal', exp.count, `${plural(exp.count, 'invoice', 'invoices')} waiting for your review`, 'Found in your email, nothing is filed until you approve.', '/expense-review');

  const today = raw.tasksToday || {};
  add('tasks-today', 'normal', today.count, `${plural(today.count, 'task', 'tasks')} due today`, names(today.sample, today.count), '/tasks');

  const sug = raw.suggestionsNew || {};
  add('suggestions-new', 'low', sug.count, `${plural(sug.count, 'new suggestion', 'new suggestions')}`, 'Findings from Vault\'s background checks.', '/suggestions');

  const order = { high: 0, normal: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]); // sort is stable: within a severity the order above is kept
}

module.exports = { buildAttentionItems };
