'use strict';

const { pool } = require('../db');
const { runLighthousePair } = require('./htmlLighthouse');
const { captureIf, makeFingerprint } = require('./SuggestionService');

function parseJson(val) {
  if (val == null) return {};
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return val;
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function rowToAudit(row) {
  const report = parseJson(row.report);
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    hostname: hostnameOf(row.url),
    score: Number(row.score),
    summary: row.summary || report.summary || '',
    strategy: row.strategy || report.strategy || 'both',
    report,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listAudits(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, url, score, summary, strategy, "createdAt", "updatedAt"
       FROM html_audits
      WHERE "userId"=$1
      ORDER BY "updatedAt" DESC
      LIMIT 80`,
    [userId]
  );
  return rows.map((r) => rowToAudit(r));
}

async function getAudit(userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM html_audits WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  if (!rows[0]) return null;
  return rowToAudit(rows[0]);
}

async function deleteAudit(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM html_audits WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowCount > 0;
}

async function createAudit(userId, { url, name } = {}) {
  const report = await runLighthousePair(url);
  const host = hostnameOf(report.finalUrl || url);
  const projectName = String(name || '').trim() || host;

  const { rows } = await pool.query(
    `INSERT INTO html_audits ("userId", name, url, score, summary, strategy, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      projectName.slice(0, 80),
      report.finalUrl || url,
      report.score,
      report.summary,
      'both',
      JSON.stringify(report),
    ]
  );
  const audit = rowToAudit(rows[0]);
  await captureIf(audit.score < 50, {
    userId,
    source: 'html',
    category: 'alert',
    fingerprint: makeFingerprint('html', `weak-lighthouse:${audit.id}`),
    title: `HTML Lighthouse scored ${audit.score} for ${host}`,
    body: audit.summary,
    context: `/html/${audit.id}`,
  });
  return audit;
}

module.exports = { listAudits, getAudit, createAudit, deleteAudit };
