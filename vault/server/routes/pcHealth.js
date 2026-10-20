'use strict';

// PC Health agent, the Vault side. Two routers:
//   - `router` (default export): what the admin's browser calls, mounted at /api/pc-health behind requireAdmin.
//   - `helperRouter`: what the read-only helper on the admin's PC calls, mounted at /api/pc-helper BEFORE requireAuth (the helper
//     has no login; it proves itself with a 32-byte token that is only stored as a hash).
// Vault cannot reach into a PC, so the page only QUEUES a scan; the helper polls, looks at the PC, and posts the report here.
// Nothing in this file (or the helper) changes, deletes or moves a file on that PC. See docs/pc-health.md.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');
const { sanitizeReport, cleanScanOptions, analyse, summarise } = require('../services/pcHealth');

const HELPER_ONLINE_MS = 90 * 1000;     // the helper polls every 30s by default
const RUNNING_TIMEOUT_MIN = 45;         // a scan the helper never finished
const QUEUED_TIMEOUT_HOURS = 24;        // a request nobody picked up
const KEEP_SCANS = 30;                  // history kept per person
const SCRIPT_PATH = path.join(__dirname, '../assets/pc-health-helper.ps1');

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const SCAN_LIST_COLS = 'id, status, options, summary, error, "requestedAt", "startedAt", "finishedAt"';

async function expireStale(userId) {
  await pool.query(
    `UPDATE pc_health_scans SET status='failed', error='The helper did not finish this scan in time.', "finishedAt"=NOW()
     WHERE "userId"=$1 AND status='running' AND "startedAt" < NOW() - ($2 || ' minutes')::interval`, [userId, String(RUNNING_TIMEOUT_MIN)]);
  await pool.query(
    `UPDATE pc_health_scans SET status='cancelled', error='Nobody picked this request up.', "finishedAt"=NOW()
     WHERE "userId"=$1 AND status='queued' AND "requestedAt" < NOW() - ($2 || ' hours')::interval`, [userId, String(QUEUED_TIMEOUT_HOURS)]);
}

// ── Admin side ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const router = express.Router();

router.get('/status', async (req, res, next) => {
  try {
    const userId = req.user.id;
    await expireStale(userId);
    const { rows: h } = await pool.query('SELECT "createdAt", "lastSeenAt", hostname FROM pc_health_helpers WHERE "userId"=$1', [userId]);
    const { rows: active } = await pool.query(
      `SELECT ${SCAN_LIST_COLS} FROM pc_health_scans WHERE "userId"=$1 AND status IN ('queued','running') ORDER BY id DESC LIMIT 1`, [userId]);
    const { rows: latest } = await pool.query(
      `SELECT ${SCAN_LIST_COLS} FROM pc_health_scans WHERE "userId"=$1 AND status='done' ORDER BY id DESC LIMIT 1`, [userId]);
    const seen = h[0]?.lastSeenAt ? new Date(h[0].lastSeenAt) : null;
    res.json({
      helper: {
        configured: !!h[0], createdAt: h[0]?.createdAt || null, lastSeenAt: seen, hostname: h[0]?.hostname || null,
        online: !!seen && Date.now() - seen.getTime() < HELPER_ONLINE_MS,
      },
      active: active[0] || null,
      latestDoneId: latest[0]?.id || null,
    });
  } catch (err) { next(err); }
});

