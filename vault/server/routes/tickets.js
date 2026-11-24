'use strict';

// Tickets: internal work items shared by everyone with the `tickets` feature (admins always). Mounted at /api/tickets behind requireFeature.
// Delete goes into the deleter's recycle bin (30 days). See docs/tickets.md and services/tickets.js.
//
//   GET    /api/tickets?q=&type=&status=&priority=&assigneeId=&clientId=&clientProjectId=&overdue=   list (newest change first, 500 max)
//   GET    /api/tickets/counts                       { assigned, overdue } for the signed-in person (menu badge)
//   GET    /api/tickets/people                       who can be assigned: [{ id, email }]
//   POST   /api/tickets/draft                        { text }  AI: a draft ticket from messy text (saves nothing)
//   POST   /api/tickets                              { title, description?, type?, status?, priority?, dueDate?, assigneeId?, clientId?,
//                                                      clientProjectId?, sourceKind?, sourceId?, sourceLabel? }
//   GET    /api/tickets/:id                          the ticket, its history and tasks made from it
//   PUT    /api/tickets/:id                          any of the fields above (not the source)
//   DELETE /api/tickets/:id                          into the recycle bin
//   POST   /api/tickets/:id/comments                 { body }
//   DELETE /api/tickets/:id/comments/:eventId        the writer or an admin
//   POST   /api/tickets/:id/task                     { title? }  a linked task in the caller's Tasks
//
// Related emails (services/ticketEmails.js), private to the caller: only their own Gmail and only their own rows.
//   POST   /api/tickets/emails/find                  { title, clientId? }  search the caller's Gmail (saves nothing; for the New ticket form)
//   POST   /api/tickets  ... emails?, emailsRunAt?   the New ticket form's choices are saved with the ticket
//   GET    /api/tickets/:id/emails                   { lastRunAt, emails, excluded }
//   POST   /api/tickets/:id/emails/regrab            search again; attached and excluded threads are kept
//   PUT    /api/tickets/:id/emails/:threadId         { status: attached | excluded | suggested }

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const { aiLimiter } = require('../middleware/aiRateLimit');
const tickets = require('../services/tickets');
const ticketDraft = require('../services/ticketDraft');
const ticketEmails = require('../services/ticketEmails');

const router = express.Router();
const BIN_TYPE = 'ticket';
const emailSearchLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Too many email searches. Wait a minute and try again.' } });

/** Gmail failures (expired sign-in, quota) are not bugs in Tickets: say so plainly. */
function failEmail(res, err, where) {
  if (tickets.publicError(err)) return fail(res, err, where);
  getLogger().error({ err }, `[tickets] ${where}`);
  return res.status(502).json({ error: 'Gmail could not be searched just now. If it keeps happening, reconnect Gmail in Settings.' });
}

function fail(res, err, where) {
  const pub = tickets.publicError(err);
  if (pub) return res.status(pub.status).json({ error: pub.message });
  getLogger().error({ err }, `[tickets] ${where}`);
  return res.status(500).json({ error: 'Something went wrong with Tickets. Try again.' });
}

/** Runs `fn(db)` in a transaction, so a change and its history line land together. */
async function inTx(fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

router.get('/', async (req, res) => {
  try { res.json({ tickets: await tickets.list(pool, req.user.id, req.query || {}) }); } catch (err) { fail(res, err, 'list'); }
});

router.get('/counts', async (req, res) => {
  try { res.json(await tickets.counts(pool, req.user.id)); } catch (err) { fail(res, err, 'counts'); }
});

router.get('/people', async (req, res) => {
  try { res.json({ people: await tickets.people(pool) }); } catch (err) { fail(res, err, 'people'); }
});

router.post('/draft', aiLimiter, async (req, res) => {
  try { res.json(await ticketDraft.draftFromText(pool, req.user.id, { text: req.body?.text })); } catch (err) {
    if (tickets.publicError(err)) return fail(res, err, 'draft');
    getLogger().error({ err }, '[tickets] draft model');
    return res.status(502).json({ error: 'The AI could not be reached just now. Try again in a minute, or fill the ticket in yourself.' });
  }
});

router.post('/emails/find', emailSearchLimiter, async (req, res) => {
  try { res.json({ emails: await ticketEmails.find(pool, req.user.id, { title: req.body?.title, clientId: req.body?.clientId }) }); } catch (err) { failEmail(res, err, 'emails find'); }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  try {
    res.status(201).json(await inTx(async (db) => {
      const t = await tickets.create(db, req.user.id, body);
      if (body.emails || body.emailsRunAt) await ticketEmails.saveFromCreate(db, req.user.id, t.id, body.emails, body.emailsRunAt);
      return t;
    }));
  } catch (err) { fail(res, err, 'create'); }
});

router.get('/:id/emails', async (req, res) => {
  try { res.json(await ticketEmails.list(pool, req.user.id, req.params.id)); } catch (err) { fail(res, err, 'emails'); }
});

router.post('/:id/emails/regrab', emailSearchLimiter, async (req, res) => {
  try { res.json(await ticketEmails.regrab(pool, req.user.id, req.params.id)); } catch (err) { failEmail(res, err, 'emails regrab'); }
});

router.put('/:id/emails/:threadId', async (req, res) => {
  try { res.json(await ticketEmails.setStatus(pool, req.user.id, req.params.id, req.params.threadId, req.body?.status)); } catch (err) { fail(res, err, 'emails status'); }
});

router.get('/:id', async (req, res) => {
  try { res.json(await tickets.get(pool, req.params.id)); } catch (err) { fail(res, err, 'get'); }
});

router.put('/:id', async (req, res) => {
  try { res.json(await inTx((db) => tickets.update(db, req.user.id, req.params.id, req.body || {}))); } catch (err) { fail(res, err, 'update'); }
});

router.delete('/:id', async (req, res) => {
  const bin = require('../services/recycleBin');
  require('../services/recycleBin/adapters');
  try {
    const binId = await inTx(async (db) => {
      const snap = await tickets.snapshot(db, req.params.id);
      const comments = snap.events.filter((e) => e.kind === 'comment').length;
      const id = await bin.moveToBin(db, {
        userId: req.user.id, type: BIN_TYPE, id: snap.ticket.id, title: `T-${snap.ticket.id} ${snap.ticket.title}`,
        detail: `${comments} comment${comments === 1 ? '' : 's'}`, payload: snap,
      });
      await db.query('DELETE FROM tickets WHERE id = $1', [snap.ticket.id]); // its history goes with it; tasks made from it stay, unlinked
      return id;
    });
    res.json({ ok: true, binId });
  } catch (err) {
    if (err && err.code === 'TOO_LARGE') return res.status(413).json({ error: 'This ticket is too big to keep in the recycle bin, so it was not deleted.' });
    fail(res, err, 'delete');
  }
});

router.post('/:id/comments', async (req, res) => {
  try { res.status(201).json(await inTx((db) => tickets.addComment(db, req.user.id, req.params.id, req.body?.body))); } catch (err) { fail(res, err, 'comment'); }
});

router.delete('/:id/comments/:eventId', async (req, res) => {
  try { res.json(await tickets.deleteComment(pool, req.user, req.params.id, req.params.eventId)); } catch (err) { fail(res, err, 'deleteComment'); }
});

router.post('/:id/task', async (req, res) => {
  try { res.status(201).json(await inTx((db) => tickets.makeTask(db, req.user.id, req.params.id, { title: req.body?.title }))); } catch (err) { fail(res, err, 'task'); }
});

module.exports = router;
