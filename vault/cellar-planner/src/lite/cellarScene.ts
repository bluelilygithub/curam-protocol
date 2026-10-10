import { internalSize } from '../enclosure/enclosure';
import type { WallKind, WallSide } from '../enclosure/types';
import { doorOpening, wallPoint, type RackLayoutAnalysis, type RackRun } from '../placement/placement';
import { BOTTLE_PROFILES } from '../engine/defaults';
import type { AppProject } from '../app/model';

// The "Cellar view": the inside of the cellar as a visitor would see it standing at the door. Pure geometry, no drawing: it turns the design into
// faces (floor, walls, rack boxes) and bottles in screen space, far to near, for the screen to paint. A pinhole camera at the door looking in, so
// the racks on the far wall face the visitor and the racks on both side walls show their open fronts at an angle. The door wall itself is left out
// (cut away) so there is nothing between the visitor and the room.
//
// Coordinates: x to the right, y away from the camera (depth), z up, millimetres, with the door wall at y = depth (the near wall).

export type V3 = [number, number, number];
export interface SceneFace { id: string; kind: 'floor' | 'wall' | 'glass' | 'rackTop' | 'rackEnd' | 'rackFront' | 'marker'; pts: Array<[number, number]>; shade: number; depth: number; wallKind?: WallKind }
export interface SceneBottle { x: number; y: number; rx: number; ry: number; rotation: number; depth: number }
export interface SceneLine { pts: Array<[number, number]>; depth: number; kind: 'plank' | 'mullion' }
export interface Scene {
  faces: SceneFace[];
  bottles: SceneBottle[];
  lines: SceneLine[];
  /** Screen-space bounds of everything drawn, for fitting it to the canvas. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  stats: { racks: number; bottles: number };
  /** Door position on the cut-away wall, projected, for a small "Door" marker. */
  door: { x: number; y: number } | null;
}

export interface SceneInput {
  project: AppProject;
  runs: RackRun[];
  analysis: RackLayoutAnalysis;
  /** Turn the camera left/right around the room's centre, in degrees (the visitor drags to do this). Limited to +/- 40. */
  yawDeg?: number;
}

const QUARTERS: Record<WallSide, number> = { SOUTH: 0, EAST: 1, NORTH: 2, WEST: 3 };
/** One clockwise quarter turn of the plan (north goes to east, east to south...). */
const NEXT: Record<WallSide, WallSide> = { NORTH: 'EAST', EAST: 'SOUTH', SOUTH: 'WEST', WEST: 'NORTH' };

