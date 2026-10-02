import { quantizeVec2 } from './coordinates';
import { aabbOf } from './geometry';
import { validateInstance } from './validation';
import type { Project, Vec2 } from './types';

const COARSE_STEP = 0.05;
/** Refinement steps; each level searches ±(previous step) around the best candidates of the previous level. */
const REFINE_STEPS = [0.01, 0.002, 0.001];
const KEEP = 24;
const TIE = 1e-9;

function angleCCW(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return a < 0 ? a + Math.PI * 2 : a;
}

/**
 * Fix position (C10): translation-only nearest position (smallest Euclidean centre distance) at which the object has no
 * hard violation, searched within the room's bounding box. Coarse-then-fine, deterministic; ties go to the smallest
 * angle counter-clockwise from +X. Returns the current position if it is already valid, `null` if nothing valid exists.
 *
 * Accuracy: the result is the nearest valid point of the 1 mm grid reachable by refinement from the coarse (50 mm)
 * scan. A valid region narrower than the coarse step that lies nearer than every coarse hit can be missed.
 */
export function findNearestValidPosition(project: Project, instanceId: string): Vec2 | null {
  const room = project.rooms.find((r) => r.furniture.some((f) => f.id === instanceId));
  if (!room) return null;
  const inst = room.furniture.find((f) => f.id === instanceId)!;
  const defs = project.furnitureDefinitions;
  const box = aabbOf(room.vertices.map((v) => v.position));

  const cache = new Map<string, boolean>();
  const isValid = (p: Vec2): boolean => {
    const q = quantizeVec2(p);
    const k = `${q.x},${q.y}`;
    let v = cache.get(k);
    if (v === undefined) {
      v = !validateInstance(room, defs, { ...inst, position: q }).some((x) => x.severity === 'hard');
      cache.set(k, v);
    }
    return v;
  };
  const inBox = (p: Vec2): boolean => p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y;
  const origin = inst.position;
  if (isValid(origin)) return origin;

  const d = (p: Vec2): number => Math.hypot(p.x - origin.x, p.y - origin.y);
  const better = (a: Vec2, b: Vec2): boolean => {
    const da = d(a);
    const db = d(b);
    if (Math.abs(da - db) > TIE) return da < db;
    return angleCCW(a.x - origin.x, a.y - origin.y) < angleCCW(b.x - origin.x, b.y - origin.y);
  };

  // Coarse: square shells around the current position; stop once a shell cannot beat the best hit.
  let valid: Vec2[] = [];
  let best: Vec2 | undefined;
  const maxK = Math.ceil(Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y) / COARSE_STEP) + 1;
  for (let k = 1; k <= maxK; k++) {
    if (best && k * COARSE_STEP > d(best)) break;
    for (let i = -k; i <= k; i++) {
      for (let j = -k; j <= k; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== k) continue;
        const p = quantizeVec2({ x: origin.x + i * COARSE_STEP, y: origin.y + j * COARSE_STEP });
        if (!inBox(p) || !isValid(p)) continue;
        valid.push(p);
        if (!best || better(p, best)) best = p;
      }
    }
  }
  if (!best) return null;

  let prevStep = COARSE_STEP;
  for (const step of REFINE_STEPS) {
    const bestD = d(best);
    const seeds = valid
      .filter((p) => d(p) <= bestD + prevStep * 1.5)
      .sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0))
      .slice(0, KEEP);
    const next = new Map<string, Vec2>();
    const radius = Math.round(prevStep / step);
    for (const s of seeds) {
      for (let i = -radius; i <= radius; i++) {
        for (let j = -radius; j <= radius; j++) {
          const p = quantizeVec2({ x: s.x + i * step, y: s.y + j * step });
          if (!inBox(p) || !isValid(p)) continue;
          next.set(`${p.x},${p.y}`, p);
          if (better(p, best)) best = p;
        }
      }
    }
    valid = [...next.values()];
    prevStep = step;
  }
  return best;
}
