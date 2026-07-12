'use strict';

/**
 * Deterministic value baseline from listing facts (price, rating, review volume).
 * LLM adjusts within a bounded band on top of this.
 */
function computePreScore(candidate, pool) {
  const priced = pool.filter((c) => Number(c.price) > 0);
  const prices = priced.map((c) => Number(c.price));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const priceRange = maxPrice - minPrice || 1;

  const price = Number(candidate.price);
  let priceScore = 50;
  if (price > 0) {
    priceScore = 100 * (1 - (price - minPrice) / priceRange);
  }

  const rating = Number(candidate.rating);
  const ratingScore = Number.isFinite(rating) && rating > 0 ? (rating / 5) * 100 : 50;

  const logReviews = pool.map((c) => Math.log10(Number(c.review_count || 0) + 1));
  const maxLog = Math.max(...logReviews, 0.001);
  const reviewScore = 100 * (Math.log10(Number(candidate.review_count || 0) + 1) / maxLog);

  return Math.round(priceScore * 0.4 + ratingScore * 0.3 + reviewScore * 0.3);
}

function attachPreScores(candidates) {
  return candidates.map((c) => ({
    ...c,
    pre_score: computePreScore(c, candidates),
  }));
}

/** Blend LLM score with deterministic baseline; cap wild swings. */
function blendValueScore(preScore, llmScore) {
  const pre = Number(preScore);
  const llm = Number(llmScore);
  if (!Number.isFinite(pre)) return Number.isFinite(llm) ? Math.round(llm) : null;
  if (!Number.isFinite(llm)) return Math.round(pre);

  const delta = Math.max(-12, Math.min(12, llm - pre));
  return Math.round(pre * 0.65 + (pre + delta) * 0.35);
}

module.exports = { computePreScore, attachPreScores, blendValueScore };
