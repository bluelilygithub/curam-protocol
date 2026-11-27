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
 *   expensePending: { count }, tasksToday: { count, sample[] }, youtubeNew: { count, sample[] }, suggestionsNew: { count },
 *   pdfHtmlReady: { count, sample[] }, geoCheckReady: { count, sample[] }
 * }  (any key may be missing: that source is off for this person or had nothing)
 * Returns [{ id, severity: 'high'|'normal'|'low', title, detail, to, count }], most urgent first, empty ones left out.
 */
const AUTH_KEY_DETAIL = 'AUTH_ENCRYPTION_KEY in Railway is missing or the wrong shape. The suggestion has the fix.';

function buildAttentionItems(raw = {}) {
  const out = [];
  const add = (id, severity, count, title, detail, to) => { if (count > 0) out.push({ id, severity, title, detail: detail || '', to, count }); };

  add('auth-key-broken', 'high', raw.authKeyBroken?.count, "Two-step login is broken: members can't sign in", AUTH_KEY_DETAIL, '/suggestions');

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

  const yt = raw.youtubeNew || {};
  add('youtube-new', 'normal', yt.count, `${plural(yt.count, 'new video', 'new videos')} from what you follow on YouTube`, names(yt.sample, yt.count), '/youtube?tab=following');

  const web = raw.pdfHtmlReady || {};
  add('pdf-html-ready', 'normal', web.count, `${plural(web.count, 'web page', 'web pages')} ready in PDF → HTML`, names(web.sample, web.count), '/pdf?tool=pdftohtml');

  const geo = raw.geoCheckReady || {};
  add('geo-check-ready', 'normal', geo.count, `${plural(geo.count, 'country check', 'country checks')} ready in Device preview`, names(geo.sample, geo.count), '/device-preview?view=countries');

  const sug = raw.suggestionsNew || {};
  add('suggestions-new', 'low', sug.count, `${plural(sug.count, 'new suggestion', 'new suggestions')}`, 'Findings from Vault\'s background checks.', '/suggestions');

  const order = { high: 0, normal: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]); // sort is stable: within a severity the order above is kept
}

/**
 * The Home page sidebar: the same counts, one box per area (Tasks, Notes, Plans, Invoices, Tickets, Emails), in that order. An area whose
 * raw keys are all missing is off for this person and left out; an area with nothing waiting is kept with no lines ("Nothing waiting").
 * Extra raw keys: plansOverdue { count, sample[] }, ticketsMine { count }, ticketsOverdue { count, sample[] }, inboxNeeds { count, sample[] },
 * followUpDrafts { count }.
 * Returns [{ id, label, icon, to, total, lines: [{ id, severity, text, detail, to }] }].
 */
function buildAttentionSummary(raw = {}) {
  const line = (id, severity, count, text, detail, to) => (count > 0 ? { id, severity, text, detail: detail || '', to, count } : null);
  const inv = raw.invoicesOverdue || {};
  const areas = [
    { id: 'signin', label: 'Sign-in', icon: 'lock', to: '/suggestions', keys: ['authKeyBroken'], lines: [
      line('auth-key-broken', 'high', raw.authKeyBroken?.count, "Two-step login is broken: members can't sign in", AUTH_KEY_DETAIL, '/suggestions'),
    ] },
    { id: 'tasks', label: 'Tasks', icon: 'check-square', to: '/tasks', keys: ['tasksOverdue', 'tasksToday'], lines: [
      line('tasks-overdue', 'high', raw.tasksOverdue?.count, `${plural(raw.tasksOverdue?.count, 'task', 'tasks')} overdue`, names(raw.tasksOverdue?.sample, raw.tasksOverdue?.count), '/tasks'),
      line('tasks-today', 'normal', raw.tasksToday?.count, `${plural(raw.tasksToday?.count, 'task', 'tasks')} due today`, names(raw.tasksToday?.sample, raw.tasksToday?.count), '/tasks'),
    ] },
    { id: 'notes', label: 'Notes', icon: 'pen-line', to: '/notes', keys: ['remindersDue'], lines: [
      line('reminders-due', 'normal', raw.remindersDue?.count, `${plural(raw.remindersDue?.count, 'reminder', 'reminders')} due`, names(raw.remindersDue?.sample, raw.remindersDue?.count), '/notes'),
    ] },
    { id: 'plans', label: 'Plans', icon: 'gantt-chart', to: '/plans', keys: ['plansOverdue'], lines: [
      line('plans-overdue', 'high', raw.plansOverdue?.count, `${plural(raw.plansOverdue?.count, 'step', 'steps')} past ${raw.plansOverdue?.count === 1 ? 'its' : 'their'} end date`, names(raw.plansOverdue?.sample, raw.plansOverdue?.count), '/plans'),
    ] },
    { id: 'invoices', label: 'Invoices', icon: 'receipt', to: '/finance', keys: ['invoicesOverdue', 'expensePending'], lines: [
      line('invoices-overdue', 'high', inv.count, `${plural(inv.count, 'invoice', 'invoices')} overdue`,
        inv.total ? `${money(inv.total)} unpaid. ${names(inv.sample, inv.count)}`.trim() : names(inv.sample, inv.count), '/finance'),
      line('expense-review', 'normal', raw.expensePending?.count, `${plural(raw.expensePending?.count, 'bill', 'bills')} from email to review`, '', '/expense-review'),
    ] },
    { id: 'tickets', label: 'Tickets', icon: 'ticket', to: '/tickets?view=mine', keys: ['ticketsMine', 'ticketsOverdue'], lines: [
      line('tickets-overdue', 'high', raw.ticketsOverdue?.count, `${plural(raw.ticketsOverdue?.count, 'ticket', 'tickets')} of yours overdue`, names(raw.ticketsOverdue?.sample, raw.ticketsOverdue?.count), '/tickets?view=overdue'),
      line('tickets-mine', 'normal', raw.ticketsMine?.count, `${plural(raw.ticketsMine?.count, 'ticket', 'tickets')} assigned to you`, '', '/tickets?view=mine'),
    ] },
    { id: 'emails', label: 'Emails', icon: 'mail', to: '/gmail-intel', keys: ['inboxNeeds', 'followUpDrafts'], lines: [
      line('inbox-needs', 'normal', raw.inboxNeeds?.count, `${plural(raw.inboxNeeds?.count, 'email', 'emails')} urgent or waiting on you`, names(raw.inboxNeeds?.sample, raw.inboxNeeds?.count), '/gmail-intel'),
      line('follow-up-drafts', 'normal', raw.followUpDrafts?.count, `${plural(raw.followUpDrafts?.count, 'follow-up draft', 'follow-up drafts')} to approve`, '', '/email-follow-up'),
    ] },
  ];
  return areas
    .filter((a) => a.keys.some((k) => raw[k]))
    .map(({ keys, lines, ...a }) => {
      const kept = lines.filter(Boolean);
      return { ...a, total: kept.reduce((n, l) => n + l.count, 0), lines: kept };
    });
}

module.exports = { buildAttentionItems, buildAttentionSummary };
