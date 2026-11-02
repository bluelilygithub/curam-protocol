'use strict';

// Shared helpers for the Email Follow-Up rule modules (docs/email-follow-up-case-model.md).
// Everything in this folder except extract.js / caseStore.js is pure: no database, no clock, no network.

const crypto = require('crypto');

/** A broken rule from the case model. The message names the rule so a failing fixture says why. */
class RuleError extends Error {
  constructor(rule, message) {
    super(`§${rule} violated: ${message}`);
    this.name = 'RuleError';
    this.rule = String(rule);
  }
}

/**
 * Does `text` (a From/To header or an address) contain this case address? A person alias ("jo@acme.com") matches as a substring;
 * a whole-organisation alias ("@acme.com") matches only that exact domain, not "@acme.com.au" or "@acme.community".
 */
function aliasMatches(alias, text) {
  const a = String(alias || '').toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!a) return false;
  if (!a.startsWith('@')) return t.includes(a);
  let from = 0;
  for (;;) {
    const i = t.indexOf(a, from);
    if (i === -1) return false;
    const next = t.charAt(i + a.length);
    const after = t.charAt(i + a.length + 1);
    if (!/[a-z0-9-]/.test(next) && !(next === '.' && /[a-z0-9]/.test(after))) return true;
    from = i + 1;
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** Lower-case, trim, collapse spaces: the form used to compare items and names. */
function norm(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Hash of a span of extracted text (whitespace-insensitive so a re-wrapped line is still the same bytes). */
function spanHash(text) {
  return sha256(String(text == null ? '' : text).replace(/\s+/g, ' ').trim());
}

/** Stable JSON: keys sorted, so the same object always hashes the same. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

module.exports = { RuleError, aliasMatches, sha256, norm, spanHash, canonicalJson };
