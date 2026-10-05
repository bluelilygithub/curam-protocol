/**
 * Alias lookups built from the registry (never a second source of truth).
 *   resolveSpokenUnit(tokensJoined) → candidate unit ids
 *   pickUnit(ids, opts)             → one unit id (region / group aware)
 */
import { allUnits, getUnit, GENERIC_FAMILIES, INGREDIENTS } from './registry.mjs';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9°²³µ/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Words (spoken / typed) → unit ids. Built from registry aliases and multi-letter symbols. */
export const VOICE_ALIAS = new Map();
function add(map, key, id) {
  if (!key) return;
  const list = map.get(key) || [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
}
for (const u of allUnits()) {
  for (const a of u.aliases) add(VOICE_ALIAS, norm(a), u.id);
  for (const s of u.symbols) {
    const n = norm(s);
    if (n.length >= 2 && /^[a-z0-9°²³µ/ ]+$/.test(n)) add(VOICE_ALIAS, n, u.id);
  }
}
// "in" is spoken as inches; the command parser decides whether it is a connector instead.
add(VOICE_ALIAS, 'in', 'length.inch');
// Regional families: the bare word maps to BOTH variants, resolved by region later.
for (const fam of Object.values(GENERIC_FAMILIES)) {
  for (const w of fam.words) VOICE_ALIAS.set(norm(w), [fam.us, fam.imperial]);
}
export const MAX_ALIAS_WORDS = Math.max(...[...VOICE_ALIAS.keys()].map((k) => k.split(' ').length));

/** Ingredient names → ingredient id. */
export const INGREDIENT_ALIAS = new Map();
for (const ing of INGREDIENTS) for (const a of ing.aliases) INGREDIENT_ALIAS.set(norm(a), ing.id);
export const MAX_INGREDIENT_WORDS = Math.max(...[...INGREDIENT_ALIAS.keys()].map((k) => k.split(' ').length));

export function findIngredient(text) {
  const n = norm(text);
  if (!n) return null;
  if (INGREDIENT_ALIAS.has(n)) return INGREDIENT_ALIAS.get(n);
  const words = n.split(' ');
  for (let len = Math.min(MAX_INGREDIENT_WORDS, words.length); len >= 1; len -= 1) {
    for (let i = 0; i + len <= words.length; i += 1) {
      const k = words.slice(i, i + len).join(' ');
      if (INGREDIENT_ALIAS.has(k)) return INGREDIENT_ALIAS.get(k);
    }
  }
  return null;
}

/** Pick one unit from candidates. opts: { region, preferGroup, groupIds (allowed), hasIngredient } */
export function pickUnit(ids, opts = {}) {
  if (!ids || !ids.length) return null;
  const { region = 'imperial', preferGroup = null, groupIds = null, hasIngredient = false } = opts;
  let c = ids.slice();
  if (groupIds) c = c.filter((id) => groupIds.includes(getUnit(id).group));
  if (!c.length) return null;
  // regional family: keep the region's variant when both are present
  const variants = c.filter((id) => getUnit(id).generic);
  if (variants.length > 1) {
    const keep = variants.find((id) => getUnit(id).variant === (region === 'us' ? 'us' : 'imperial'));
    if (keep) c = c.filter((id) => !getUnit(id).generic || id === keep);
  }
  if (c.length === 1) return c[0];
  const score = (id) => {
    const g = getUnit(id).group;
    let s = 0;
    if (g === 'cooking') s += hasIngredient ? 10 : -10;
    if (preferGroup && g === preferGroup) s += 5;
    return s;
  };
  c.sort((a, b) => score(b) - score(a));
  return c[0];
}

/** Resolve a typed/spoken unit phrase ("centimetres", "degrees celsius", "psi") to a unit id. */
export function parseSpokenUnit(text, opts = {}) {
  const n = norm(text).replace(/^(to|into|in|as|a|an|the)\s+/, '');
  if (!n) return null;
  let ids = VOICE_ALIAS.get(n);
  if (!ids) {
    // exact symbol (case-sensitive) e.g. "mL", "kPa", "°C"
    const t = String(text).trim();
    ids = allUnits().filter((u) => u.symbols.includes(t)).map((u) => u.id);
  }
  if (!ids || !ids.length) return null;
  return pickUnit(ids, opts);
}
