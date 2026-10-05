// Light power (M4.13): a multiplier on how bright each light source is. Two levels multiply: "All lights" (a remembered setting, 0–200 %)
// and a piece's own power (0–300 %, saved with the project). Pure.
import type { FurnitureInstance, Project } from '../engine/types';

export const GLOBAL_POWER_MAX = 2;
export const PIECE_POWER_MAX = 3;

export const clampPower = (v: number, max: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 1);

/** The strength a light actually gets: its base strength × all-lights power × its own power. */
export const effectiveIntensity = (base: number, globalPower: number, own: number | undefined): number =>
  base * clampPower(globalPower, GLOBAL_POWER_MAX) * clampPower(own ?? 1, PIECE_POWER_MAX);

/** "130 %" for 1.3. */
export const percent = (v: number): string => `${Math.round(v * 100)} %`;

const sameButPower = (a: FurnitureInstance, b: FurnitureInstance): boolean => {
  if (a === b) return true;
  const ka = Object.keys(a).filter((k) => k !== 'lightPower');
  const kb = Object.keys(b).filter((k) => k !== 'lightPower');
  if (ka.length !== kb.length) return false;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  return ka.every((k) => ra[k] === rb[k]);
};

/**
 * True when `next` differs from `prev` only in the `lightPower` of some pieces. The 3D scene uses this to retune its lights in place while a
 * slider is dragged, instead of rebuilding the whole room on every movement.
 */
export function lightPowerOnly(prev: Project, next: Project): boolean {
  if (prev === next) return false;
  if (prev.rooms.length !== next.rooms.length) return false;
  const topKeys = (p: Project): string[] => Object.keys(p).filter((k) => k !== 'rooms');
  if (topKeys(prev).length !== topKeys(next).length) return false;
  for (const k of topKeys(prev)) if ((prev as unknown as Record<string, unknown>)[k] !== (next as unknown as Record<string, unknown>)[k]) return false;
  let changed = false;
  for (let i = 0; i < prev.rooms.length; i++) {
    const a = prev.rooms[i];
    const b = next.rooms[i];
    if (a === b) continue;
    const roomKeys = Object.keys(a).filter((k) => k !== 'furniture');
    if (roomKeys.length !== Object.keys(b).filter((k) => k !== 'furniture').length) return false;
    for (const k of roomKeys) if ((a as unknown as Record<string, unknown>)[k] !== (b as unknown as Record<string, unknown>)[k]) return false;
    if (a.furniture.length !== b.furniture.length) return false;
    for (let j = 0; j < a.furniture.length; j++) {
      if (a.furniture[j] === b.furniture[j]) continue;
      if (a.furniture[j].id !== b.furniture[j].id || !sameButPower(a.furniture[j], b.furniture[j])) return false;
      changed = true;
    }
  }
  return changed;
}

/** The project with one piece's power set (1 = the default, stored as "not set"). */
export function withLightPower(project: Project, id: string, power: number): Project {
  const v = clampPower(power, PIECE_POWER_MAX);
  return {
    ...project,
    rooms: project.rooms.map((r) => {
      if (!r.furniture.some((f) => f.id === id)) return r;
      return {
        ...r,
        furniture: r.furniture.map((f) => {
          if (f.id !== id) return f;
          const { lightPower: _drop, ...rest } = f;
          void _drop;
          return Math.abs(v - 1) < 1e-9 ? (rest as FurnitureInstance) : { ...rest, lightPower: v };
        }),
      };
    }),
  };
}
