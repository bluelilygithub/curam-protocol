import type { FeatureOption, LiteConfig } from './config';
import { featureTotals } from './features';

// The indicative price: fixed + per rack unit x units + the door's price, shown as a range (+/- a percentage) rounded to a tidy figure, PLUS the
// chosen feature options: each adds its own low to the bottom of the range and its own high to the top (the owner's range, not the +/- percentage).
// Returns null (show nothing) unless the owner switched prices on AND entered at least one amount: a price is never invented.

export interface PriceRange { low: number; high: number; text: string }

const roundTo = (n: number, step: number): number => Math.round(n / step) * step;

export function priceRange(cfg: LiteConfig, units: number, doorStyle: 'SINGLE' | 'DOUBLE', problems = 0, extras: readonly FeatureOption[] = []): PriceRange | null {
  const p = cfg.pricing;
  if (!p.show || problems > 0 || !(units > 0)) return null;
  const door = doorStyle === 'DOUBLE' ? p.doorDouble : p.doorSingle;
  if (p.fixed === null && p.perUnit === null && door === null) return null;
  const mid = (p.fixed ?? 0) + (p.perUnit ?? 0) * units + (door ?? 0);
  if (!(mid > 0)) return null;
  const spread = p.rangePct / 100;
  const f = featureTotals(extras);
  const low = Math.max(0, roundTo(mid * (1 - spread) + f.low, p.roundTo));
  const high = Math.max(low, roundTo(mid * (1 + spread) + f.high, p.roundTo));
  const fmt = (n: number): string => `${p.currency}${n.toLocaleString('en-AU')}`;
  return { low, high, text: low === high ? `about ${fmt(low)}` : `${fmt(low)} to ${fmt(high)}` };
}
