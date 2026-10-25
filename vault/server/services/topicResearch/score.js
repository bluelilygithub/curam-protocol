'use strict';

// Topic Research: rank the articles of one search. Pure code: every number can be worked out by hand from what is stored.
//
// Five signals, each between 0 and 1 for an article, weighted (weights are the owner's, editable in Settings) and added up to a score of 0-100:
//   rank        a Google/Brave position: 1.0 at 1, falling by 0.1 a place to 0.1 at 10; 0 outside the top 10 or not listed; +0.2 for
//               "Top stories", never above 1. The best position any source gave is used.
//   size        how many different outlets are in the article's story (log scaled against the biggest story in this search)
//   engagement  Hacker News points + comments and Reddit score + comments (log scaled against the biggest in this search)
//   recency     0.5 to the power (hours old / half-life); half-life 48 h unless changed. An undated article counts as 0.3 (neither fresh nor old).
//   outlet      the owner's own weight for the article's site (0.5 for a site not in the list)
//
// A signal that tells the articles apart not at all in THIS search (nobody has a rank, no story has two outlets, no numbers, no dates, no
// outlet weights set) is left out and the remaining weights are scaled up to fill its place, and the breakdown says so. That keeps a score
// meaningful when a source is switched off, instead of capping every article below 100 with dead weight. Weights that do not add to 1 are
// scaled the same way. See docs/topic-research.md.

const crypto = require('crypto');

const DEFAULT_WEIGHTS = Object.freeze({ rank: 0.30, size: 0.25, engagement: 0.20, recency: 0.15, source: 0.10 });
const DEFAULT_HALF_LIFE_HOURS = 48;
const UNDATED_RECENCY = 0.3;
const UNKNOWN_OUTLET_WEIGHT = 0.5;
const TOP_STORY_BONUS = 0.2;
const HEAT_WINDOW_MS = 48 * 3600 * 1000;
const SIGNALS = [
  { id: 'rank', label: 'Search rank' },
  { id: 'size', label: 'Story size' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'recency', label: 'Recency' },
  { id: 'source', label: 'Outlet weight' },
];
const WHY_OFF = {
  rank: 'no Google or Brave results are in this search',
  size: 'no story was covered by more than one outlet',
  engagement: 'no Hacker News or Reddit numbers',
  recency: 'no article has a date',
  source: 'no outlet weights are set',
};

const round1 = (n) => Math.round(n * 10) / 10;
const finite = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** The weight for a site: the most specific entry in the owner's list ("news.abc.net.au" falls back to "abc.net.au"), else 0.5. */
function outletWeight(domain, sourceWeights) {
  const parts = String(domain || '').toLowerCase().split('.').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i += 1) {
    const w = sourceWeights.get(parts.slice(i).join('.'));
    if (w !== undefined) return { weight: w, known: true };
  }
  return { weight: UNKNOWN_OUTLET_WEIGHT, known: false };
}

/** Search-rank value 0-1 for one article. */
function rankValue(signals) {
  const r = Number(signals?.serp_rank);
  let v = Number.isInteger(r) && r >= 1 && r <= 10 ? 1.1 - 0.1 * r : 0;
  if (signals?.serp_top_story) v = Math.min(1, v + TOP_STORY_BONUS);
  return v;
}
const hasRank = (signals) => (Number.isInteger(Number(signals?.serp_rank)) && Number(signals?.serp_rank) >= 1) || !!signals?.serp_top_story;
const engagementOf = (s) => Math.max(0, finite(s?.hn_points)) + Math.max(0, finite(s?.hn_comments)) + Math.max(0, finite(s?.reddit_score)) + Math.max(0, finite(s?.reddit_comments));
const logScaled = (x, max) => (max > 0 ? Math.log(1 + x) / Math.log(1 + max) : 0);

function recencyValue(publishedAt, nowMs, halfLifeHours) {
  if (!publishedAt) return UNDATED_RECENCY;
  const ageHours = Math.max(0, (nowMs - new Date(publishedAt).getTime()) / 3600000);
  return 0.5 ** (ageHours / halfLifeHours);
}

/**
 * @param articles [{ id, domain, publishedAt: Date|string|null, signals, clusterId }]
 * @param config   { weights?, halfLifeHours?, sourceWeights?: Map<domain, 0-1>, now?: ms }
 * @returns {{ scores: Map<id, { score, breakdown }>, clusters: Array<{ clusterId, outlets, articleIds, bestScore, originalId|null }>, used }}
 *   clusters are ordered by best score (highest first); `used` records the weights actually applied, what was left out and why.
 */
