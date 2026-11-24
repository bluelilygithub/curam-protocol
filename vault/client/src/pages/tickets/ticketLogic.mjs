// Tickets: labels, colours and small pure helpers shared by the list and the ticket page (docs/tickets.md).
// The values match server/services/tickets.js. Run: node client/src/pages/tickets/ticketLogic.test.mjs

export const TYPES = [
  { value: 'client', label: 'Client work', tip: 'Requests, issues and to-dos for a client or project.' },
  { value: 'bug', label: 'Bug', tip: 'Something broken in Vault, a site or an app.' },
  { value: 'admin', label: 'Admin', tip: 'Running the business: accounts, compliance, renewals, suppliers.' },
  { value: 'idea', label: 'Idea', tip: 'Something to look at later, not yet committed to.' },
];
export const STATUSES = [
  { value: 'open', label: 'Open', bg: '#dbeafe', color: '#1e40af' },
  { value: 'in_progress', label: 'In progress', bg: '#ede9fe', color: '#5b21b6' },
  { value: 'waiting', label: 'Waiting', bg: '#fef3c7', color: '#92400e' },
  { value: 'done', label: 'Done', bg: '#d1fae5', color: '#065f46' },
];
export const PRIORITIES = [
  { value: 'high', label: 'High', color: '#ef4444' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'low', label: 'Low', color: 'var(--color-muted)' },
];

const find = (list, v) => list.find((x) => x.value === v) || list[0];
export const typeOf = (v) => find(TYPES, v);
export const statusOf = (v) => find(STATUSES, v);
export const priorityOf = (v) => find(PRIORITIES, v);

/** The filter chips over the list: "Active" (not done) is the default. */
export const STATUS_FILTERS = [{ value: 'active', label: 'Active' }, ...STATUSES.map(({ value, label }) => ({ value, label })), { value: '', label: 'All' }];

export const ticketNo = (t) => `T-${t.id}`;

/** A person's short name: the part of the email before @ (Vault users have only an email). */
export const shortName = (email) => (email ? String(email).split('@')[0] : '');

/** Due before today and not done. `today` is YYYY-MM-DD in the person's time zone. */
export function isOverdue(t, today) {
  return !!t.dueDate && t.status !== 'done' && t.dueDate < today;
}

/** The local date as YYYY-MM-DD (not UTC, so an Australian morning is not yesterday). */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Due 3 Dec", "Due today", "2 days overdue" for a row. */
export function dueText(t, today) {
  if (!t.dueDate) return '';
  if (t.status !== 'done' && t.dueDate === today) return 'Due today';
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.dueDate}T00:00:00Z`)) / 86400000);
  if (t.status !== 'done' && days > 0) return `${days} day${days === 1 ? '' : 's'} overdue`;
  const [y, m, dd] = t.dueDate.split('-').map(Number);
  return `Due ${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
}

/** The list's query string from the filters (empty values left out). */
export function listQuery(f) {
  const p = new URLSearchParams();
  for (const k of ['q', 'status', 'type', 'priority', 'assigneeId']) if (f[k]) p.set(k, f[k]);
  if (f.overdue) p.set('overdue', 'true');
  return p.toString();
}

/**
 * A new ticket can start filled in from a link (other tools, stage 2): /tickets?new=1&title=..&clientId=..&sourceKind=note&sourceId=4&sourceLabel=..
 * Returns the starting values, or null when the link does not ask for a new ticket.
 */
export function prefillFrom(params) {
  if (params.get('new') !== '1') return null;
  const num = (k) => { const n = Number(params.get(k)); return Number.isInteger(n) && n > 0 ? n : null; };
  const kinds = ['note', 'client', 'client_project', 'ef_case'];
  const kind = params.get('sourceKind');
  return {
    title: (params.get('title') || '').slice(0, 200),
    description: (params.get('description') || '').slice(0, 5000),
    type: TYPES.some((t) => t.value === params.get('type')) ? params.get('type') : 'client',
    clientId: num('clientId'),
    clientProjectId: num('clientProjectId'),
    sourceKind: kinds.includes(kind) && num('sourceId') ? kind : null,
    sourceId: kinds.includes(kind) ? num('sourceId') : null,
    sourceLabel: (params.get('sourceLabel') || '').slice(0, 200),
  };
}

/** Where a ticket's source lives in Vault, for the "From" link. */
export function sourceHref(t) {
  if (!t.sourceKind || !t.sourceId) return null;
  return { note: `/notes?note=${t.sourceId}`, client: `/clients/${t.sourceId}`, client_project: `/client-projects/${t.sourceId}`, ef_case: '/email-follow-up' }[t.sourceKind] || null;
}
