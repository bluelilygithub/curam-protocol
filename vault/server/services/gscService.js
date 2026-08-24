'use strict';

const { google } = require('googleapis');
const { pool } = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');
const { captureIf, makeFingerprint } = require('./SuggestionService');

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function getOAuth2Client() {
  const appUrl = String(process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const redirect = String(process.env.GSC_REDIRECT_URI || `${appUrl}/api/gsc/callback`).trim();
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirect,
  );
}

async function getAuthClient(userId) {
  const { rows } = await pool.query('SELECT * FROM gsc_tokens WHERE "userId"=$1', [userId]);
  if (!rows[0]) throw new Error('Search Console is not connected');
  const row = rows[0];
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decrypt(row.accessToken),
    refresh_token: row.refreshToken ? decrypt(row.refreshToken) : undefined,
    token_type: row.tokenType || 'Bearer',
    expiry_date: row.expiryDate ? Number(row.expiryDate) : undefined,
    scope: row.scope || undefined,
  });
  oauth2Client.on('tokens', (tokens) => {
    const access = tokens.access_token ? encrypt(tokens.access_token) : row.accessToken;
    const expiry = tokens.expiry_date || row.expiryDate;
    pool.query(
      `UPDATE gsc_tokens SET "accessToken"=$1, "expiryDate"=$2, "updatedAt"=NOW() WHERE "userId"=$3`,
      [access, expiry, userId],
    ).catch(() => {});
  });
  return oauth2Client;
}

function client(auth) {
  return google.searchconsole({ version: 'v1', auth });
}

function cannibalisation(rows) {
  const byQuery = new Map();
  for (const r of rows || []) {
    const query = r.keys?.[0] || '';
    const page = r.keys?.[1] || '';
    if (!query || !page) continue;
    if (!byQuery.has(query)) byQuery.set(query, []);
    byQuery.get(query).push({
      page,
      clicks: Number(r.clicks) || 0,
      impressions: Number(r.impressions) || 0,
      position: r.position != null ? Number(r.position) : null,
    });
  }
  return [...byQuery.entries()]
    .map(([query, pages]) => ({
      query,
      pages: pages.sort((a, b) => b.impressions - a.impressions),
    }))
    .filter((row) => row.pages.length > 1)
    .sort((a, b) => (b.pages[0].impressions + (b.pages[1]?.impressions || 0)) - (a.pages[0].impressions + (a.pages[1]?.impressions || 0)))
    .slice(0, 20);
}

async function listSites(userId) {
  const auth = await getAuthClient(userId);
  const sc = client(auth);
  const res = await sc.sites.list();
  const list = (res.data.siteEntry || []).map((s) => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel,
  }));
  await captureIf(list.length === 0, {
    userId,
    source: 'searchConsole',
    category: 'alert',
    fingerprint: makeFingerprint('searchConsole', `no-sites:${userId}`),
    title: 'Search Console has no properties',
    body: 'This Google account is connected but has no Search Console sites. Add the property in Google Search Console, then load 28 days again.',
    context: '/search-console',
  });
  return list;
}

async function fetchSnapshot(userId, siteUrl) {
  const auth = await getAuthClient(userId);
  const sc = client(auth);
  const endDate = isoDaysAgo(3);
  const startDate = isoDaysAgo(31);
  const mapRows = (rows) => (rows || []).map((r) => ({
    keys: r.keys || [],
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    ctr: r.ctr != null ? Number(r.ctr) : 0,
    position: r.position != null ? Number(r.position) : null,
  }));

  const [queries, pages, qp] = await Promise.all([
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 25 },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ['page'], rowLimit: 25 },
    }),
    sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ['query', 'page'], rowLimit: 200 },
    }),
  ]);

  const report = {
    siteUrl,
    startDate,
    endDate,
    queries: mapRows(queries.data.rows).map((r) => ({ query: r.keys[0], ...r })),
    pages: mapRows(pages.data.rows).map((r) => ({ page: r.keys[0], ...r })),
    cannibalisation: cannibalisation(qp.data.rows),
    summary: `Search Console ${startDate} to ${endDate} · ${siteUrl}`,
  };

  await pool.query(
    `INSERT INTO gsc_snapshots ("userId", "siteUrl", report)
     VALUES ($1, $2, $3)`,
    [userId, siteUrl, JSON.stringify(report)],
  );
  return report;
}

async function latestSnapshot(userId) {
  const { rows } = await pool.query(
    `SELECT report, "createdAt" FROM gsc_snapshots WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
    [userId],
  );
  if (!rows[0]) return null;
  const report = typeof rows[0].report === 'string' ? JSON.parse(rows[0].report) : rows[0].report;
  return { ...report, fetchedAt: rows[0].createdAt };
}

module.exports = {
  getOAuth2Client,
  listSites,
  fetchSnapshot,
  latestSnapshot,
};
