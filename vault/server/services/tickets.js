'use strict';

// Tickets: internal work items (client work, bugs, admin, ideas) shared by everyone who has the `tickets` feature. There is no owner column:
// every person with access sees and can change every ticket (the owner chose "everyone sees all"). Who raised it and who it is assigned to are
// recorded, and each change writes a line to the ticket's history. A client or client project can only be linked by someone whose CRM holds it
// (plans.resolveClientLink); everyone still sees the linked name. See docs/tickets.md.

const { resolveClientLink, PlanError } = require('./plans');

class TicketError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const TYPES = ['client', 'bug', 'admin', 'idea'];
const STATUSES = ['open', 'in_progress', 'waiting', 'done'];
const PRIORITIES = ['high', 'medium', 'low'];
const TYPE_LABEL = { client: 'Client work', bug: 'Bug', admin: 'Admin', idea: 'Idea' };
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const SOURCE_KINDS = ['note', 'client', 'client_project', 'ef_case'];
const MAX_TITLE = 200;
const MAX_TEXT = 20000;
const MAX_COMMENT = 10000;

const tidy = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

function cleanTitle(v) {
  const t = tidy(v).replace(/\s+/g, ' ');
  if (!t) throw new TicketError('Give the ticket a title.');
  return t.slice(0, MAX_TITLE);
}
function oneOf(v, list, what) {
  if (!list.includes(v)) throw new TicketError(`That ${what} is not one Tickets knows.`);
  return v;
}
function cleanDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new TicketError('The due date must be a date like 2026-12-01.');
  return s;
}

const COLS = `t.id, t.title, t.description, t.type, t.status, t.priority, t."dueDate"::text AS "dueDate", t."clientId", t."clientProjectId",
  t."createdBy", t."assigneeId", t."sourceKind", t."sourceId", t."sourceLabel", t."createdAt", t."updatedAt", t."closedAt",
  c.name AS "clientName", c."userId" AS "clientOwnerId", p.name AS "clientProjectName", cu.email AS "createdByEmail", au.email AS "assigneeEmail"`;
const FROM = `tickets t
  LEFT JOIN clients c ON c.id = t."clientId"
  LEFT JOIN projects p ON p.id = t."clientProjectId"
  LEFT JOIN users cu ON cu.id = t."createdBy"
  LEFT JOIN users au ON au.id = t."assigneeId"`;

/**
 * Everyone who can use Tickets (admins always; others when the feature is on for them), for the assignee list: [{ id, email }].
 * `deps.access(userId)` returns the person's feature flags (middleware/auth loadFeatureAccess).
 */
async function people(db, deps = {}) {
  const access = deps.access || require('../middleware/auth').loadFeatureAccess;
  const { rows } = await db.query('SELECT id, email, "isAdmin" FROM users ORDER BY email');
  const out = [];
  for (const u of rows) {
    if (u.isAdmin) { out.push({ id: u.id, email: u.email }); continue; }
    const flags = await access(u.id).catch(() => ({}));
    if (flags.tickets === true) out.push({ id: u.id, email: u.email });
  }
  return out;
}

async function checkAssignee(db, id, deps) {
  if (id == null || id === '') return null;
  const n = idOf(id);
  if (!n || !(await people(db, deps)).some((p) => p.id === n)) throw new TicketError('That person cannot be assigned: they do not have Tickets.', 400);
  return n;
}

/**
 * Tickets, most recently changed first, with filters: q (title, description, T-number), type, status ('active' = not done), priority,
 * assigneeId ('me' or an id, 'none'), clientId, clientProjectId, overdue (true: due before today and not done). Capped at 500.
 */
