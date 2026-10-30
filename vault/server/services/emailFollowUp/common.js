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

module.exports = { RuleError, sha256, norm, spanHash, canonicalJson };
