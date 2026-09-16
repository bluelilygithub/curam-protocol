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

module.exports = { aiLimiter };
