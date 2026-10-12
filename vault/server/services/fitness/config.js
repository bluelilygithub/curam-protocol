'use strict';

/**
 * Fitness Planner: editable config. Nothing here is logic; targets.js / goal.js read it.
 *
 * Sources
 *  - WHO Guidelines on physical activity and sedentary behaviour (2020), "at a glance". Checked 2026-10-12.
 *    All adults: 150-300 min moderate OR 75-150 min vigorous aerobic per week (or an equivalent mix),
 *    muscle-strengthening on 2+ days. Adults 65+: add varied multicomponent activity that emphasises
 *    functional balance and strength, moderate or greater intensity, on 3+ days.
 *  - Flexibility/mobility days, the "healthy range" self-rating bands, ambition ladder and rating-to-minutes
 *    mapping are PRODUCT DEFAULTS (WHO gives no figure for these). They are guides for a self-rated lifestyle
 *    tool, not clinical norms, and the UI says so.
 *
 * An admin can override any of this without a deploy: workspace_settings key `fitness_config_override`
 * (JSON, deep-merged over these defaults by loadConfig()).
 */

const CONFIG_VERSION = 'v1';

const DOMAINS = ['cardio', 'strength', 'flexibility', 'balance'];

const DOMAIN_LABELS = {
  cardio: 'Cardio',
  strength: 'Strength',
  flexibility: 'Flexibility & mobility',
  balance: 'Balance',
};

// Plain description per level, per domain. Same words everywhere so ratings stay consistent.
const RATING_SCALE = {
  cardio: [
    'Short walks or a flight of stairs leave me puffing.',
    'I can walk 15-20 minutes comfortably, but hills or a jog wear me out fast.',
    'I can walk briskly or cycle for 30-45 minutes and recover reasonably quickly.',
    'I can jog, swim or cycle at a solid effort for 30-60 minutes, most weeks.',
    'I train hard and often; long, demanding sessions feel manageable.',
  ],
  strength: [
    'Carrying shopping or getting up from a low chair is hard work.',
    'Everyday tasks are fine, but lifting or climbing stairs with a load tires me quickly.',
    'I can do 10 sit-to-stands without hands, carry groceries upstairs, and hold a plank for a few seconds.',
    'I lift moderate weights with good form and finish sets feeling strong.',
    'I lift challenging weights regularly across all the main movements.',
  ],
  flexibility: [
    'I feel stiff most days; reaching my feet or looking over my shoulder is difficult.',
    'I loosen up after warming up, but reaching my shins or the floor is a stretch.',
    'I can sit on the floor and get up again, and reach my ankles when seated.',
    'I move freely through most joints and can touch my toes or close to it.',
    'I have excellent range in hips, back and shoulders and keep it that way.',
  ],
  balance: [
    'I feel unsteady and avoid uneven ground or hold on to things.',
    'Flat ground is fine, but I can only stand on one leg for a few seconds.',
    'I can stand on one leg for about 10 seconds and walk on uneven ground comfortably.',
    'I can hold one leg for 20-30 seconds and feel steady on trails and steps.',
    'I am very steady on one leg (30+ seconds), including with eyes closed or while moving.',
  ],
};

const SEX_OPTIONS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'other', label: 'Other / prefer not to say' },
];

const EQUIPMENT = [
  { id: 'gym', label: 'Gym' },
  { id: 'pool', label: 'Pool' },
  { id: 'treadmill', label: 'Treadmill' },
  { id: 'bike', label: 'Bike' },
  { id: 'dumbbells', label: 'Dumbbells' },
  { id: 'trails', label: 'Trails / outdoors' },
  { id: 'bodyweight_home', label: 'Bodyweight at home' },
];

const SMOKING = [
  { id: 'none', label: 'Do not smoke' },
  { id: 'former', label: 'Former smoker' },
  { id: 'current', label: 'Smoke' },
];

const ALCOHOL = [
  { id: 'none', label: 'None' },
  { id: 'light', label: 'Light (a few a week)' },
  { id: 'moderate', label: 'Moderate (most days)' },
  { id: 'heavy', label: 'Heavy' },
];

const DIET_SCALE = [
  'Mostly takeaway or processed food.',
  'More processed than fresh food.',
  'A fair mix of both.',
  'Mostly fresh, home-cooked food.',
  'Consistently balanced, mostly whole foods.',
];

// Ambition ladder. 3 is the default proposal.
const AMBITION_LEVELS = [
  { level: 1, label: 'Gentle', blurb: 'Stay active and keep what you have, at the lower end of the WHO range.' },
  { level: 2, label: 'Easy-going', blurb: 'Steady habits with room to breathe.' },
  { level: 3, label: 'Balanced', blurb: 'Build toward a solid, sustainable level.' },
  { level: 4, label: 'Ambitious', blurb: 'More weekly work and a higher fitness level over five years.' },
  { level: 5, label: 'Stretch', blurb: 'The top of the sensible range for your age. Needs consistency.' },
];
const DEFAULT_AMBITION = 3;

