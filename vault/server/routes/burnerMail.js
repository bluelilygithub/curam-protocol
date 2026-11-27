'use strict';

// Burner Mail: throw-away addresses on the owner's own domain for web sign-ups, with the verification code / confirm link pulled out of
// each email that arrives. Two routers:
//   - `router` (default export): what the signed-in person's browser calls, mounted at /api/burner-mail behind requireFeature('burnerMail').
//   - `inboundRouter`: what the mail provider calls (a Cloudflare Email Worker forwards each raw email), mounted BEFORE requireAuth and proved by
//     the shared secret INBOUND_MAIL_SECRET. See docs/burner-mail.md.
// The tool never opens a link and never shows an email's HTML; it keeps plain text, codes and link addresses only.

const crypto = require('crypto');
const express = require('express');
const { simpleParser } = require('mailparser');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const { extractCodes, extractLinks, stripHtml } = require('../services/burnerMail/extract');

const MAX_ADDRESSES = 50;           // active addresses per person
const MAX_MESSAGES = 100;           // kept per address
const MAX_RAW_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 60000;
const LIFETIMES_DAYS = [1, 7, 30];
const DEFAULT_DAYS = 7;

const domain = () => String(process.env.BURNER_MAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '');
const log = () => { try { return getLogger(); } catch { return console; } };

function slugFromLabel(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
}

// Live: not deleted, and not yet expired or saved (a saved burn never expires).
// Rows are never removed (see purgeExpired and DELETE), so an address can never be issued to anyone again.
const LIVE = `(a."deletedAt" IS NULL AND (a."expiresAt" > NOW() OR a."savedAt" IS NOT NULL))`;

const ADDRESS_COLS = `a.id, a.address, a.label, a."createdAt", a."expiresAt", a."lastMessageAt", a."savedAt",
  (SELECT COUNT(*) FROM burner_messages m WHERE m."addressId" = a.id) AS "messageCount"`;

function addressRow(r) {
  return { ...r, messageCount: Number(r.messageCount) };
}

// ── Signed-in side ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ configured: Boolean(domain() && process.env.INBOUND_MAIL_SECRET), domain: domain() || null, lifetimes: LIFETIMES_DAYS, defaultDays: DEFAULT_DAYS });
});

router.get('/addresses', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ADDRESS_COLS} FROM burner_addresses a WHERE a."userId"=$1 AND ${LIVE} ORDER BY a."createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows.map(addressRow));
  } catch (err) { next(err); }
});

