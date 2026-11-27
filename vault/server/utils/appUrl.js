'use strict';

function getAppUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');

  const appEnv = String(process.env.APP_ENV || '').trim().toLowerCase();
  if (appEnv === 'local') {
    return (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  }

  const requestBaseUrl = req?.get?.('host') ? `${req.protocol}://${req.get('host')}` : '';
  return (requestBaseUrl || 'http://localhost:5173').replace(/\/$/, '');
}

// The address put in emails people receive (welcome, password reset, Forgot password, Wellbeing invite): the Vault's own domain,
// whatever address the request came in on. A local run keeps its local address. APP_URL is left alone (it also drives Google sign-in
// return links). Owner's choice, 2026-11-27.
const EMAIL_APP_URL = 'https://vault.curam-ai.com.au';
function emailAppUrl(req) {
  const url = getAppUrl(req);
  return /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(url) ? url : EMAIL_APP_URL;
}

module.exports = { getAppUrl, emailAppUrl, EMAIL_APP_URL };
