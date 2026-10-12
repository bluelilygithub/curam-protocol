'use strict';

/**
 * 5-year goal. Numbers (targets per year, what a dial change moves) come from code in targets.js.
 * AI only writes the explanation, with a rule-based fallback.
 */

const { DOMAINS, DOMAIN_LABELS, AMBITION_LEVELS, loadConfig } = require('./config');
const { pool } = require('../../db');
const T = require('./targets');
const { runJson, str, GUARDRAILS } = require('./ai');

function ambitionLabel(level) {
  return (AMBITION_LEVELS.find((a) => a.level === level) || AMBITION_LEVELS[2]).label;
}

function fallbackText(plan, diff) {
  const last = plan.milestones[plan.milestones.length - 1];
  const summary = `${ambitionLabel(plan.ambition)} pace: build to about ${last.weekly.aerobicModerateMin} minutes of aerobic activity a week, with strength on ${last.weekly.strengthDays} days, balance on ${last.weekly.balanceDays} and mobility on ${last.weekly.mobilityDays}, over five years. ${plan.regaining ? 'Because you have been fitter before, the first year can move a little faster.' : 'The first year is deliberately gentle and builds from there.'}`;
  let whatChanged = null;
  if (diff) {
    const bits = [];
    if (diff.aerobicMinutesPerWeek) bits.push(`${Math.abs(diff.aerobicMinutesPerWeek)} min a week ${diff.aerobicMinutesPerWeek > 0 ? 'more' : 'less'} aerobic activity`);
    if (diff.strengthDays) bits.push(`${Math.abs(diff.strengthDays)} ${diff.strengthDays > 0 ? 'extra' : 'fewer'} strength day`);
    if (diff.balanceDays) bits.push(`${Math.abs(diff.balanceDays)} ${diff.balanceDays > 0 ? 'extra' : 'fewer'} balance day`);
    if (diff.mobilityDays) bits.push(`${Math.abs(diff.mobilityDays)} ${diff.mobilityDays > 0 ? 'extra' : 'fewer'} mobility day`);
    const up = DOMAINS.filter((d) => diff.ratingChanges[d] !== 0).map((d) => `${DOMAIN_LABELS[d].toLowerCase()} ${diff.ratingChanges[d] > 0 ? '+' : ''}${diff.ratingChanges[d]}`);
    whatChanged = bits.length || up.length
      ? `Moving from ${ambitionLabel(diff.fromAmbition)} to ${ambitionLabel(diff.toAmbition)}: ${[...bits, up.length ? `five-year rating targets shift (${up.join(', ')})` : ''].filter(Boolean).join('; ')}.`
      : `Moving from ${ambitionLabel(diff.fromAmbition)} to ${ambitionLabel(diff.toAmbition)} does not change the weekly picture for your age band.`;
  }
  return { summary, whatChanged };
}

function validateGoalText(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  const summary = str(obj.summary, 800);
  if (!summary) return { ok: false, error: 'missing summary' };
  const whatChanged = obj.whatChanged == null ? null : str(obj.whatChanged, 700);
  return { ok: true, value: { summary, whatChanged } };
}

/**
 * Build a plan for an ambition and, optionally, the explanation of the change from another ambition.
 * `scores`/`previous` are 1-5 ratings; `profile` = { age, bandId }.
 */
async function buildGoalPlan({ userId, profile, scores, previous, ambition, fromAmbition, startsOn, notes, refresh }) {
  const cfg = await loadConfig(pool);
  const plan = T.buildMilestones({ bandId: profile.bandId, scores, previous, ambition, startsOn }, cfg);
  let diff = null;
  if (fromAmbition != null && T.clampAmbition(fromAmbition) !== plan.ambition) {
    const from = T.buildMilestones({ bandId: profile.bandId, scores, previous, ambition: fromAmbition, startsOn }, cfg);
    diff = T.diffPlans(from, plan);
  }

  const input = {
    age: profile.age,
    band: profile.bandId,
    ambition: { level: plan.ambition, label: ambitionLabel(plan.ambition) },
    currentRatings: scores,
    previousRatings: previous || null,
    regaining: plan.regaining,
    startMinutesPerWeek: plan.startMinutes,
    milestones: plan.milestones.map((m) => ({ year: m.year, phase: m.phase.label, ratings: m.ratings, weekly: m.weekly })),
    change: diff,
    userNotes: notes || null,
  };

  const system = `${GUARDRAILS}\nThe milestone numbers are fixed by the app. Explain them; never change or add numbers. Ratings are 1-5 self-ratings; decimals mean partway between two levels.`;
  const prompt = `Explain this 5-year fitness goal in plain language.\n\nDATA:\n${JSON.stringify(input, null, 1)}\n\nReturn JSON:\n{"summary": string (3-4 sentences: the shape of the five years and why year 1 is gentle),\n"whatChanged": ${diff ? 'string (2-3 sentences explaining, with the numbers in "change", what the ambition change means day to day, and that either pace is fine)' : 'null'}}`;

  const result = await runJson({
    userId,
    kind: 'goal',
    input,
    system,
    prompt,
    validate: validateGoalText,
    fallback: () => fallbackText(plan, diff),
    tier: 'standard',
    refresh,
    maxTokens: 1500,
  });

  const text = result.value;
  const milestones = plan.milestones;
  return {
    ambition: plan.ambition,
    ambitionLabel: ambitionLabel(plan.ambition),
    regaining: plan.regaining,
    startMinutes: plan.startMinutes,
    now: plan.now,
    endRatings: plan.endRatings,
    endWeekly: plan.endWeekly,
    milestones,
    summary: text.summary,
    whatChanged: text.whatChanged || (diff ? fallbackText(plan, diff).whatChanged : null),
    diff,
    source: result.source,
    model: result.model,
    note: result.note,
  };
}

module.exports = { buildGoalPlan, fallbackText, validateGoalText, ambitionLabel };
