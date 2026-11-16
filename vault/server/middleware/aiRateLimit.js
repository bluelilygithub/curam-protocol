'use strict';

const rateLimit = require('express-rate-limit');

// Rate limiter for AI-cost endpoints (chat, generation, etc). Runs after
// requireAuth, so req.user is set — key by user, not IP, so one heavy user
// doesn't throttle everyone else behind a shared office IP, and one user
// can't burn Anthropic/Gemini/Replicate spend unbounded via scripted calls.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many requests, please slow down.' },
});

/**
 * The AI limiter with some free, read-only requests left out of the count. `isFree(req)` says which.
 * Used where a page has to ask for progress every couple of seconds (a running translation checks its status
 * 30 times a minute, which used to spend the person's whole allowance and get their other clicks refused).
 * Only leave out requests that read the caller's own rows and call no paid service.
 */
function aiLimiterExcept(isFree) {
  return (req, res, next) => (isFree(req) ? next() : aiLimiter(req, res, next));
}

module.exports = { aiLimiter, aiLimiterExcept };
