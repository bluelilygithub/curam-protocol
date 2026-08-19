'use strict';

const { pool } = require('../../db');
const { scrapeSite } = require('./siteScraper');
const { generateGoogleAdsKeywords, getSeoStatus } = require('./googleAdsKeywords');
const { capture, captureIf, makeFingerprint } = require('../SuggestionService');

const ARTIFACT_KIND = 'google_ads_keywords';

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function rowToProject(row, artifact = null) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    notes: row.notes || '',
    siteSnapshot: parseJsonField(row.siteSnapshot) || {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    googleAdsKeywords: artifact ? parseJsonField(artifact.payload) : null,
  };
}

async function listProjects(userId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.url, p.notes, p."createdAt", p."updatedAt",
            a.id AS "artifactId", a."updatedAt" AS "keywordsAt"
       FROM seo_projects p
  LEFT JOIN seo_artifacts a
         ON a."projectId" = p.id AND a.kind = $2
      WHERE p."userId" = $1
      ORDER BY p."updatedAt" DESC, p.id DESC`,
    [userId, ARTIFACT_KIND]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    notes: r.notes || '',
    hostname: hostnameOf(r.url),
    hasKeywords: Boolean(r.artifactId),
    keywordsAt: r.keywordsAt || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function getProject(userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM seo_projects WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  if (!rows[0]) return null;
  const { rows: arts } = await pool.query(
    `SELECT * FROM seo_artifacts WHERE "projectId"=$1 AND "userId"=$2 AND kind=$3`,
    [id, userId, ARTIFACT_KIND]
  );
  return rowToProject(rows[0], arts[0] || null);
}

async function updateProject(userId, id, { name, notes } = {}) {
  const existing = await getProject(userId, id);
  if (!existing) return null;
  const nextName = name != null ? String(name).trim().slice(0, 120) : existing.name;
  const nextNotes = notes != null ? String(notes).slice(0, 2000) : existing.notes;
  const { rows } = await pool.query(
    `UPDATE seo_projects SET name=$3, notes=$4, "updatedAt"=NOW()
      WHERE id=$1 AND "userId"=$2
      RETURNING *`,
    [id, userId, nextName || existing.name, nextNotes]
  );
  return getProject(userId, rows[0].id);
}

async function deleteProject(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM seo_projects WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowCount > 0;
}

async function saveArtifact(userId, projectId, payload) {
  await pool.query(
    `INSERT INTO seo_artifacts ("projectId", "userId", kind, payload, "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT ("projectId", kind)
     DO UPDATE SET payload = EXCLUDED.payload, "updatedAt" = NOW()`,
    [projectId, userId, ARTIFACT_KIND, JSON.stringify(payload)]
  );
  await pool.query(
    `UPDATE seo_projects SET "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`,
    [projectId, userId]
  );
}

async function reportKeywordGaps(userId, projectId, snapshot, payload) {
  await captureIf(!snapshot?.text || snapshot.charCount < 400, {
    userId,
    source: 'seo',
    category: 'alert',
    fingerprint: makeFingerprint('seo', `thin-scrape:${projectId}`),
    title: 'SEO scrape returned little text',
    body: `Project ${projectId} scraped only ${snapshot?.charCount || 0} characters. Keyword lists may be generic. Try a different URL (homepage or services page) or a site that is not heavily JavaScript-rendered.`,
    context: `/seo/${projectId}`,
  });
  const kw = payload?.counts?.keywords || 0;
  const neg = payload?.counts?.negatives || 0;
  await captureIf(kw < 80 || neg < 80, {
    userId,
    source: 'seo',
    category: 'alert',
    fingerprint: makeFingerprint('seo', `short-lists:${projectId}`),
    title: 'SEO keyword lists came in short of 100',
    body: `Google Ads lists for project ${projectId}: ${kw} keywords and ${neg} negatives (target 100 each). Regenerate, or add a notes hint about the offer and location.`,
    context: `/seo/${projectId}`,
  });
}

async function generateKeywordsForProject(userId, projectId) {
  const project = await getProject(userId, projectId);
  if (!project) throw new Error('Project not found');
  const snapshot = project.siteSnapshot;
  if (!snapshot?.text) throw new Error('No scraped site content — recreate the project with a URL');
  const payload = await generateGoogleAdsKeywords(userId, snapshot, { notes: project.notes });
  await saveArtifact(userId, projectId, payload);
  await reportKeywordGaps(userId, projectId, snapshot, payload);
  return getProject(userId, projectId);
}

async function createProject(userId, { url, name, notes } = {}) {
  if (!url || typeof url !== 'string') throw new Error('url is required');
  const snapshot = await scrapeSite(url);
  const displayName = (name && String(name).trim())
    || snapshot.title
    || hostnameOf(snapshot.finalUrl || snapshot.url)
    || 'SEO project';

  const { rows } = await pool.query(
    `INSERT INTO seo_projects ("userId", name, url, notes, "siteSnapshot")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      userId,
      String(displayName).slice(0, 120),
      snapshot.finalUrl || snapshot.url,
      String(notes || '').slice(0, 2000),
      JSON.stringify(snapshot),
    ]
  );
  const projectId = rows[0].id;

  let keywordError = null;
  try {
    const payload = await generateGoogleAdsKeywords(userId, snapshot, { notes });
    await saveArtifact(userId, projectId, payload);
    await reportKeywordGaps(userId, projectId, snapshot, payload);
  } catch (err) {
    keywordError = err.message;
    await capture({
      userId,
      source: 'seo',
      category: 'alert',
      fingerprint: makeFingerprint('seo', `generate-failed:${projectId}`),
      title: 'SEO keywords failed after scrape',
      body: `Site scraped for ${snapshot.finalUrl || snapshot.url}, but keyword generation failed: ${err.message}. Open the project and tap Generate keywords.`,
      context: `/seo/${projectId}`,
    });
  }

  const project = await getProject(userId, projectId);
  if (!project) throw new Error('Project was not saved');
  if (keywordError) project.keywordError = keywordError;
  return project;
}

module.exports = {
  ARTIFACT_KIND,
  getSeoStatus,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  generateKeywordsForProject,
};
