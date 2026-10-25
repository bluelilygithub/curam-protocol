#!/usr/bin/env node
/**
 * Topic Research (milestone 3): ranking. Every expected number below was worked out by hand from the spec's formulas, not read back from the
 * code (the working is in the comments). Pure code: no database, no network.
 *
 * Run: node server/services/topicResearch/score.test.js
 */
'use strict';

const assert = require('assert');
const {
  scoreArticles, topicHeat, fingerprint, rankValue, recencyValue, outletWeight, engagementOf, DEFAULT_WEIGHTS, UNDATED_RECENCY,
} = require('./score');

const NOW = Date.UTC(2026, 9, 25, 0, 0, 0);
const HOUR = 3600000;
const ago = (h) => new Date(NOW - h * HOUR);
const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);
const art = (id, domain, cluster, hoursAgo, signals = {}) => ({ id, domain, clusterId: cluster, publishedAt: hoursAgo == null ? null : ago(hoursAgo), signals });

// ------------------------------------------------------------ search rank: 1.0 at 1, falling 0.1 a place to 0.1 at 10
close(rankValue({ serp_rank: 1 }), 1.0, 'rank 1');
close(rankValue({ serp_rank: 2 }), 0.9, 'rank 2');
close(rankValue({ serp_rank: 5 }), 0.6, 'rank 5');
close(rankValue({ serp_rank: 10 }), 0.1, 'rank 10');
assert.strictEqual(rankValue({ serp_rank: 11 }), 0, 'outside the top 10');
assert.strictEqual(rankValue({ serp_rank: 0 }), 0);
assert.strictEqual(rankValue({ serp_rank: 1.5 }), 0, 'a position is a whole number');
assert.strictEqual(rankValue({}), 0);
assert.strictEqual(rankValue(undefined), 0);
close(rankValue({ serp_top_story: true }), 0.2, 'Top stories alone');
close(rankValue({ serp_rank: 1, serp_top_story: true }), 1.0, 'capped at 1');
close(rankValue({ serp_rank: 5, serp_top_story: true }), 0.8, 'rank 5 plus Top stories');
close(rankValue({ serp_rank: 10, serp_top_story: true }), 0.3, 'rank 10 plus Top stories');
close(rankValue({ serp_rank: 12, serp_top_story: true }), 0.2, 'Top stories without a top-10 place');

// ------------------------------------------------------------ recency: half-life 48 h
close(recencyValue(ago(0), NOW, 48), 1, 'now');
close(recencyValue(ago(48), NOW, 48), 0.5, 'one half-life');
close(recencyValue(ago(96), NOW, 48), 0.25, 'two half-lives');
close(recencyValue(ago(24), NOW, 24), 0.5, 'a shorter half-life');
close(recencyValue(ago(-5), NOW, 48), 1, 'a clock a little ahead is not "fresher than fresh"');
assert.strictEqual(recencyValue(null, NOW, 48), UNDATED_RECENCY);
assert.strictEqual(UNDATED_RECENCY, 0.3);
close(recencyValue(ago(24).toISOString(), NOW, 48), 0.5 ** 0.5, 'a date as text works');

// ------------------------------------------------------------ engagement and outlets
assert.strictEqual(engagementOf({ hn_points: 7, hn_comments: 2, reddit_score: 10, reddit_comments: 1 }), 20);
assert.strictEqual(engagementOf({ hn_points: -5, reddit_score: NaN }), 0);
assert.strictEqual(engagementOf(undefined), 0);
const sw = new Map([['abc.net.au', 0.9], ['news.abc.net.au', 0.4], ['example.com', 0.1]]);
assert.deepStrictEqual(outletWeight('abc.net.au', sw), { weight: 0.9, known: true });
assert.deepStrictEqual(outletWeight('news.abc.net.au', sw), { weight: 0.4, known: true }, 'the most specific entry wins');
assert.deepStrictEqual(outletWeight('www.example.com', sw), { weight: 0.1, known: true }, 'a sub-site falls back to its site');
assert.deepStrictEqual(outletWeight('ABC.net.au', sw), { weight: 0.9, known: true });
assert.deepStrictEqual(outletWeight('other.org', sw), { weight: 0.5, known: false });
assert.deepStrictEqual(outletWeight('au', new Map([['au', 0.1]])), { weight: 0.5, known: false }, 'a bare ending is not a site');

