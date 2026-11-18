'use strict';

// Ponytail report (admin, /ponytail). Two routers from one set of dependencies, so the test can swap the database and the clock:
//
//   ingest  /api/ponytail/ingest  The Ponytail plugin in Claude Code posts one task row per turn with "Authorization: Bearer pty_...".
//           No login, so it is mounted BEFORE requireAuth and before the global body parser: the key is checked first, then the body is
//           read with a 16 KB cap. Answers 204. The body is never logged.
//   admin   /api/ponytail         behind requireAuth + requireAdmin: keys (make, list, revoke), tasks, summary, code written per day,
//                                 CSV backfill, delete (to the recycle bin).
//
// What Ponytail sends and why the key is only stored as a hash: docs/ponytail-report.md. Checks: services/ponytailTasks.js.

const express = require('express');
const multer = require('multer');
const { getLogger, attachUserToLogContext } = require('../middleware/requestContext');
const { hashToken, newToken, cleanLabel, createLimiter } = require('../services/shelfTokens');
const { cleanSnapshot, parseCsv } = require('../services/ponytailTasks');

const TOKEN_RE = /^pty_[0-9a-f]{64}$/;
const MAX_ACTIVE_TOKENS = 5;
const MINUTE = 60 * 1000;
const PER_MINUTE = 120; // Ponytail sends once per turn
const PAGE_SIZE = 50;
const TZ = 'Australia/Brisbane';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CSV_BYTES = 2 * 1024 * 1024;

const errInfo = (err) => ({ name: err?.name, code: err?.code || err?.type, status: err?.status || err?.statusCode });

// Columns written for one task, in this order ($2..). "userId" is $1. started is read as Brisbane time.
const TASK_COLS = ['key', 'started', 'project', 'name', 'session', 'level', 'model', 'cost', 'lastTurn', 'turns', 'agentMs',
  'tokensInput', 'tokensOutput', 'tokensCacheRead', 'tokensCacheWrite', 'reuse', 'reused', 'created', 'callersOpen', 'tests', 'source'];
const qc = (c) => `"${c}"`;
const placeholders = TASK_COLS.map((c, i) => (c === 'started' ? `($${i + 2}::timestamp AT TIME ZONE '${TZ}')` : `$${i + 2}`));
const UPDATE_SET = TASK_COLS.filter((c) => c !== 'key').map((c) => `${qc(c)} = EXCLUDED.${qc(c)}`).join(', ');
const taskValues = (userId, t) => [userId, ...TASK_COLS.map((c) => t[c])];

const WEBHOOK_UPSERT = `
  INSERT INTO ponytail_tasks ("userId", ${TASK_COLS.map(qc).join(', ')}) VALUES ($1, ${placeholders.join(', ')})
  ON CONFLICT ("userId", key) DO UPDATE SET ${UPDATE_SET},
    "updatesReceived" = ponytail_tasks."updatesReceived" + 1, "lastSeenAt" = NOW()`;
// A backfill never overwrites what the webhook sent (it has the token split, the session and the last turn).
const CSV_UPSERT = `
  INSERT INTO ponytail_tasks ("userId", ${TASK_COLS.map(qc).join(', ')}) VALUES ($1, ${placeholders.join(', ')})
  ON CONFLICT ("userId", key) DO UPDATE SET ${UPDATE_SET}, "lastSeenAt" = NOW()
  WHERE ponytail_tasks.source = 'csv'
  RETURNING (xmax = 0) AS inserted`;

const DAY_SQL = `(t.started AT TIME ZONE '${TZ}')::date`;
const TOKENS_SQL = '(t."tokensInput" + t."tokensOutput" + t."tokensCacheRead" + t."tokensCacheWrite")';
const SORTS = {
  started: 't.started', cost: 't.cost', turns: 't.turns', agentMs: 't."agentMs"', tokens: TOKENS_SQL, reuse: 't.reuse',
  project: 't.project', name: 't.name', model: 't.model', level: 't.level',
};

/** The WHERE clause for the page's filters (from/to are Brisbane days, both inclusive). Unknown or bad values are ignored. */
function taskFilter(userId, q = {}) {
  const where = ['t."userId" = $1'];
  const params = [userId];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (DAY_RE.test(String(q.from || ''))) add(`t.started >= (?::date)::timestamp AT TIME ZONE '${TZ}'`, q.from);
  if (DAY_RE.test(String(q.to || ''))) add(`t.started < (?::date + 1)::timestamp AT TIME ZONE '${TZ}'`, q.to);
  if (typeof q.project === 'string' && q.project) add('t.project = ?', q.project.slice(0, 200));
  if (typeof q.model === 'string' && q.model) add('t.model = ?', q.model.slice(0, 100));
  return { where: where.join(' AND '), params };
}

