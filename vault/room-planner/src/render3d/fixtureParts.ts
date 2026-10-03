// 3D models of doors and windows (D38, v2 in M4.6): a frame (architrave) around the opening plus a closed door leaf with raised panels and
// a lever handle, or a window with a glazing bar and a sill, both with translucent glass for the window. In the fixture's local frame:
// x along the wall (start → end), y up from the room floor, z = interior normal; the wall body sits at negative z (walls expand outward
// only), so the opening is centred on z = −thickness/2. Pure data.
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

type Ext = [number, number];
const box = (role: Part['role'], x: Ext, y: Ext, z: Ext, r = 0): Part => {
  const size: Vec3 = [x[1] - x[0], y[1] - y[0], z[1] - z[0]];
  const centre: Vec3 = [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2];
  if (r <= 0) return { shape: 'box', role, centre, size };
  return { shape: 'rbox', role, centre, size, radius: Math.max(0, Math.min(r, size[0] / 2 - 1e-4, size[1] / 2 - 1e-4, size[2] / 2 - 1e-4)) };
};

export function fixtureModel(room: Room, f: Fixture): FixtureModel | undefined {
  const g = wallGeometry(room, f.wallId);
  if (!g) return undefined;
  const t = g.wall.thickness ?? DEFAULT_WALL_THICKNESS;
  const c = fixtureCentre(g, f);
  const fw = Math.min(FRAME_WIDTH, f.width / 4, f.height / 4);
  const depth = Math.min(FRAME_DEPTH_MAX, t);
  const zc = -t / 2;
  const z: Ext = [zc - depth / 2, zc + depth / 2];
  const y0 = f.elevation;
  const y1 = f.elevation + f.height;
  const hw = f.width / 2;
  const parts: Part[] = [
    box('frame', [-hw, -hw + fw], [y0, y1], z),
    box('frame', [hw - fw, hw], [y0, y1], z),
    box('frame', [-hw + fw, hw - fw], [y1 - fw, y1], z),
  ];
  if (f.type === 'window') {
    parts.push(box('frame', [-hw + fw, hw - fw], [y0, y0 + fw], z));
    const gx: Ext = [-hw + fw, hw - fw];
    const gy: Ext = [y0 + fw, y1 - fw];
    parts.push(box('glass', gx, gy, [zc - 0.006, zc + 0.006]));
    // glazing bars: a vertical one in a wide window, and a horizontal one in a tall one
    const bar = 0.02;
    if (f.width > 0.9) parts.push(box('frame', [-bar / 2, bar / 2], gy, [zc - 0.015, zc + 0.015]));
    if (f.height > 0.8) parts.push(box('frame', gx, [(gy[0] + gy[1]) / 2 - bar / 2, (gy[0] + gy[1]) / 2 + bar / 2], [zc - 0.015, zc + 0.015]));
    // the sill, standing proud of the inside wall face
    parts.push(box('frame', [-hw - 0.03, hw + 0.03], [y0, y0 + 0.025], [zc - depth / 2, 0.04], 0.006));
  } else {
    const lw: Ext = [-hw + fw + 0.004, hw - fw - 0.004];
    const ly: Ext = [y0, y1 - fw - 0.004];
    const lz: Ext = [zc - 0.02, zc + 0.02];
    parts.push(box('door', lw, ly, lz, 0.004));
    // two raised panels on the room side of the leaf
    const pw = (lw[1] - lw[0]) - 0.16;
    const ph = (ly[1] - ly[0]);
    const px: Ext = [-pw / 2, pw / 2];
    parts.push(box('door', px, [ly[0] + ph * 0.1, ly[0] + ph * 0.46], [zc + 0.02, zc + 0.026], 0.003));
    parts.push(box('door', px, [ly[0] + ph * 0.54, ly[0] + ph * 0.92], [zc + 0.02, zc + 0.026], 0.003));
    // lever handle on the side away from the hinge
    const sign = (f.hingeSide ?? 'left') === 'left' ? -1 : 1;
    const hx = sign * (lw[1] - 0.06);
    parts.push(box('handle', [Math.min(hx, hx - sign * 0.11), Math.max(hx, hx - sign * 0.11)], [y0 + 1.0, y0 + 1.022], [zc + 0.02, zc + 0.058], 0.008));
    parts.push(box('handle', [hx - 0.011, hx + 0.011], [y0 + 0.985, y0 + 1.037], [zc + 0.02, zc + 0.034], 0.008));
  }
  // dir = (cosφ, sinφ) in plan, so the group's rotation about the vertical axis is −φ (D37).
  const phi = Math.atan2(g.dir.y, g.dir.x);
  return { position: [c.x, 0, c.y], rotationY: phi === 0 ? 0 : -phi, parts };
}
