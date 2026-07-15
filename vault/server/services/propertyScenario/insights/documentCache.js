'use strict';

/**
 * In-memory cache for fetched / extracted lender documents.
 * Documents change infrequently — avoid re-fetching on every question.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** @type {Map<string, { at: number, payload: object }>} */
const cache = new Map();

function cacheKey(url) {
  return String(url || '').trim();
}

function getCachedDocument(url) {
  const key = cacheKey(url);
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DEFAULT_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { ...hit.payload, cache_hit: true };
}

function setCachedDocument(url, payload) {
  const key = cacheKey(url);
  if (!key) return;
  cache.set(key, { at: Date.now(), payload: { ...payload, cache_hit: false } });
}

function clearDocumentCache() {
  cache.clear();
}

function documentCacheStats() {
  return { size: cache.size, ttl_ms: DEFAULT_TTL_MS };
}

module.exports = {
  getCachedDocument,
  setCachedDocument,
  clearDocumentCache,
  documentCacheStats,
  DEFAULT_TTL_MS,
};