async function list(db, userId, f = {}) {
  const where = []; const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  const q = tidy(f.q).slice(0, 200);
  if (q) {
    const num = q.match(/^t-?(\d+)$/i);
    if (num) add('t.id = ?', Number(num[1]));
    else { params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); where.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`); }
  }
  if (f.type && TYPES.includes(f.type)) add('t.type = ?', f.type);
  if (f.status === 'active') where.push(`t.status <> 'done'`);
  else if (f.status && STATUSES.includes(f.status)) add('t.status = ?', f.status);
  if (f.priority && PRIORITIES.includes(f.priority)) add('t.priority = ?', f.priority);
  if (f.assigneeId === 'me') add('t."assigneeId" = ?', userId);
  else if (f.assigneeId === 'none') where.push('t."assigneeId" IS NULL');
  else if (idOf(f.assigneeId)) add('t."assigneeId" = ?', idOf(f.assigneeId));
  if (idOf(f.clientId)) add('t."clientId" = ?', idOf(f.clientId));
  if (idOf(f.clientProjectId)) add('t."clientProjectId" = ?', idOf(f.clientProjectId));
  if (f.overdue === true || f.overdue === 'true') where.push(`t.status <> 'done' AND t."dueDate" < CURRENT_DATE`);
  const { rows } = await db.query(
    `SELECT ${COLS}, (SELECT COUNT(*)::int FROM ticket_events e WHERE e."ticketId" = t.id AND e.kind = 'comment') AS "commentCount"
       FROM ${FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t."updatedAt" DESC, t.id DESC LIMIT 500`, params);
  return rows;
}

/** Counts for the menu badge: open tickets assigned to the person, and how many of those are overdue. */
async function counts(db, userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS assigned, COUNT(*) FILTER (WHERE "dueDate" < CURRENT_DATE)::int AS overdue
       FROM tickets WHERE "assigneeId" = $1 AND status <> 'done'`, [userId]);
  return rows[0];
}

async function getRow(db, id, { lock = false } = {}) {
  const n = idOf(id);
  if (!n) throw new TicketError('That ticket was not found.', 404);
  if (lock) await db.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [n]);
  const { rows } = await db.query(`SELECT ${COLS} FROM ${FROM} WHERE t.id = $1`, [n]);
  if (!rows[0]) throw new TicketError('That ticket was not found.', 404);
  return rows[0];
}

/** A ticket with its history (comments and changes, oldest first) and the tasks made from it. */
async function get(db, id) {
  const ticket = await getRow(db, id);
  const { rows: events } = await db.query(
    `SELECT e.id, e.kind, e.body, e."userId", u.email AS "userEmail", e."createdAt"
       FROM ticket_events e LEFT JOIN users u ON u.id = e."userId" WHERE e."ticketId" = $1 ORDER BY e."createdAt", e.id`, [ticket.id]);
  const { rows: tasks } = await db.query('SELECT id, title, status, "userId" FROM tasks WHERE "ticketId" = $1 ORDER BY id', [ticket.id]);
  return { ...ticket, events, tasks };
}

async function logEvent(db, ticketId, userId, kind, body) {
  await db.query('INSERT INTO ticket_events ("ticketId", "userId", kind, body) VALUES ($1,$2,$3,$4)', [ticketId, userId, kind, String(body).slice(0, MAX_COMMENT)]);
}

/** The link to where a ticket came from (a note, client, client project or Email Follow-Up case): kept as a kind, id and a short label. */
function cleanSource(body) {
  if (!body.sourceKind) return { sourceKind: null, sourceId: null, sourceLabel: null };
  const kind = oneOf(String(body.sourceKind), SOURCE_KINDS, 'source');
  const id = idOf(body.sourceId);
  if (!id) throw new TicketError('The ticket\'s source was not found.', 400);
  return { sourceKind: kind, sourceId: String(id), sourceLabel: tidy(body.sourceLabel).replace(/\s+/g, ' ').slice(0, 200) || null };
}

async function create(db, userId, body = {}, deps = {}) {
  const title = cleanTitle(body.title);
  const description = tidy(body.description).slice(0, MAX_TEXT);
  const type = body.type == null ? 'client' : oneOf(body.type, TYPES, 'type');
  const status = body.status == null ? 'open' : oneOf(body.status, STATUSES, 'status');
  const priority = body.priority == null ? 'medium' : oneOf(body.priority, PRIORITIES, 'priority');
  const dueDate = cleanDate(body.dueDate);
  const link = await resolveClientLink(db, userId, body);
  const assigneeId = await checkAssignee(db, body.assigneeId, deps);
  const src = cleanSource(body);
  const { rows } = await db.query(
    `INSERT INTO tickets (title, description, type, status, priority, "dueDate", "clientId", "clientProjectId", "createdBy", "assigneeId",
                          "sourceKind", "sourceId", "sourceLabel", "closedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $4 = 'done' THEN NOW() END) RETURNING id`,
    [title, description, type, status, priority, dueDate, link.clientId, link.clientProjectId, userId, assigneeId, src.sourceKind, src.sourceId, src.sourceLabel]);
  return get(db, rows[0].id);
}

/**
 * Change any of title, description, type, status, priority, dueDate, assigneeId, clientId, clientProjectId. Every change to a field people
 * track (status, priority, type, due date, assignee, client) is written to the history in plain words.
 */
