'use strict';

// Tiny shared helpers for the Presentations route modules. Kept in one place so every tool answers errors the same way.

const { getLogger } = require('../../middleware/requestContext');

function sendError(res, err, fallback = 'Presentations could not finish that.') {
  const status = err?.status || (err?.name === 'MulterError' ? 400 : 500);
  if (status >= 500) getLogger().error({ err }, '[presentations]');
  res.status(status).json({ error: status >= 500 ? fallback : (err?.message || fallback) });
}

module.exports = { sendError };
