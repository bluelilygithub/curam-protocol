'use strict';

/**
 * Pure wording rules for the short things the app says back: a tip or two after a session, and a reflection on the week.
 * No database, no AI. The model (chosen in Settings) may reword these from the same facts; whatever it returns is checked
 * here, and if it is missing or unsuitable these rule-based versions are used. Tone: warm, plain, never guilt.
 */

const L = require('./library');

// Words that must never appear in what the app says back to someone.
const BANNED = /\b(fail(ed|ure|ing)?|lazy|should have|missed|skipp(ed|ing)|behind|guilt\w*|slack\w*|excuse\w*|bad week|poor(ly)?|weak|pathetic|disappoint\w*)\b/i;

const TIP_STATUSES = new Set(['done', 'partial', 'swapped']);

const round05 = (n) => Math.round(n * 2) / 2;

/** The exercises worth talking about: the main work, with the library facts the model may use. */
function tipFacts(ctx) {
  const lib = L.getLibrary().bySlug;
  return (ctx.exercises || []).filter((e) => e.block == null || e.block === 'main').map((e) => {
    const item = lib.get(e.slug);
    const easier = item?.easier?.[0] ? lib.get(item.easier[0])?.name : null;
    return {
      slug: e.slug,
      name: item?.name || e.name || e.slug,
      pattern: item?.pattern || null,
      weightKg: e.weightKg ?? null,
      prevWeightKg: e.prevWeightKg ?? null,
      sets: e.sets ?? null,
      reps: e.reps ?? null,
      easierVersion: easier,
      commonMistake: item?.mistakes?.[0] || null,
    };
  });
}

/**
 * One or two short tips for what was just done, from fixed rules.
 * @param {{ status:string, effort:number|null, exercises:object[] }} ctx
 * @param {number} seed picks which exercise gets the form cue, so it varies from session to session
 * @returns {string[]} 0 to 2 tips; none for rest or "didn't do it"
 */
function ruleTips(ctx, seed = 0) {
  if (!TIP_STATUSES.has(ctx.status)) return [];
  const facts = tipFacts(ctx);
  const effort = ctx.effort;
  const tips = [];

  if (effort != null && effort >= 9) {
    const hard = facts.find((f) => f.easierVersion);
    tips.push(hard
      ? `You rated this ${effort} out of 10. Next time try the easier version of ${hard.name} (${hard.easierVersion}) and aim for around 6 to 8.`
      : `You rated this ${effort} out of 10. Next time start a little lighter or take longer rests; around 6 to 8 is the sweet spot.`);
  }

  const lifted = facts.find((f) => f.weightKg != null && f.weightKg > 0);
  if (lifted && effort != null) {
    const w = lifted.weightKg;
    if (effort <= 5) tips.push(`${lifted.name}: ${w} kg felt manageable. If your form held to the last rep, try ${round05(w + 1)} to ${round05(w + 2)} kg next time.`);
    else if (effort >= 8) tips.push(`${lifted.name}: stay at ${w} kg until it feels easier. There is no rush.`);
  }

  if (effort != null && effort <= 3 && tips.length < 2) {
    tips.push('That felt comfortable. When it keeps feeling this easy, the plan steps up a little by itself.');
  }
  if (ctx.status === 'partial' && tips.length < 2) {
    tips.push('Part of a session still counts. If time is short, the first exercises in each block are the most useful ones.');
  }

  if (tips.length < 2) {
    const withCue = facts.filter((f) => f.commonMistake);
    if (withCue.length) {
      const f = withCue[Math.abs(seed) % withCue.length];
      tips.push(`A form cue for ${f.name}: watch for "${f.commonMistake.mistake.toLowerCase()}". ${f.commonMistake.fix}`);
    }
  }
  return tips.slice(0, 2);
}

function validateTips(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.tips)) return { ok: false, error: 'no tips array' };
  const tips = obj.tips.map((t) => (typeof t === 'string' ? t.trim().slice(0, 220) : '')).filter(Boolean).slice(0, 2);
  if (!tips.length) return { ok: false, error: 'empty tips' };
  if (tips.some((t) => BANNED.test(t))) return { ok: false, error: 'tone' };
  return { ok: true, value: { tips } };
}

/**
 * The week in a few facts, for the reflection. Only what was logged counts; unlogged sessions are simply not mentioned.
 * @param {{ sessions:object[], extras:object[], done:object, week:{ targets:object } }} week the payload of GET /week
 */
function reflectionFacts(week) {
  const targets = week.week?.targets || {};
  const logged = week.sessions.filter((s) => s.log);
  const count = (st) => logged.filter((s) => s.log.status === st).length;
  const efforts = logged.map((s) => s.log.effort).filter((e) => e != null);
  const minutes = logged.reduce((n, s) => n + (s.log.actualMinutes || 0), 0) + (week.extras || []).reduce((n, x) => n + (x.minutes || 0), 0);
  return {
    sessionsLogged: logged.length,
    done: count('done'),
    partly: count('partial'),
    didSomethingElse: count('swapped'),
    rested: week.sessions.filter((s) => s.status === 'rest').length,
    extras: (week.extras || []).length,
    minutesLogged: minutes,
    averageEffort: efforts.length ? Math.round((efforts.reduce((a, b) => a + b, 0) / efforts.length) * 10) / 10 : null,
    aerobicDone: week.done.aerobicMinutes,
    aerobicPlanned: targets.aerobicMinutes ?? 0,
    strengthDaysDone: week.done.strengthDays,
    strengthDaysPlanned: targets.strengthDays ?? 0,
  };
}

function reflectionFallback(f) {
  if (!f.sessionsLogged && !f.extras) return null;
  const parts = [];
  const items = f.sessionsLogged + f.extras;
  parts.push(`Last week you logged ${f.minutesLogged} minutes across ${items} ${items === 1 ? 'activity' : 'activities'}.`);
  if (f.aerobicPlanned > 0 && f.aerobicDone > 0) parts.push(`That included ${f.aerobicDone} aerobic minutes against the ${f.aerobicPlanned} the plan asks for.`);
  if (f.averageEffort != null) {
    parts.push(f.averageEffort <= 4 ? 'It mostly felt comfortable.' : f.averageEffort >= 8 ? 'It felt hard, which is worth noticing; an easier week is fine.' : 'It felt like a solid, moderate effort.');
  }
  if (f.extras) parts.push('The extra activity counts too.');
  parts.push('Rest and quiet weeks are part of it, so go at the pace that suits your week.');
  return parts.join(' ');
}

function validateReflection(obj) {
  const text = obj && typeof obj.reflection === 'string' ? obj.reflection.trim().slice(0, 480) : '';
  if (!text) return { ok: false, error: 'empty' };
  if (BANNED.test(text)) return { ok: false, error: 'tone' };
  return { ok: true, value: { reflection: text } };
}

module.exports = { BANNED, TIP_STATUSES, tipFacts, ruleTips, validateTips, reflectionFacts, reflectionFallback, validateReflection };
