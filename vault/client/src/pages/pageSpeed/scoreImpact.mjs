// How many points fixing an action might add to a Page speed score. Used by the Actions tab, Copy action list and the PDF.
//
// - Accessibility, Best practices, SEO: Lighthouse scores these as a weighted average of pass/fail checks, so fixing one check adds
//   weight x (1 - its score) / total weight x 100 points. Exact, given the weights stored with the run (views from 2026-11-10 on).
// - Performance: a weighted mix of five timings, each turned into 0-1 by Lighthouse's log-normal curve. Each finding carries Google's
//   estimated saving per timing (metricSavings); we take that off the timing, re-score, and report the difference. An estimate, as
//   Google says of its own savings.
// Older runs have neither the weights nor the savings, so they show no estimate (run the test again).
// Test: node client/src/pages/pageSpeed/scoreImpact.test.mjs

// Lighthouse 10-12 scoring curves (p10 = score 0.9, median = score 0.5) and weights.
const CURVES = {
  mobile: { FCP: [1800, 3000], SI: [3387, 5800], LCP: [2500, 4000], TBT: [200, 600], CLS: [0.1, 0.25] },
  desktop: { FCP: [934, 1600], SI: [1311, 2300], LCP: [1200, 2400], TBT: [150, 350], CLS: [0.1, 0.25] },
};
const WEIGHTS = { FCP: 0.1, SI: 0.1, LCP: 0.25, TBT: 0.3, CLS: 0.25 };
const METRIC_AUDIT = {
  FCP: 'first-contentful-paint', SI: 'speed-index', LCP: 'largest-contentful-paint', TBT: 'total-blocking-time', CLS: 'cumulative-layout-shift',
};

// Abramowitz and Stegun 7.1.26, as Lighthouse uses.
function erf(x) {
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - y * Math.exp(-ax * ax));
}

/** Lighthouse's getLogNormalScore. */
export function logNormalScore([p10, median], value) {
  if (!(value > 0)) return 1;
  const standardizedX = (Math.log(Math.max(Number.MIN_VALUE, value / median)) * 0.9061938024368232) / -Math.log(p10 / median);
  const cp = (1 - erf(standardizedX)) / 2;
  if (value <= p10) return Math.max(0.9, Math.min(1, cp));
  if (value <= median) return Math.max(0.5, Math.min(0.89999999999999, cp));
  return Math.max(0, Math.min(0.49999999999999, cp));
}

/** The five timings of a view as { FCP, SI, LCP, TBT, CLS } (null if any is missing). */
export function metricValues(view) {
  const out = {};
  for (const [k, id] of Object.entries(METRIC_AUDIT)) {
    const m = (view?.metrics || []).find((x) => x.id === id);
    const v = Number(m?.numericValue);
    if (!Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

function formFactor(view) {
  const f = view?.environment?.formFactor || view?.strategy;
  return f === 'desktop' ? 'desktop' : 'mobile';
}

/** Performance score 0-100 (unrounded) from the five timings. */
export function perfScore(values, ff = 'mobile') {
  const curves = CURVES[ff] || CURVES.mobile;
  let s = 0;
  for (const k of Object.keys(WEIGHTS)) s += WEIGHTS[k] * logNormalScore(curves[k], values[k]);
  return s * 100;
}

function applySavings(values, savings) {
  const next = { ...values };
  for (const k of ['FCP', 'LCP', 'TBT', 'CLS']) {
    if (savings[k]) next[k] = Math.max(k === 'CLS' ? 0 : 1, values[k] - savings[k]);
  }
  return next;
}

/** Performance points one saving would add (current score is taken from the timings so rounding cancels out). */
export function perfGain(view, savings) {
  const values = metricValues(view);
  if (!values || !savings) return null;
  const ff = formFactor(view);
  const gain = perfScore(applySavings(values, savings), ff) - perfScore(values, ff);
  return Math.max(0, gain);
}

const CAT_SCORE_KEY = { performance: 'performance', accessibility: 'accessibility', 'best-practices': 'bestPractices', seo: 'seo' };

/** Points fixing one checked audit adds to its (non-performance) category. */
export function checkGain(view, audit, category) {
  const total = Number(view?.categoryWeights?.[category]);
  const w = Number(audit?.weight);
  if (!(total > 0) || !(w > 0)) return null;
  const s = audit.score == null ? 0 : Math.max(0, Math.min(1, Number(audit.score)));
  return (w * (1 - s) / total) * 100;
}

/**
 * Estimated impact of fixing one action: { category, points, exact, metricSavings } or null when the run has no data for it.
 * `audit` is the Lighthouse finding behind the action (with weight / metricSavings), `category` the action's category id.
 */
export function actionImpact(view, audit, category) {
  if (!audit) return null;
  if (category === 'performance' || (!category && audit.metricSavings)) {
    if (!audit.metricSavings) return null;
    const points = perfGain(view, audit.metricSavings);
    return points == null ? null : { category: 'performance', points, exact: false, metricSavings: audit.metricSavings };
  }
  const points = checkGain(view, audit, category);
  return points == null ? null : { category, points, exact: true };
}

/**
 * Combined estimate for a set of actions: { [category]: { from, to, gain } }. Performance savings overlap (two fixes often speed up
 * the same thing), so for each timing we take the largest single saving plus half of the rest, never below zero.
 */
export function combinedImpact(view, actions) {
  const out = {};
  const perf = actions.filter((a) => a.impact?.category === 'performance' && a.impact.metricSavings);
  const values = metricValues(view);
  if (perf.length && values) {
    const total = {};
    for (const k of ['FCP', 'LCP', 'TBT', 'CLS']) {
      const list = perf.map((a) => a.impact.metricSavings[k] || 0).filter((v) => v > 0).sort((x, y) => y - x);
      if (list.length) total[k] = list[0] + list.slice(1).reduce((n, v) => n + v, 0) / 2;
    }
    const ff = formFactor(view);
    const gain = Math.max(0, perfScore(applySavings(values, total), ff) - perfScore(values, ff));
    const from = Number(view.categories?.performance);
    if (Number.isFinite(from) && gain > 0) out.performance = { from, to: Math.min(100, Math.round(from + gain)), gain };
  }
  for (const cat of ['accessibility', 'best-practices', 'seo']) {
    const gain = actions.filter((a) => a.impact?.category === cat).reduce((n, a) => n + a.impact.points, 0);
    const from = Number(view.categories?.[CAT_SCORE_KEY[cat]]);
    if (Number.isFinite(from) && gain > 0) out[cat] = { from, to: Math.min(100, Math.round(from + gain)), gain };
  }
  return out;
}

/** "+6", "+<1" — for badges. */
export function pointsLabel(points) {
  if (points == null) return '';
  if (points < 0.5) return '+<1';
  return `+${Math.round(points)}`;
}

/** True when the run has the data to estimate anything (runs from 2026-11-10 on). */
export function hasImpactData(view) {
  return !!view?.categoryWeights;
}
