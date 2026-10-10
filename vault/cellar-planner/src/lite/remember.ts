import type { LengthUnit } from './units';
import { LENGTH_UNITS } from './units';

// What the browser remembers between visits: the last design (its short code, nothing personal) and the chosen unit. Every read and write is
// guarded: storage can be blocked (private windows, some embeds) and the tool must work regardless.

const DESIGN_KEY = 'cellar-lite:last:v1';
const UNIT_KEY = 'cellar-lite:unit:v1';

export const readLastDesign = (): string | null => { try { return localStorage.getItem(DESIGN_KEY); } catch { return null; } };
export const writeLastDesign = (code: string): void => { try { localStorage.setItem(DESIGN_KEY, code); } catch { /* fine */ } };
export const clearLastDesign = (): void => { try { localStorage.removeItem(DESIGN_KEY); } catch { /* fine */ } };

export function readUnit(): LengthUnit {
  try { const u = localStorage.getItem(UNIT_KEY); if (u && (LENGTH_UNITS as readonly string[]).includes(u)) return u as LengthUnit; } catch { /* fine */ }
  return 'm';
}
export const writeUnit = (u: LengthUnit): void => { try { localStorage.setItem(UNIT_KEY, u); } catch { /* fine */ } };
