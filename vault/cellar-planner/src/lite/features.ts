import type { FeatureEffect, FeatureGroup, FeatureOption } from './config';

// The "Make it yours" feature options: what a person has picked, resolved against the owner's list (Cellar Planner -> Settings -> Feature options).
// A pick is stored as the option's `code` (a number that never changes for an option), so a design code or saved design survives renames, and a pick
// whose option was removed, switched off or no longer fits the room is simply ignored (never an error). Pure; used by the public tool, the staff
// planner, the price, the quote and the design code.

export interface Room { widthMm: number; depthMm: number }

/** Why an option cannot be chosen for this room (plain words), or null when it can. */
export function unavailableReason(o: FeatureOption, room: Room): string | null {
  if (!o.enabled) return 'Not available at the moment.';
  if (o.minDepthMm !== null && room.depthMm < o.minDepthMm) return `Needs a room at least ${o.minDepthMm / 1000} m deep.`;
  if (o.minWidthMm !== null && room.widthMm < o.minWidthMm) return `Needs a room at least ${o.minWidthMm / 1000} m wide.`;
  return null;
}

export interface ResolvedGroup { group: FeatureGroup; /** What is chosen now: the standard option of a pick-one group, or the person's picks. */ chosen: FeatureOption[] }
export interface ResolvedFeatures {
  groups: ResolvedGroup[];
  /** Everything chosen that is NOT a standard (included) option: these are the extras that add to the price. */
  extras: FeatureOption[];
}

/** Turn a list of picked codes into what is actually chosen. In a pick-one group the last valid pick wins; otherwise the standard option stays. */
export function resolveFeatures(features: FeatureGroup[], picks: readonly number[] | undefined, room: Room): ResolvedFeatures {
  const want = new Set(picks ?? []);
  const groups: ResolvedGroup[] = [];
  const extras: FeatureOption[] = [];
  for (const group of features) {
    const ok = (o: FeatureOption): boolean => unavailableReason(o, room) === null;
    const picked = group.options.filter((o) => want.has(o.code) && !o.included && ok(o));
    let chosen: FeatureOption[];
    if (group.mode === 'ANY') chosen = picked;
    else {
      const standard = group.options.find((o) => o.included) ?? group.options[0];
      // the standard option is shown as chosen unless something else valid is picked; if the standard itself is switched off it is still the fallback
      const last = picked[picked.length - 1];
      chosen = last ? [last] : standard ? [standard] : [];
    }
    groups.push({ group, chosen });
    for (const o of chosen) if (!o.included) extras.push(o);
  }
  return { groups, extras };
}

/** The picks to keep when the person chooses (or un-chooses) an option: a pick-one group holds at most one pick; choosing its standard option clears it. */
export function togglePick(features: FeatureGroup[], picks: readonly number[], group: FeatureGroup, option: FeatureOption): number[] {
  const inGroup = new Set(group.options.map((o) => o.code));
  const rest = picks.filter((c) => !inGroup.has(c));
  const mine = picks.filter((c) => inGroup.has(c));
  void features;
  if (group.mode === 'ONE') return option.included ? rest : [...rest, option.code];
  return mine.includes(option.code) ? [...rest, ...mine.filter((c) => c !== option.code)] : [...rest, ...mine, option.code];
}

/** Whole numbers, no duplicates, sorted: the form picks take in a design code and a saved design. */
export const cleanPicks = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 999))].sort((a, b) => a - b) : []);

export interface FeatureTotals {
  /** Sum of the lows and of the highs of the priced extras (an option with one price counts that price at both ends). */
  low: number; high: number;
  /** The single amount a quote uses for each extra when nothing overrides it: halfway between low and high. */
  mid: number;
  /** Extras with no price set at all: they are in the design but not in any total. */
  unpriced: FeatureOption[];
}

/** The low and high price of one option (null = no price set). */
export function optionRange(o: FeatureOption): { low: number; high: number } | null {
  if (o.low === null && o.high === null) return null;
  const low = o.low ?? (o.high as number), high = o.high ?? (o.low as number);
  return { low: Math.min(low, high), high: Math.max(low, high) };
}
export const optionMid = (o: FeatureOption): number | null => { const r = optionRange(o); return r ? Math.round(((r.low + r.high) / 2) * 100) / 100 : null; };

export function featureTotals(extras: readonly FeatureOption[]): FeatureTotals {
  let low = 0, high = 0, mid = 0;
  const unpriced: FeatureOption[] = [];
  for (const o of extras) {
    const r = optionRange(o);
    if (!r) { unpriced.push(o); continue; }
    low += r.low; high += r.high; mid += (r.low + r.high) / 2;
  }
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100, mid: Math.round(mid * 100) / 100, unpriced };
}

/** The 3D picture changes the given options ask for (doors, lights, a centrepiece, wall and floor finishes). */
export const effectsOf = (options: readonly FeatureOption[]): FeatureEffect[] => [...new Set(options.map((o) => o.effect).filter((e): e is FeatureEffect => e !== '' && e !== 'NONE'))];

/** Every option that is chosen right now, the standard ones included (a standard timber door or ceiling downlights are drawn too, until swapped). */
export const chosenOptions = (r: ResolvedFeatures): FeatureOption[] => r.groups.flatMap((g) => g.chosen);

/** "+$2,800–3,600", "+$2,900" when both ends are the same, "Price on request" with no price, "Included" for a standard option, nothing while prices are hidden. */
export function priceLabel(o: FeatureOption, currency: string, showPrices: boolean): string {
  if (o.included) return 'Included';
  // while the owner keeps prices hidden no price is shown at all (the server does not even send them)
  if (!showPrices) return '';
  const r = optionRange(o);
  if (!r) return 'Price on request';
  const fmt = (n: number): string => n.toLocaleString('en-AU');
  return r.low === r.high ? `+${currency}${fmt(r.low)}` : `+${currency}${fmt(r.low)}–${fmt(r.high)}`;
}

/** One line for the enquiry and the review: "Frameless glass doors, Ducted split system", or '' when nothing extra is chosen. */
export const extrasLine = (extras: readonly FeatureOption[]): string => extras.map((o) => o.name).join(', ');
