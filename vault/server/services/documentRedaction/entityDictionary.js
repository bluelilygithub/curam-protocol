'use strict';

/**
 * Optional cross-job synthetic-value consistency, scoped to one user.
 * Opt-in only (`reuseAcrossJobs: true` on apply) — off by default.
 *
 * Never stores the real value in plaintext: the lookup key is a hash of the
 * normalized real value + category, so the shared dictionary file itself
 * carries no re-identifiable content, only real→synthetic keeps living in
 * each job's local-only entity map (see jobStore internalDir).
 *
 * Use case: same client's documents redacted across multiple jobs — "Jane
 * Doe" maps to the same synthetic name every time instead of a fresh fake
 * per job, so a reviewer comparing exports isn't confused by drift.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dictionaryRoot() {
  const base = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');
  const dir = path.join(base, 'document-redaction', '_dictionary');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dictionaryPath(userId) {
  return path.join(dictionaryRoot(), `${String(userId)}.json`);
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function keyFor(realValue, categoryLabel) {
  return crypto.createHash('sha256')
    .update(`${normalize(realValue)}|${normalize(categoryLabel)}`)
    .digest('hex');
}

function loadDictionary(userId) {
  const file = dictionaryPath(userId);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function saveDictionary(userId, dict) {
  fs.writeFileSync(dictionaryPath(userId), JSON.stringify(dict, null, 2));
}

/** @returns {string|null} previously used synthetic value for this real value + category, or null */
function lookupSynthetic(userId, realValue, categoryLabel) {
  if (!userId || !realValue) return null;
  const dict = loadDictionary(userId);
  const entry = dict[keyFor(realValue, categoryLabel)];
  return entry?.syntheticValue || null;
}

/** Remember a synthetic value for future jobs (opt-in caller only). */
function rememberSynthetic(userId, realValue, categoryLabel, syntheticValue) {
  if (!userId || !realValue || !syntheticValue) return;
  const dict = loadDictionary(userId);
  dict[keyFor(realValue, categoryLabel)] = {
    syntheticValue,
    categoryLabel: categoryLabel || null,
    updatedAt: new Date().toISOString(),
  };
  saveDictionary(userId, dict);
}

module.exports = {
  lookupSynthetic,
  rememberSynthetic,
};
