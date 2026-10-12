'use strict';

/**
 * Week skeleton and rest handling. Pure code: where sessions go, how rest days work, and the soft notes shown when
 * someone moves things around. Days are 0 = Monday ... 6 = Sunday. Slots: morning | midday | evening.
 *
 * Rest is never a failure. Planned rest days and rest-budget days are recorded as rest (kind 'planned' | 'budget');
 * a session left undone on a rest day gets status 'rest', which is stored differently from 'skipped' (Stage 3) so
 * charts can show planned versus done honestly. Rebalancing only ever moves a session to a free slot or lets it go:
 * it never stacks missed work onto later days.
 */

const SLOTS = ['morning', 'midday', 'evening'];
const SLOT_HOURS = { morning: 8, midday: 12.5, evening: 18 };
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STRENGTH_GAP_HOURS = 48;
const WARMUP_MIN = 5;
const COOLDOWN_MIN = 5;

const STRENGTH_MIN = 30;
const BALANCE_MIN = 8;
const MOBILITY_MIN = 8;
const MIXED_MIN = 16;

const DOMAIN_TITLES = { cardio: 'Cardio', strength: 'Strength', balance: 'Balance', flexibility: 'Mobility' };

const REST_PREFERENCE = [6, 3, 2, 5, 1, 4, 0]; // Sunday, Thursday, Wednesday ...
const AEROBIC_DAY_PREFERENCE = [5, 1, 4, 6, 3, 0, 2]; // long one on Saturday when free

// Southern-hemisphere zones get hot Nov-Mar; elsewhere hot Jun-Aug. Config-like, kept here with the rule it serves.
const SOUTHERN_PREFIXES = ['Australia/', 'Pacific/Auckland', 'Pacific/Fiji', 'Africa/Johannesburg', 'America/Sao_Paulo', 'America/Argentina', 'America/Santiago', 'Antarctica/'];
const HOT_SOUTH = [11, 12, 1, 2, 3];
const HOT_NORTH = [6, 7, 8];

function isHotMonth(iso, timeZone) {
  const month = Number(iso.slice(5, 7));
  const south = SOUTHERN_PREFIXES.some((p) => String(timeZone || '').startsWith(p));
  return (south ? HOT_SOUTH : HOT_NORTH).includes(month);
}

function hourOf(day, slot) {
  return day * 24 + SLOT_HOURS[slot];
}