const n = (v) => (v === null || v === undefined ? null : Number(v));

/** A task row as the page gets it: numbers as numbers, started as an ISO time. */
function taskOut(r) {
  return {
    id: r.id, key: r.key, started: r.started, project: r.project, name: r.name, session: r.session, level: r.level, model: r.model,
    cost: n(r.cost), lastTurn: n(r.lastTurn), turns: n(r.turns), agentMs: n(r.agentMs),
    tokens: { input: n(r.tokensInput), output: n(r.tokensOutput), cacheRead: n(r.tokensCacheRead), cacheWrite: n(r.tokensCacheWrite) },
    reuse: n(r.reuse), reused: n(r.reused), created: n(r.created), callersOpen: n(r.callersOpen), tests: r.tests,
    source: r.source, updatesReceived: n(r.updatesReceived), firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt,
  };
}

const tokenOut = (r) => ({ id: r.id, label: r.label, hint: `${r.prefix}…${r.last4}`, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt });

function createRouters(deps) {
  const { pool } = deps;
  const limiter = deps.limiter || createLimiter();
  const bin = deps.bin || require('../services/recycleBin');
  const log = () => getLogger();

  // ================================================================ ingest (no login: the key is the proof)
  const ingest = express.Router();

  async function keyAuth(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store');
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!TOKEN_RE.test(token)) return res.status(401).json({ error: 'Not authenticated' });
      const { rows } = await pool.query(
        `SELECT k.id, k."userId", k."revokedAt", u."isAdmin", u."disabledAt", u."accountantOfUserId"
           FROM ponytail_tokens k JOIN users u ON u.id = k."userId" WHERE k."tokenHash" = $1`, [hashToken(token)]);
      const row = rows[0];
      // The report is admin-only, so a key stops working if its owner is no longer an admin.
      if (!row || row.revokedAt || row.disabledAt || row.accountantOfUserId || !row.isAdmin) return res.status(401).json({ error: 'Not authenticated' });
      if (!limiter.take(`t:${row.id}`, PER_MINUTE, MINUTE)) {
        res.set('Retry-After', String(limiter.retryAfter(`t:${row.id}`, MINUTE)));
        return res.status(429).json({ error: 'Too many requests.' });
      }
      req.ponytail = { tokenId: row.id, userId: row.userId };
      attachUserToLogContext(row.userId);
      if (limiter.take(`u:${row.id}`, 1, MINUTE)) pool.query('UPDATE ponytail_tokens SET "lastUsedAt"=NOW() WHERE id=$1', [row.id]).catch(() => {});
      next();
    } catch (err) {
      log().error(errInfo(err), '[ponytail ingest auth]');
      res.status(500).json({ error: 'Something went wrong.' });
    }
  }

  // Any content type: the body is read as JSON only after the key passed.
  ingest.post('/', keyAuth, express.json({ limit: '16kb', type: () => true }), async (req, res) => {
    const { task, error } = cleanSnapshot(req.body);
    if (error) return res.status(400).json({ error });
    try {
      await pool.query(WEBHOOK_UPSERT, taskValues(req.ponytail.userId, task));
      res.status(204).end();
    } catch (err) {
      log().error(errInfo(err), '[ponytail ingest]');
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // A body that is too big or is not JSON: a short reason, never the body (a parser error object quotes it).
  ingest.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    log().warn(errInfo(err), '[ponytail ingest body]');
    const tooBig = err?.type === 'entity.too.large';
    res.status(400).json({ error: tooBig ? 'Body is larger than 16 KB.' : 'Body is not valid JSON.' });
  });

  // ================================================================ admin
  const admin = express.Router();
  const json = express.json({ limit: '16kb' });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CSV_BYTES, files: 1, fields: 5 } });

  const fail = (res, where, err) => {
    log().error(errInfo(err), `[ponytail ${where}]`);
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  };

  // ---- keys
  admin.get('/tokens', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, label, prefix, last4, "createdAt", "lastUsedAt", "revokedAt" FROM ponytail_tokens WHERE "userId"=$1 ORDER BY "revokedAt" NULLS FIRST, "createdAt" DESC',
        [req.user.id]);
      res.json({ tokens: rows.map(tokenOut) });
    } catch (err) { fail(res, 'tokens', err); }
  });

  admin.post('/tokens', json, async (req, res) => {
    try {
      const label = cleanLabel(req.body?.label) || 'Claude Code';
      const active = await pool.query('SELECT COUNT(*) FROM ponytail_tokens WHERE "userId"=$1 AND "revokedAt" IS NULL', [req.user.id]);
      if (Number(active.rows[0].count) >= MAX_ACTIVE_TOKENS) return res.status(400).json({ error: `You already have ${MAX_ACTIVE_TOKENS} keys. Revoke one first.` });
      const k = newToken('pty');
      const { rows } = await pool.query(
        `INSERT INTO ponytail_tokens ("userId", label, "tokenHash", prefix, last4) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, label, prefix, last4, "createdAt", "lastUsedAt", "revokedAt"`,
        [req.user.id, label, k.tokenHash, k.prefix, k.last4]);
      res.status(201).json({ token: k.token, key: tokenOut(rows[0]) }); // the only time the key itself is sent
    } catch (err) { fail(res, 'token create', err); }
  });

  admin.delete('/tokens/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    try {
      const r = await pool.query('UPDATE ponytail_tokens SET "revokedAt"=NOW() WHERE id=$1 AND "userId"=$2 AND "revokedAt" IS NULL', [id, req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (err) { fail(res, 'token revoke', err); }
  });

  // ---- summary: tiles and per-day series for the filters
  admin.get('/summary', async (req, res) => {
    try {
      const { where, params } = taskFilter(req.user.id, req.query);
      const totals = (await pool.query(
        `SELECT COUNT(*) AS tasks, COALESCE(SUM(t.cost),0) AS cost, COALESCE(SUM(${TOKENS_SQL}),0) AS tokens,
                AVG(t.reuse) AS reuse,
                COUNT(*) FILTER (WHERE t.tests ~ 'passed$') AS "testsPassed",
                COUNT(*) FILTER (WHERE t.tests ~ '(passed|failed)$') AS "testsRun"
           FROM ponytail_tasks t WHERE ${where}`, params)).rows[0];
      const days = (await pool.query(
        `SELECT ${DAY_SQL}::text AS day, COUNT(*) AS tasks, SUM(t.cost) AS cost, AVG(t.reuse) AS reuse,
                SUM(t."tokensInput") AS input, SUM(t."tokensOutput") AS output, SUM(t."tokensCacheRead" + t."tokensCacheWrite") AS cache
           FROM ponytail_tasks t WHERE ${where} GROUP BY 1 ORDER BY 1`, params)).rows;
      // Filter choices come from everything this person has, not just the current filter.
      const choices = (await pool.query(
        `SELECT ARRAY(SELECT DISTINCT project FROM ponytail_tasks WHERE "userId"=$1 AND project<>'' ORDER BY 1) AS projects,
                ARRAY(SELECT DISTINCT model FROM ponytail_tasks WHERE "userId"=$1 AND model<>'' ORDER BY 1) AS models,
                (SELECT COUNT(*) FROM ponytail_tasks WHERE "userId"=$1) AS "allTasks"`, [req.user.id])).rows[0];
      const tasks = Number(totals.tasks);
      res.json({
        totals: {
          tasks, cost: Number(totals.cost), avgCost: tasks ? Number(totals.cost) / tasks : 0, tokens: Number(totals.tokens),
          avgReuse: n(totals.reuse), testsPassed: Number(totals.testsPassed), testsRun: Number(totals.testsRun),
        },
        days: days.map((d) => ({ day: d.day, tasks: Number(d.tasks), cost: Number(d.cost), reuse: n(d.reuse), input: Number(d.input), output: Number(d.output), cache: Number(d.cache) })),
        projects: choices.projects, models: choices.models, allTasks: Number(choices.allTasks),
      });
    } catch (err) { fail(res, 'summary', err); }
  });

  // ---- code written per day (changelog_entries) next to that day's Ponytail cost and reuse. Matched by day, not commit by commit.
  admin.get('/code-written', async (req, res) => {
    try {
      const { from, to } = req.query;
      const params = [];
      const where = [`subject NOT ILIKE 'Changelog:%'`];
      if (DAY_RE.test(String(from || ''))) { params.push(from); where.push(`"committedAt" >= ($${params.length}::date)::timestamp AT TIME ZONE '${TZ}'`); }
      if (DAY_RE.test(String(to || ''))) { params.push(to); where.push(`"committedAt" < ($${params.length}::date + 1)::timestamp AT TIME ZONE '${TZ}'`); }
      const commits = (await pool.query(
        `SELECT ("committedAt" AT TIME ZONE '${TZ}')::date::text AS day, COUNT(*) AS commits,
                COALESCE(SUM(insertions),0) AS insertions, COALESCE(SUM(deletions),0) AS deletions
           FROM changelog_entries WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY 1`, params)).rows;
      const f = taskFilter(req.user.id, { from, to });
      const tasks = (await pool.query(
        `SELECT ${DAY_SQL}::text AS day, COUNT(*) AS tasks, SUM(t.cost) AS cost, AVG(t.reuse) AS reuse
           FROM ponytail_tasks t WHERE ${f.where} GROUP BY 1`, f.params)).rows;
      const byDay = new Map();
      const get = (day) => byDay.get(day) || byDay.set(day, { day, commits: 0, insertions: 0, deletions: 0, tasks: 0, cost: 0, reuse: null }).get(day);
      for (const c of commits) Object.assign(get(c.day), { commits: Number(c.commits), insertions: Number(c.insertions), deletions: Number(c.deletions) });
      for (const t of tasks) Object.assign(get(t.day), { tasks: Number(t.tasks), cost: Number(t.cost), reuse: n(t.reuse) });
      res.json({ days: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)) });
    } catch (err) { fail(res, 'code written', err); }
  });

  // ---- CSV backfill
  admin.post('/import', (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is larger than 2 MB.' : 'Could not read that upload.' });
    next();
  }), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a .csv file.' });
    const { tasks, problems } = parseCsv(req.file.buffer.toString('utf8'));
    if (!tasks.length) return res.status(400).json({ error: problems[0]?.reason || 'No tasks in that file.', problems: problems.slice(0, 50) });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      let added = 0; let updated = 0; let kept = 0;
      for (const t of tasks) {
        const { rows } = await db.query(CSV_UPSERT, taskValues(req.user.id, t));
        if (!rows.length) kept += 1; else if (rows[0].inserted) added += 1; else updated += 1;
      }
      await db.query('COMMIT');
      res.json({ added, updated, kept, skipped: problems.length, problems: problems.slice(0, 50) });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      fail(res, 'import', err);
    } finally { db.release(); }
  });

  // ---- tasks (named routes above, /:id last)
  admin.get('/tasks', async (req, res) => {
    try {
      const { where, params } = taskFilter(req.user.id, req.query);
      const sort = SORTS[req.query.sort] || SORTS.started;
      const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
      const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
      const total = Number((await pool.query(`SELECT COUNT(*) FROM ponytail_tasks t WHERE ${where}`, params)).rows[0].count);
      const { rows } = await pool.query(
        `SELECT t.* FROM ponytail_tasks t WHERE ${where} ORDER BY ${sort} ${dir} NULLS LAST, t.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params);
      res.json({ tasks: rows.map(taskOut), total, page, pageSize: PAGE_SIZE });
    } catch (err) { fail(res, 'tasks', err); }
  });

  admin.get('/tasks/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    try {
      const { rows } = await pool.query('SELECT * FROM ponytail_tasks WHERE id=$1 AND "userId"=$2', [id, req.user.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json({ task: taskOut(rows[0]) });
    } catch (err) { fail(res, 'task', err); }
  });

  admin.delete('/tasks/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const { rows } = await db.query('SELECT * FROM ponytail_tasks WHERE id=$1 AND "userId"=$2 FOR UPDATE', [id, req.user.id]);
      if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
      const t = rows[0];
      const binId = await bin.moveToBin(db, {
        userId: req.user.id, type: 'ponytail-task', id,
        title: t.name || `Ponytail task ${t.key}`, detail: `${t.project || 'no project'} · $${Number(t.cost).toFixed(2)} · Ponytail`,
        payload: { task: t },
      });
      await db.query('DELETE FROM ponytail_tasks WHERE id=$1 AND "userId"=$2', [id, req.user.id]);
      await db.query('COMMIT');
      res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      fail(res, 'task delete', err);
    } finally { db.release(); }
  });

  return { ingest, admin };
}

module.exports = { createRouters, taskFilter, TOKEN_RE, PAGE_SIZE };
