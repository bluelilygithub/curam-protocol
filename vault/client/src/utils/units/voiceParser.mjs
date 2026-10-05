/**
 * Spoken-command parser.
 *   "five feet eleven in centimetres"        → 5 ft 11 in → cm
 *   "two cups of flour in grams"             → 2 cup (flour) → g
 *   "thirty degrees Celsius to Fahrenheit"   → 30 °C → °F
 * Pure: reads the registry through aliasIndex.mjs. The UI shows `understood` before converting.
 */
import { getUnit, getIngredient, formatNumber, unitShort } from './registry.mjs';
import { VOICE_ALIAS, MAX_ALIAS_WORDS, INGREDIENT_ALIAS, MAX_INGREDIENT_WORDS, pickUnit } from './aliasIndex.mjs';
import { tokenize, parseNumberWords } from './numbers.mjs';
import { partLabel } from './convert.mjs';

export { parseSpokenNumber, numberWordsToDigits } from './numbers.mjs';
export { parseSpokenUnit } from './aliasIndex.mjs';

const CONNECTORS = new Set(['to', 'into', 'as', 'equals', 'equal', 'is', 'makes', 'convert', 'then']);
const FILLER_SKIP = new Set(['of', 'and', 'a', 'an', 'the', 'what', 'whats', 'how', 'many', 'much', 'in', 'convert', 'me', 'please', 'tell']);

// Compound completions: first-part unit id → compound id, and the ordered part ids
const COMPOUNDS = [
  { id: 'length.ftin', parts: ['length.foot', 'length.inch'] },
  { id: 'mass.stlb', parts: ['mass.stone', 'mass.pound'] },
  { id: 'time.hmin', parts: ['time.hour', 'time.minute'] },
];

function matchAt(tokens, i, map, maxWords) {
  for (let len = Math.min(maxWords, tokens.length - i); len >= 1; len -= 1) {
    const key = tokens.slice(i, i + len).join(' ');
    if (map.has(key)) return { len, value: map.get(key), key };
  }
  return null;
}

function tokenizeItems(tokens) {
  const items = [];
  let i = 0;
  while (i < tokens.length) {
    const num = parseNumberWords(tokens, i);
    if (num) { items.push({ k: 'num', value: num.value }); i = num.next; continue; }
    const ing = matchAt(tokens, i, INGREDIENT_ALIAS, MAX_INGREDIENT_WORDS);
    const unit = matchAt(tokens, i, VOICE_ALIAS, MAX_ALIAS_WORDS);
    // prefer the longer match; ties go to the unit
    if (unit && (!ing || unit.len >= ing.len)) { items.push({ k: 'unit', ids: unit.value, raw: unit.key }); i += unit.len; continue; }
    if (ing) { items.push({ k: 'ing', id: ing.value }); i += ing.len; continue; }
    const t = tokens[i];
    if (CONNECTORS.has(t)) { items.push({ k: 'conn', word: t }); i += 1; continue; }
    if (FILLER_SKIP.has(t)) { i += 1; continue; }
    i += 1; // unknown word: ignored
  }
  return items;
}

function describeQuantity(parts, unitId, value, precision) {
  if (parts) {
    const u = getUnit(unitId);
    return parts.map((v, i) => `${formatNumber(v, precision)} ${partLabel(u.parts[i])}`).join(' ');
  }
  const u = getUnit(unitId);
  const label = u ? (u.symbols[0] || (value === 1 ? u.name : u.plural)) : '?';
  return `${value === null || value === undefined ? '?' : formatNumber(value, precision)} ${label}`;
}

/**
 * @returns {{ ok: boolean, value?: number, parts?: number[], fromId?: string, toId?: string,
 *             ingredientId?: string, groupId?: string, understood: string, notes: string[] }}
 */
