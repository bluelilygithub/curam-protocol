'use strict';

/**
 * Baseline assessment: where you are now, what is healthy for your age (WHO-based), what to do weekly.
 * The numbers and comparison come from code (targets.js). Only the wording is AI, with a rule-based fallback.
 */

const { DOMAINS, DOMAIN_LABELS, loadConfig } = require('./config');
const { pool } = require('../../db');
const T = require('./targets');
const { runJson, str, strList, GUARDRAILS } = require('./ai');

function weeklyToMaintain(bandId, cfg) {
  const t = cfg.bandTargets[bandId];
  const items = [
    `${t.aerobicModerateMin}-${t.aerobicModerateMax} minutes of moderate aerobic activity (or half that at a vigorous effort), spread across the week.`,
    `Muscle-strengthening on ${t.strengthDays} or more days, working the major muscle groups.`,
  ];
  if (t.multicomponent) {
    items.push('Varied multicomponent activity that emphasises balance and strength on 3 or more days. This is the WHO advice for people 65 and over, and it helps prevent falls.');
  } else {
    items.push(`A little balance work on ${t.balanceDays}+ day${t.balanceDays > 1 ? 's' : ''}; it matters more with age, so it pays to keep it going.`);
  }
  items.push(`Some mobility or stretching on ${t.mobilityDays}+ days to keep joints moving freely.`);
  items.push('Sit less where you can, and break up long sitting with a short walk.');
  return items;
}

/** Everything about the baseline that is not wording. */
async function buildBaselineData({ age, bandId, sex, scores, previous, previousLabel }) {
  const cfg = await loadConfig(pool);
  const band = cfg.bandTargets[bandId];
  return {
    age,
    bandId,
    sex,
    previousLabel: previousLabel || null,
    comparison: T.compareToRange(bandId, scores, previous, cfg),
    who: {
      aerobicModerateMin: band.aerobicModerateMin,
      aerobicModerateMax: band.aerobicModerateMax,
      strengthDays: band.strengthDays,
      balanceDays: band.multicomponent ? 3 : band.balanceDays,
      multicomponent: !!band.multicomponent,
    },
    weeklyToMaintain: weeklyToMaintain(bandId, cfg),
  };
}

function sentenceList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function fallbackNarrative(data) {
  const building = data.comparison.filter((c) => c.status === 'building').map((c) => DOMAIN_LABELS[c.domain].toLowerCase());
  const inRange = data.comparison.filter((c) => c.status === 'in_range').map((c) => DOMAIN_LABELS[c.domain].toLowerCase());
  const above = data.comparison.filter((c) => c.status === 'above').map((c) => DOMAIN_LABELS[c.domain].toLowerCase());
  const parts = [];
  if (inRange.length) parts.push(`You rated ${sentenceList(inRange)} within the healthy range for your age.`);
  if (above.length) parts.push(`You rated ${sentenceList(above)} above it, which is a great base to keep.`);
  if (building.length) parts.push(`${sentenceList(building)} ${building.length > 1 ? 'are' : 'is'} where there is most room to build.`);
  const regain = data.comparison.some((c) => c.before != null && c.before > c.now);
  return {
    headline: building.length ? 'A solid starting point, with clear places to build' : 'You are starting from a good place',
    whereYouAre: parts.join(' ') + (regain ? ' You have been fitter before, and that history helps: things tend to come back faster than they were first built.' : ''),
    whereYouShouldBe: `For your age (${data.bandId}), the WHO suggests ${data.who.aerobicModerateMin}-${data.who.aerobicModerateMax} minutes of moderate aerobic activity a week and muscle-strengthening on ${data.who.strengthDays}+ days${data.who.multicomponent ? ', plus balance and strength work on 3+ days' : ''}.`,
    weeklyToMaintain: data.weeklyToMaintain.slice(0, 5),
    encouragement: 'Rest days and quiet weeks are part of it. Small, steady habits do the work.',
  };
}

function validateNarrative(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  const headline = str(obj.headline, 140);
  const whereYouAre = str(obj.whereYouAre, 900);
  const whereYouShouldBe = str(obj.whereYouShouldBe, 900);
  const weekly = strList(obj.weeklyToMaintain, { min: 3, max: 6, each: 260 });
  const encouragement = str(obj.encouragement, 300);
  if (!headline || !whereYouAre || !whereYouShouldBe || !weekly || !encouragement) return { ok: false, error: 'missing or empty field' };
  return { ok: true, value: { headline, whereYouAre, whereYouShouldBe, weeklyToMaintain: weekly, encouragement } };
}

async function buildBaseline({ userId, profile, scores, previous, previousLabel, notes, refresh }) {
  const data = await buildBaselineData({ age: profile.age, bandId: profile.bandId, sex: profile.sex, scores, previous, previousLabel });

  const input = {
    age: data.age,
    band: data.bandId,
    sex: data.sex,
    ratings: data.comparison.map((c) => ({ domain: DOMAIN_LABELS[c.domain], now: c.now, before: c.before, healthyRange: [c.low, c.high], status: c.status })),
    previousLabel: data.previousLabel,
    who: data.who,
    weeklyToMaintain: data.weeklyToMaintain,
    lifestyle: profile.lifestyleSummary || null,
    userNotes: notes || null,
  };

  const system = `${GUARDRAILS}\nScale: ratings are 1 (lowest) to 5 (highest) per domain. "building" means below the healthy range for this age band, "in_range" within it, "above" over it. Describe these gently.`;
  const prompt = `Write a short baseline assessment for this person.\n\nDATA:\n${JSON.stringify(input, null, 1)}\n\nReturn JSON:\n{"headline": string (max 120 chars), "whereYouAre": string (2-4 sentences using the ratings; mention any earlier fitness shown by "before" as a head start), "whereYouShouldBe": string (2-3 sentences on the WHO-based weekly picture for their age), "weeklyToMaintain": array of 3-5 short strings based on the weeklyToMaintain list, "encouragement": string (1 sentence, never guilt-inducing)}`;

  const result = await runJson({
    userId,
    kind: 'baseline',
    input,
    system,
    prompt,
    validate: validateNarrative,
    fallback: () => fallbackNarrative(data),
    tier: 'standard',
    refresh,
    maxTokens: 900,
  });

  return { data, narrative: result.value, source: result.source, model: result.model, note: result.note };
}

module.exports = { buildBaseline, buildBaselineData, fallbackNarrative, validateNarrative, weeklyToMaintain };