function scoreArticles(articles, config = {}) {
  const nowMs = config.now ?? Date.now();
  const halfLife = Number(config.halfLifeHours) > 0 ? Number(config.halfLifeHours) : DEFAULT_HALF_LIFE_HOURS;
  const sourceWeights = config.sourceWeights instanceof Map ? config.sourceWeights : new Map();
  const given = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };

  // story sizes: distinct outlets per cluster
  const outletsByCluster = new Map();
  for (const a of articles) {
    if (!outletsByCluster.has(a.clusterId)) outletsByCluster.set(a.clusterId, new Set());
    outletsByCluster.get(a.clusterId).add(a.domain);
  }
  const sizeOf = (a) => outletsByCluster.get(a.clusterId)?.size || 1;
  const maxSize = Math.max(1, ...articles.map(sizeOf));
  const engagements = articles.map((a) => engagementOf(a.signals));
  const maxEngagement = Math.max(0, ...engagements);
  const outlets = articles.map((a) => outletWeight(a.domain, sourceWeights));

  const available = {
    rank: articles.some((a) => hasRank(a.signals)),
    size: maxSize > 1,
    engagement: maxEngagement > 0,
    recency: articles.some((a) => a.publishedAt),
    source: outlets.some((o) => o.known),
  };
  const totalWeight = SIGNALS.reduce((s, sig) => s + (available[sig.id] ? Math.max(0, finite(given[sig.id])) : 0), 0);
  const share = (id) => (available[id] && totalWeight > 0 ? Math.max(0, finite(given[id])) / totalWeight : 0);

  const scores = new Map();
  articles.forEach((a, i) => {
    const values = {
      rank: rankValue(a.signals),
      size: logScaled(sizeOf(a), maxSize),
      engagement: logScaled(engagements[i], maxEngagement),
      recency: recencyValue(a.publishedAt, nowMs, halfLife),
      source: outlets[i].weight,
    };
    const raw = { rank: Number(a.signals?.serp_rank) || null, size: sizeOf(a), engagement: engagements[i], recency: a.publishedAt ? new Date(a.publishedAt).toISOString() : null, source: outlets[i].weight };
    let total = 0;
    const breakdown = SIGNALS.map((sig) => {
      if (!available[sig.id]) return { id: sig.id, label: sig.label, available: false, why: WHY_OFF[sig.id], value: null, weight: 0, points: 0, raw: raw[sig.id] };
      const w = share(sig.id);
      const points = 100 * w * values[sig.id];
      total += points;
      return { id: sig.id, label: sig.label, available: true, value: values[sig.id], weight: w, points: round1(points), raw: raw[sig.id] };
    });
    scores.set(a.id, { score: round1(total), breakdown });
  });

  // stories: ordered by their best article; the Original is the earliest dated article, only where two or more outlets cover the story
  const byCluster = new Map();
  for (const a of articles) {
    if (!byCluster.has(a.clusterId)) byCluster.set(a.clusterId, []);
    byCluster.get(a.clusterId).push(a);
  }
  const clusters = [...byCluster.entries()].map(([clusterId, list]) => {
    const outletCount = new Set(list.map((a) => a.domain)).size;
    let originalId = null;
    if (outletCount >= 2) {
      const dated = list.filter((a) => a.publishedAt).sort((x, y) => new Date(x.publishedAt) - new Date(y.publishedAt));
      if (dated.length) originalId = dated[0].id;
    }
    return { clusterId, outlets: outletCount, articleIds: list.map((a) => a.id), bestScore: Math.max(...list.map((a) => scores.get(a.id).score)), originalId };
  }).sort((p, q) => q.bestScore - p.bestScore || p.clusterId - q.clusterId);

  const dropped = SIGNALS.filter((s) => !available[s.id]).map((s) => ({ id: s.id, label: s.label, why: WHY_OFF[s.id] }));
  const weights = Object.fromEntries(SIGNALS.map((s) => [s.id, share(s.id)]));
  const used = { weights, given: Object.fromEntries(SIGNALS.map((s) => [s.id, finite(given[s.id])])), halfLifeHours: halfLife, dropped, fingerprint: fingerprint(config) };
  return { scores, clusters, used };
}

/** A short code for the settings that decide scores (weights, half-life, outlet list), to tell when a stored score is out of date. */
function fingerprint(config = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
  const sw = config.sourceWeights instanceof Map ? [...config.sourceWeights.entries()].sort(([a], [b]) => (a < b ? -1 : 1)) : [];
  const text = JSON.stringify([SIGNALS.map((s) => finite(w[s.id])), Number(config.halfLifeHours) > 0 ? Number(config.halfLifeHours) : DEFAULT_HALF_LIFE_HOURS, sw]);
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/**
 * How lively the topic is right now: stories with an article from the last 48 hours, plus a small bounded amount for engagement
 * (log10 of the total). There is no Google Trends slope (not built). Rising / Steady / Falling compares with the topic's previous search
 * (20 % either way); the first search is "New".
 */
function topicHeat(articles, { now = Date.now(), previous = null } = {}) {
  const latest = new Map();
  for (const a of articles) {
    if (!a.publishedAt) continue;
    const t = new Date(a.publishedAt).getTime();
    if (!latest.has(a.clusterId) || t > latest.get(a.clusterId)) latest.set(a.clusterId, t);
  }
  const clusters48h = [...latest.values()].filter((t) => now - t <= HEAT_WINDOW_MS).length;
  const engagement = articles.reduce((s, a) => s + engagementOf(a.signals), 0);
  const value = Math.round((clusters48h + Math.log10(1 + engagement)) * 100) / 100;
  let label = 'New';
  if (previous != null && Number.isFinite(Number(previous))) {
    const p = Number(previous);
    if (p === 0 && value === 0) label = 'Steady';
    else if (value >= p * 1.2 && value > p) label = 'Rising';
    else if (value <= p * 0.8 && value < p) label = 'Falling';
    else label = 'Steady';
  }
  return { value, label, clusters48h, engagement, previous: previous == null ? null : Number(previous) };
}

module.exports = {
  scoreArticles, topicHeat, fingerprint, rankValue, recencyValue, outletWeight, engagementOf,
  DEFAULT_WEIGHTS, DEFAULT_HALF_LIFE_HOURS, UNDATED_RECENCY, UNKNOWN_OUTLET_WEIGHT, SIGNALS,
};
