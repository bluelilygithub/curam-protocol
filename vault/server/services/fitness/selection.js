'use strict';

/**
 * Which exercise goes in which slot. Pure code, so variety rules hold whatever the model says:
 *  - same movement pattern every week, but a different variation (rotate along the easier/harder links);
 *  - never the exact same session again within two weeks;
 *  - about a third of the slots are "keepers" repeated from last week (familiar movements are good);
 *  - only exercises the person can do with their equipment, at a level that fits (one level easier when easing/deload);
 *  - a short warm-up and cool-down drawn from the mobility and balance exercises.
 * The AI only chooses among the shortlist built here.
 */

const L = require('./library');

const STRENGTH_PLANS = [
  ['squat', 'push', 'pull', 'core'],
  ['hinge', 'lunge', 'push', 'core'],
  ['lunge', 'pull', 'carry', 'core'],
];
const ONLY_ONE_STRENGTH = ['squat', 'hinge', 'push', 'pull', 'core'];
const SHORTLIST = 4;
const KEEPER_EVERY = 3;

const DOMAIN_OF_PATTERN = {
  squat: 'strength', hinge: 'strength', lunge: 'strength', push: 'strength', pull: 'strength', core: 'strength', carry: 'strength',
  cardio: 'cardio', balance: 'balance', mobility: 'flexibility',
};

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rngFrom(seed) {
  let a = hashString(String(seed)) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isOutdoor = (e) => e.pattern === 'cardio' && e.settings.includes('outdoor') && !e.requires.some((r) => r === 'gym' || r === 'treadmill');

/** Slots for a session skeleton. `strengthIndex`/`strengthTotal` choose the movement plan; kind indexes feed the keepers. */
function buildSlots(session, { strengthIndex, strengthTotal }) {
  const slots = [];
  const push = (block, pattern, role) => slots.push({ block, pattern, role: role || null });
  push('warmup', 'mobility', 'warmup');
  push('warmup', 'mobility', 'warmup');
  for (const c of session.components) {
    if (c.domain === 'strength') {
      const plan = strengthTotal === 1 ? ONLY_ONE_STRENGTH : STRENGTH_PLANS[Math.min(strengthIndex, STRENGTH_PLANS.length - 1)];
      for (const p of plan) push('main', p);
    } else if (c.domain === 'cardio') push('main', 'cardio');
    else if (c.domain === 'balance') { push('main', 'balance'); push('main', 'balance'); }
    else if (c.domain === 'flexibility') { push('main', 'mobility'); push('main', 'mobility'); }
  }
  push('cooldown', 'mobility', 'cooldown');
  push('cooldown', 'mobility', 'cooldown');
  slots.forEach((s, i) => { s.index = i; });
  return slots;
}

/** Rating (1-5) the level cap for this pattern's domain comes from. */
function levelFor(pattern, ratings) {
  return L.levelName(ratings[DOMAIN_OF_PATTERN[pattern]] ?? 3);
}

/**
 * Candidates for one slot, best first.
 * @param {object} ctx { equipment, ratings, easier, lastUse: Map<slug, weeksAgo>, usedThisWeek:Set, usedInSession:Set, rng }
 */
function rankedCandidates(slot, ctx) {
  const lib = L.getLibrary().list;
  const role = slot.role || 'main';
  let cap = L.levelCap(levelFor(slot.pattern, ctx.ratings), ctx.easier);
  // Cardio level also follows how much cardio the week holds: jogging and hard intervals are not where someone starts
  // from a few easy sessions, whatever they once could do.
  if (slot.pattern === 'cardio' && ctx.cardioLimit) cap = Math.min(cap, ctx.cardioLimit);
  let pool = lib.filter((e) => {
    if (slot.block === 'main') { if (e.pattern !== slot.pattern || !e.roles.includes('main')) return false; } else if (!e.roles.includes(role)) return false;
    if (ctx.usedInSession.has(e.slug)) return false;
    if (ctx.hidden && ctx.hidden.has(e.slug)) return false; // "not for me"
    if (!L.isAvailable(e, ctx.equipment)) return false;
    if (!L.gateOpen(e, ctx.exposure, ctx.waivers)) return false;
    return e.level <= (slot.block === 'main' ? cap : 4);
  });
  // Warm-ups and cool-downs: variety across mobility and balance, gentle ones first.
  if (slot.block !== 'main') pool = pool.filter((e) => e.level <= 2);
  const last = ctx.lastUse;
  const score = (e) => {
    const ago = last.get(e.slug);
    let s = ago == null ? 0 : ago === 1 ? 6 : ago === 2 ? 3 : 1; // lower is better; recently used scores worse
    if (ctx.usedThisWeek.has(e.slug)) s += 4;
    // Prefer a neighbour of something done recently (same pattern, different variation).
    const neighbour = [...(e.easier || []), ...(e.harder || [])].some((n) => last.get(n) === 1);
    if (neighbour && ago == null) s -= 1;
    return s + ctx.rng() * 0.9;
  };
  return pool.map((e) => ({ e, s: score(e) })).sort((a, b) => a.s - b.s).map((x) => x.e);
}

const isKeeperSlot = (seed, key, index) => hashString(`${seed}:${key}:${index}`) % KEEPER_EVERY === 0;

function signature(slugs) {
  return [...slugs].sort().join('|');
}

// Below this many aerobic minutes a week, cardio stays at the gentler end (walking, easy riding, swimming, run/walk).
const GENTLE_CARDIO_BELOW = 90;
const GENTLE_CARDIO_LEVEL = 2;

module.exports = {
  GENTLE_CARDIO_BELOW, GENTLE_CARDIO_LEVEL,
  STRENGTH_PLANS, SHORTLIST, DOMAIN_OF_PATTERN,
  hashString, rngFrom, isOutdoor, buildSlots, levelFor, rankedCandidates, isKeeperSlot, signature,
};
