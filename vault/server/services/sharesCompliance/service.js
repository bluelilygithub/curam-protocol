'use strict';

/**
 * Shares Compliance Advisory orchestration and storage.
 *
 * A run reads the fixed ATO allow-list politely, asks the configured standard text model for a short summary
 * tied to those snapshots, and saves one report row per admin (so each admin owns and can delete their own
 * history). A force answers 202 with a 'running' row; the page polls GET /reports/:id. The scheduled run uses
 * the same code under withCronLock. Model/source failures degrade to a partial or unavailable report rather
 * than an empty screen. See docs/shares-compliance.md.
 */

const crypto = require('crypto');
const { fetchSources: defaultFetchSources, sha256 } = require('./fetchSources');
const { sourcesForRun } = require('./sources');
const { SYSTEM_PROMPT, buildPrompt, parseModelJson } = require('./prompt');
const { buildReport, markdownFor } = require('./report');
const { assertWithinCap, FEATURE } = require('./spend');

const REPORT_COLUMNS = `id, "userId", status, "trigger", "modelId", summary, report, markdown,
  "contentHash", error, "createdAt", "updatedAt"`;

let activeRun = null;

function contentHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function shortError(err) {
  return String(err?.message || err || 'Unknown error').replace(/\s+/g, ' ').trim().slice(0, 300);
}

