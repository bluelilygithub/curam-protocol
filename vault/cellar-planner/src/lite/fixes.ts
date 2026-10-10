import type { LiteConfig } from './config';
import { LIMITS, liteResult, type LiteSettings } from './settings';
import { describeLength, type LengthUnit } from './units';
import { BOTTLE_PROFILES } from '../engine/defaults';

// Today every design the tool can reach is buildable (a low ceiling gets a lower door), so this is a safety net: if a future rule or an owner setting
// ever makes a design unbuildable, the visitor still gets a button, not a dead end. When a design cannot be built, find the smallest single change that makes it buildable, so the visitor gets a button instead of a dead end.
// It tries real changes against the real engine (never guesses from the message text) in this order: a taller ceiling, a wider or deeper room, a
// single door, a smaller bottle style. Each is tried in small steps and the first that works wins, so the suggestion is always the gentlest one.

export interface Fix { text: string; settings: LiteSettings }

const BOTTLE_STEPS: Array<LiteSettings['bottle']> = ['MAGNUM', 'CHAMPAGNE', 'BURGUNDY', 'BORDEAUX'];
type Evaluate = (s: LiteSettings, cfg: LiteConfig) => { problems: string[] };

/** `evaluate` is the real engine unless a test supplies a stand-in. */
export function suggestFix(s: LiteSettings, cfg: LiteConfig, unit: LengthUnit, evaluate: Evaluate = liteResult): Fix | null {
  const buildable = (x: LiteSettings, c: LiteConfig): boolean => evaluate(x, c).problems.length === 0;
  if (buildable(s, cfg)) return null;

  for (let h = s.heightMm + 50; h <= LIMITS.heightMm[1]; h += 50) {
    const next = { ...s, heightMm: h };
    if (buildable(next, cfg)) return { text: `Make the ceiling ${describeLength(h, unit)} high`, settings: next };
  }
  for (let w = s.widthMm + 100; w <= LIMITS.widthMm[1]; w += 100) {
    const next = { ...s, widthMm: w };
    if (buildable(next, cfg)) return { text: `Make the room ${describeLength(w, unit)} wide`, settings: next };
  }
  for (let d = s.depthMm + 100; d <= LIMITS.depthMm[1]; d += 100) {
    const next = { ...s, depthMm: d };
    if (buildable(next, cfg)) return { text: `Make the room ${describeLength(d, unit)} deep`, settings: next };
  }
  if (s.doorStyle === 'DOUBLE') {
    const next = { ...s, doorStyle: 'SINGLE' as const };
    if (buildable(next, cfg)) return { text: 'Use a single door', settings: next };
  }
  for (const b of BOTTLE_STEPS.slice(BOTTLE_STEPS.indexOf(s.bottle) + 1)) {
    const next = { ...s, bottle: b };
    if (buildable(next, cfg)) return { text: `Choose ${BOTTLE_PROFILES[b].label} bottles`, settings: next };
  }
  return null;
}