router.post('/addresses', async (req, res, next) => {
  try {
    const d = domain();
    if (!d || !process.env.INBOUND_MAIL_SECRET) return res.status(409).json({ error: 'Burner Mail is not set up yet. The owner needs to add the mail domain and secret (see docs/burner-mail.md).' });
    const label = String(req.body?.label || '').trim().slice(0, 60);
    const forever = Number(req.body?.days) === 0; // "Keep for good": saved from the start
    const days = LIFETIMES_DAYS.includes(Number(req.body?.days)) ? Number(req.body.days) : DEFAULT_DAYS;

    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*) AS n FROM burner_addresses WHERE "userId"=$1 AND "expiresAt" > NOW() AND "savedAt" IS NULL AND "deletedAt" IS NULL`, [req.user.id]);
    if (Number(n) >= MAX_ADDRESSES) return res.status(409).json({ error: `You already have ${MAX_ADDRESSES} unsaved live burns. Delete some first.` });

    const slug = slugFromLabel(label) || 'signup';
    for (let attempt = 0; attempt < 5; attempt++) {
      const address = `${slug}-${crypto.randomBytes(3).toString('hex')}@${d}`;
      const { rows } = await pool.query(
        `INSERT INTO burner_addresses ("userId", address, label, "expiresAt", "savedAt")
         VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval, CASE WHEN $5::boolean THEN NOW() END)
         ON CONFLICT (address) DO NOTHING
         RETURNING id`,
        [req.user.id, address, label || null, String(days), forever]
      );
      if (rows[0]) {
        const { rows: [row] } = await pool.query(`SELECT ${ADDRESS_COLS} FROM burner_addresses a WHERE a.id=$1`, [rows[0].id]);
        return res.status(201).json(addressRow(row));
      }
    }
    res.status(500).json({ error: 'Could not make a free address. Try again.' });
  } catch (err) { next(err); }
});

router.get('/addresses/:id', async (req, res, next) => {
  try {
    const { rows: [row] } = await pool.query(`SELECT ${ADDRESS_COLS} FROM burner_addresses a WHERE a.id=$1 AND a."userId"=$2 AND a."deletedAt" IS NULL`, [req.params.id, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Burn not found.' });
    res.json(addressRow(row));
  } catch (err) { next(err); }
});

// Rename and/or save. Unsaving gives the burn at least the default lifetime again, so it does not vanish the moment it is unsaved.
router.patch('/addresses/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = [];
    const vals = [req.params.id, req.user.id];
    if (b.label !== undefined) { vals.push(String(b.label || '').trim().slice(0, 60) || null); sets.push(`label=$${vals.length}`); }
    if (b.saved === true) sets.push(`"savedAt"=COALESCE("savedAt", NOW())`);
    if (b.saved === false) sets.push(`"savedAt"=NULL, "expiresAt"=GREATEST("expiresAt", NOW() + INTERVAL '${DEFAULT_DAYS} days')`);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
    const { rowCount } = await pool.query(`UPDATE burner_addresses SET ${sets.join(', ')} WHERE id=$1 AND "userId"=$2 AND "deletedAt" IS NULL`, vals);
    if (!rowCount) return res.status(404).json({ error: 'Burn not found.' });
    const { rows: [row] } = await pool.query(`SELECT ${ADDRESS_COLS} FROM burner_addresses a WHERE a.id=$1`, [req.params.id]);
    res.json(addressRow(row));
  } catch (err) { next(err); }
});

router.delete('/addresses/:id', async (req, res, next) => {
  try {
    // emails go for good; the address row stays as a tombstone so it is never reissued (one statement, so both or neither)
    const { rowCount } = await pool.query(
      `WITH gone AS (DELETE FROM burner_messages WHERE "addressId"=$1 AND "userId"=$2)
       UPDATE burner_addresses SET "deletedAt"=NOW(), "savedAt"=NULL WHERE id=$1 AND "userId"=$2 AND "deletedAt" IS NULL`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Address not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/addresses/:id/messages', async (req, res, next) => {
  try {
    const { rows: own } = await pool.query(`SELECT id FROM burner_addresses WHERE id=$1 AND "userId"=$2 AND "deletedAt" IS NULL`, [req.params.id, req.user.id]);
    if (!own[0]) return res.status(404).json({ error: 'Address not found.' });
    const { rows } = await pool.query(
      `SELECT id, "fromAddr", subject, "bodyText", codes, links, "receivedAt" FROM burner_messages WHERE "addressId"=$1 ORDER BY id DESC LIMIT $2`,
      [req.params.id, MAX_MESSAGES]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.delete('/messages/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM burner_messages WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Message not found.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Mail provider side ─────────────────────────────────────────────────────────────────────────────────────────────────────

const inboundRouter = express.Router();

function secretOk(given) {
  const want = String(process.env.INBOUND_MAIL_SECRET || '');
  if (!want || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Save one raw email against the address it was sent to. Returns what happened (used by the route and the tests). */
async function storeInbound(raw, envelopeTo) {
  const to = String(envelopeTo || '').trim().toLowerCase();
  if (!to) return 'no-recipient';
  const { rows: [addr] } = await pool.query(
    `SELECT a.id, a."userId" FROM burner_addresses a WHERE a.address=$1 AND ${LIVE}`, [to]
  );
  if (!addr) return 'unknown-address'; // dropped quietly: a bounce would tell a stranger which addresses exist

  const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const html = typeof mail.html === 'string' ? mail.html : '';
  const text = (mail.text && mail.text.trim()) || stripHtml(html);
  const subject = String(mail.subject || '').slice(0, 300);
  const from = (mail.from?.text || '').slice(0, 300);
  const messageId = mail.messageId ? String(mail.messageId).slice(0, 300) : null;

  const codes = extractCodes(subject, text);
  const links = extractLinks(html, text);

  const { rows } = await pool.query(
    `INSERT INTO burner_messages ("addressId", "userId", "fromAddr", subject, "bodyText", codes, links, "messageId")
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
     ON CONFLICT ("addressId", "messageId") WHERE "messageId" IS NOT NULL DO NOTHING
     RETURNING id`,
    [addr.id, addr.userId, from, subject, text.slice(0, MAX_TEXT_CHARS), JSON.stringify(codes), JSON.stringify(links), messageId]
  );
  if (!rows[0]) return 'duplicate';
  await pool.query(`UPDATE burner_addresses SET "lastMessageAt"=NOW() WHERE id=$1`, [addr.id]);
  // keep only the newest MAX_MESSAGES per address
  await pool.query(
    `DELETE FROM burner_messages WHERE "addressId"=$1 AND id NOT IN (SELECT id FROM burner_messages WHERE "addressId"=$1 ORDER BY id DESC LIMIT $2)`,
    [addr.id, MAX_MESSAGES]
  );
  return 'stored';
}

inboundRouter.post('/', express.raw({ type: () => true, limit: MAX_RAW_BYTES }), async (req, res) => {
  if (!secretOk(req.get('x-inbound-secret'))) return res.status(401).json({ error: 'Not allowed.' });
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty email.' });
    const result = await storeInbound(req.body, req.get('x-envelope-to'));
    res.json({ ok: true, result });
  } catch (err) {
    log().warn({ err: err.message }, '[burner-mail] could not store inbound email');
    // 200 so the provider does not retry a mail we cannot parse; the problem is in our log.
    res.json({ ok: false });
  }
});

/** Hourly: delete the emails of unsaved addresses a day past their time. The address row stays (tombstone) so it is never reissued. */
async function purgeExpired() {
  const { rowCount } = await pool.query(
    `DELETE FROM burner_messages m USING burner_addresses a
     WHERE m."addressId"=a.id AND a."expiresAt" < NOW() - INTERVAL '1 day' AND a."savedAt" IS NULL`
  );
  return rowCount;
}

module.exports = router;
module.exports.inboundRouter = inboundRouter;
module.exports.storeInbound = storeInbound;
module.exports.purgeExpired = purgeExpired;
