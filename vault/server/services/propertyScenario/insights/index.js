'use strict';

/**
 * Document / Insight Reasoning Layer (Stage 11).
 *
 * Quarantined from Scenario, orchestrator, and calc modules.
 * Reads CDR-linked T&Cs/PDS only — never writes scenario/calc totals.
 */

const { INSIGHT_DISCLAIMER } = require('./disclaimer');
const {
  fetchDocument,
  fetchProductDocuments,
  documentUrlsFromProduct,
  corpusFromDocuments,
} = require('./fetchDocument');
const {
  getCachedDocument,
  setCachedDocument,
  clearDocumentCache,
  documentCacheStats,
} = require('./documentCache');
const { buildInsight } = require('./buildInsight');
const { compareInsights } = require('./compareInsights');

module.exports = {
  INSIGHT_DISCLAIMER,
  fetchDocument,
  fetchProductDocuments,
  documentUrlsFromProduct,
  corpusFromDocuments,
  getCachedDocument,
  setCachedDocument,
  clearDocumentCache,
  documentCacheStats,
  buildInsight,
  compareInsights,
};
