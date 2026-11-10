// node client/src/pages/pageSpeed/scoreImpact.test.mjs   (Page speed score estimates). No network.
import assert from 'assert';
import { logNormalScore, perfScore, perfGain, checkGain, actionImpact, combinedImpact, pointsLabel, hasImpactData } from './scoreImpact.mjs';

const near = (a, b, tol, why) => assert.ok(Math.abs(a - b) <= tol, `${why}: ${a} vs ${b}`);

// the curve hits Lighthouse's anchor points
near(logNormalScore([2500, 4000], 4000), 0.5, 0.001, 'median scores 0.5');
near(logNormalScore([2500, 4000], 2500), 0.9, 0.001, 'p10 scores 0.9');
assert.strictEqual(logNormalScore([2500, 4000], 0), 1);
assert.ok(logNormalScore([2500, 4000], 20000) < 0.05, 'very slow scores near 0');

// all timings at their medians -> 50; all at p10 -> 90
near(perfScore({ FCP: 3000, SI: 5800, LCP: 4000, TBT: 600, CLS: 0.25 }, 'mobile'), 50, 0.2, 'medians give 50');
near(perfScore({ FCP: 1800, SI: 3387, LCP: 2500, TBT: 200, CLS: 0.1 }, 'mobile'), 90, 0.2, 'p10s give 90');
near(perfScore({ FCP: 1600, SI: 2300, LCP: 2400, TBT: 350, CLS: 0.25 }, 'desktop'), 50, 0.2, 'desktop curves');

const metrics = (o) => Object.entries({
  'first-contentful-paint': o.FCP, 'speed-index': o.SI, 'largest-contentful-paint': o.LCP, 'total-blocking-time': o.TBT, 'cumulative-layout-shift': o.CLS,
}).map(([id, numericValue]) => ({ id, numericValue }));
const view = {
  strategy: 'mobile',
  categories: { performance: 41, accessibility: 79, bestPractices: 78, seo: 83 },
  categoryWeights: { performance: 100, accessibility: 50, 'best-practices': 20, seo: 10 },
  metrics: metrics({ FCP: 3100, SI: 4900, LCP: 5400, TBT: 420, CLS: 0.05 }),
};

const g = perfGain(view, { LCP: 780, FCP: 780 });
assert.ok(g > 3 && g < 15, `a 780 ms LCP/FCP saving is worth a few points (${g})`);
assert.strictEqual(perfGain(view, {}), 0, 'no saving, no gain');
assert.strictEqual(perfGain({ metrics: [] }, { LCP: 500 }), null, 'no timings, no estimate');

assert.strictEqual(checkGain(view, { weight: 10, score: 0 }, 'accessibility'), 20, '10 of 50 weight = 20 points');
assert.strictEqual(checkGain(view, { weight: 10, score: 0.5 }, 'accessibility'), 10, 'a half-passed check is worth half');
assert.strictEqual(checkGain(view, { weight: 0, score: 0 }, 'accessibility'), null, 'zero-weight checks are not scored');
assert.strictEqual(checkGain({ categories: {} }, { weight: 10, score: 0 }, 'accessibility'), null, 'old runs: no weights, no estimate');

const a1 = actionImpact(view, { metricSavings: { LCP: 780 } }, 'performance');
assert.ok(a1.points > 0 && a1.exact === false);
const a2 = actionImpact(view, { weight: 7, score: 0 }, 'accessibility');
assert.ok(a2.exact && Math.round(a2.points) === 14);
assert.strictEqual(actionImpact(view, { score: 0 }, 'performance'), null, 'performance finding without savings -> none');

const combo = combinedImpact(view, [
  { impact: actionImpact(view, { metricSavings: { LCP: 780, FCP: 780 } }, 'performance') },
  { impact: actionImpact(view, { metricSavings: { LCP: 600 } }, 'performance') },
  { impact: a2 },
  { impact: actionImpact(view, { weight: 40, score: 0 }, 'accessibility') },
]);
assert.ok(combo.performance.to > 41 && combo.performance.to <= 100);
assert.strictEqual(combo.accessibility.to, 100, 'capped at 100');
assert.strictEqual(pointsLabel(0.2), '+<1');
assert.strictEqual(pointsLabel(6.4), '+6');
assert.ok(hasImpactData(view) && !hasImpactData({}));

console.log('scoreImpact tests passed');