const AGE_BANDS = [
  { id: '18-34', min: 18, max: 34, label: '18-34' },
  { id: '35-49', min: 35, max: 49, label: '35-49' },
  { id: '50-64', min: 50, max: 64, label: '50-64' },
  { id: '65-74', min: 65, max: 74, label: '65-74' },
  { id: '75+', min: 75, max: 120, label: '75 and over' },
];

// Per band: WHO aerobic range, strength/balance days, and the product-default mobility days.
// `aerobicCapModerate` is the most we ever propose in a week (equivalent moderate minutes), a safety ceiling.
const BAND_TARGETS = {
  '18-34': { aerobicModerateMin: 150, aerobicModerateMax: 300, aerobicCapModerate: 300, strengthDays: 2, strengthDaysHigh: 3, balanceDays: 1, balanceDaysHigh: 2, mobilityDays: 2, mobilityDaysHigh: 3, multicomponent: false },
  '35-49': { aerobicModerateMin: 150, aerobicModerateMax: 300, aerobicCapModerate: 300, strengthDays: 2, strengthDaysHigh: 3, balanceDays: 1, balanceDaysHigh: 2, mobilityDays: 2, mobilityDaysHigh: 3, multicomponent: false },
  '50-64': { aerobicModerateMin: 150, aerobicModerateMax: 300, aerobicCapModerate: 270, strengthDays: 2, strengthDaysHigh: 3, balanceDays: 2, balanceDaysHigh: 3, mobilityDays: 2, mobilityDaysHigh: 3, multicomponent: false },
  '65-74': { aerobicModerateMin: 150, aerobicModerateMax: 300, aerobicCapModerate: 240, strengthDays: 3, strengthDaysHigh: 3, balanceDays: 3, balanceDaysHigh: 3, mobilityDays: 3, mobilityDaysHigh: 3, multicomponent: true },
  '75+':   { aerobicModerateMin: 150, aerobicModerateMax: 300, aerobicCapModerate: 210, strengthDays: 3, strengthDaysHigh: 3, balanceDays: 3, balanceDaysHigh: 3, mobilityDays: 3, mobilityDaysHigh: 3, multicomponent: true },
};

// The "healthy range" on the 1-5 self-rating, per band and domain: [low, high]. `ceiling` is the highest
// level we propose as a 5-year target for that band (people can already be above it).
const HEALTHY_RANGE = {
  '18-34': { cardio: [3, 4], strength: [3, 4], flexibility: [3, 4], balance: [3, 4], ceiling: { cardio: 5, strength: 5, flexibility: 5, balance: 5 } },
  '35-49': { cardio: [3, 4], strength: [3, 4], flexibility: [3, 4], balance: [3, 4], ceiling: { cardio: 5, strength: 5, flexibility: 5, balance: 5 } },
  '50-64': { cardio: [3, 4], strength: [3, 4], flexibility: [3, 4], balance: [3, 4], ceiling: { cardio: 5, strength: 4, flexibility: 4, balance: 5 } },
  '65-74': { cardio: [3, 4], strength: [3, 4], flexibility: [3, 4], balance: [3, 4], ceiling: { cardio: 4, strength: 4, flexibility: 4, balance: 4 } },
  '75+':   { cardio: [2, 3], strength: [3, 4], flexibility: [2, 3], balance: [3, 4], ceiling: { cardio: 4, strength: 4, flexibility: 3, balance: 4 } },
};

// How a cardio self-rating maps to a rough current weekly aerobic minutes figure. Only used to draw the
// starting point of a milestone path. Rough on purpose.
const CARDIO_RATING_TO_MINUTES = { 1: 0, 2: 40, 3: 90, 4: 150, 5: 240 };

// How far the rating target moves above max(current, bottom of healthy range) per ambition level.
const AMBITION_RATING_BONUS = { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 };

// Share of the journey from today to the 5-year target reached by the end of each year.
const YEAR_CURVE = [0.45, 0.7, 0.85, 0.95, 1];
// Used when someone's earlier fitness was clearly higher (they are regaining, which comes back faster).
const YEAR_CURVE_REGAIN = [0.6, 0.8, 0.9, 0.97, 1];

// Self-ratings move more slowly than weekly minutes, so the expected rating at the end of each year is a gradual
// climb (shown to one decimal: 3.4 means "between 3 and 4"). Year 5 always lands on the whole-number target.
const YEAR_CURVE_RATINGS = [0.2, 0.42, 0.64, 0.84, 1];
const YEAR_CURVE_RATINGS_REGAIN = [0.3, 0.52, 0.72, 0.89, 1];