/** The room turned so the door wall is the south (near) wall. Dimensions swap on odd turns. */
function turner(quarters: number, w: number, d: number): { W: number; D: number; pt(x: number, y: number): [number, number]; wall(s: WallSide): WallSide } {
  const k = ((quarters % 4) + 4) % 4;
  let W = w, D = d;
  const steps: Array<[number, number]> = [];
  for (let i = 0; i < k; i++) { steps.push([W, D]); [W, D] = [D, W]; }
  return {
    W, D,
    pt: (x, y) => { let px = x, py = y; for (const [, prevD] of steps) { [px, py] = [prevD - py, px]; } return [px, py]; },
    wall: (s) => { let r = s; for (let i = 0; i < k; i++) r = NEXT[r]; return r; },
  };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** A pinhole camera: world point to screen (x right, y down) with the distance in front of it. Null when the point is behind the camera. */
export function makeCamera(eye: V3, target: V3, focalPx: number): (p: V3) => { x: number; y: number; z: number } | null {
  const f = norm(sub(target, eye));
  // the plan's axes (x east, y south, z up) are left-handed, so "right" is up x forward and "up" is forward x right
  const r = norm(cross([0, 0, 1], f));
  const u = cross(f, r);
  return (p) => {
    const v = sub(p, eye);
    const z = dot(v, f);
    if (z < 50) return null;
    return { x: (dot(v, r) / z) * focalPx, y: (-dot(v, u) / z) * focalPx, z };
  };
}

export function buildScene(input: SceneInput): Scene {
  const { project, runs, analysis } = input;
  const e = project.enclosure;
  const inner = internalSize(e);
  const t = turner(QUARTERS[e.door.wall], inner.widthMm, inner.depthMm);
  const W = t.W, D = t.D, H = inner.heightMm;
  const yaw = (Math.max(-40, Math.min(40, input.yawDeg ?? 0)) * Math.PI) / 180;

  // the camera is outside the door and well above head height, looking down into the room (the near wall is cut away, like a dolls' house)
  const centre: V3 = [W / 2, D * 0.5, H * 0.3];
  const back = Math.max(W, D) * 0.95 + 900;
  const eyeBase: V3 = [W / 2, D + back, H * 1.75 + 600];
  const dx = eyeBase[0] - centre[0], dy = eyeBase[1] - centre[1];
  const eye: V3 = [centre[0] + dx * Math.cos(yaw) + dy * Math.sin(yaw), centre[1] - dx * Math.sin(yaw) + dy * Math.cos(yaw), eyeBase[2]];
  const cam = makeCamera(eye, centre, 1000);
  const dist = (p: V3): number => Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
  const centreOf = (pts: V3[]): V3 => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length, pts.reduce((a, p) => a + p[2], 0) / pts.length];

  const faces: SceneFace[] = [];
  const bottles: SceneBottle[] = [];
  const lines: SceneLine[] = [];
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number): void => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };

  const project3 = (pts: V3[]): Array<[number, number]> | null => {
    const out: Array<[number, number]> = [];
    for (const p of pts) { const s = cam(p); if (!s) return null; out.push([s.x, s.y]); grow(s.x, s.y); }
    return out;
  };
  const addFace = (id: string, kind: SceneFace['kind'], pts3: V3[], shade: number, extra: Partial<SceneFace> = {}): void => {
    const pts = project3(pts3);
    if (pts) faces.push({ id, kind, pts, shade, depth: dist(centreOf(pts3)), ...extra });
  };

  // floor, then the far wall and the two side walls (their inner faces)
  addFace('floor', 'floor', [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]], 1);
  const wallKind = (s: WallSide): WallKind => e.walls[s].kind;
  // which real wall is now far (north), left (west) and right (east) once the door wall is at the front
  const real = (turned: WallSide): WallSide => { for (const s of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as WallSide[]) if (t.wall(s) === turned) return s; return turned; };
  const far = real('NORTH'), left = real('WEST'), right = real('EAST');
  const glassOrWall = (s: WallSide): SceneFace['kind'] => (wallKind(s) === 'GLASS' ? 'glass' : 'wall');
  addFace('wall-far', glassOrWall(far), [[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]], 0.92, { wallKind: wallKind(far) });
  addFace('wall-left', glassOrWall(left), [[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]], 0.8, { wallKind: wallKind(left) });
  addFace('wall-right', glassOrWall(right), [[W, 0, 0], [W, D, 0], [W, D, H], [W, 0, H]], 0.74, { wallKind: wallKind(right) });

  // floor boards running away from the camera
  for (let x = 300; x < W; x += 300) {
    const pts = project3([[x, 0, 0], [x, D, 0]]);
    if (pts) lines.push({ pts, depth: dist([x, D / 2, 0]) + 1e6, kind: 'plank' });
  }

  // racks
  let rackCount = 0, bottleCount = 0;
  const profile = BOTTLE_PROFILES[project.bottle];
  for (const run of runs) {
    const ra = analysis.runs.find((x) => x.runId === run.id);
    if (!ra || ra.footprint.status !== 'OK' || ra.capacity.status !== 'OK') continue;
    const r = ra.footprint.rect;
    const [ax, ay] = t.pt(r.x0, r.y0), [bx, by] = t.pt(r.x1, r.y1);
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    const turned = t.wall(run.wall);
    const rows = ra.capacity.rowsPerUnit, perRow = ra.capacity.bottlesPerRow * ra.capacity.units;
    const pitch = (project.rackSpec.rowPitchMm ?? profile.diameterMm + 5) as number;
    const h = Math.min(H - 20, Math.max(300, rows * pitch + 80));
    rackCount++;
    // the near wall is cut away, so a rack against it is seen from behind: draw only its box
    const open: 'N' | 'S' | 'W' | 'E' = turned === 'NORTH' ? 'S' : turned === 'SOUTH' ? 'N' : turned === 'WEST' ? 'E' : 'W';
    const id = run.id;
    // top
    if (eye[2] > h) addFace(`${id}-top`, 'rackTop', [[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], 1.0); // seen only from above
    // end faces and the open front; each is drawn only when it faces the camera
    const quads: Array<{ side: 'N' | 'S' | 'W' | 'E'; pts: V3[]; normal: V3 }> = [
      { side: 'S', pts: [[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]], normal: [0, 1, 0] },
      { side: 'N', pts: [[x0, y0, 0], [x1, y0, 0], [x1, y0, h], [x0, y0, h]], normal: [0, -1, 0] },
      { side: 'W', pts: [[x0, y0, 0], [x0, y1, 0], [x0, y1, h], [x0, y0, h]], normal: [-1, 0, 0] },
      { side: 'E', pts: [[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]], normal: [1, 0, 0] },
    ];
    for (const q of quads) {
      const c = centreOf(q.pts);
      if (dot(q.normal, sub(eye, c)) <= 0) continue; // faces away from the camera
      const isOpen = q.side === open;
      // faces that sit against a wall are never seen
      const againstWall = (q.side === 'N' && y0 < 5) || (q.side === 'W' && x0 < 5) || (q.side === 'E' && x1 > W - 5) || (q.side === 'S' && y1 > D - 5);
      if (againstWall && !isOpen) continue;
      addFace(`${id}-${q.side}`, isOpen ? 'rackFront' : 'rackEnd', q.pts, q.side === 'W' || q.side === 'E' ? 0.78 : 0.9);
      if (!isOpen) continue;
      // bottles on the open front: perRow across the run's length, `rows` up the height
      const alongX = q.side === 'N' || q.side === 'S';
      const len = alongX ? x1 - x0 : y1 - y0;
      const step = len / perRow;
      const radius = Math.min(profile.diameterMm / 2, step / 2) * 0.94;
      const fixed = q.side === 'S' ? y1 : q.side === 'N' ? y0 : q.side === 'W' ? x0 : x1;
      const frontDepth = dist(centreOf(q.pts));
      for (let j = 0; j < rows; j++) {
        const z = 50 + (j + 0.5) * pitch;
        for (let i = 0; i < perRow; i++) {
          const along = (alongX ? x0 : y0) + (i + 0.5) * step;
          const p: V3 = alongX ? [along, fixed, z] : [fixed, along, z];
          const s0 = cam(p);
          if (!s0) continue;
          const pu = cam(alongX ? [p[0] + radius, p[1], p[2]] : [p[0], p[1] + radius, p[2]]);
          const pv = cam([p[0], p[1], p[2] + radius]);
          if (!pu || !pv) continue;
          const ux = pu.x - s0.x, uy = pu.y - s0.y, vx = pv.x - s0.x, vy = pv.y - s0.y;
          bottles.push({ x: s0.x, y: s0.y, rx: Math.max(0.2, Math.hypot(ux, uy)), ry: Math.max(0.2, Math.hypot(vx, vy)), rotation: (Math.atan2(uy, ux) * 180) / Math.PI, depth: frontDepth - 0.5 });
          grow(s0.x - Math.hypot(ux, uy), s0.y - Math.hypot(vx, vy)); grow(s0.x + Math.hypot(ux, uy), s0.y + Math.hypot(vx, vy));
          bottleCount++;
        }
      }
    }
  }

  // a small marker where the door is, on the floor at the cut-away wall
  let door: Scene['door'] = null;
  try {
    const open = doorOpening(e);
    const pa = wallPoint(e, open.wall, open.aMm, 0), pb = wallPoint(e, open.wall, open.bMm, 0);
    const [ax, ay] = t.pt(pa.x, pa.y), [bx, by] = t.pt(pb.x, pb.y);
    const mid: V3 = [(ax + bx) / 2, (ay + by) / 2, 0];
    const s = cam(mid);
    if (s) { door = { x: s.x, y: s.y }; grow(s.x, s.y); }
  } catch { /* no door marker */ }

  faces.sort((a, c) => c.depth - a.depth);
  bottles.sort((a, c) => c.depth - a.depth);
  if (!Number.isFinite(b.x0)) { b.x0 = -1; b.y0 = -1; b.x1 = 1; b.y1 = 1; }
  return { faces, bottles, lines, bounds: b, stats: { racks: rackCount, bottles: bottleCount }, door };
}