// A new token replaces the old one (the old helper stops working). The plain token is shown once and never stored.
router.post('/helper-token', async (req, res, next) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO pc_health_helpers ("userId", "tokenHash") VALUES ($1,$2)
       ON CONFLICT ("userId") DO UPDATE SET "tokenHash"=EXCLUDED."tokenHash", "createdAt"=NOW(), "lastSeenAt"=NULL, hostname=NULL`,
      [req.user.id, hashToken(token)]);
    res.json({ token });
  } catch (err) { next(err); }
});

router.delete('/helper-token', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM pc_health_helpers WHERE "userId"=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/helper-script', (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  } catch (err) { next(err); }
});

router.post('/scans', async (req, res, next) => {
  try {
    const userId = req.user.id;
    await expireStale(userId);
    const { rows: active } = await pool.query(`SELECT id FROM pc_health_scans WHERE "userId"=$1 AND status IN ('queued','running') LIMIT 1`, [userId]);
    if (active[0]) return res.status(409).json({ error: 'A scan is already waiting or running. Wait for it to finish, or cancel it.' });
    const options = cleanScanOptions(req.body);
    const { rows } = await pool.query(
      `INSERT INTO pc_health_scans ("userId", status, options) VALUES ($1,'queued',$2) RETURNING ${SCAN_LIST_COLS}`, [userId, JSON.stringify(options)]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/scans', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SCAN_LIST_COLS} FROM pc_health_scans WHERE "userId"=$1 ORDER BY id DESC LIMIT ${KEEP_SCANS}`, [req.user.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/scans/:id/cancel', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE pc_health_scans SET status='cancelled', error='Cancelled.', "finishedAt"=NOW()
       WHERE id=$1 AND "userId"=$2 AND status IN ('queued','running') RETURNING ${SCAN_LIST_COLS}`, [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'No waiting or running scan with that number.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/scans/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SCAN_LIST_COLS}, report, findings FROM pc_health_scans WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Scan not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Helper side ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const helperRouter = express.Router();

async function helperAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!/^[0-9a-f]{64}$/.test(token)) return res.status(401).json({ error: 'Not authenticated' });
    const { rows } = await pool.query('SELECT "userId" FROM pc_health_helpers WHERE "tokenHash"=$1', [hashToken(token)]);
    if (!rows[0]) return res.status(401).json({ error: 'Not authenticated' });
    req.helperUserId = rows[0].userId;
    next();
  } catch (err) { next(err); }
}
helperRouter.use(helperAuth);

helperRouter.post('/poll', async (req, res, next) => {
  try {
    const userId = req.helperUserId;
    const hostname = String(req.body?.hostname || '').replace(/[^\w.\- ]/g, '').slice(0, 80) || null;
    await pool.query('UPDATE pc_health_helpers SET "lastSeenAt"=NOW(), hostname=COALESCE($2, hostname) WHERE "userId"=$1', [userId, hostname]);
    await expireStale(userId);
    const { rows } = await pool.query(
      `UPDATE pc_health_scans SET status='running', "startedAt"=NOW()
       WHERE id = (SELECT id FROM pc_health_scans WHERE "userId"=$1 AND status='queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id, options`, [userId]);
    res.json({ scan: rows[0] ? { id: rows[0].id, options: rows[0].options } : null });
  } catch (err) { next(err); }
});

helperRouter.post('/scans/:id/report', async (req, res, next) => {
  try {
    const userId = req.helperUserId;
    const { rows: own } = await pool.query(`SELECT id, status FROM pc_health_scans WHERE id=$1 AND "userId"=$2`, [req.params.id, userId]);
    if (!own[0]) return res.status(404).json({ error: 'Scan not found.' });
    if (own[0].status !== 'running') return res.status(409).json({ error: `This scan is ${own[0].status}, so the report was ignored.` });

    const report = sanitizeReport(req.body);
    const { rows: prevRows } = await pool.query(
      `SELECT report, "finishedAt" FROM pc_health_scans WHERE "userId"=$1 AND status='done' ORDER BY id DESC LIMIT 1`, [userId]);
    const result = analyse(report, prevRows[0]?.report || null, prevRows[0]?.finishedAt || null, new Date());
    const summary = { ...summarise(result.findings), total: result.findings.length, hadPrevious: result.hadPrevious, truncated: report.scan.truncated, hostname: report.machine.hostname };

    await pool.query(
      `UPDATE pc_health_scans SET status='done', report=$1, findings=$2, summary=$3, error=NULL, "finishedAt"=NOW() WHERE id=$4`,
      [JSON.stringify(report), JSON.stringify(result), JSON.stringify(summary), own[0].id]);
    await pool.query(
      `DELETE FROM pc_health_scans WHERE "userId"=$1 AND id NOT IN (SELECT id FROM pc_health_scans WHERE "userId"=$1 ORDER BY id DESC LIMIT ${KEEP_SCANS})`, [userId]);

    // The agent found something worth a look: tell the Suggestions inbox once for this set of high-severity findings.
    const high = result.findings.filter((f) => f.severity === 'high');
    const key = crypto.createHash('sha256').update(high.map((f) => f.id).sort().join('|')).digest('hex').slice(0, 16);
    await captureIf(high.length > 0, {
      userId, source: 'pcHealth', category: 'alert', fingerprint: makeFingerprint('pcHealth', `high:${key}`),
      title: `PC Health: ${high.length} thing${high.length === 1 ? '' : 's'} need a look`,
      body: `${high.slice(0, 8).map((f) => `- ${f.title}`).join('\n')}\n\nOpen PC Health for the full report. The agent only reports; it changes nothing on the PC.`,
      context: `/pc-health scan ${own[0].id}`,
    }).catch(() => {});

    res.json({ ok: true, id: own[0].id });
  } catch (err) { next(err); }
});

helperRouter.post('/scans/:id/fail', async (req, res, next) => {
  try {
    const msg = String(req.body?.error || 'The helper could not finish the scan.').replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
    const { rows } = await pool.query(
      `UPDATE pc_health_scans SET status='failed', error=$3, "finishedAt"=NOW() WHERE id=$1 AND "userId"=$2 AND status='running' RETURNING id`,
      [req.params.id, req.helperUserId, msg]);
    if (!rows[0]) return res.status(409).json({ error: 'That scan is not running.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

helperRouter.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  getLogger().error({ err }, '[pc-helper]');
  res.status(500).json({ error: 'Vault could not handle that.' });
});

module.exports = router;
module.exports.helperRouter = helperRouter;