// What each year is mostly about. Ambitious paces keep building for longer before consolidating.
const PHASES = {
  base: { label: 'Rebuild base', focus: 'Easy, regular, steady' },
  build: { label: 'Build', focus: 'Add time and strength' },
  consolidate: { label: 'Consolidate', focus: 'Make it a habit' },
  maintain: { label: 'Maintain', focus: 'Keep what you have built' },
};
const YEAR_PHASES = {
  gentle: ['base', 'build', 'consolidate', 'consolidate', 'maintain'],
  ambitious: ['base', 'build', 'build', 'consolidate', 'maintain'],
};

// Re-rating cadence in weeks (soft prompt at `soft`, firm at `firm`).
const RERATE = { softWeeks: 4, firmWeeks: 6 };

// Defaults pre-filled by age band + sex. Sex only nudges a couple of suggestions; nothing here is a verdict.
const AGE_TEMPLATES = {
  '18-34': { ratings: { cardio: 3, strength: 3, flexibility: 3, balance: 4 }, previous: { cardio: 3, strength: 3, flexibility: 3, balance: 4 }, previousLabel: '5 years ago', equipment: ['bodyweight_home', 'trails'], smoking: 'none', alcohol: 'light', dietQuality: 3, timeFlexibility: { mode: 'fixed', twiceDaily: false } },
  '35-49': { ratings: { cardio: 3, strength: 3, flexibility: 2, balance: 3 }, previous: { cardio: 3, strength: 3, flexibility: 3, balance: 4 }, previousLabel: '5 years ago', equipment: ['bodyweight_home', 'trails'], smoking: 'none', alcohol: 'light', dietQuality: 3, timeFlexibility: { mode: 'fixed', twiceDaily: false } },
  '50-64': { ratings: { cardio: 3, strength: 3, flexibility: 2, balance: 3 }, previous: { cardio: 3, strength: 3, flexibility: 3, balance: 3 }, previousLabel: '5 years ago', equipment: ['bodyweight_home', 'trails'], smoking: 'none', alcohol: 'light', dietQuality: 3, timeFlexibility: { mode: 'flexible', twiceDaily: false } },
  '65-74': { ratings: { cardio: 3, strength: 2, flexibility: 2, balance: 3 }, previous: { cardio: 3, strength: 3, flexibility: 3, balance: 3 }, previousLabel: '5 years ago', equipment: ['bodyweight_home', 'trails'], smoking: 'none', alcohol: 'light', dietQuality: 3, timeFlexibility: { mode: 'flexible', twiceDaily: false } },
  '75+':   { ratings: { cardio: 2, strength: 2, flexibility: 2, balance: 2 }, previous: { cardio: 3, strength: 3, flexibility: 2, balance: 3 }, previousLabel: '5 years ago', equipment: ['bodyweight_home'], smoking: 'none', alcohol: 'none', dietQuality: 3, timeFlexibility: { mode: 'flexible', twiceDaily: false } },
};

const DISCLAIMER = 'This app is a lifestyle tool, not medical advice. It does not replace a doctor, physio or mental health professional. If you have a health condition, or you are unsure whether an activity is right for you, check with your GP first.';

const DEFAULT_TIMEZONE = 'Australia/Brisbane';

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}

const DEFAULTS = {
  version: CONFIG_VERSION,
  bandTargets: BAND_TARGETS,
  healthyRange: HEALTHY_RANGE,
  cardioRatingToMinutes: CARDIO_RATING_TO_MINUTES,
  ambitionRatingBonus: AMBITION_RATING_BONUS,
  yearCurve: YEAR_CURVE,
  yearCurveRegain: YEAR_CURVE_REGAIN,
  yearCurveRatings: YEAR_CURVE_RATINGS,
  yearCurveRatingsRegain: YEAR_CURVE_RATINGS_REGAIN,
  phases: PHASES,
  yearPhases: YEAR_PHASES,
  rerate: RERATE,
  ageTemplates: AGE_TEMPLATES,
};

/** Defaults deep-merged with the admin override (workspace_settings `fitness_config_override`), if any. */
async function loadConfig(pool) {
  if (!pool) return DEFAULTS;
  try {
    const { rows } = await pool.query("SELECT value FROM workspace_settings WHERE key='fitness_config_override' LIMIT 1");
    if (!rows[0]?.value) return DEFAULTS;
    const parsed = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    return isPlainObject(parsed) ? deepMerge(DEFAULTS, parsed) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

module.exports = {
  CONFIG_VERSION,
  DOMAINS,
  DOMAIN_LABELS,
  RATING_SCALE,
  SEX_OPTIONS,
  EQUIPMENT,
  SMOKING,
  ALCOHOL,
  DIET_SCALE,
  AMBITION_LEVELS,
  DEFAULT_AMBITION,
  AGE_BANDS,
  DISCLAIMER,
  DEFAULT_TIMEZONE,
  DEFAULTS,
  loadConfig,
  deepMerge,
};
