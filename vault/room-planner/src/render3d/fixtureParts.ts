// 3D models of doors and windows (D38): a frame around the opening plus a closed leaf (door) or translucent glass (window).
// In the fixture's local frame: x along the wall (start → end), y up from the room floor, z = interior normal; the wall body
// sits at negative z (walls expand outward only), so the opening is centred on z = −thickness/2. Pure data.
import { fixtureCentre, wallGeometry } from '../engine/constraints';
import { DEFAULT_WALL_THICKNESS } from '../engine/wallOutline';
import type { Fixture, Room } from '../engine/types';
import type { Part } from './furnitureParts';
import type { Vec3 } from './transforms';

export const FRAME_WIDTH = 0.05;
export const FRAME_DEPTH_MAX = 0.1;

export interface FixtureModel {
  /** Group origin on the interior face at the fixture centre, floor level; `rotationY` for three.js. */
  position: Vec3;
  rotationY: number;
  parts: Part[];
}

const box = (role: Part['role'], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Part =>
  ({ shape: 'box', role, centre: [cx, cy, cz], size: [sx, sy, sz] });

export function fixtureModel(room: Room, f: Fixture): FixtureModel | undefined {
  const g = wallGeometry(room, f.wallId);
  if (!g) return undefined;
  const t = g.wall.thickness ?? DEFAULT_WALL_THICKNESS;
  const c = fixtureCentre(g, f);
  const fw = Math.min(FRAME_WIDTH, f.width / 4, f.height / 4);
  const depth = Math.min(FRAME_DEPTH_MAX, t);
  const zc = -t / 2;
  const y0 = f.elevation;
  const y1 = f.elevation + f.height;
  const parts: Part[] = [
    box('frame', -f.width / 2 + fw / 2, (y0 + y1) / 2, zc, fw, f.height, depth),
    box('frame', f.width / 2 - fw / 2, (y0 + y1) / 2, zc, fw, f.height, depth),
    box('frame', 0, y1 - fw / 2, zc, f.width - 2 * fw, fw, depth),
  ];
  if (f.type === 'window') {
    parts.push(box('frame', 0, y0 + fw / 2, zc, f.width - 2 * fw, fw, depth));
    parts.push(box('glass', 0, (y0 + y1) / 2, zc, f.width - 2 * fw, f.height - 2 * fw, 0.012));
  } else {
    // Closed leaf, slightly inside the frame; the head is the frame's top bar.
    parts.push(box('door', 0, (y0 + y1 - fw) / 2, zc, f.width - 2 * fw, f.height - fw, Math.min(0.04, depth)));
  }
  // dir = (cosφ, sinφ) in plan, so the group's rotation about the vertical axis is −φ (D37).
  const phi = Math.atan2(g.dir.y, g.dir.x);
  return { position: [c.x, 0, c.y], rotationY: phi === 0 ? 0 : -phi, parts };
}