// Same preference order as modelResolver.pickTextModel, kept local so a unit test never has to load the
// settings/database stack. The model IDs themselves still come from getModelsForUser().
function pickTextModel(tiers, prefer = 'standard') {
  const t = tiers || {};
  const chain = prefer === 'light'
    ? [t.light, t.standard, t.gemini, t.deepseek, t.ollama]
    : [t.standard, t.light, t.gemini, t.deepseek, t.ollama];
  return chain.find(Boolean) || null;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToPublic(row, sources) {
  if (!row) return null;
  const out = {
    id: Number(row.id),
    userId: Number(row['userId']),
    status: row.status || 'done',
    trigger: row.trigger || 'manual',
    modelId: row.modelId || '',
    summary: row.summary || '',
    report: parseJson(row.report, {}),
    markdown: row.markdown || '',
    contentHash: row.contentHash || '',
    error: row.error || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (sources !== undefined) out.sources = sources;
  return out;
}

function beginGuard() {
  if (activeRun) return null;
  activeRun = Symbol('shares-compliance-run');
  return activeRun;
}

function endGuard(token) {
  if (activeRun === token) activeRun = null;
}

async function insertRunningReports(db, userIds, trigger, startedAt) {
  const rows = [];
  for (const userId of userIds) {
    const { rows: inserted } = await db.query(
      `INSERT INTO shares_compliance_reports ("userId", status, "trigger", "modelId", summary, report, markdown, "contentHash", error)
       VALUES ($1, 'running', $2, '', '', '{}'::jsonb, '', '', '')
       RETURNING ${REPORT_COLUMNS}`,
      [userId, trigger]
    );
    rows.push(inserted[0]);
  }
  return rows;
}

async function saveSources(db, reportIds, sources, userId) {
  for (const reportId of reportIds) {
    for (const s of sources) {
      await db.query(
        `INSERT INTO shares_compliance_sources
           ("reportId", "userId", "sourceId", label, url, "finalUrl", status, reason, hash, title, excerpt, "fetchedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz)`,
        [reportId, userId, String(s.sourceId || ''), String(s.label || '').slice(0, 200), String(s.url || ''),
          String(s.finalUrl || ''), String(s.status || 'unavailable'), String(s.reason || '').slice(0, 240),
          String(s.hash || ''), String(s.title || '').slice(0, 200), String(s.excerpt || '').slice(0, 1200),
          s.fetchedAt || null]
      );
    }
  }
}

async function performRun({ rows, userId, trigger, startedAt, deps }) {
  const {
    pool, callModel, resolveModel, logUsage, fetchSources, fetchSourcesDeps, env, pickTextModel,
  } = deps;
  let snapshots = [];
  let ai = null;
  let aiError = '';
  let modelId = '';

  try {
    snapshots = await fetchSources({ sources: sourcesForRun(), ...fetchSourcesDeps });
  } catch (err) {
    aiError = `The ATO pages could not be read: ${shortError(err)}`;
  }

  try {
    const tiers = await resolveModel(userId);
    modelId = String(pickTextModel(tiers, 'standard') || '');
    if (!modelId) throw new Error('No standard text model is configured in Settings → Models.');
    if (!snapshots.some((s) => s.status === 'ok')) throw new Error('No ATO page was readable, so no summary was requested.');

    const result = await callModel(modelId, buildPrompt(snapshots), {
      maxTokens: 1800,
      system: SYSTEM_PROMPT,
      returnUsage: true,
      timeoutMs: 90000,
    });
    const text = typeof result === 'string' ? result : String(result?.text || '');
    ai = parseModelJson(text);
    if (!ai) aiError = 'The model reply could not be read as a report.';
    const inputTokens = Number(result?.inputTokens) || 0;
    const outputTokens = Number(result?.outputTokens) || 0;
    if (inputTokens || outputTokens) {
      await logUsage({ userId, model: modelId, inputTokens, outputTokens, feature: FEATURE });
    }
  } catch (err) {
    aiError = `The model summary was unavailable: ${shortError(err)}`;
  }

  const report = buildReport({ snapshots, ai, generatedAt: startedAt, trigger, modelId, aiError });
  const markdown = markdownFor(report);
  const hash = contentHash(markdown);
  const ids = rows.map((r) => Number(r.id));

  await pool.query(
    `UPDATE shares_compliance_reports
        SET status='done', "modelId"=$2, summary=$3, report=$4::jsonb, markdown=$5,
            "contentHash"=$6, error=$7, "updatedAt"=NOW()
      WHERE id = ANY($1::int[])`,
    [ids, modelId, report.summary, JSON.stringify(report), markdown, hash, aiError.slice(0, 300)]
  );
  await saveSources(pool, ids, snapshots.map((s) => ({ ...s, hash: s.hash || sha256(s.excerpt || '') })), userId);
  return report;
}

async function markFailed(pool, rows, err) {
  const ids = rows.map((r) => Number(r.id));
  try {
    await pool.query(
      `UPDATE shares_compliance_reports
          SET status='failed', error=$2, "updatedAt"=NOW()
        WHERE id = ANY($1::int[])`,
      [ids, shortError(err)]
    );
  } catch (dbErr) {
    console.error('[shares-compliance] could not mark run failed:', dbErr.message);
  }
}

/**
 * Insert one running row per user and run in the background (or inline when background:false, for tests).
 * Exactly one run at a time workspace-wide, so a force cannot stack with the monthly job or another force.
 */
async function startReports({
  userIds = [],
  trigger = 'manual',
  background = true,
  deps = {},
} = {}) {
  const uniqueIds = [...new Set((Array.isArray(userIds) ? userIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniqueIds.length) throw Object.assign(new Error('No admin account is available for this report.'), { status: 400 });

  const token = beginGuard();
  if (!token) throw Object.assign(new Error('A Shares compliance check is already running. Please wait for it to finish.'), { status: 409 });

  const resolved = {
    pool: deps.pool || require('../../db').pool,
    callModel: deps.callModel || ((...args) => require('../callModel').callModel(...args)),
    resolveModel: deps.resolveModel || (async (userId) => require('../modelResolver').getModelsForUser(userId)),
    logUsage: deps.logUsage || (async (entry) => require('../../utils/logUsage').logUsage(entry)),
    pickTextModel: deps.pickTextModel || pickTextModel,
    fetchSources: deps.fetchSources || defaultFetchSources,
    fetchSourcesDeps: deps.fetchSourcesDeps || {},
    env: deps.env || process.env,
    assertCap: deps.assertCap || assertWithinCap,
    now: deps.now || (() => new Date()),
  };

  try {
    await resolved.assertCap(uniqueIds[0], { pool: resolved.pool, env: resolved.env, now: resolved.now() });
    const startedAt = resolved.now().toISOString();
    const rows = await insertRunningReports(resolved.pool, uniqueIds, trigger, startedAt);

    const run = performRun({ rows, userId: uniqueIds[0], trigger, startedAt, deps: resolved })
      .catch((err) => {
        console.error('[shares-compliance] run failed:', err.message);
        return markFailed(resolved.pool, rows, err);
      })
      .finally(() => endGuard(token));

    if (background) setImmediate(() => { void run; });
    else await run;

    return rows.map((r) => rowToPublic(r));
  } catch (err) {
    endGuard(token);
    throw err;
  }
}

async function listReports(userId, { pool = require('../../db').pool } = {}) {
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLUMNS} FROM shares_compliance_reports
      WHERE "userId"=$1 ORDER BY "createdAt" DESC, id DESC LIMIT 100`,
    [userId]
  );
  return rows.map((r) => rowToPublic(r));
}

async function getReport(userId, id, { pool = require('../../db').pool } = {}) {
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLUMNS} FROM shares_compliance_reports WHERE id=$1 AND "userId"=$2`,
    [Number(id) || 0, userId]
  );
  if (!rows[0]) return null;
  const sources = (await pool.query(
    `SELECT id, "sourceId", label, url, "finalUrl", status, reason, hash, title, excerpt, "fetchedAt"
       FROM shares_compliance_sources WHERE "reportId"=$1 AND "userId"=$2 ORDER BY id`,
    [Number(id) || 0, userId]
  )).rows;
  return rowToPublic(rows[0], sources);
}

/** Delete to the shared bin in the same transaction, with the report and its source snapshots for restore. */
async function deleteReport(userId, id, { pool = require('../../db').pool, recycleBin = require('../recycleBin') } = {}) {
  const reportId = Number(id) || 0;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      `SELECT * FROM shares_compliance_reports WHERE id=$1 AND "userId"=$2 FOR UPDATE`,
      [reportId, userId]
    );
    if (!rows[0]) {
      await db.query('ROLLBACK');
      return null;
    }
    const sources = (await db.query(
      'SELECT * FROM shares_compliance_sources WHERE "reportId"=$1 AND "userId"=$2 ORDER BY id',
      [reportId, userId]
    )).rows;
    const binId = await recycleBin.moveToBin(db, {
      userId,
      type: 'shares-compliance-report',
      id: reportId,
      title: 'Shares compliance report',
      detail: `${new Date(rows[0].createdAt).toLocaleDateString('en-AU')} · ${sources.length} source snapshots`,
      payload: { report: rows[0], sources },
    });
    await db.query('DELETE FROM shares_compliance_reports WHERE id=$1 AND "userId"=$2', [reportId, userId]);
    await db.query('COMMIT');
    return { ok: true, binId, retentionDays: recycleBin.RETENTION_DAYS };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

module.exports = {
  startReports, listReports, getReport, deleteReport, rowToPublic,
  REPORT_COLUMNS, FEATURE,
};
