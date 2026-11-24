'use strict';

// Ticket emails: find threads in the person's own Gmail that look related to a ticket, and let them attach or dismiss each one.
//
// Private by design: tickets are shared, Gmail is not. Every row is keyed by the person ("userId") and every read and write here filters on
// it, so an attached email (subject, sender, date, preview) is only ever shown to the person who attached it. Dismissing ("excluded") is per
// ticket: the thread is not suggested again on that ticket, by any later regrab. A regrab replaces only untouched suggestions; attached and
// excluded threads stay. ticket_email_runs records when each person last ran the search on each ticket.
//
// The search is a plain Gmail query, no AI: words from the ticket title, plus the client's contact addresses and email domains when the client
// is in the person's own CRM. Nothing is sent anywhere but the person's Gmail. Only headers and Gmail's preview snippet are read and stored.
// See docs/tickets.md "Related emails".

const { TicketError } = require('./tickets');
const { normaliseDomains } = require('./clientEmailSync');

const MAX_RESULTS = 15;
const MAX_WORDS = 6;
const THREAD_RE = /^[0-9a-f]{6,32}$/i;
const STATUSES = ['suggested', 'attached', 'excluded'];
const STOP = new Set(('the and for with from that this have about into need needs fix make again some what when where which their there they them '
  + 'will would should could please urgent asap before after next week today tomorrow ticket issue client update check').split(' '));

const tidy = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();

