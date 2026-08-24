'use strict';

const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth, requireFeature } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');
const {
  getOAuth2Client,
  listSites,
  fetchSnapshot,
  latestSnapshot,
} = require('../services/gscService');

router.use((req, res, next) => {
  if (req.path === '/callback') return next();
  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    return requireFeature('searchConsole')(req, res, next);
  });
});

router.get('/status', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.json({ connected: false, configured: false, email: null });
  }
  try {
    const { rows } = await pool.query('SELECT email FROM gsc_tokens WHERE "userId"=$1', [req.user.id]);
    res.json({
      connected: !!rows[0],
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      email: rows[0]?.email || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/auth', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({ error: 'Google OAuth is not configured (GOOGLE_CLIENT_ID / SECRET).' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const returnTo = '/search-console';
  try {
    await pool.query(
      'INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3)',
      [req.user.id, `gsc_oauth_state_${state}`, JSON.stringify({ userId: req.user.id, expiresAt, returnTo })],
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
  res.json({ authUrl });
});

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const appUrl = String(process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  if (error) return res.redirect(`${appUrl}/search-console?gscError=${encodeURIComponent(error)}`);
  if (!code || !state) return res.redirect(`${appUrl}/search-console?gscError=missing_params`);
  const stateKey = `gsc_oauth_state_${state}`;
  try {
    const { rows: stateRows } = await pool.query('SELECT value FROM settings WHERE key=$1', [stateKey]);
    if (!stateRows[0]) return res.redirect(`${appUrl}/search-console?gscError=invalid_state`);
    const parsed = JSON.parse(stateRows[0].value);
    const userId = parsed.userId;
    if (new Date(parsed.expiresAt) < new Date()) {
      await pool.query('DELETE FROM settings WHERE key=$2 AND "userId"=$1', [userId, stateKey]);
      return res.redirect(`${appUrl}/search-console?gscError=state_expired`);
    }
    await pool.query('DELETE FROM settings WHERE key=$2 AND "userId"=$1', [userId, stateKey]);
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2Api.userinfo.get();
    const email = userInfo.data.email;
    const { rows: existing } = await pool.query('SELECT id, "refreshToken" FROM gsc_tokens WHERE "userId"=$1', [userId]);
    if (existing[0]) {
      const existingRefresh = decrypt(existing[0].refreshToken);
      await pool.query(
        `UPDATE gsc_tokens SET "accessToken"=$1, "refreshToken"=$2, "expiryDate"=$3, scope=$4, email=$5, "updatedAt"=NOW() WHERE "userId"=$6`,
        [
          encrypt(tokens.access_token),
          encrypt(tokens.refresh_token || existingRefresh),
          tokens.expiry_date || null,
          tokens.scope || null,
          email,
          userId,
        ],
      );
    } else {
      await pool.query(
        'INSERT INTO gsc_tokens ("userId", "accessToken", "refreshToken", "tokenType", "expiryDate", scope, email) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          userId,
          encrypt(tokens.access_token),
          tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          tokens.token_type || 'Bearer',
          tokens.expiry_date || null,
          tokens.scope || null,
          email,
        ],
      );
    }
    res.redirect(`${appUrl}/search-console?gscConnected=1`);
  } catch (err) {
    console.error('[gsc] OAuth callback', err.message);
    res.redirect(`${appUrl}/search-console?gscError=${encodeURIComponent(err.message)}`);
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    await pool.query('DELETE FROM gsc_tokens WHERE "userId"=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sites', async (req, res) => {
  try {
    res.json(await listSites(req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/snapshot', async (req, res) => {
  try {
    res.json(await latestSnapshot(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshot', async (req, res) => {
  try {
    const siteUrl = String(req.body?.siteUrl || '').trim();
    if (!siteUrl) return res.status(400).json({ error: 'Choose a Search Console property' });
    res.json(await fetchSnapshot(req.user.id, siteUrl));
  } catch (err) {
    console.error('[gsc] snapshot', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