export function parseSpokenCommand(text, opts = {}) {
  const { region = 'imperial', preferGroup = null } = opts;
  const notes = [];
  const tokens = tokenize(text);
  if (!tokens.length) return { ok: false, understood: '', notes: ['Nothing heard.'] };
  let items = tokenizeItems(tokens);

  // "in" is a connector when it follows a non-number and precedes a unit ("flour in grams", "cm in inches")
  items = items.map((it, idx) => {
    if (it.k === 'unit' && it.raw === 'in') {
      const prev = items[idx - 1];
      const next = items[idx + 1];
      if (prev && prev.k !== 'num' && next && next.k === 'unit') return { k: 'conn', word: 'in' };
      if (prev && prev.k === 'ing' && next) return { k: 'conn', word: 'in' };
      if (!prev || prev.k !== 'num') {
        if (prev && prev.k === 'conn') return it;
        return { k: 'conn', word: 'in' };
      }
    }
    return it;
  });

  const ingItem = items.find((it) => it.k === 'ing');
  const ingredientId = ingItem ? ingItem.id : null;
  const hasIngredient = !!ingredientId;

  // split into left (from) / right (to)
  let split = items.findIndex((it, idx) => it.k === 'conn' && items.slice(0, idx).some((x) => x.k === 'num' || x.k === 'unit') && items.slice(idx + 1).some((x) => x.k === 'unit'));
  if (split === -1) {
    const lastUnit = items.map((x) => x.k).lastIndexOf('unit');
    const unitCount = items.filter((x) => x.k === 'unit').length;
    if (unitCount >= 2) split = lastUnit; else split = items.length; // only one unit: it is the "from"
  }
  let left = items.slice(0, split).filter((x) => x.k !== 'conn');
  let right = items.slice(split).filter((x) => x.k !== 'conn');
  // "how many millilitres in half a cup": the amount sits after the connector, so the sides swap
  if (!left.some((x) => x.k === 'num') && right.some((x) => x.k === 'num')) [left, right] = [right, left];

  // left: (num [unit])* [bare num]
  const pairs = [];
  let bare = null;
  let fromUnitOnly = null;
  for (let i = 0; i < left.length; i += 1) {
    const it = left[i];
    if (it.k === 'num') {
      const next = left[i + 1];
      if (next && next.k === 'unit') { pairs.push({ value: it.value, ids: next.ids }); i += 1; } else bare = it.value;
    } else if (it.k === 'unit' && !pairs.length && fromUnitOnly === null) fromUnitOnly = it.ids;
  }
  const toItem = right.find((x) => x.k === 'unit');
  const toIds = toItem ? toItem.ids : null;
  // numbers on the right side with no left value ("to ... 5")? ignore.

  let value = null;
  let parts = null;
  let fromIds = null;
  let compoundId = null;

  if (pairs.length >= 2) {
    const comp = COMPOUNDS.find((c) => pairs.every((p, i) => c.parts[i] && p.ids.includes(c.parts[i])));
    if (comp) { compoundId = comp.id; parts = pairs.map((p) => p.value); }
    else { notes.push('Heard several amounts — using the first one.'); value = pairs[0].value; fromIds = pairs[0].ids; }
  } else if (pairs.length === 1) {
    value = pairs[0].value;
    fromIds = pairs[0].ids;
    if (bare !== null) {
      const comp = COMPOUNDS.find((c) => fromIds.includes(c.parts[0]));
      if (comp) { compoundId = comp.id; parts = [value, bare]; value = null; fromIds = null; notes.push(`Read "${bare}" as ${getUnit(comp.parts[1]).plural}.`); }
    }
  } else if (bare !== null) {
    value = bare;
  } else if (fromUnitOnly) {
    fromIds = fromUnitOnly;
  }

  // choose units that share a group
  const unitOpts = { region, preferGroup, hasIngredient };
  let fromId = compoundId;
  let toId = null;
  if (!fromId && fromIds) {
    if (toIds) {
      const fromGroups = new Set(fromIds.map((id) => getUnit(id).group));
      const shared = toIds.filter((id) => fromGroups.has(getUnit(id).group)).map((id) => getUnit(id).group);
      const groupIds = [...new Set(shared)];
      if (groupIds.length) {
        fromId = pickUnit(fromIds, { ...unitOpts, groupIds });
        toId = pickUnit(toIds, { ...unitOpts, groupIds });
      }
    }
    if (!fromId) fromId = pickUnit(fromIds, unitOpts);
  }
  if (!toId && toIds) {
    const g = fromId ? getUnit(fromId).group : null;
    toId = pickUnit(toIds, { ...unitOpts, groupIds: g ? [g] : null });
    if (!toId && fromId) notes.push(`"${toItem.raw}" does not measure the same thing as ${getUnit(fromId).name}.`);
  }
  if (compoundId && toIds && !toId) toId = pickUnit(toIds, { ...unitOpts, groupIds: [getUnit(compoundId).group] });

  const groupId = (fromId && getUnit(fromId).group) || (toId && getUnit(toId).group) || null;
  const ok = (value !== null || parts !== null) && !!fromId && !!toId && getUnit(fromId)?.group === getUnit(toId)?.group;
  const ingName = ingredientId ? getIngredient(ingredientId).name.toLowerCase() : '';
  let understood = '';
  if (fromId || value !== null || parts) {
    understood = describeQuantity(parts, fromId, value, { mode: 'sig', n: 8 });
    if (ingName) understood += ` of ${ingName}`;
  }
  if (toId) understood += ` → ${unitShort(getUnit(toId))}`;
  if (!ok && !notes.length) {
    if (value === null && !parts) notes.push('No amount heard.');
    else if (!fromId) notes.push('No starting unit heard.');
    else if (!toId) notes.push('No target unit heard.');
  }
  return { ok, value, parts, fromId, toId, ingredientId, groupId, understood: understood.trim(), notes };
}