/** Up to six search words from a title: lower-case, 4+ letters, not filler. Pure. */
function keywords(title) {
  const words = String(title || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) || [];
  return [...new Set(words.map((w) => w.replace(/'s$/, '')).filter((w) => !STOP.has(w)))].slice(0, MAX_WORDS);
}

/**
 * The Gmail queries to try, best first. With client addresses: client mail mentioning a title word, then (if that finds little) any recent
 * client mail. Without: mail mentioning a title word. Null when there is nothing to search on. Pure.
 */
function buildQueries({ title, addresses = [], domains = [] }) {
  const words = keywords(title);
  const who = [...addresses.map((a) => `from:${a} OR to:${a}`), ...domains.map((d) => `from:@${d} OR to:@${d}`)].join(' OR ');
  const what = words.length ? `(${words.join(' OR ')})` : '';
  const recent = 'newer_than:1y';
  if (who && what) return { words, queries: [`(${who}) ${what} ${recent}`, `(${who}) ${recent}`] };
  if (who) return { words, queries: [`(${who}) ${recent}`] };
  if (what) return { words, queries: [`${what} ${recent}`] };
  return { words, queries: [] };
}

/** How many title words a hit mentions in its subject or preview. Pure. */
function score(hit, words) {
  const text = `${hit.subject} ${hit.snippet}`.toLowerCase();
  return words.filter((w) => text.includes(w)).length;
}

/** Ranks hits (most title words, then newest). Without a client, a hit must mention at least two words when there are two to match. Pure. */
function rank(hits, words, { hasClient }) {
  const need = hasClient ? 0 : Math.min(2, words.length);
  return hits.map((h) => ({ h, s: score(h, words) })).filter((x) => x.s >= need)
    .sort((a, b) => b.s - a.s || String(b.h.date).localeCompare(String(a.h.date))).map((x) => x.h);
}

async function gmailFor(db, userId, deps) {
  if (deps.gmailFor) return deps.gmailFor(userId);
  const { rows: [t] } = await db.query('SELECT email FROM gmail_tokens WHERE "userId"=$1', [userId]);
  if (!t) return null;
  const { getGmailClient } = require('../routes/gmail');
  return { gmail: await getGmailClient(userId), ownEmail: t.email || '' };
}

/** The client's contact addresses and domains, only when the client is in this person's own CRM (clients are per person). */
async function clientMail(db, userId, clientId, ownEmail) {
  if (!clientId) return { addresses: [], domains: [] };
  const { rows: [c] } = await db.query('SELECT "emailDomains" FROM clients WHERE id=$1 AND "userId"=$2', [clientId, userId]);
  if (!c) return { addresses: [], domains: [] };
  const own = String(ownEmail || '').toLowerCase();
  const raw = typeof c.emailDomains === 'string' ? JSON.parse(c.emailDomains) : c.emailDomains;
  const domains = normaliseDomains(raw).domains.filter((d) => d !== own.split('@')[1]); // your own domain would match all your mail
  const { rows } = await db.query(`SELECT DISTINCT lower(trim(email)) AS e FROM client_contacts WHERE "clientId"=$1 AND email IS NOT NULL AND email <> ''`, [clientId]);
  return { addresses: rows.map((r) => r.e).filter((e) => e && e !== own && /^[^\s@()]+@[^\s@()]+$/.test(e)), domains };
}

const header = (headers, name) => (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

/** One thread's first message headers and Gmail's preview. */
async function readThread(gmail, id) {
  const { data } = await gmail.users.threads.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
  const msgs = data.messages || [];
  const first = msgs[0] || {};
  const last = msgs[msgs.length - 1] || first;
  const h = first.payload?.headers;
  return {
    threadId: data.id || id,
    subject: tidy(header(h, 'Subject')).slice(0, 300) || '(no subject)',
    from: tidy(header(h, 'From')).slice(0, 300),
    date: new Date(Number(last.internalDate) || Date.now()).toISOString(),
    snippet: tidy(last.snippet || first.snippet).slice(0, 500),
  };
}

/**
 * Searches the person's Gmail for threads related to { title, clientId }. Saves nothing.
 * @returns {Promise<Array<{ threadId, subject, from, date, snippet }>>}
 */
async function find(db, userId, input = {}, deps = {}) {
  const title = tidy(input.title);
  if (!title) throw new TicketError('Give the ticket a title first, so there is something to search for.');
  const g = await gmailFor(db, userId, deps);
  if (!g) throw new TicketError('Connect your Gmail first (Settings → Gmail), then try again.', 409);
  const mail = await clientMail(db, userId, Number(input.clientId) || null, g.ownEmail);
  const { words, queries } = buildQueries({ title, ...mail });
  if (!queries.length) return [];
  const ids = [];
  for (const q of queries) {
    const { data } = await g.gmail.users.threads.list({ userId: 'me', q, maxResults: MAX_RESULTS });
    for (const t of data.threads || []) if (!ids.includes(t.id)) ids.push(t.id);
    if (ids.length >= 5) break; // enough from the closer query; the wider one is only a fallback
  }
  const hits = await Promise.all(ids.slice(0, MAX_RESULTS).map((id) => readThread(g.gmail, id)));
  return rank(hits, words, { hasClient: mail.addresses.length + mail.domains.length > 0 });
}

/** One email as given by a browser, checked: a real-looking thread id, a known status, trimmed text. Null if unusable. */
function cleanEmail(e) {
  if (!e || !THREAD_RE.test(String(e.threadId))) return null;
  const date = Date.parse(e.date);
  return {
    threadId: String(e.threadId), status: STATUSES.includes(e.status) ? e.status : 'suggested',
    subject: tidy(e.subject).slice(0, 300) || '(no subject)', from: tidy(e.from).slice(0, 300), snippet: tidy(e.snippet).slice(0, 500),
    date: Number.isNaN(date) ? null : new Date(date).toISOString(),
  };
}

async function insert(db, userId, ticketId, e, { keep }) {
  await db.query(
    `INSERT INTO ticket_emails ("ticketId","userId","threadId",subject,"fromAddr","sentAt",snippet,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT ("ticketId","userId","threadId") DO ${keep ? 'NOTHING' : 'UPDATE SET status = EXCLUDED.status, "updatedAt" = NOW()'}`,
    [ticketId, userId, e.threadId, e.subject, e.from, e.date, e.snippet, e.status]);
}

async function markRun(db, userId, ticketId, at = new Date()) {
  await db.query(`INSERT INTO ticket_email_runs ("ticketId","userId","lastRunAt") VALUES ($1,$2,$3)
                  ON CONFLICT ("ticketId","userId") DO UPDATE SET "lastRunAt" = EXCLUDED."lastRunAt"`, [ticketId, userId, at]);
}

/** This person's emails on a ticket: { lastRunAt, emails (suggested and attached), excluded }. */
async function listFor(db, userId, ticketId) {
  const { rows } = await db.query(
    `SELECT "threadId", subject, "fromAddr" AS "from", "sentAt" AS date, snippet, status FROM ticket_emails
      WHERE "ticketId"=$1 AND "userId"=$2 ORDER BY status = 'attached' DESC, "sentAt" DESC NULLS LAST`, [ticketId, userId]);
  const { rows: [run] } = await db.query('SELECT "lastRunAt" FROM ticket_email_runs WHERE "ticketId"=$1 AND "userId"=$2', [ticketId, userId]);
  return { lastRunAt: run ? run.lastRunAt : null, emails: rows.filter((r) => r.status !== 'excluded'), excluded: rows.filter((r) => r.status === 'excluded') };
}

async function ticketRow(db, id) {
  const n = Number(id);
  const { rows: [t] } = Number.isInteger(n) && n > 0 ? await db.query('SELECT id, title, "clientId" FROM tickets WHERE id=$1', [n]) : { rows: [] };
  if (!t) throw new TicketError('That ticket was not found.', 404);
  return t;
}

/** This person's emails on a ticket, after checking the ticket exists. */
async function list(db, userId, id) {
  return listFor(db, userId, (await ticketRow(db, id)).id);
}

/**
 * Search again: untouched suggestions are replaced; attached and excluded threads stay as they are. Records the run time.
 * `pool` is a pg Pool: the Gmail search runs first, then the writes go in one transaction (no connection held while Gmail answers).
 */
async function regrab(pool, userId, id, deps = {}) {
  const t = await ticketRow(pool, id);
  const found = await find(pool, userId, { title: t.title, clientId: t.clientId }, deps);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`DELETE FROM ticket_emails WHERE "ticketId"=$1 AND "userId"=$2 AND status='suggested'`, [t.id, userId]);
    for (const e of found) await insert(db, userId, t.id, { ...e, status: 'suggested' }, { keep: true });
    await markRun(db, userId, t.id);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
  return listFor(pool, userId, t.id);
}

/** Attach, dismiss, or put back ('suggested') one of this person's threads on a ticket. */
async function setStatus(db, userId, id, threadId, status) {
  const t = await ticketRow(db, id);
  if (!STATUSES.includes(status)) throw new TicketError('That is not something an email on a ticket can be.');
  const r = await db.query(`UPDATE ticket_emails SET status=$4, "updatedAt"=NOW() WHERE "ticketId"=$1 AND "userId"=$2 AND "threadId"=$3`, [t.id, userId, String(threadId), status]);
  if (!r.rowCount) throw new TicketError('That email was not found on this ticket.', 404);
  return listFor(db, userId, t.id);
}

/** Saves what the person chose in the New ticket form (emails with their status, and when they last searched). */
async function saveFromCreate(db, userId, ticketId, emails, lastRunAt) {
  const list = (Array.isArray(emails) ? emails : []).slice(0, 50).map(cleanEmail).filter(Boolean);
  for (const e of list) await insert(db, userId, ticketId, e, { keep: false });
  const at = Date.parse(lastRunAt);
  if (!Number.isNaN(at)) await markRun(db, userId, ticketId, new Date(Math.min(at, Date.now())));
}

module.exports = { keywords, buildQueries, score, rank, cleanEmail, find, list, regrab, setStatus, saveFromCreate };