async function update(db, userId, id, body = {}, deps = {}) {
  const cur = await getRow(db, id, { lock: true });
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const next = {};
  if (has('title')) next.title = cleanTitle(body.title);
  if (has('description')) next.description = tidy(body.description).slice(0, MAX_TEXT);
  if (has('type')) next.type = oneOf(body.type, TYPES, 'type');
  if (has('status')) next.status = oneOf(body.status, STATUSES, 'status');
  if (has('priority')) next.priority = oneOf(body.priority, PRIORITIES, 'priority');
  if (has('dueDate')) next.dueDate = cleanDate(body.dueDate);
  if (has('assigneeId')) next.assigneeId = body.assigneeId === cur.assigneeId ? cur.assigneeId : await checkAssignee(db, body.assigneeId, deps);
  if (has('clientId') || has('clientProjectId')) {
    // someone without that client in their CRM can still change other fields; only re-linking is checked against their own clients
    const sameClient = (!has('clientId') || (idOf(body.clientId) || null) === (cur.clientId || null))
      && (!has('clientProjectId') || (idOf(body.clientProjectId) || null) === (cur.clientProjectId || null));
    if (!sameClient) Object.assign(next, await resolveClientLink(db, userId, body, { clientId: cur.clientId, clientProjectId: cur.clientProjectId }));
  }

  const changes = [];
  const say = (field, from, to) => changes.push(`${field}: ${from || 'none'} → ${to || 'none'}`);
  if (next.status && next.status !== cur.status) say('Status', STATUS_LABEL[cur.status], STATUS_LABEL[next.status]);
  if (next.priority && next.priority !== cur.priority) say('Priority', PRIORITY_LABEL[cur.priority], PRIORITY_LABEL[next.priority]);
  if (next.type && next.type !== cur.type) say('Type', TYPE_LABEL[cur.type], TYPE_LABEL[next.type]);
  if (has('dueDate') && next.dueDate !== cur.dueDate) say('Due', cur.dueDate, next.dueDate);
  let assigneeEmail = cur.assigneeEmail;
  if (has('assigneeId') && (next.assigneeId || null) !== (cur.assigneeId || null)) {
    assigneeEmail = next.assigneeId ? (await db.query('SELECT email FROM users WHERE id = $1', [next.assigneeId])).rows[0]?.email : null;
    say('Assigned', cur.assigneeEmail, assigneeEmail);
  }
  if ('clientId' in next && (next.clientId || null) !== (cur.clientId || null)) {
    const name = next.clientId ? (await db.query('SELECT name FROM clients WHERE id = $1', [next.clientId])).rows[0]?.name : null;
    say('Client', cur.clientName, name);
  }
  if (next.title && next.title !== cur.title) changes.push('Title changed');

  const cols = Object.keys(next).filter((k) => next[k] !== undefined);
  if (!cols.length) return get(db, cur.id);
  const sets = cols.map((k, i) => `"${k}" = $${i + 2}`);
  if (next.status) sets.push(next.status === 'done' ? `"closedAt" = COALESCE("closedAt", NOW())` : `"closedAt" = NULL`);
  await db.query(`UPDATE tickets SET ${sets.join(', ')}, "updatedAt" = NOW() WHERE id = $1`, [cur.id, ...cols.map((k) => next[k])]);
  if (changes.length) await logEvent(db, cur.id, userId, 'change', changes.join('; '));
  return get(db, cur.id);
}

async function addComment(db, userId, id, text) {
  const body = tidy(text).slice(0, MAX_COMMENT);
  if (!body) throw new TicketError('Write something to add a comment.');
  const t = await getRow(db, id);
  await logEvent(db, t.id, userId, 'comment', body);
  await db.query('UPDATE tickets SET "updatedAt" = NOW() WHERE id = $1', [t.id]);
  return get(db, t.id);
}

/** A comment can be removed by the person who wrote it, or by an admin. Change lines cannot be removed. */
async function deleteComment(db, user, id, eventId) {
  const t = await getRow(db, id);
  const { rows } = await db.query('SELECT "userId", kind FROM ticket_events WHERE id = $1 AND "ticketId" = $2', [idOf(eventId), t.id]);
  if (!rows[0] || rows[0].kind !== 'comment') throw new TicketError('That comment was not found.', 404);
  if (rows[0].userId !== user.id && !user.isAdmin) throw new TicketError('Only the person who wrote a comment can remove it.', 403);
  await db.query('DELETE FROM ticket_events WHERE id = $1', [idOf(eventId)]);
  return get(db, t.id);
}

