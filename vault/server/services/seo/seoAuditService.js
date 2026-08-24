'use strict';

const { pool } = require('../../db');
const { crawlSite, clampPageLimit } = require('./siteCrawler');
const { buildSiteAudit, buildGlobalUpdates } = require('./seoAuditEngine');
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

function withGlobalUpdates(report) {
  const next = report && typeof report === 'object' ? report : {};
  if (Array.isArray(next.globalUpdates)) return next;
  next.globalUpdates = buildGlobalUpdates(next.pages || [], next.findings || [], {
    crawled: next.crawled,
    discovered: next.discovered,
  });
  return next;
}

function rowToAudit(row) {
  const report = withGlobalUpdates(parseJson(row.report));
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

async function listAudits(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, url, score, summary, report, "createdAt", "updatedAt"
       FROM seo_audits
      WHERE "userId"=$1
      ORDER BY "updatedAt" DESC
      LIMIT 80`,
    [userId]
  );
  return rows.map((r) => {
    const report = parseJson(r.report);
    return {
      id: r.id,
      name: r.name,
      url: r.url,
      hostname: hostnameOf(r.url),
      score: Number(r.score),
      summary: r.summary || '',
      crawled: report.crawled || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
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

async function createAudit(userId, { url, name, pageLimit } = {}) {
  const limit = clampPageLimit(pageLimit);
  const crawl = await crawlSite(url, { pageLimit: limit });
  if (!crawl.pages.length) {
    throw new Error('Could not fetch any pages from that URL.');
  }
  const report = buildSiteAudit({ crawl });
  const home = crawl.pages[0];
  const title = home?.title || hostnameOf(crawl.startUrl) || 'SEO audit';
  const projectName = String(name || '').trim() || title.slice(0, 80);

  const snapshot = {
    startUrl: crawl.startUrl,
    pageLimit: crawl.pageLimit,
    crawled: crawl.crawled,
    discovered: crawl.discovered,
    robotsStatus: crawl.robots?.statusCode || 0,
    urls: crawl.pages.map((p) => p.url),
  };

  const { rows } = await pool.query(
    `INSERT INTO seo_audits ("userId", name, url, score, summary, snapshot, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      projectName,
      crawl.startUrl,
      report.score,
      report.summary,
      JSON.stringify(snapshot),
      JSON.stringify(report),
    ]
  );

  const audit = rowToAudit(rows[0]);
  const fails = (report.allRecommendations || []).filter((r) => r.severity === 'fail').length;
  await captureIf(fails >= 5 || report.score < 50, {
    userId,
    source: 'seo',
    category: 'alert',
    fingerprint: makeFingerprint('seo', `weak-audit:${audit.id}`),
    title: `SEO audit scored ${report.score} for ${audit.hostname || audit.url}`,
    body: `Crawled ${report.crawled} pages with ${fails} failing recommendations.`,
    context: `/seo/${audit.id}`,
  });
  return audit;
}

module.exports = { listAudits, getAudit, createAudit, deleteAudit };
