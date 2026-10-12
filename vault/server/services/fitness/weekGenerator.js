'use strict';

/**
 * Builds one week: the skeleton and the shortlists come from code (schedule.js, selection.js); the model, chosen in
 * Vault Settings, picks among the shortlists and writes a short note. If the model is missing, slow or returns
 * something invalid, the rule-based picks stand, so a week always appears.
 */

const L = require('./library');
const S = require('./schedule');
const Sel = require('./selection');
const { runJson, str, GUARDRAILS } = require('./ai');

const LEVEL_DOWN = { advanced: 'intermediate', intermediate: 'beginner', beginner: 'beginner' };

function prescriptionFor(exercise, session, ctx) {
  if (exercise.pattern === 'cardio') {
    const c = session.components.find((x) => x.domain === 'cardio');
    return `${c ? c.minutes : 20} minutes`;
  }
  let level = Sel.levelFor(exercise.pattern, ctx.ratings);
  if (ctx.easier) level = LEVEL_DOWN[level];
  const base = exercise.dosage[level];
  // Balance work is always done beside something to hold on to.
  return exercise.pattern === 'balance' ? `${base}. Stand beside a wall or bench for support.` : base;
}

function validatePicks(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  const picks = {};
  if (obj.picks && typeof obj.picks === 'object') {
    for (const [k, v] of Object.entries(obj.picks)) if (typeof v === 'string') picks[k] = v.trim();
  }
  return { ok: true, value: { weekNote: str(obj.weekNote, 300), picks } };
}

// Plain words for what each phase means for the week. No numbers: the page already shows the targets.
const PHASE_WORDS = {
  base: 'You are rebuilding a base, so the work is easy, regular and steady.',
  build: 'You are building up gradually, a little more over time.',
  consolidate: 'You are making it a habit, so this is about keeping a steady rhythm.',
  maintain: 'You are keeping what you have built.',
};

function fallbackNote({ phase, isDeload, eased }) {
  if (isDeload) return 'A lighter week on purpose. Easier sessions give your body time to absorb the work you have done, so it is fine to go gently.';
  if (eased) return 'A gentle start: shorter sessions and easier versions while you settle in. There is no need to push.';
  return `${PHASE_WORDS[phase?.id] || 'A steady week.'} Keep the effort comfortable; doing it regularly matters more than doing it hard.`;
}

/**
 * @param {object} p
 * @param {number} p.userId
 * @param {string} p.weekStart
 * @param {object} p.info        output of phases.targetsForWeek
 * @param {object} p.person      { ratings:{cardio,strength,flexibility,balance}, equipment[], twiceDaily, workAround }
 * @param {object} p.history     { weeks: [{ weeksAgo, sessions:[{ kind, kindIndex, exercises:[{ block, slug, pattern, nth }] }] }] }
 * @param {number} p.generation  bumps on every regenerate so the rotation and the cache move on
 * @param {string} p.timezone
 */
