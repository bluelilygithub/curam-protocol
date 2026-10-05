/**
 * Conversion engine. Reads only from registry.mjs.
 *   convert(value, fromId, toId, ctx)         → number (NaN when not possible)
 *   convertValues(values[], fromId, toId, ctx) → { parts: number[] } | { value: number }
 *   formatConverted(...)                       → display string ("5 ft 11 in", "1.8288 m")
 * ctx: { cupStandard, ingredient, tempMode: 'absolute'|'difference' }
 */
import { getUnit, clean, formatNumber, unitShort, DEFAULT_CUP_STANDARD } from './registry.mjs';

export function defaultContext(ctx = {}) {
  return { cupStandard: DEFAULT_CUP_STANDARD, ingredient: null, tempMode: 'absolute', ...ctx };
}

function toBaseUnit(unit, value, ctx) {
  return unit.toBase(value, ctx);
}

/** Convert a base-unit value (of the unit's group) into `unit`. */
export function fromBaseUnit(unit, base, ctx) {
  return unit.fromBase(base, ctx);
}

/** Compound units take an array of part values (largest first). */
export function compoundToBase(unit, values, ctx) {
  let sum = 0;
  unit.parts.forEach((pid, i) => {
    const v = values[i];
    if (v === undefined || v === null || v === '') return;
    sum += getUnit(pid).toBase(Number(v), ctx);
  });
  return sum;
}

/** Break a base value into compound parts. Last part keeps the fraction; carries after rounding. */
export function baseToCompound(unit, base, ctx, decimals = 2) {
  const parts = unit.parts.map((p) => getUnit(p));
  const sign = base < 0 ? -1 : 1;
  let rest = Math.abs(base);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const val = parts[i].fromBase(rest, ctx);
    if (i === parts.length - 1) {
      out.push(val);
    } else {
      const whole = Math.floor(clean(val) + 1e-9);
      out.push(whole);
      rest -= parts[i].toBase(whole, ctx);
    }
  }
  // round the last part and carry upward when it reaches the next-larger unit
  const f = 10 ** decimals;
  out[out.length - 1] = Math.round(out[out.length - 1] * f) / f;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const size = parts[i - 1].toBase(1, ctx) / parts[i].toBase(1, ctx);
    if (out[i] >= size - 1e-9) {
      out[i] = Math.abs(out[i] - size) < 1e-9 ? 0 : clean(out[i] - size);
      out[i - 1] += 1;
    }
  }
  return out.map((v, i) => (i === out.length - 1 ? clean(v) : v)).map((v) => (sign < 0 ? -v : v));
}

/** Single-value conversion between two non-compound units (or compound with a one-element list). */
export function convert(value, fromId, toId, ctx = {}) {
  const c = defaultContext(ctx);
  const from = getUnit(fromId);
  const to = getUnit(toId);
  if (!from || !to || from.group !== to.group) return NaN;
  if (from.type === 'compound') return NaN;
  const base = toBaseUnit(from, Number(value), c);
  if (to.type === 'compound') return NaN;
  return clean(fromBaseUnit(to, base, c));
}

/**
 * General entry point. `values` is one number for simple units or an array of part values for a
 * compound `from`. Returns { base, value } for simple targets or { base, parts } for compound targets.
 */
export function convertValues(values, fromId, toId, ctx = {}, decimals = 2) {
  const c = defaultContext(ctx);
  const from = getUnit(fromId);
  const to = getUnit(toId);
  if (!from || !to || from.group !== to.group) return { base: NaN, value: NaN };
  const vs = Array.isArray(values) ? values : [values];
  const base = from.type === 'compound' ? compoundToBase(from, vs, c) : toBaseUnit(from, Number(vs[0]), c);
  if (to.type === 'compound') return { base, parts: baseToCompound(to, base, c, decimals) };
  return { base, value: clean(fromBaseUnit(to, base, c)) };
}

/** Value of one base quantity in every (visible) unit of its group. */
export function allInGroup(base, groupUnits, ctx = {}) {
  const c = defaultContext(ctx);
  return groupUnits
    .filter((u) => u.type !== 'compound')
    .map((u) => ({ unit: u, value: clean(fromBaseUnit(u, base, c)) }));
}

const PART_LABEL = {
  'length.foot': 'ft', 'length.inch': 'in', 'mass.stone': 'st', 'mass.pound': 'lb',
  'time.hour': 'h', 'time.minute': 'min', 'angle.degree': '°', 'angle.arcminute': '′', 'angle.arcsecond': '″',
};
export const partLabel = (pid) => PART_LABEL[pid] || unitShort(getUnit(pid));

export function formatParts(unit, parts, precision) {
  return unit.parts
    .map((pid, i) => `${formatNumber(parts[i], i === parts.length - 1 ? precision : { mode: 'dp', n: 0 })} ${partLabel(pid)}`)
    .join(' ');
}

/** Display string for a converted result. */
export function formatResult(result, toId, precision) {
  const to = getUnit(toId);
  if (!to) return '';
  if (to.type === 'compound') return formatParts(to, result.parts, precision);
  return `${formatNumber(result.value, precision)} ${unitShort(to)}`;
}

/** Why a conversion cannot be done (for inline messages), or null. */
export function conversionProblem(fromId, toId, ctx = {}) {
  const from = getUnit(fromId);
  const to = getUnit(toId);
  if (!from || !to) return 'Pick both units.';
  if (from.group !== to.group) return 'These units measure different things.';
  const c = defaultContext(ctx);
  if ((from.needsContext === 'ingredient' || to.needsContext === 'ingredient') && !c.ingredient) return 'Pick an ingredient to convert between cups/spoons and grams.';
  if (c.tempMode === 'difference' && (from.type === 'lookup' || to.type === 'lookup')) return 'Gas marks are temperatures, not differences.';
  return null;
}
