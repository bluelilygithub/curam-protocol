// Domain → three.js mapping (Spec §4, D37). Pure: no three.js import, so it is unit-testable and never drifts from the engine.
//
//   World X → Three X     World Y → Three Z     elevation → Three Y (up)
//
// A domain rotation φ is counter-clockwise in plan (World X toward World Y). In three.js `rotation.y = θ` maps (x, z) to
// (x cosθ + z sinθ, −x sinθ + z cosθ), so the same turn is θ = −φ. An object's local frame (C20) is: width = local X, length =
// local Y (front = +Y at rotation 0); in three it becomes group-local X and Z, with local Y of the plan on Z.
import { threeToWorld, worldToThree } from '../engine/coordinates';
import type { FurnitureInstance, Vec2 } from '../engine/types';

export type { Vec3 } from '@planner-core/render3d/camera';
import type { Vec3 } from '@planner-core/render3d/camera';

/** Plan point + elevation → three position. */
export function planToThree(p: Vec2, elevation = 0): Vec3 {
  const t = worldToThree(p, elevation);
  return [t.x, t.y, t.z];
}

/** Three position → plan point + elevation. Exact inverse of `planToThree`. */
export function threeToPlan(v: Vec3): { position: Vec2; elevation: number } {
  return threeToWorld({ x: v[0], y: v[1], z: v[2] });
}

/** three.js `rotation.y` for a domain rotation (radians, CCW in plan). */
export const rotationYOf = (phi: number): number => (phi === 0 ? 0 : -phi);

/** Inverse of `rotationYOf`. */
export const rotationFromY = (theta: number): number => (theta === 0 ? 0 : -theta);

/** Group transform of a furniture instance: origin at the footprint centre on its elevation, turned about the vertical axis. */
export function instanceTransform(i: Pick<FurnitureInstance, 'position' | 'elevation' | 'rotation'>): { position: Vec3; rotationY: number } {
  return { position: planToThree(i.position, i.elevation), rotationY: rotationYOf(i.rotation) };
}

/** A point in an object's local frame (x = width axis, y = up, z = length axis) → three world position. */
export function localToThreeWorld(origin: Vec3, rotationY: number, local: Vec3): Vec3 {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return [origin[0] + local[0] * c + local[2] * s, origin[1] + local[1], origin[2] - local[0] * s + local[2] * c];
}