// ------------------------------------------------------------ a full score with every signal, by hand
// a1: x.com, story 1, 0 h old, Google #1, HN 7 points + 2 comments (engagement 9)
// a2: y.com, story 1, 48 h old, nothing else
// a3: z.com, story 2, 96 h old, Google #5, Reddit 99 + 0 (engagement 99, the biggest)
// outlet weights: x.com 0.9, z.com 0.2 (y.com unknown = 0.5)
// story sizes: story 1 has outlets {x, y} = 2, story 2 has {z} = 1; biggest = 2
//   size      a1, a2: ln(3)/ln(3) = 1        a3: ln(2)/ln(3) = 0.63093
//   engage.   a1: ln(10)/ln(100) = 0.5       a2: 0           a3: 1
//   recency   a1: 1                          a2: 0.5         a3: 0.25
//   rank      a1: 1.0                        a2: 0           a3: 0.6
//   outlet    a1: 0.9                        a2: 0.5         a3: 0.2
// score = 100 x (0.30 rank + 0.25 size + 0.20 engagement + 0.15 recency + 0.10 outlet)
//   a1 = 100 x (0.30 + 0.25 + 0.10 + 0.15 + 0.09)                          = 89.0
//   a2 = 100 x (0 + 0.25 + 0 + 0.075 + 0.05)                               = 37.5
//   a3 = 100 x (0.18 + 0.25 x 0.63093 + 0.20 + 0.0375 + 0.02)              = 59.52 -> 59.5
{
  const arts = [
    art('a1', 'x.com', 1, 0, { serp_rank: 1, hn_points: 7, hn_comments: 2 }),
    art('a2', 'y.com', 1, 48),
    art('a3', 'z.com', 2, 96, { serp_rank: 5, reddit_score: 99, reddit_comments: 0 }),
  ];
  const { scores, clusters, used } = scoreArticles(arts, { now: NOW, sourceWeights: new Map([['x.com', 0.9], ['z.com', 0.2]]) });
  assert.strictEqual(scores.get('a1').score, 89.0);
  assert.strictEqual(scores.get('a2').score, 37.5);
  assert.strictEqual(scores.get('a3').score, 59.5);
  assert.deepStrictEqual(used.dropped, [], 'every signal had something to say');
  close(used.weights.rank + used.weights.size + used.weights.engagement + used.weights.recency + used.weights.source, 1, 'weights add to 1');

  const b = Object.fromEntries(scores.get('a3').breakdown.map((x) => [x.id, x]));
  close(b.rank.value, 0.6); close(b.rank.weight, 0.3); close(b.rank.points, 18.0);
  close(b.size.value, Math.log(2) / Math.log(3)); close(b.size.points, 15.8, 'ln2/ln3 x 25 = 15.77', 0.05);
  close(b.engagement.points, 20.0); close(b.recency.points, 3.8, '0.25 x 15 = 3.75', 0.06); close(b.source.points, 2.0);
  assert.strictEqual(b.rank.raw, 5);
  assert.strictEqual(b.engagement.raw, 99);
  assert.strictEqual(scores.get('a3').breakdown.length, 5);
  const sum = scores.get('a3').breakdown.reduce((s, x) => s + x.points, 0);
  close(sum, scores.get('a3').score, 'the parts add up to the score', 0.15);

  // stories: ordered by their best article; the Original is the earliest dated article of a story covered by two outlets
  assert.deepStrictEqual(clusters.map((c) => [c.clusterId, c.outlets, c.bestScore, c.originalId]), [[1, 2, 89.0, 'a2'], [2, 1, 59.5, null]]);
  assert.deepStrictEqual(clusters[0].articleIds, ['a1', 'a2']);
}

// ------------------------------------------------------------ a weight change re-orders the results
// p: story 1, 96 h old, Google #1.   q: story 2, 0 h old, no rank.   (only rank and recency tell them apart)
// default weights 0.30 / 0.15 -> shares 2/3 and 1/3:  p = 100 x (2/3 x 1 + 1/3 x 0.25) = 75.0     q = 100 x (1/3 x 1) = 33.3
// rank 0.05, recency 0.90 -> shares 0.05/0.95 and 0.90/0.95:  p = 100 x (0.05263 + 0.94737 x 0.25) = 28.9    q = 94.7
{
  const arts = [art('p', 'p.com', 1, 96, { serp_rank: 1 }), art('q', 'q.com', 2, 0)];
  const before = scoreArticles(arts, { now: NOW });
  assert.strictEqual(before.scores.get('p').score, 75.0);
  assert.strictEqual(before.scores.get('q').score, 33.3);
  assert.deepStrictEqual(before.clusters.map((c) => c.clusterId), [1, 2], 'p first');
  const after = scoreArticles(arts, { now: NOW, weights: { rank: 0.05, recency: 0.90 } });
  assert.strictEqual(after.scores.get('p').score, 28.9);
  assert.strictEqual(after.scores.get('q').score, 94.7);
  assert.deepStrictEqual(after.clusters.map((c) => c.clusterId), [2, 1], 'q first now');
  assert.notStrictEqual(before.used.fingerprint, after.used.fingerprint, 'the stored scores can be told to be out of date');

  // weights that do not add to 1 are scaled: 3 : 1 -> shares 0.75 / 0.25;  p = 100 x (0.75 + 0.25 x 0.25) = 81.25 -> 81.3
  const odd = scoreArticles(arts, { now: NOW, weights: { rank: 3, recency: 1 } });
  assert.strictEqual(odd.scores.get('p').score, 81.3);
  close(odd.used.weights.rank, 0.75); close(odd.used.weights.recency, 0.25);
  assert.deepStrictEqual(odd.used.given, { rank: 3, size: DEFAULT_WEIGHTS.size, engagement: DEFAULT_WEIGHTS.engagement, recency: 1, source: DEFAULT_WEIGHTS.source }, 'what was asked for is kept beside what was used');
}

