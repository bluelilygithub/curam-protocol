'use strict';

const { pool } = require('../../db');
const { scrapeSite, scrapeConflictsWithOffer } = require('./siteScraper');
const { generateGoogleAdsKeywords, getSeoStatus } = require('./googleAdsKeywords');
const { generateGoogleAdsCopy, reportCopyGaps } = require('./googleAdsCopy');
const { capture, captureIf, makeFingerprint } = require('../SuggestionService');

const KEYWORD_KIND = 'google_ads_keywords';
const COPY_KIND = 'google_ads_copy';

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function artifactsByKind(rows) {
  const out = {};
  for (const row of rows || []) {
    out[row.kind] = parseJsonField(row.payload);
  }
  return out;
}

function rowToProject(row, artifactRows = []) {
  if (!row) return null;
  const byKind = artifactsByKind(artifactRows);
  const siteSnapshot = parseJsonField(row.siteSnapshot) || {};
  const offer = row.offer || '';
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    notes: row.notes || '',
    offer,
    scrapeMismatch: scrapeConflictsWithOffer(siteSnapshot, offer),
    siteSnapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    googleAdsKeywords: byKind[KEYWORD_KIND] || null,
    googleAdsCopy: byKind[COPY_KIND] || null,
  };
}

async function listProjects(userId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.url, p.notes, p."createdAt", p."updatedAt",
            k.id AS "keywordId", k."updatedAt" AS "keywordsAt",
            c.id AS "copyId", c."updatedAt" AS "adsAt"
       FROM seo_projects p
  LEFT JOIN seo_artifacts k
         ON k."projectId" = p.id AND k.kind = $2
  LEFT JOIN seo_artifacts c
         ON c."projectId" = p.id AND c.kind = $3
      WHERE p."userId" = $1
      ORDER BY p."updatedAt" DESC, p.id DESC`,
    [userId, KEYWORD_KIND, COPY_KIND]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    notes: r.notes || '',
    hostname: hostnameOf(r.url),
    hasKeywords: Boolean(r.keywordId),
    hasAds: Boolean(r.copyId),
    keywordsAt: r.keywordsAt || null,
    adsAt: r.adsAt || null,
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
    `SELECT * FROM seo_artifacts WHERE "projectId"=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowToProject(rows[0], arts);
}

async function updateProject(userId, id, { name, notes, offer } = {}) {
  const existing = await getProject(userId, id);
  if (!existing) return null;
  const nextName = name != null ? String(name).trim().slice(0, 120) : existing.name;
  const nextNotes = notes != null ? String(notes).slice(0, 2000) : existing.notes;
  const nextOffer = offer != null ? String(offer).slice(0, 500) : existing.offer;
  const { rows } = await pool.query(
    `UPDATE seo_projects SET name=$3, notes=$4, offer=$5, "updatedAt"=NOW()
      WHERE id=$1 AND "userId"=$2
      RETURNING *`,
    [id, userId, nextName || existing.name, nextNotes, nextOffer]
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

async function saveArtifact(userId, projectId, kind, payload) {
  await pool.query(
    `INSERT INTO seo_artifacts ("projectId", "userId", kind, payload, "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT ("projectId", kind)
     DO UPDATE SET payload = EXCLUDED.payload, "updatedAt" = NOW()`,
    [projectId, userId, kind, JSON.stringify(payload)]
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
  const payload = await generateGoogleAdsKeywords(userId, snapshot, {
    notes: project.notes,
    offer: project.offer,
  });
  await saveArtifact(userId, projectId, KEYWORD_KIND, payload);
  await reportKeywordGaps(userId, projectId, snapshot, payload);
  return getProject(userId, projectId);
}

async function generateAdsForProject(userId, projectId, { format } = {}) {
  const project = await getProject(userId, projectId);
  if (!project) throw new Error('Project not found');
  const snapshot = project.siteSnapshot;
  if (!snapshot?.text) throw new Error('No scraped site content — recreate the project with a URL');
  const kw = project.googleAdsKeywords || {};
  const payload = await generateGoogleAdsCopy(userId, snapshot, {
    notes: project.notes,
    offer: project.offer,
    keywords: kw.keywords || [],
    business: project.offer || kw.business || '',
    geo: kw.geo || '',
    format,
  });
  await saveArtifact(userId, projectId, COPY_KIND, payload);
  await reportCopyGaps(userId, projectId, payload);
  return getProject(userId, projectId);
}

async function createProject(userId, { url, name, notes, offer } = {}) {
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (!String(offer || '').trim()) {
    throw new Error('Say what they sell — keyword lists follow the offer, not a conflicting page scrape');
  }
  const snapshot = await scrapeSite(url);
  const offerText = String(offer || '').slice(0, 500);
  const displayName = (name && String(name).trim())
    || (offerText ? offerText.slice(0, 80) : '')
    || snapshot.title
    || hostnameOf(snapshot.finalUrl || snapshot.url)
    || 'SEO project';

  const { rows } = await pool.query(
    `INSERT INTO seo_projects ("userId", name, url, notes, offer, "siteSnapshot")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      userId,
      String(displayName).slice(0, 120),
      snapshot.finalUrl || snapshot.url,
      String(notes || '').slice(0, 2000),
      offerText,
      JSON.stringify(snapshot),
    ]
  );
  const projectId = rows[0].id;

  let keywordError = null;
  let adsError = null;
  let keywordPayload = null;
  try {
    keywordPayload = await generateGoogleAdsKeywords(userId, snapshot, { notes, offer: offerText });
    await saveArtifact(userId, projectId, KEYWORD_KIND, keywordPayload);
    await reportKeywordGaps(userId, projectId, snapshot, keywordPayload);
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

  try {
    const copyPayload = await generateGoogleAdsCopy(userId, snapshot, {
      notes,
      offer: offerText,
      keywords: keywordPayload?.keywords || [],
      business: offerText || keywordPayload?.business || '',
      geo: keywordPayload?.geo || '',
    });
    await saveArtifact(userId, projectId, COPY_KIND, copyPayload);
    await reportCopyGaps(userId, projectId, copyPayload);
  } catch (err) {
    adsError = err.message;
    await capture({
      userId,
      source: 'seo',
      category: 'alert',
      fingerprint: makeFingerprint('seo', `ads-failed:${projectId}`),
      title: 'SEO ad copy failed after scrape',
      body: `Keywords may be ready for ${snapshot.finalUrl || snapshot.url}, but RSA copy failed: ${err.message}. Open the project and tap Generate ads.`,
      context: `/seo/${projectId}`,
    });
  }

  const project = await getProject(userId, projectId);
  if (!project) throw new Error('Project was not saved');
  if (keywordError) project.keywordError = keywordError;
  if (adsError) project.adsError = adsError;
  return project;
}

module.exports = {
  KEYWORD_KIND,
  COPY_KIND,
  getSeoStatus,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  generateKeywordsForProject,
  generateAdsForProject,
};
