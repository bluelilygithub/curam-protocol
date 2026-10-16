'use strict';
/**
 * Boots the REAL app (server/index.js: every middleware, every router) against a local throwaway
 * database for the cross-user route test, with three safety nets:
 *  1. refuses any database that is not on this machine;
 *  2. blanks every key and mail setting, even ones a local .env supplies;
 *  3. refuses every network connection that is not to this machine, so nothing can leave even if a
 *     route tries (an outside call from a probe is reported, never made).
 *
 * Must be required BEFORE anything else in the test (it sets the environment first).
 */
const net = require('net');
const http = require('http');
const crypto = require('crypto');

function localOnly(url) {
  try { const h = new URL(url).hostname; return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h); } catch { return false; }
}
if (!process.env.DATABASE_URL || !localOnly(process.env.DATABASE_URL)) {
  console.log('SKIP crossUser: set DATABASE_URL to a throwaway Postgres on this machine (localhost / 127.0.0.1)');
  process.exit(0);
}

Object.assign(process.env, {
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DISABLE_EXTERNAL_CRON: 'true', PORT: '0',
  SEED_EMAIL: '', SEED_PASSWORD: '',
  ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '', FAL_API_KEY: '', REPLICATE_API_TOKEN: '',
  FINNHUB_API_KEY: '', ALPHA_VANTAGE_API_KEY: '', SEARCH_API_KEY: '', SERPER_SEARCH_API_KEY: '', RAINFOREST_API_KEY: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', SENTRY_DSN: '', MAIL_CHANNEL_API_KEY: '', SMTP_HOST: '', SMTP_USER: '',
  SMTP_PASS: '', MAIL_FROM: '', DOMSCAN_API_KEY: '', PAGESPEED_API_KEY: '', MAPTILER_API_KEY: '', ORS_API_KEY: '',
  ROUTE_TRACER_MAPTILER_KEY: '', GITHUB_TOKEN: '', ALA_API_KEY: '',
});

// Network guard: any connection to a non-local address is refused and counted.
const blocked = [];
const LOCAL = new Set(['127.0.0.1', '::1', 'localhost']);
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const a = args[0];
  const host = a && typeof a === 'object' ? (a.host || 'localhost') : (typeof args[1] === 'string' ? args[1] : 'localhost');
  const isPath = a && typeof a === 'object' && a.path;
  if (!isPath && !LOCAL.has(host)) {
    blocked.push(String(host));
    const err = new Error(`cross-user test: outside network blocked (${host})`);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return origConnect.apply(this, args);
};
const realFetch = global.fetch;
global.fetch = (input, init) => {
  const u = typeof input === 'string' ? input : (input && input.url) || String(input);
  if (!localOnly(u)) { blocked.push(u.slice(0, 80)); return Promise.reject(new Error(`cross-user test: outside network blocked (${u.slice(0, 60)})`)); }
  return realFetch(input, init);
};

const app = require('../index.js');
const { pool } = require('../db');

async function waitForSchema() {
  for (let i = 0; i < 60; i++) {
    try { await pool.query('SELECT 1 FROM auth_sessions LIMIT 1'); await pool.query('SELECT 1 FROM workspace_settings LIMIT 1'); return; }
    catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error('schema never became ready');
}

async function makeUser(label, isAdmin) {
  const email = `xuser-${label}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@example.test`;
  const { rows } = await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',$2) RETURNING id`, [email, !!isAdmin]);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO auth_sessions (token,"userId","expiresAt") VALUES ($1,$2,NOW() + INTERVAL '1 day')`, [token, rows[0].id]);
  return { id: rows[0].id, email, token, label };
}

async function start() {
  await waitForSchema();
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, pool, server, base, blocked, makeUser };
}

/** One HTTP call. token undefined = no Authorization header. body objects are sent as JSON. */
async function call(base, method, path, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined && !['GET', 'HEAD'].includes(method)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await realFetch(base + path, { method, headers: h, body: payload, signal: ctl.signal, redirect: 'manual' });
    const text = await res.text().catch(() => '');
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: String(e.message || e) };
  } finally { clearTimeout(timer); }
}

module.exports = { start, call };
