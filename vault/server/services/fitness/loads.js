'use strict';

/**
 * What to suggest for a loaded exercise, from what was actually lifted. Pure code.
 * Never assumes every kilogram exists: it says "the next weight up", and names it only when the person has listed the dumbbell
 * weights they own (Profile).
 */

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** The next weight above `kg` from a sorted list of owned weights, or null. */
function nextUp(kg, steps) {
  if (!Array.isArray(steps) || !steps.length) return null;
  return steps.find((s) => s > kg + 1e-9) ?? null;
}

/** The next weight below `kg`, or null. */
function nextDown(kg, steps) {
  if (!Array.isArray(steps) || !steps.length) return null;
  const lower = steps.filter((s) => s < kg - 1e-9);
  return lower.length ? lower[lower.length - 1] : null;
}

/**
 * @param {{ kg:number, effort:number|null }[]} logs the last logged weights for this exercise, newest first
 * @param {number[]} [steps] the dumbbell weights the person has, if they said
 * @returns {string|null} one short sentence, or null when nothing has been lifted yet
 */
function loadSuggestion(logs, steps = []) {
  if (!logs || !logs.length || !(logs[0].kg > 0)) return null;
  const [last, before] = logs;
  const kg = last.kg;
  const e = last.effort;

  // two hard sessions in a row at the same weight: step back one
  if (e != null && e >= 9 && before && before.effort != null && before.effort >= 9 && Math.abs(before.kg - kg) < 1e-9) {
    const down = nextDown(kg, steps);
    return down != null ? `Last two times at ${fmt(kg)} kg felt very hard. Try the next weight down (${fmt(down)} kg).` : `Last two times at ${fmt(kg)} kg felt very hard. Try the next weight down.`;
  }
  if (e != null && e <= 5) {
    const up = nextUp(kg, steps);
    return up != null ? `Last time: ${fmt(kg)} kg felt manageable. If your form held to the last rep, try the next weight up (${fmt(up)} kg).` : `Last time: ${fmt(kg)} kg felt manageable. If your form held to the last rep, try the next weight up.`;
  }
  if (e != null && e >= 8) return `Last time: ${fmt(kg)} kg felt hard. Stay at that weight until it feels easier.`;
  if (e != null) return `Last time: ${fmt(kg)} kg felt about right. Stay with it.`;
  return `Last time: ${fmt(kg)} kg.`;
}

/** The weights a person says they own, cleaned: positive numbers, unique, sorted, at most 30. */
function cleanSteps(list) {
  if (list == null || list === '') return [];
  const raw = Array.isArray(list) ? list : String(list).split(/[,;\s]+/);
  const nums = raw.map((x) => Number(String(x).replace(/kg/i, ''))).filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return [...new Set(nums.map((n) => Math.round(n * 2) / 2))].sort((a, b) => a - b).slice(0, 30);
}

module.exports = { loadSuggestion, cleanSteps, nextUp, nextDown };
