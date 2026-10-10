'use strict';

// Cellar Planner enquiries ("leads"). Two routers, built here so the test can run them without a database:
//
//   publicRouter  POST /api/cellar-lite/enquiry  -- no login. The business's website posts here (from its own contact page, via the small page script)
//                 when a visitor sends the contact form with a design from the planner. It records the enquiry, and puts the person into the CRM
//                 (prospect client + primary contact, or the existing one with the same email) with a new deal (stage lead) carrying the design and
//                 a link that opens it in the staff Cellar Planner. The website's own email is NOT replaced: this is an extra copy, so if Vault is
//                 down the enquiry still reaches the business by email.
//   staffRouter   /api/cellar-planner/leads -- behind requireAuth + requireFeature('cellarPlanner') where it is mounted (server/index.js).
//                 List, read one, mark opened, and record that a quote was made (logs it on the CRM timeline, fills the deal value if empty).
//
// The CRM records belong to the first admin (the workspace owner), the same convention the rest of Vault uses for workspace-level settings, and
// every staff query filters by "userId" like the rest of the CRM. Docs: docs/cellar-planner.md ("Enquiries").

const crypto = require('crypto');
const express = require('express');
const { getLogger } = require('../middleware/requestContext');

const CODE_RE = /^CL\d+\.[A-Za-z0-9_-]{1,200}$/;
const EMAIL_RE = /^[^\s@<>"',;:()\[\]\\]{1,64}@[^\s@<>"',;:()\[\]\\]{1,190}\.[A-Za-z]{2,24}$/;
const LIMITS = { name: 100, email: 254, phone: 24, message: 2000, summary: 400, priceText: 60, perIpPerHour: 5, perDay: 100, dedupeHours: 24 };
const HOUR = 60 * 60 * 1000;

// control characters are never wanted in text that ends up in a CRM note or an email
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const cleanLine = (v, max) => clean(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);

/** Validate what the page script posted. Returns { ok:true, value } or { ok:false, error }. Pure, so it is tested directly. */
function validateEnquiry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'No enquiry was sent.' };
  const name = cleanLine(raw.name, LIMITS.name);
  const email = cleanLine(raw.email, LIMITS.email).toLowerCase();
  const phoneRaw = cleanLine(raw.phone, LIMITS.phone);
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  if (!name) return { ok: false, error: 'A name is needed.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'A valid email address is needed.' };
  if (!CODE_RE.test(code)) return { ok: false, error: 'The design code is not valid.' };
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const phone = phoneRaw && /^\+?[\d\s().-]+$/.test(phoneRaw) && phoneDigits.length >= 6 && phoneDigits.length <= 15 ? phoneRaw : '';
  // blank is "not known", never 0 bottles
  const nb = raw.bottles === null || raw.bottles === undefined || raw.bottles === '' || typeof raw.bottles === 'boolean' ? NaN : Number(raw.bottles);
  const bottles = Number.isFinite(nb) && nb >= 0 && nb <= 100000 ? Math.round(nb) : null;
  return {
    ok: true,
    value: {
      name, email, phone, code, bottles,
      message: clean(raw.message, LIMITS.message),
      summary: cleanLine(raw.summary, LIMITS.summary),
      priceText: cleanLine(raw.priceText, LIMITS.priceText),
    },
  };
}

const ipOf = (req) => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown');
const hashIp = (ip) => crypto.createHash('sha256').update(`cellar-lead:${ip}`).digest('hex').slice(0, 24);

