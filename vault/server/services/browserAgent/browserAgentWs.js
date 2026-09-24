'use strict';

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const { pool } = require('../../db');
const { loadFeatureAccess } = require('../../middleware/auth');
const { getModelsForUser } = require('../modelResolver');
const { decrypt } = require('../../utils/encryption');
const { BrowserAgentSession } = require('./browserAgentSession');

const MAX_CONCURRENT_SESSIONS = 4;
let activeSessions = 0;

// Reuses the same 32-byte-hex token lookup as requireAuth (server/middleware/auth.js).
// The WS upgrade handshake never runs Express middleware, so this check has to be
// done by hand before a Session (and its Chromium context) is created.
async function authenticate(token) {
  if (!token) return null;
  const { rows: sessions } = await pool.query('SELECT * FROM auth_sessions WHERE token=$1', [token]);
  const session = sessions[0];
  if (!session || new Date(session.expiresAt) < new Date()) return null;
  const { rows: users } = await pool.query('SELECT id, email, "isAdmin" FROM users WHERE id=$1', [session.userId]);
  return users[0] || null;
}

// Profile lives in Settings (Profile tab → "Browser Agent form details"), same
// key/value settings table every other Vault feature uses — not client localStorage,
// so it's available from any device and survives the browser being cleared.
const PROFILE_SETTING_KEYS = {
  user_name: 'name',
  browser_agent_phone: 'phone',
  browser_agent_email: 'email',
  browser_agent_address: 'address',
};

async function loadBrowserAgentProfile(userId) {
  const { rows } = await pool.query(
    `SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`,
    [userId, Object.keys(PROFILE_SETTING_KEYS)]
  );
  const profile = {};
  for (const row of rows) {
    const field = PROFILE_SETTING_KEYS[row.key];
    if (field && row.value) profile[field] = row.value;
  }
  return profile;
}

// Matches a page's hostname against the user's saved logins (browser_agent_credentials).
// Decrypted here, inside the WS process, and handed straight into Playwright field
// fills — never returned over the WS to the client, never logged, never included in
// any string sent to the Anthropic API (see fill_login in browserAgentSession.js).
async function makeCredentialLookup(userId) {
  const { rows } = await pool.query(
    `SELECT domain, username, password FROM browser_agent_credentials WHERE "userId"=$1`,
    [userId]
  );
  return async (hostname) => {
    const host = String(hostname || '').toLowerCase();
    const match = rows.find((r) => host === r.domain || host.endsWith(`.${r.domain}`));
    if (!match) return null;
    return { username: match.username, password: decrypt(match.password) };
  };
}

function attachBrowserAgentWs(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://internal');
    if (pathname !== '/api/browser-agent/ws') return; // leave other upgrades alone

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws, req) => {
    const { searchParams } = new URL(req.url, 'http://internal');
    const token = searchParams.get('token');

    const user = await authenticate(token).catch(() => null);
    if (!user) {
      ws.send(JSON.stringify({ type: 'error', text: 'Not authenticated.' }));
      return ws.close(4001, 'unauthenticated');
    }

    if (!user.isAdmin) {
      const access = await loadFeatureAccess(user.id).catch(() => ({}));
      if (access.browserAgent === false) {
        ws.send(JSON.stringify({ type: 'error', text: 'Feature disabled for member accounts.' }));
        return ws.close(4003, 'feature-disabled');
      }
    }

    if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
      ws.send(JSON.stringify({ type: 'error', text: 'Too many browser agent sessions running right now — try again shortly.' }));
      return ws.close(4008, 'capacity');
    }

    const { rows: tzRows } = await pool.query(
      "SELECT value FROM settings WHERE \"userId\"=$1 AND key='user_timezone'", [user.id]
    ).catch(() => ({ rows: [] }));
    const tz = tzRows[0]?.value || 'Australia/Sydney';

    // The tool-use loop below talks to the Anthropic SDK directly (no Gemini/DeepSeek
    // routing, unlike chat.js) — so pick the first tier slot that's actually an
    // Anthropic id, in case the workspace default_model points at gemini-*/deepseek-*.
    const isAnthropicId = (id) => !!id && !id.startsWith('gemini-') && !id.startsWith('deepseek-') && !id.startsWith('ollama:');
    let model;
    try {
      const models = await getModelsForUser(user.id);
      model = [models.standard, models.light].find(isAnthropicId) || null;
    } catch {
      model = null;
    }
    if (!model) {
      ws.send(JSON.stringify({ type: 'error', text: 'No Anthropic model configured for this workspace — add one to vault_models in Settings.' }));
      return ws.close(4004, 'no-model');
    }

    const lookupCredential = await makeCredentialLookup(user.id).catch(() => null);

    activeSessions += 1;
    const session = new BrowserAgentSession(ws, {
      model,
      tz,
      lookupCredential,
      onFinish: (run) => {
        pool.query(
          `INSERT INTO browser_agent_runs ("userId", instruction, outcome, summary, log, "startedAt", "endedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user.id, run.instruction, run.outcome, run.summary, JSON.stringify(run.log), run.startedAt, run.endedAt]
        ).catch((err) => console.error('[browser-agent] failed to archive run:', err.message));
      },
    });

    session.bumpIdleTimer();

    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      session.bumpIdleTimer();
      try {
        if (m.type === 'start') {
          const profile = await loadBrowserAgentProfile(user.id).catch(() => ({}));
          const allowedDomain = m.allowedDomain ? String(m.allowedDomain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : null;
          session.run(String(m.instruction || '').slice(0, 2000), profile, allowedDomain);
        }
        else if (m.type === 'answer' && session.pendingAnswer) session.pendingAnswer(String(m.text || ''));
        else if (m.type === 'takeover') session.takeover();
        else if (m.type === 'pause') session.pause();
        else if (m.type === 'resume') session.resume();
        else if (m.type === 'redirect') session.redirect(String(m.text || '').slice(0, 2000));
        else if (m.type === 'clear_session') await session.clearConversation();
        else if (['mouse', 'wheel', 'key', 'text'].includes(m.type)) await session.userInput(m);
      } catch (e) {
        session.log('error', e.message);
      }
    });

    ws.on('close', () => {
      activeSessions -= 1;
      session.close();
    });
  });

  return wss;
}

module.exports = { attachBrowserAgentWs };
