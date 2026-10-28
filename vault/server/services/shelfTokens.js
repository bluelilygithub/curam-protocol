'use strict';

// Vault Shelf keys. The Windows clipboard app has no login: it proves itself with an "ingest-only" key (docs/vault-shelf.md).
//   - A key looks like  vsh_<64 hex>  (32 random bytes). Only its SHA-256 is stored; the key itself is shown once, when it is made.
//   - A key has SCOPES (what it may push). What it may actually do is the intersection of its scopes and what the person's account
//     is allowed to use (workspace switches narrowed by per-member switches), worked out on every request by effectiveScopes().
//   - Keys can expire, can be revoked, and stop working when the account is disabled or deleted.

const crypto = require('crypto');

const TOKEN_RE = /^vsh_[0-9a-f]{64}$/;
const MAX_ACTIVE_TOKENS = 5;
const MAX_LABEL = 60;

// scope -> what it does, and which Vault features must be on for the person. Notes has no switch of its own.
const SCOPES = {
  'notes:write': { label: 'Save as Note', needs: [] },
  'finance:write': { label: 'Ingest to Invoice Review (Finance)', needs: ['finance', 'gmailIntel'] },
  'crm:write': { label: 'Attach to CRM (unfiled inbox)', needs: ['clients'] },
  'redact:check': { label: 'Check text for sensitive data', needs: ['documentRedaction'] },
};
const SCOPE_NAMES = Object.keys(SCOPES);

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** A new key: { token, tokenHash, prefix, last4 }. prefix + last4 are what the list shows, enough to tell keys apart. */
function newToken() {
  const token = `vsh_${crypto.randomBytes(32).toString('hex')}`;
  return { token, tokenHash: hashToken(token), prefix: token.slice(0, 8), last4: token.slice(-4) };
}

const cleanLabel = (raw) => String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);

/** Keeps only known scope names, once each, in a fixed order. */
function cleanScopes(raw) {
  const asked = new Set(Array.isArray(raw) ? raw.map(String) : []);
  return SCOPE_NAMES.filter((s) => asked.has(s));
}

/** Can this account use this scope right now? Admins are never narrowed (same rule as requireFeature). */
function scopeAllowed(scope, flags, isAdmin) {
  const def = SCOPES[scope];
  if (!def) return false;
  if (isAdmin) return true;
  return def.needs.every((k) => flags[k] !== false);
}

/** The scopes the key is allowed to use right now, and the ones it holds but cannot use (with the reason). */
function effectiveScopes(tokenScopes, flags, isAdmin) {
  const allowed = [];
  const blocked = [];
  for (const s of cleanScopes(tokenScopes)) {
    if (scopeAllowed(s, flags, isAdmin)) allowed.push(s);
    else blocked.push({ scope: s, reason: 'This part of Vault is switched off for your account.' });
  }
  return { allowed, blocked };
}

/** Why a key row cannot be used, or null when it can. */
function tokenProblem(row, now = new Date()) {
  if (!row) return { code: 'TOKEN_INVALID', message: 'Not authenticated' };
  if (row.revokedAt) return { code: 'TOKEN_REVOKED', message: 'This key was revoked in Vault. Make a new one in Settings, Vault Shelf.' };
  if (row.expiresAt && new Date(row.expiresAt) <= now) return { code: 'TOKEN_EXPIRED', message: 'This key has expired. Make a new one in Settings, Vault Shelf.' };
  return null;
}

/** Sliding-window counters kept in memory, one list of timestamps per name. They reset when the server restarts, which is fine for a guard. */
function createLimiter(now = () => Date.now()) {
  const hits = new Map();
  return {
    /** True (and counts it) while fewer than `max` hits happened in the last `windowMs`; false once the limit is reached. */
    take(name, max, windowMs) {
      const t = now();
      const list = (hits.get(name) || []).filter((x) => t - x < windowMs);
      if (list.length >= max) { hits.set(name, list); return false; }
      list.push(t);
      hits.set(name, list);
      return true;
    },
    /** Seconds until the oldest hit in the window expires. */
    retryAfter(name, windowMs) {
      const list = hits.get(name) || [];
      if (!list.length) return 1;
      return Math.max(1, Math.ceil((windowMs - (now() - list[0])) / 1000));
    },
    /** Forget old names so the map cannot grow without end. */
    sweep(maxAgeMs) {
      const t = now();
      for (const [k, list] of hits) if (!list.length || t - list[list.length - 1] > maxAgeMs) hits.delete(k);
    },
  };
}

module.exports = {
  TOKEN_RE, MAX_ACTIVE_TOKENS, MAX_LABEL, SCOPES, SCOPE_NAMES,
  hashToken, newToken, cleanLabel, cleanScopes, scopeAllowed, effectiveScopes, tokenProblem, createLimiter,
};