async function generateWeekPlan({ userId, weekStart, info, person, history, generation = 0, timezone, refresh = false, useAi = true }) {
  const easier = info.easier;
  const { sessions, restDays, shortfall } = S.buildSkeleton({
    targets: info.targets,
    plannedRest: 2,
    twiceDaily: !!person.twiceDaily,
    intensity: easier ? 0.8 : 1,
  });

  const seed = `${userId}:${weekStart}:${generation}`;
  const rng = Sel.rngFrom(seed);
  const strengthTotal = sessions.filter((s) => s.components.some((c) => c.domain === 'strength')).length;

  // last-use map (slug -> weeks ago) and last week's slugs per (session kind, kind index, pattern, nth)
  const lastUse = new Map();
  const lastWeekSlot = new Map();
  const pastSigs = [];
  for (const w of history.weeks || []) {
    for (const s of w.sessions) {
      for (const e of s.exercises) {
        const prev = lastUse.get(e.slug);
        if (prev == null || w.weeksAgo < prev) lastUse.set(e.slug, w.weeksAgo);
        if (w.weeksAgo === 1 && e.block === 'main') lastWeekSlot.set(`${s.kind}${s.kindIndex}:${e.pattern}:${e.nth}`, e.slug);
      }
      pastSigs.push({ kind: s.kind, kindIndex: s.kindIndex, sig: Sel.signature(s.exercises.filter((e) => e.block === 'main').map((e) => e.slug)) });
    }
  }

  const lib = L.getLibrary().bySlug;
  const usedThisWeek = new Set();
  const cardioLimit = info.targets.aerobicMinutes < Sel.GENTLE_CARDIO_BELOW ? Sel.GENTLE_CARDIO_LEVEL : 0;
  // Starter weeks: nothing marked Challenging for someone who is starting from (near) zero.
  const starter = info.weeksSinceStart < Sel.STARTER_WEEKS && (person.currentMinutes == null || person.currentMinutes < Sel.STARTER_BELOW_MINUTES);
  const starterLimit = starter ? Sel.STARTER_LEVEL_LIMIT : 0;
  const counters = { strength: 0, aerobic: 0, mixed: 0 };
  const planned = [];

  for (const session of sessions) {
    const isStrong = session.components.some((c) => c.domain === 'strength');
    const strengthIndex = isStrong ? counters.strength : 0;
    const kind = isStrong ? 'strength' : session.kind === 'aerobic' ? 'aerobic' : session.kind;
    const kindIndex = counters[kind] ?? 0;
    counters[kind] = kindIndex + 1;
    if (isStrong) counters.strength = strengthIndex + 1;

    const slots = Sel.buildSlots(session, { strengthIndex, strengthTotal });
    const usedInSession = new Set();
    const mainCount = slots.filter((x) => x.block === 'main').length;
    const nth = {};
    const entry = { session, kind, kindIndex, slots: [] };
    for (const slot of slots) {
      nth[slot.pattern] = (nth[slot.pattern] ?? 0) + (slot.block === 'main' ? 1 : 0);
      const ctx = {
        equipment: person.equipment, ratings: person.ratings, easier, lastUse, usedThisWeek, usedInSession, rng, cardioLimit, starterLimit,
        hidden: person.hidden, exposure: person.exposure, waivers: { 'running-history': !!person.runningHistory },
      };
      let candidates = Sel.rankedCandidates(slot, ctx);
      const pool = candidates; // everything eligible, kept for the no-repeat check
      let forced = false;
      // Keepers only make sense in sessions with several exercises: a one-exercise session repeated is the same session.
      if (slot.block === 'main' && mainCount > 1) {
        const keepSlug = lastWeekSlot.get(`${kind}${kindIndex}:${slot.pattern}:${nth[slot.pattern]}`);
        if (keepSlug && Sel.isKeeperSlot(seed, `${kind}${kindIndex}`, slot.index) && candidates.some((c) => c.slug === keepSlug)) {
          candidates = candidates.filter((c) => c.slug === keepSlug);
          forced = true;
        }
      }
      const shortlist = candidates.slice(0, Sel.SHORTLIST);
      const pick = shortlist[0] || null;
      if (pick) { usedInSession.add(pick.slug); usedThisWeek.add(pick.slug); }
      entry.slots.push({ ...slot, id: `${session.key}.${slot.index}`, nth: slot.block === 'main' ? nth[slot.pattern] : null, shortlist, pool, pick, forced });
    }
    planned.push(entry);
  }

  // ── the model chooses among shortlists and writes the week note ──
  const open = planned.flatMap((p) => p.slots.filter((s) => s.shortlist.length > 1));
  const input = {
    noteVersion: 2,
    weekStart,
    generation,
    phase: info.phase.label,
    focus: info.phase.focus,
    deload: info.isDeload,
    eased: info.eased,
    targets: info.targets,
    ratings: person.ratings,
    thingsToWorkAround: person.workAround || null,
    sessions: planned.map((p) => ({
      id: p.session.key,
      title: p.session.title,
      slots: p.slots.filter((s) => s.shortlist.length > 1).map((s) => ({
        id: s.id, pattern: s.block === 'main' ? s.pattern : s.block, options: s.shortlist.map((e) => ({ slug: e.slug, name: e.name })),
      })),
    })).filter((s) => s.slots.length),
  };

  let weekNote = null;
  let source = 'fallback';
  let model = null;
  let note = null;
  if (open.length && useAi) {
    const system = `${GUARDRAILS}\nYou are choosing exercises for one week of a personal program. For each slot id, pick exactly one slug from that slot's options and no other. Prefer variety across the week and avoid choosing the same exercise in two slots. If thingsToWorkAround names a limit and an option clearly conflicts with it, pick another option when one is offered. Write weekNote as 1-2 plain, warm sentences about the character of this week and one thing to focus on. Do not list the targets or repeat numbers: the page already shows them. Strength, balance and mobility are counted in DAYS and can share one session, so never call them separate sessions.`;
    const prompt = `Choose the exercises.\n\nDATA:\n${JSON.stringify(input)}\n\nReturn JSON:\n{"weekNote": string (max 280 chars), "picks": {"<slot id>": "<slug from that slot's options>"}}`;
    const res = await runJson({
      userId, kind: 'week', input, system, prompt, validate: validatePicks,
      fallback: () => ({ weekNote: null, picks: {} }), tier: 'standard', refresh, maxTokens: 2500,
    });
    source = res.source;
    model = res.model;
    note = res.note;
    weekNote = res.value.weekNote;
    const taken = new Map(planned.map((p) => [p.session.key, new Set()]));
    for (const p of planned) for (const s of p.slots) if (s.pick) taken.get(p.session.key).add(s.pick.slug);
    for (const p of planned) {
      for (const s of p.slots) {
        const wanted = res.value.picks[s.id];
        if (!wanted || !s.pick || wanted === s.pick.slug) continue;
        const choice = s.shortlist.find((e) => e.slug === wanted);
        if (!choice) continue; // not in the shortlist: ignored, never trusted
        const set = taken.get(p.session.key);
        if (set.has(choice.slug)) continue; // would duplicate another slot of this session
        set.delete(s.pick.slug);
        set.add(choice.slug);
        s.pick = choice;
      }
    }
  }

  // ── never the exact same session again within two weeks ──
  for (const p of planned) {
    const main = () => p.slots.filter((s) => s.block === 'main' && s.pick);
    const clash = () => pastSigs.some((x) => x.kind === p.kind && x.kindIndex === p.kindIndex && x.sig === Sel.signature(main().map((s) => s.pick.slug)));
    // Prefer something not used anywhere else this week; fall back to anything not already in this session.
    const usedElsewhere = (e) => planned.some((q) => q.slots.some((o) => o.pick?.slug === e.slug));
    const alt = (s, from) => from.find((e) => e.slug !== s.pick.slug && !p.slots.some((o) => o !== s && o.pick?.slug === e.slug) && !usedElsewhere(e))
      || from.find((e) => e.slug !== s.pick.slug && !p.slots.some((o) => o !== s && o.pick?.slug === e.slug));
    for (let tries = 0; tries < 8 && clash(); tries += 1) {
      // First choice: change a slot that is not a keeper. Last resort: let the rule override a keeper.
      const swap = main().find((s) => !s.forced && alt(s, s.shortlist)) || main().find((s) => alt(s, s.pool));
      if (!swap) break;
      swap.pick = alt(swap, swap.forced ? swap.pool : swap.shortlist) || alt(swap, swap.pool);
      swap.forced = false;
    }
  }

  // ── assemble ──
  const ctxRx = { ratings: person.ratings, easier };
  const out = planned.map((p) => {
    const exercises = [];
    let position = 0;
    for (const s of p.slots) {
      if (!s.pick) continue;
      exercises.push({
        block: s.block,
        position: position++,
        slug: s.pick.slug,
        name: s.pick.name,
        pattern: s.block === 'main' ? s.pick.pattern : s.block,
        nth: s.nth,
        prescription: prescriptionFor(s.pick, p.session, ctxRx),
      });
    }
    const mainCardio = exercises.find((e) => e.block === 'main' && lib.get(e.slug)?.pattern === 'cardio');
    return {
      key: p.session.key,
      day: p.session.day,
      slot: p.session.slot,
      kind: p.session.kind,
      kindIndex: p.kindIndex,
      title: p.session.title,
      components: p.session.components,
      warmupMin: p.session.warmupMin,
      cooldownMin: p.session.cooldownMin,
      outdoor: !!(mainCardio && Sel.isOutdoor(lib.get(mainCardio.slug))),
      exercises,
    };
  });

  const missingPatterns = [...new Set(planned.flatMap((p) => p.slots.filter((s) => s.block === 'main' && !s.pick).map((s) => s.pattern)))];
  const notes = [];
  if (shortfall > 0) notes.push(`This week's aerobic target is about ${shortfall} minutes more than fits in your sessions, so it is a little lower. That is fine.`);
  if (missingPatterns.length) {
    const bands = missingPatterns.includes('pull') && !(person.equipment || []).includes('bands') && !(person.equipment || []).includes('gym');
    notes.push(`There is no ${missingPatterns.join(' / ')} exercise for the equipment you listed, so those slots were left out.${bands ? ' A resistance band is inexpensive and adds a rowing exercise: tick Resistance bands in your Profile.' : ''}`);
  }

  return {
    sessions: out,
    restDays,
    weekNote: weekNote || fallbackNote(info),
    generatedBy: source === 'fallback' ? 'rules' : 'ai',
    model,
    aiNote: note,
    notes,
  };
}

module.exports = { generateWeekPlan, validatePicks, fallbackNote, prescriptionFor };