// ------------------------------------------------------------ a signal with nothing to say is left out, and says so
{
  const lone = scoreArticles([art('a', 'a.com', 1, 48)], { now: NOW });
  // only recency can speak: all of the weight goes to it, 100 x 0.5 = 50
  assert.strictEqual(lone.scores.get('a').score, 50.0);
  assert.deepStrictEqual(lone.used.dropped.map((d) => d.id), ['rank', 'size', 'engagement', 'source']);
  assert.ok(lone.used.dropped.every((d) => d.why.length > 10));
  const bd = lone.scores.get('a').breakdown;
  assert.deepStrictEqual(bd.filter((x) => !x.available).map((x) => [x.id, x.value, x.points]), [['rank', null, 0], ['size', null, 0], ['engagement', null, 0], ['source', null, 0]]);
  assert.ok(bd.filter((x) => !x.available).every((x) => /no |No /.test(x.why)));
  assert.strictEqual(bd.find((x) => x.id === 'recency').weight, 1);

  // nothing at all to go on (no dates either): every article scores 0, never NaN
  const none = scoreArticles([art('a', 'a.com', 1, null), art('b', 'b.com', 2, null)], { now: NOW });
  assert.deepStrictEqual([none.scores.get('a').score, none.scores.get('b').score], [0, 0]);
  assert.strictEqual(none.used.dropped.length, 5);

  // the owner turns every available signal's weight to zero: scores are 0, not NaN
  const zero = scoreArticles([art('a', 'a.com', 1, 10)], { now: NOW, weights: { recency: 0 } });
  assert.strictEqual(zero.scores.get('a').score, 0);
  assert.ok(Object.values(zero.used.weights).every((w) => w === 0));

  // all stories single-outlet: size is dropped even when other signals exist
  const singles = scoreArticles([art('a', 'a.com', 1, 0, { hn_points: 5 }), art('b', 'a.com', 1, 24, { hn_points: 50 })], { now: NOW });
  assert.ok(singles.used.dropped.some((d) => d.id === 'size'), 'one outlet twice is still one outlet');
  assert.ok(!singles.used.dropped.some((d) => d.id === 'engagement'));
  // outlet weights count only once at least one site in the set is in the list
  assert.ok(singles.used.dropped.some((d) => d.id === 'source'));
  const withList = scoreArticles([art('a', 'a.com', 1, 0)], { now: NOW, sourceWeights: new Map([['a.com', 1]]) });
  assert.ok(!withList.used.dropped.some((d) => d.id === 'source'));
  close(withList.used.weights.source, 0.10 / 0.25, 'recency 0.15 + outlet 0.10 share the whole');
}

// ------------------------------------------------------------ the Original
{
  const sameOutlet = scoreArticles([art('a', 'a.com', 1, 10), art('b', 'a.com', 1, 20)], { now: NOW });
  assert.strictEqual(sameOutlet.clusters[0].originalId, null, 'two articles from one outlet are not a story many outlets covered');
  const undated = scoreArticles([art('a', 'a.com', 1, null), art('b', 'b.com', 1, null)], { now: NOW });
  assert.strictEqual(undated.clusters[0].originalId, null, 'no dates, no way to say who was first');
  const oneDated = scoreArticles([art('a', 'a.com', 1, null), art('b', 'b.com', 1, 30)], { now: NOW });
  assert.strictEqual(oneDated.clusters[0].originalId, 'b');
  const tie = scoreArticles([art('first', 'a.com', 1, 5), art('second', 'b.com', 1, 5)], { now: NOW });
  assert.strictEqual(tie.clusters[0].originalId, 'first', 'a tie goes to the one listed first');
  const earliest = scoreArticles([art('new', 'a.com', 1, 1), art('old', 'b.com', 1, 70), art('mid', 'c.com', 1, 20)], { now: NOW });
  assert.strictEqual(earliest.clusters[0].originalId, 'old');
  assert.strictEqual(earliest.clusters[0].outlets, 3);
}