/** Evenly spread n picks across a sorted list. */
function spread(list, n) {
  if (n <= 0 || !list.length) return [];
  if (n >= list.length) return [...list];
  if (n === 1) return [list[Math.floor(list.length / 2)]];
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

/**
 * @param {object} p
 * @param {{aerobicMinutes:number, strengthDays:number, balanceDays:number, mobilityDays:number}} p.targets
 * @param {number} [p.plannedRest=2]
 * @param {boolean} [p.twiceDaily=false]
 * @param {number} [p.intensity=1]  0.8 = shorter strength blocks (deload / easing)
 */
function buildSkeleton({ targets, plannedRest = 2, twiceDaily = false, intensity = 1 }) {
  const cap = twiceDaily ? 2 : 1;
  const strengthDays = { 0: [], 1: [2], 2: [0, 3], 3: [0, 2, 4] }[Math.min(targets.strengthDays, 3)];
  const restDays = [];
  for (const d of REST_PREFERENCE) {
    if (restDays.length >= plannedRest) break;
    if (!strengthDays.includes(d)) restDays.push(d);
  }
  const training = [0, 1, 2, 3, 4, 5, 6].filter((d) => !restDays.includes(d));
  const byDay = new Map(training.map((d) => [d, []]));
  const add = (day, s) => byDay.get(day).push(s);

  for (const d of strengthDays) add(d, { kind: 'strength', components: [{ domain: 'strength', minutes: round5(STRENGTH_MIN * intensity) }] });

  // Aerobic sessions: 25-60 minutes each, long one on a free weekend day, extra ones only where a day has room.
  let shortfall = 0;
  if (targets.aerobicMinutes > 0) {
    const n = Math.min(4, Math.max(1, Math.round(targets.aerobicMinutes / 40)));
    const freeDays = AEROBIC_DAY_PREFERENCE.filter((d) => training.includes(d) && !strengthDays.includes(d));
    const dayList = [...freeDays];
    for (const d of training) if (!dayList.includes(d)) dayList.push(d); // strength days last, as second sessions
    let remaining = targets.aerobicMinutes;
    let placed = 0;
    for (const d of dayList) {
      if (placed >= n) break;
      if (byDay.get(d).length >= cap) continue;
      const left = n - placed;
      const share = placed === 0 && left > 1 ? Math.min(75, round5((remaining / left) * 1.25)) : round5(remaining / left);
      const minutes = Math.min(remaining, share);
      add(d, { kind: 'aerobic', components: [{ domain: 'cardio', minutes }] });
      remaining -= minutes;
      placed += 1;
    }
    if (remaining > 4) {
      // No room for another session today-style: lengthen the aerobic sessions we have (up to 75), drop the rest.
      const aer = [...byDay.values()].flat().filter((s) => s.kind === 'aerobic');
      for (const s of aer) {
        const room = 75 - s.components[0].minutes;
        const add5 = Math.min(room, remaining);
        s.components[0].minutes += add5;
        remaining -= add5;
      }
      shortfall = Math.max(0, remaining);
    }
  }

  // Balance and mobility attach to sessions on distinct days (they can share a session); a short mixed session fills a bare day.
  const attach = (domain, minutes, count, avoid = []) => {
    const pool = training.filter((d) => !avoid.includes(d));
    const days = spread(pool.length >= count ? pool : training, count);
    const used = [];
    for (const d of days) {
      const list = byDay.get(d);
      if (list.length) list[0].components.push({ domain, minutes });
      else add(d, { kind: 'mixed', components: [{ domain, minutes: Math.max(minutes, MIXED_MIN / 2) }] });
      used.push(d);
    }
    return used;
  };
  const balanceUsed = attach('balance', BALANCE_MIN, targets.balanceDays);
  attach('flexibility', MOBILITY_MIN, targets.mobilityDays, balanceUsed);

  const sessions = [];
  for (const d of training) {
    const list = byDay.get(d);
    // Merge two mixed bits onto one bare day into a single short session.
    const mixed = list.filter((s) => s.kind === 'mixed');
    if (mixed.length > 1) {
      const keep = mixed[0];
      for (const extra of mixed.slice(1)) {
        keep.components.push(...extra.components);
        list.splice(list.indexOf(extra), 1);
      }
    }
    list.forEach((s, i) => {
      sessions.push({
        day: d,
        slot: i === 0 ? 'morning' : 'evening',
        kind: s.kind,
        components: s.components,
        title: [...new Set(s.components.map((c) => DOMAIN_TITLES[c.domain]))].join(' + '),
        warmupMin: WARMUP_MIN,
        cooldownMin: COOLDOWN_MIN,
      });
    });
  }
  sessions.sort((a, b) => a.day - b.day || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  sessions.forEach((s, i) => { s.key = `s${i + 1}`; });
  return { sessions, restDays: restDays.map((day) => ({ day, kind: 'planned' })), shortfall };
}

const isStrength = (s) => (s.components || []).some((c) => c.domain === 'strength') || s.strength === true;

/** Soft notes about the current arrangement. Never a block: the person decides. */
function softNotes(sessions, { hotOutdoor = false } = {}) {
  const live = sessions.filter((s) => s.status !== 'rest');
  const notes = [];
  const strong = live.filter(isStrength).sort((a, b) => hourOf(a.day, a.slot) - hourOf(b.day, b.slot));
  for (let i = 1; i < strong.length; i += 1) {
    const gap = hourOf(strong[i].day, strong[i].slot) - hourOf(strong[i - 1].day, strong[i - 1].slot);
    if (gap < STRENGTH_GAP_HOURS) {
      notes.push(`Two strength sessions (${DAY_NAMES[strong[i - 1].day]} ${strong[i - 1].slot} and ${DAY_NAMES[strong[i].day]} ${strong[i].slot}) are less than 48 hours apart. That is fine if it suits you; a day in between usually helps muscles recover.`);
    }
  }
  if (hotOutdoor) {
    for (const s of live) {
      if (s.outdoor && s.slot === 'midday') notes.push(`${DAY_NAMES[s.day]}'s outdoor session is at midday. It can be hot at this time of year; morning or evening is usually more comfortable.`);
    }
  }
  const perDay = new Map();
  for (const s of live) perDay.set(s.day, (perDay.get(s.day) || 0) + 1);
  for (const [d, n] of perDay) if (n > 2) notes.push(`${DAY_NAMES[d]} has ${n} sessions. Spreading them out often feels better.`);
  return [...new Set(notes)];
}

/**
 * Take a rest day. Each live session on that day is moved to a free slot on a later day if one suits (not a rest day,
 * room for it, and 48 hours from other strength sessions); otherwise it simply becomes a rest session. Nothing is added
 * anywhere else.
 * @returns {{ moves: {key:string,day:number,slot:string}[], rested: string[] }}
 */
function planRestDay({ sessions, day, restDays = [], minDay = 0, twiceDaily = false }) {
  const cap = twiceDaily ? 2 : 1;
  const working = sessions.map((s) => ({ ...s }));
  const moves = [];
  const rested = [];
  const resting = new Set([...restDays.map((r) => r.day), day]);
  for (const s of working.filter((x) => x.day === day && (x.status === 'planned' || x.status === 'moved'))) {
    let target = null;
    for (let d = Math.max(minDay, 0); d < 7 && !target; d += 1) {
      if (resting.has(d) || d === day) continue;
      const here = working.filter((x) => x.day === d && x.status !== 'rest' && x.key !== s.key);
      if (here.length >= cap) continue;
      const taken = new Set(here.map((x) => x.slot));
      const slot = [s.slot, 'morning', 'evening'].find((sl) => !taken.has(sl));
      if (!slot) continue;
      if (isStrength(s)) {
        const others = working.filter((x) => x.key !== s.key && x.status !== 'rest' && isStrength(x));
        if (others.some((o) => Math.abs(hourOf(o.day, o.slot) - hourOf(d, slot)) < STRENGTH_GAP_HOURS)) continue;
      }
      target = { day: d, slot };
    }
    if (target) {
      moves.push({ key: s.key, ...target });
      s.day = target.day;
      s.slot = target.slot;
    } else {
      rested.push(s.key);
      s.status = 'rest';
    }
  }
  return { moves, rested };
}

module.exports = {
  SLOTS, SLOT_HOURS, DAY_NAMES, STRENGTH_GAP_HOURS, WARMUP_MIN, COOLDOWN_MIN,
  isHotMonth, buildSkeleton, softNotes, planRestDay, hourOf, isStrength, spread,
};
