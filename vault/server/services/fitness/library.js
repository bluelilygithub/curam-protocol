'use strict';

/**
 * Exercise library. The versioned seed file (server/seeds/fitnessExercises.v1.json) is the single source of exercises:
 * the AI picks from it and never invents exercises, and video/image links only come from a human editing the file.
 * The fitness_exercises table mirrors the file (upserted by slug on boot) so later stages can join logs to it.
 */

const SEED = require('../../seeds/fitnessExercises.v1.json');

const PATTERNS = ['squat', 'hinge', 'lunge', 'push', 'pull', 'core', 'carry', 'cardio', 'balance', 'mobility'];
const DOMAIN_IDS = ['cardio', 'strength', 'flexibility', 'balance'];
const SETTINGS = ['gym', 'pool', 'outdoor', 'home'];
const EQUIPMENT_IDS = ['gym', 'pool', 'treadmill', 'bike', 'dumbbells', 'bands', 'trails', 'bodyweight_home'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
// Patterns that must have a progression chain (an easier and a harder end).
const CHAINED = ['squat', 'hinge', 'lunge', 'push', 'pull', 'core', 'cardio', 'balance'];

let cache = null;

function loadSeed() {
  return SEED;
}

/** All exercises, indexed. */
function getLibrary() {
  if (!cache) {
    const list = SEED.exercises;
    cache = { version: SEED.version, list, bySlug: new Map(list.map((e) => [e.slug, e])), effortScale: SEED.effortScale };
  }
  return cache;
}

/**
 * Hard checks on the seed. Returns { ok, errors }. Run in tests and at boot (logged, never fatal).
 */
function validateLibrary(data = SEED) {
  const errors = [];
  const list = data.exercises || [];
  const slugs = new Set();
  for (const e of list) {
    if (!/^[a-z0-9-]+$/.test(e.slug || '')) errors.push(`bad slug: ${e.slug}`);
    if (slugs.has(e.slug)) errors.push(`duplicate slug: ${e.slug}`);
    slugs.add(e.slug);
  }
  for (const e of list) {
    const at = (m) => errors.push(`${e.slug}: ${m}`);
    if (!e.name) at('missing name');
    if (!PATTERNS.includes(e.pattern)) at(`unknown pattern ${e.pattern}`);
    if (!Array.isArray(e.domains) || !e.domains.length || e.domains.some((d) => !DOMAIN_IDS.includes(d))) at('bad domains');
    if (!Array.isArray(e.settings) || !e.settings.length || e.settings.some((s) => !SETTINGS.includes(s))) at('bad settings');
    if (!Array.isArray(e.requires) || e.requires.some((r) => !EQUIPMENT_IDS.includes(r))) at('bad requires');
    if (!Number.isInteger(e.level) || e.level < 1 || e.level > 4) at('level must be 1-4');
    if (!Array.isArray(e.steps) || e.steps.length < 3 || e.steps.length > 6) at('needs 3-6 steps');
    if (!Array.isArray(e.mistakes) || e.mistakes.length < 1 || e.mistakes.some((m) => !m.mistake || !m.fix)) at('needs mistakes with fixes');
    if (!e.whyFormMatters) at('missing whyFormMatters');
    if (!e.dosage || LEVELS.some((l) => !e.dosage[l])) at('dosage needs beginner/intermediate/advanced');
    for (const link of [...(e.easier || []), ...(e.harder || [])]) if (!slugs.has(link)) at(`link to unknown exercise ${link}`);
    // The AI never creates links. A video/image may only be present once a person has reviewed it.
    for (const k of ['videoUrl', 'imageUrl']) {
      if (e[k] != null && !(typeof e[k] === 'string' && e[k].startsWith('https://') && e.linksReviewedBy)) at(`${k} needs https and linksReviewedBy`);
    }
    for (const r of e.roles || []) if (!['main', 'warmup', 'cooldown'].includes(r)) at(`bad role ${r}`);
    if (!e.effort) at('missing effort guidance (talk test and 1-10 scale)');
    if (e.setup && (!Array.isArray(e.setup) || e.setup.length < 3 || e.setup.length > 4)) at('setup needs 3-4 cues');
    if (e.gate) {
      if (!Array.isArray(e.gate.after) || !e.gate.after.length || !Number.isInteger(e.gate.weeks)) at('bad gate');
      if (e.gate.comfortable && !(e.gate.comfortable.maxEffort >= 1 && e.gate.comfortable.maxEffort <= 10)) at('bad comfortable gate');
      for (const group of e.gate.after || []) for (const g of group) if (!slugs.has(g)) at(`gate refers to unknown exercise ${g}`);
    }
  }
  if (!Array.isArray(data.effortScale) || data.effortScale.length < 5) errors.push('effortScale (1-10 with talk test) is missing');
  for (const need of ['leg-press', 'assisted-pull-up']) {
    const e = list.find((x) => x.slug === need);
    if (!e || !e.setup) errors.push(`${need} needs 3-4 set-up cues`);
  }
  for (const need of ['goblet-squat', 'dumbbell-romanian-deadlift', 'supported-dumbbell-row', 'bent-over-dumbbell-row', 'farmers-carry']) {
    const e = list.find((x) => x.slug === need);
    if (!e || !e.loadGuide) errors.push(`${need} needs a starting-load suggestion`);
  }
  for (const p of PATTERNS) if (!list.some((e) => e.pattern === p)) errors.push(`no exercise for pattern ${p}`);
  for (const p of CHAINED) {
    const inP = list.filter((e) => e.pattern === p);
    if (!inP.some((e) => e.level === 1 || !(e.easier || []).length)) errors.push(`pattern ${p} has no easy end`);
    if (!inP.some((e) => (e.harder || []).length)) errors.push(`pattern ${p} has no harder step`);
  }
  if (list.filter((e) => (e.roles || []).includes('warmup')).length < 4) errors.push('need at least 4 warm-up exercises');
  if (list.filter((e) => (e.roles || []).includes('cooldown')).length < 3) errors.push('need at least 3 cool-down exercises');
  if (list.length < 40 || list.length > 50) errors.push(`library size ${list.length} outside 40-50`);
  return { ok: errors.length === 0, errors };
}

/** Can this person do the exercise with what they have? No `requires` = needs nothing. */
function isAvailable(exercise, equipment) {
  if (!exercise.requires.length) return true;
  const have = new Set(equipment || []);
  return exercise.requires.some((r) => have.has(r));
}

/**
 * Some exercises open up only after others have been in the program for a while ("exposure" = number of earlier weeks
 * an exercise appeared in the main work). `gate.after` is a list of groups; every group needs at least one member with
 * enough weeks. A `waivedBy` reason (for example a running history) skips the wait; the weekly-minutes rule still applies.
 * Stage 3 adds "rated comfortable" from logged effort.
 */
function gateOpen(exercise, exposure, waivers = {}, comfort = null) {
  const g = exercise.gate;
  if (!g) return true;
  if (g.waivedBy && waivers[g.waivedBy]) return true;
  // a gate marked `comfortable` counts only weeks where the exercise was LOGGED at or under the comfortable effort
  const seen = (g.comfortable ? comfort : exposure) || new Map();
  return g.after.every((group) => group.some((slug) => (seen.get(slug) || 0) >= g.weeks));
}

/** Highest exercise level allowed for a rating-derived level name, one lower when easing or in a deload week. */
function levelCap(levelName, easier = false) {
  const base = { beginner: 2, intermediate: 3, advanced: 4 }[levelName] || 2;
  return Math.max(1, easier ? base - 1 : base);
}

/** Self-rating (1-5) to a level name. */
function levelName(rating) {
  if (rating <= 2) return 'beginner';
  if (rating === 3) return 'intermediate';
  return 'advanced';
}

/** Mirrors the seed into the fitness_exercises table. Safe to run on every boot. */
async function seedLibrary(pool) {
  const check = validateLibrary();
  if (!check.ok) console.error('[fitness] exercise library failed validation:', check.errors.slice(0, 10));
  for (const e of SEED.exercises) {
    await pool.query(
      `INSERT INTO fitness_exercises (slug, name, pattern, domains, data, "libraryVersion")
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, pattern=EXCLUDED.pattern, domains=EXCLUDED.domains,
         data=EXCLUDED.data, "libraryVersion"=EXCLUDED."libraryVersion", "updatedAt"=NOW()`,
      [e.slug, e.name, e.pattern, JSON.stringify(e.domains), JSON.stringify(e), SEED.version],
    );
  }
}

module.exports = {
  PATTERNS, LEVELS, CHAINED, SETTINGS,
  loadSeed, getLibrary, validateLibrary, isAvailable, gateOpen, levelCap, levelName, seedLibrary,
};