// ------------------------------------------------------------ nothing depends on the order the articles arrive in
{
  const arts = [
    art('a1', 'x.com', 1, 0, { serp_rank: 1, hn_points: 7 }), art('a2', 'y.com', 1, 48), art('a3', 'z.com', 2, 96, { reddit_score: 99 }), art('a4', 'w.com', 3, null),
  ];
  const cfg = { now: NOW, sourceWeights: new Map([['x.com', 0.9]]) };
  const one = scoreArticles(arts, cfg);
  const two = scoreArticles([...arts].reverse(), cfg);
  for (const a of arts) assert.strictEqual(one.scores.get(a.id).score, two.scores.get(a.id).score, `score of ${a.id}`);
  assert.deepStrictEqual(one.clusters.map((c) => c.clusterId), two.clusters.map((c) => c.clusterId));
}

// ------------------------------------------------------------ the fingerprint
{
  const base = { weights: { rank: 0.3 }, halfLifeHours: 48, sourceWeights: new Map([['a.com', 0.5], ['b.com', 0.7]]) };
  assert.strictEqual(fingerprint(base), fingerprint({ ...base, sourceWeights: new Map([['b.com', 0.7], ['a.com', 0.5]]) }), 'the order of the outlet list does not matter');
  assert.strictEqual(fingerprint({}), fingerprint({ weights: DEFAULT_WEIGHTS, halfLifeHours: 48 }), 'defaults are the defaults however they are spelt');
  assert.notStrictEqual(fingerprint(base), fingerprint({ ...base, weights: { rank: 0.31 } }));
  assert.notStrictEqual(fingerprint(base), fingerprint({ ...base, halfLifeHours: 24 }));
  assert.notStrictEqual(fingerprint(base), fingerprint({ ...base, sourceWeights: new Map([['a.com', 0.5]]) }));
  assert.notStrictEqual(fingerprint(base), fingerprint({ ...base, sourceWeights: new Map([['a.com', 0.5], ['b.com', 0.8]]) }));
}

// ------------------------------------------------------------ topic heat
// stories with an article in the last 48 h: story 1 (10 h ago) counts; story 2 (latest 100 h ago) and story 3 (undated) do not. engagement 99.
// heat = 1 + log10(1 + 99) = 3
{
  const arts = [
    art('a', 'a.com', 1, 10, { hn_points: 49, hn_comments: 0 }), art('b', 'b.com', 1, 60), art('c', 'c.com', 2, 100, { reddit_score: 50 }), art('d', 'd.com', 3, null),
  ];
  const h = (previous) => topicHeat(arts, { now: NOW, previous });
  assert.deepStrictEqual([h(null).value, h(null).clusters48h, h(null).engagement, h(null).label], [3, 1, 99, 'New']);
  assert.strictEqual(h(2).label, 'Rising', '3 >= 2 x 1.2');
  assert.strictEqual(h(2.5).label, 'Rising', '3 is exactly 2.5 x 1.2, which counts as Rising');
  assert.strictEqual(h(2.6).label, 'Steady', '3 is under 2.6 x 1.2 = 3.12');
  assert.strictEqual(h(3).label, 'Steady');
  assert.strictEqual(h(3.2).label, 'Steady', '3 is not 20% under 3.2 (2.56)');
  assert.strictEqual(h(4).label, 'Falling', '3 <= 4 x 0.8');
  assert.strictEqual(h(0).label, 'Rising', 'from nothing to something');
  assert.strictEqual(topicHeat([], { now: NOW, previous: 0 }).label, 'Steady', 'nothing then, nothing now');
  assert.strictEqual(topicHeat([], { now: NOW }).value, 0);
  assert.strictEqual(h(4).previous, 4);
  assert.strictEqual(h(undefined).label, 'New');
  // a story's freshness is its newest article: story 1 stays "recent" through its 60 h old article
  assert.strictEqual(topicHeat([art('x', 'x.com', 1, 60), art('y', 'y.com', 1, 40)], { now: NOW }).clusters48h, 1);
  assert.strictEqual(topicHeat([art('x', 'x.com', 1, 60), art('y', 'y.com', 1, 49)], { now: NOW }).clusters48h, 0);
}

console.log('topicResearch score: all passed');