/**
 * "Make a task": a task in the caller's own Tasks, linked back to the ticket, with its title, client, client project (as the task's project),
 * due date and priority. `title` overrides the ticket title. The ticket's history records it.
 */
async function makeTask(db, userId, id, { title } = {}) {
  const t = await getRow(db, id, { lock: true });
  // one task per ticket (the owner's choice); older tickets may have several, and syncFromTask still handles them
  const { rows: had } = await db.query('SELECT 1 FROM tasks WHERE "ticketId" = $1 LIMIT 1', [t.id]);
  if (had.length) throw new TicketError('This ticket already has a task. Open it from the ticket.', 409);
  const taskTitle = title ? cleanTitle(title) : t.title;
  // the task is the caller's, so only link a client or project that is in their own CRM
  const own = async (table, rowId) => (rowId ? (await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND "userId" = $2`, [rowId, userId])).rows.length > 0 : false);
  const clientId = (await own('clients', t.clientId)) ? t.clientId : null;
  const projectId = (await own('projects', t.clientProjectId)) ? t.clientProjectId : null;
  const { rows } = await db.query(
    `INSERT INTO tasks (title, notes, status, priority, "dueDate", "userId", "clientId", "projectId", "ticketId", "updatedAt")
     VALUES ($1,$2,'todo',$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
    [taskTitle, `From ticket T-${t.id}: ${t.title}`, t.priority, t.dueDate, userId, clientId, projectId, t.id]);
  await logEvent(db, t.id, userId, 'change', `Task made: ${taskTitle}`);
  await syncFromTask(db, userId, rows[0].id, { made: true });
  return { taskId: rows[0].id, ticket: await get(db, t.id) };
}

/**
 * A task made from a ticket was finished, reopened or just made (docs/tickets.md "Tasks move the ticket"). The history says so; when every
 * task made from the ticket is done it moves to Waiting for a last look, and an open task moves a Waiting ticket back to In progress.
 * A Done ticket, and a ticket with no tasks, never move on their own. Call it in a transaction. Returns the new status, or null.
 */
async function syncFromTask(db, userId, taskId, { made = false } = {}) {
  const { rows: [task] } = await db.query('SELECT title, status, "ticketId" FROM tasks WHERE id = $1', [idOf(taskId)]);
  if (!task?.ticketId) return null;
  const { rows: [t] } = await db.query('SELECT id, status FROM tickets WHERE id = $1 FOR UPDATE', [task.ticketId]);
  if (!t) return null;
  const { rows: [{ open }] } = await db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'done') AS open FROM tasks WHERE "ticketId" = $1`, [t.id]);
  let next = null;
  if (t.status !== 'done') {
    if (Number(open) === 0 && t.status !== 'waiting') next = 'waiting';
    else if (Number(open) > 0 && t.status === 'waiting') next = 'in_progress';
  }
  const lines = made ? [] : [`${task.status === 'done' ? 'Task done' : 'Task reopened'}: ${task.title}`];
  if (next) {
    lines.push(`Status: ${STATUS_LABEL[t.status]} → ${STATUS_LABEL[next]} (${next === 'waiting' ? 'every task is done' : 'a task is open again'})`);
    await db.query('UPDATE tickets SET status = $2, "updatedAt" = NOW() WHERE id = $1', [t.id, next]);
  }
  if (lines.length) await logEvent(db, t.id, userId, 'change', lines.join('; '));
  return next;
}

/** Everything needed to put a ticket back from the recycle bin: the row and its history. */
async function snapshot(db, id) {
  const t = await getRow(db, id, { lock: true });
  const { rows: [row] } = await db.query('SELECT *, "dueDate"::text AS "dueDate" FROM tickets WHERE id = $1', [t.id]);
  const { rows: events } = await db.query('SELECT * FROM ticket_events WHERE "ticketId" = $1 ORDER BY id', [t.id]);
  return { ticket: row, events };
}

/** A safe message for a person, or null for a bug. */
function publicError(err) {
  if (err instanceof TicketError || err instanceof PlanError) return { status: err.status, message: err.message };
  return null;
}

module.exports = {
  TicketError, TYPES, STATUSES, PRIORITIES, TYPE_LABEL, STATUS_LABEL, PRIORITY_LABEL, SOURCE_KINDS, MAX_TITLE,
  people, list, counts, get, create, update, addComment, deleteComment, makeTask, syncFromTask, snapshot, publicError, cleanDate,
};
