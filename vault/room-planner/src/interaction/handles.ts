import { footprintOf, localToWorld, type ResizeHandle } from '../engine/footprints';
import { aabbOf } from '../engine/geometry';
import type { Project, Vec2 } from '../engine/types';
import type { SelectionRef } from '../engine/selection';

/** Touch targets are at least 44 × 44 px (Spec rule 12); B2: the rotation handle sits 24 px above the top-centre. */
export const HANDLE_HIT_PX = 44;
export const ROTATE_OFFSET_PX = 24;
export const MIN_SIZE = 0.05; // B3, enforced in the interaction layer

export interface Handles {
  /** Resize handles (only for a single, unlocked furniture selection). */
  resize: Array<{ handle: ResizeHandle; world: Vec2 }>;
  rotate: Vec2 | null;
}

const HANDLES: ResizeHandle[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 },
];

/** Handle positions for the current selection (world metres). */
export function computeHandles(project: Project, selection: SelectionRef[], mpp: number): Handles {
  const room = project.rooms[0];
  const empty: Handles = { resize: [], rotate: null };
  if (!room) return empty;
  const picked = selection.filter((s) => s.kind === 'furniture').map((s) => room.furniture.find((f) => f.id === s.id)).filter((f) => !!f);
  if (picked.length === 0 || picked.length !== selection.length) return empty;
  if (picked.some((f) => f!.locked)) return empty;
  const box = aabbOf(picked.flatMap((f) => footprintOf(f!)));
  const rotate = { x: (box.min.x + box.max.x) / 2, y: box.max.y + ROTATE_OFFSET_PX * mpp };
  if (picked.length > 1) return { resize: [], rotate };
  const f = picked[0]!;
  return {
    rotate,
    resize: HANDLES.map((handle) => ({
      handle,
      world: localToWorld(f, { x: (handle.x * f.width) / 2, y: (handle.y * f.length) / 2 }),
    })),
  };
}

export type HandleHit =
  | { kind: 'rotate' }
  | { kind: 'resize'; handle: ResizeHandle }
  | null;

/** Hit-test handles with a ≥ 44 px target (radius = half of it). Rotation wins ties, then corners over edges. */
export function hitHandle(h: Handles, world: Vec2, mpp: number): HandleHit {
  const r = (HANDLE_HIT_PX / 2) * mpp;
  const d = (p: Vec2): number => Math.hypot(p.x - world.x, p.y - world.y);
  if (h.rotate && d(h.rotate) <= r) return { kind: 'rotate' };
  let best: { handle: ResizeHandle; dist: number } | null = null;
  for (const item of h.resize) {
    const dd = d(item.world);
    if (dd <= r && (!best || dd < best.dist - 1e-12 || (Math.abs(dd - best.dist) <= 1e-12 && item.handle.x !== 0 && item.handle.y !== 0))) {
      best = { handle: item.handle, dist: dd };
    }
  }
  return best ? { kind: 'resize', handle: best.handle } : null;
}
