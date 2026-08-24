'use strict';

const { pool } = require('../../db');
const { scrapeSite, assertUsableScrape } = require('./siteScraper');
const { fetchHtml, normaliseHttpUrl } = require('../htmlFetch');
const { buildSeoAudit } = require('./seoAuditEngine');
const { captureIf, makeFingerprint } = require('../SuggestionService');

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
    report,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function fetchRobotsTxt(pageUrl) {
  try {
    const origin = new URL(normaliseHttpUrl(pageUrl)).origin;
    const { body, statusCode } = await fetchHtml(`${origin}/robots.txt`, 3, 8000);
    const text = String(body || '');
    return { ok: statusCode < 400 && text.trim().length > 0, statusCode, body: text.slice(0, 8000) };
  } catch (err) {
    return { ok: false, statusCode: 0, body: '', error: err.message };
  }
}

async function listAudits(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, url, score, summary, "createdAt", "updatedAt"
       FROM seo_audits
      WHERE "userId"=$1
      ORDER BY "updatedAt" DESC
      LIMIT 80`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    hostname: hostnameOf(r.url),
    score: Number(r.score),
    summary: r.summary || '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function getAudit(userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM seo_audits WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  if (!rows[0]) return null;
  return rowToAudit(rows[0]);
}

async function deleteAudit(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM seo_audits WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowCount > 0;
}

async function createAudit(userId, { url, name } = {}) {
  const snapshot = await scrapeSite(url, { includeHtml: true });
  assertUsableScrape(snapshot);
  const robots = await fetchRobotsTxt(snapshot.finalUrl || snapshot.url);
  const html = snapshot.html || '';
  delete snapshot.html;
  const built = buildSeoAudit({ snapshot, html, robots });

  const title = snapshot.title || hostnameOf(snapshot.finalUrl || url) || 'SEO audit';
  const projectName = String(name || '').trim() || title.slice(0, 80);

  const { rows } = await pool.query(
    `INSERT INTO seo_audits ("userId", name, url, score, summary, snapshot, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      projectName,
      snapshot.finalUrl || snapshot.url,
      built.score,
      built.summary,
      JSON.stringify(snapshot),
      JSON.stringify(built),
    ]
  );

  const audit = rowToAudit(rows[0]);
  const fails = (built.findings || []).filter((f) => f.severity === 'fail').length;
  await captureIf(fails >= 3 || built.score < 50, {
    userId,
    source: 'seo',
    category: 'alert',
    fingerprint: makeFingerprint('seo', `weak-audit:${audit.id}`),
    title: `SEO audit scored ${built.score} for ${audit.hostname || audit.url}`,
    body: `${fails} failing checks. Open SEO to review title, headings, and indexability.`,
    context: `/seo/${audit.id}`,
  });
  return audit;
}

module.exports = { listAudits, getAudit, createAudit, deleteAudit };
