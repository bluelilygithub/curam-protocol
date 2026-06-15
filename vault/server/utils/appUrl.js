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

module.exports = { getAppUrl };