function createCellarLeadsRouters({ pool, now = () => Date.now(), capture = null, appUrl = () => process.env.APP_URL || 'https://curam-vault.up.railway.app' }) {
  const log = () => getLogger();
  const seen = new Map(); // ip hash -> [timestamps] (in memory: a restart only resets a limit, never loses an enquiry)

  /** True while this visitor is under the hourly limit (and counts this attempt). */
  function allowIp(h) {
    const t = now();
    const recent = (seen.get(h) || []).filter((x) => t - x < HOUR);
    if (recent.length >= LIMITS.perIpPerHour) { seen.set(h, recent); return false; }
    recent.push(t);
    seen.set(h, recent);
    if (seen.size > 5000) for (const [k, v] of seen) if (!v.some((x) => t - x < HOUR)) seen.delete(k);
    return true;
  }

  // ---------------------------------------------------------------- public: POST /api/cellar-lite/enquiry
  const publicRouter = express.Router();
  publicRouter.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST, OPTIONS').end();
    next();
  });
  // The page script sends text/plain (a "simple" request: no preflight, and it survives the page navigating away); accept JSON too.
  publicRouter.use(express.text({ type: () => true, limit: '16kb' }));

  publicRouter.post('/', async (req, res) => {
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'The enquiry could not be read.' }); } }
      // a field real visitors never see: anything in it means a robot. Answer as if it worked so the robot learns nothing.
      if (body && typeof body === 'object' && String(body.website ?? '').trim()) return res.json({ ok: true });
      const v = validateEnquiry(body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const e = v.value;

      if (!allowIp(hashIp(ipOf(req)))) return res.status(429).set('Retry-After', '3600').json({ error: 'Too many enquiries from this connection. Please try again later.' });

      const { rows: [owner] } = await pool.query('SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC LIMIT 1');
      if (!owner) { log().error('[cellar-leads] no admin user to own the enquiry'); return res.status(503).json({ error: 'Enquiries are not available right now.' }); }
      const userId = owner.id;

      // the same person sending the same design again (a double click, a retry) is one enquiry
      const { rows: dup } = await pool.query(
        `SELECT id FROM cellar_leads WHERE "userId"=$1 AND lower(email)=$2 AND "designCode"=$3 AND "createdAt" > NOW() - ($4 || ' hours')::interval LIMIT 1`,
        [userId, e.email, e.code, String(LIMITS.dedupeHours)]);
      if (dup.length) return res.json({ ok: true });

      // a daily ceiling on new enquiries, so a flood cannot fill the CRM
      const { rows: [today] } = await pool.query(`SELECT COUNT(*) AS n FROM cellar_leads WHERE "createdAt" > NOW() - INTERVAL '24 hours'`);
      if (Number(today.n) >= LIMITS.perDay) {
        if (capture) {
          await capture({
            userId, source: 'cellarLeads', category: 'alert', fingerprint: `cellarLeads:daily-cap:${new Date(now()).toISOString().slice(0, 10)}`,
            title: 'Cellar planner enquiries hit the daily limit',
            body: `${LIMITS.perDay} enquiries were recorded in 24 hours, so new ones are being refused until it drops. If these are real, raise LIMITS.perDay in server/routes/cellarLeadsRouter.js; if not, the public enquiry endpoint is being spammed.`,
            context: 'server/routes/cellarLeadsRouter.js',
          }).catch(() => {});
        }
        return res.status(429).json({ error: 'Enquiries are paused for now. Please call or email us instead.' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [lead] } = await client.query(
          `INSERT INTO cellar_leads ("userId", name, email, phone, message, "designCode", summary, "priceText", bottles, "ipHash")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [userId, e.name, e.email, e.phone || null, e.message || null, e.code, e.summary || null, e.priceText || null, e.bottles, hashIp(ipOf(req))]);
        const link = `${appUrl().replace(/\/$/, '')}/cellar-planner?lead=${lead.id}`;

        // the same email already in the CRM -> that client; otherwise a new prospect with a primary contact
        const { rows: existing } = await client.query(
          `SELECT c.id AS "clientId" FROM client_contacts cc JOIN clients c ON c.id = cc."clientId"
            WHERE c."userId"=$1 AND lower(cc.email)=$2 ORDER BY c.id ASC LIMIT 1`, [userId, e.email]);
        let clientId, isNew = false;
        if (existing.length) clientId = existing[0].clientId;
        else {
          const { rows: [c] } = await client.query(
            `INSERT INTO clients ("userId", name, status, "clientType", tags, notes) VALUES ($1,$2,'prospect','individual',$3,$4) RETURNING id`,
            [userId, e.name, JSON.stringify(['cellar-enquiry']), 'Created from a Cellar Planner enquiry on the website.']);
          clientId = c.id; isNew = true;
          await client.query(`INSERT INTO client_contacts ("clientId", name, email, phone, "isPrimary") VALUES ($1,$2,$3,$4,TRUE)`, [clientId, e.name, e.email, e.phone || null]);
        }
        const design = [e.summary, e.bottles !== null ? `${e.bottles} bottles` : '', e.priceText ? `guide price ${e.priceText}` : ''].filter(Boolean).join(' | ');
        const notes = [`Cellar Planner enquiry.`, design && `Design: ${design}`, e.message && `Their message:\n${e.message}`, `Open the design in the Cellar Planner: ${link}`].filter(Boolean).join('\n\n');
        const { rows: [deal] } = await client.query(
          `INSERT INTO client_deals ("userId", "clientId", title, stage, notes) VALUES ($1,$2,$3,'lead',$4) RETURNING id`,
          [userId, clientId, `Cellar enquiry${e.bottles !== null ? `: ${e.bottles} bottles` : ''}`.slice(0, 255), notes]);
        await client.query(
          `INSERT INTO client_interactions ("clientId", "userId", type, source, title, note, "dealId") VALUES ($1,$2,'note','system',$3,$4,$5)`,
          [clientId, userId, 'Cellar Planner enquiry received', notes, deal.id]);
        await client.query(`UPDATE cellar_leads SET "clientId"=$1, "dealId"=$2 WHERE id=$3`, [clientId, deal.id, lead.id]);
        await client.query('COMMIT');
        log().info({ leadId: lead.id, clientId, dealId: deal.id, newClient: isNew }, '[cellar-leads] enquiry recorded');
        res.json({ ok: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      // the website's own email still reaches the business, so a plain 503 is the right answer
      log().error({ err: err.message }, '[cellar-leads] could not record the enquiry');
      res.status(503).json({ error: 'Enquiries are not available right now.' });
    }
  });

  // ---------------------------------------------------------------- staff
  const staffRouter = express.Router();
  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null; };
  const publicLead = (r, full) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone, summary: r.summary, priceText: r.priceText, bottles: r.bottles, status: r.status,
    clientId: r.clientId, dealId: r.dealId, createdAt: new Date(r.createdAt).toISOString(),
    ...(full ? { message: r.message, code: r.designCode } : {}),
  });

  staffRouter.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, email, phone, summary, "priceText", bottles, status, "clientId", "dealId", "createdAt"
           FROM cellar_leads WHERE "userId"=$1 ORDER BY "createdAt" DESC, id DESC LIMIT 50`, [req.user.id]);
      res.json({ leads: rows.map((r) => publicLead(r, false)) });
    } catch (err) {
      log().error({ err: err.message }, '[cellar-leads] list failed');
      res.status(500).json({ error: 'Could not read the enquiries.' });
    }
  });

  staffRouter.get('/:id', async (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(404).json({ error: 'Enquiry not found.' });
    try {
      const { rows: [r] } = await pool.query(`SELECT * FROM cellar_leads WHERE id=$1 AND "userId"=$2`, [id, req.user.id]);
      if (!r) return res.status(404).json({ error: 'Enquiry not found.' });
      res.json({ lead: publicLead(r, true) });
    } catch (err) {
      log().error({ err: err.message }, '[cellar-leads] read failed');
      res.status(500).json({ error: 'Could not read the enquiry.' });
    }
  });

  // opened in the planner: new -> opened (never moves a quoted enquiry back)
  staffRouter.post('/:id/opened', async (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(404).json({ error: 'Enquiry not found.' });
    try {
      const { rows: [r] } = await pool.query(
        `UPDATE cellar_leads SET status = CASE WHEN status='new' THEN 'opened' ELSE status END, "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2 RETURNING status`, [id, req.user.id]);
      if (!r) return res.status(404).json({ error: 'Enquiry not found.' });
      res.json({ ok: true, status: r.status });
    } catch (err) {
      log().error({ err: err.message }, '[cellar-leads] opened failed');
      res.status(500).json({ error: 'Could not update the enquiry.' });
    }
  });

  // a quote PDF was made for this enquiry: status quoted, a line on the CRM timeline, and the deal's value filled in if it had none
  staffRouter.post('/:id/quote', async (req, res) => {
    const id = idOf(req);
    if (!id) return res.status(404).json({ error: 'Enquiry not found.' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const num = (x) => (Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 100000000 ? Math.round(Number(x) * 100) / 100 : null);
    const total = num(b.total);
    if (total === null || total <= 0) return res.status(400).json({ error: 'A quote total is needed.' });
    const text = cleanLine(b.text, 80), reference = cleanLine(b.reference, 60);
    try {
      const { rows: [r] } = await pool.query(`SELECT id, "clientId", "dealId" FROM cellar_leads WHERE id=$1 AND "userId"=$2`, [id, req.user.id]);
      if (!r) return res.status(404).json({ error: 'Enquiry not found.' });
      await pool.query(`UPDATE cellar_leads SET status='quoted', "updatedAt"=NOW() WHERE id=$1`, [id]);
      let valueSet = false;
      if (r.dealId) {
        const { rowCount } = await pool.query(`UPDATE client_deals SET value=$1, "updatedAt"=NOW() WHERE id=$2 AND "userId"=$3 AND value IS NULL`, [total, r.dealId, req.user.id]);
        valueSet = rowCount > 0;
      }
      if (r.clientId) {
        await pool.query(
          `INSERT INTO client_interactions ("clientId", "userId", type, source, title, note, "dealId") VALUES ($1,$2,'note','system',$3,$4,$5)`,
          [r.clientId, req.user.id, 'Cellar Planner quote prepared', `Total ${total.toLocaleString('en-AU')}${text ? ` (${text})` : ''}${reference ? `. Reference ${reference}` : ''}.${valueSet ? ' Deal value set from this quote.' : ''}`, r.dealId || null]);
      }
      res.json({ ok: true, valueSet });
    } catch (err) {
      log().error({ err: err.message }, '[cellar-leads] quote log failed');
      res.status(500).json({ error: 'Could not record the quote.' });
    }
  });

  return { publicRouter, staffRouter };
}

module.exports = { createCellarLeadsRouters, validateEnquiry, LIMITS };
