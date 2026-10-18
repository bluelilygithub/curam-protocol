import { internalSize } from '../enclosure/enclosure';
import type { WallKind, WallSide } from '../enclosure/types';
import { doorOpening, type RackLayoutAnalysis, type RackRun } from '../placement/placement';
import { BOTTLE_PROFILES } from '../engine/defaults';
import type { AppProject } from '../app/model';
import type { FeatureEffect } from './config';
import { FINISH_LOOK, type FinishKey } from './finishes';

// Render photo, the pure half: the design as a list of real-world shapes (millimetres, plan coordinates: x east, y south, z up, the north wall at
// y = 0 and the south wall at y = depth), ready for the three.js side (photoScene.ts) to turn into a scene. No drawing and no three.js here, so it
// is tested without a graphics card. It follows the same rules as the on-screen picture (cellarScene.ts): racks are open boxes with the bottles lying
// neck-out in them, the open front faces into the room, only racks that can be built are drawn, and the same feature picks change the look.

export interface PhotoRack {
  id: string;
  x0: number; x1: number; y0: number; y1: number; h: number;
  /** The side of the box that is open (faces into the room). */
  open: 'N' | 'S' | 'W' | 'E';
  rows: number; perRow: number; pitch: number;
}
export interface PhotoBottle {
  /** Centre of the whole bottle (body, shoulder and neck), in mm. */
  x: number; y: number; z: number;
  /** The direction the bottle's neck points (out of the open front). */
  dir: 'N' | 'S' | 'W' | 'E';
  radius: number; length: number;
}
export interface PhotoDoor { wall: WallSide; aMm: number; bMm: number; heightMm: number; leaves: 1 | 2; kind: 'none' | 'glass' | 'timber' }
export interface PhotoWall { side: WallSide; kind: WallKind | 'WALL' | 'GLASS' }
export interface PhotoGeometry {
  widthMm: number; depthMm: number; heightMm: number;
  walls: PhotoWall[];
  racks: PhotoRack[];
  bottles: PhotoBottle[];
  door: PhotoDoor;
  finish: FinishKey;
  /** The feature picks that change the look (floor and wall finishes, lights, a centre piece, a glass front). */
  effects: FeatureEffect[];
  /** A bench or island in the middle of the room (illustrative, as in the on-screen picture), or null. */
  centrePiece: { x0: number; x1: number; y0: number; y1: number; h: number } | null;
  /** Ceiling spots (downlights) when the Lighting feature is picked; otherwise the room's general light is used. */
  downlights: Array<{ x: number; y: number }>;
  stats: { racks: number; bottles: number };
}

export interface PhotoGeometryInput { project: AppProject; runs: RackRun[]; analysis: RackLayoutAnalysis; effects?: FeatureEffect[] }

/** A hard ceiling on bottles in one picture, so a huge design can never exhaust a device's memory. */
export const MAX_PHOTO_BOTTLES = 4000;

const OPEN_SIDE: Record<WallSide, PhotoRack['open']> = { NORTH: 'S', SOUTH: 'N', WEST: 'E', EAST: 'W' };

export function buildPhotoGeometry(input: PhotoGeometryInput): PhotoGeometry {
  const { project, runs, analysis } = input;
  const e = project.enclosure;
  const inner = internalSize(e);
  const W = inner.widthMm, D = inner.depthMm, H = inner.heightMm;
  const fx = new Set(input.effects ?? []);
  const profile = BOTTLE_PROFILES[project.bottle];
  const racks: PhotoRack[] = [];
  const bottles: PhotoBottle[] = [];

  for (const run of runs) {
    const ra = analysis.runs.find((x) => x.runId === run.id);
    if (!ra || ra.footprint.status !== 'OK' || ra.capacity.status !== 'OK') continue; // a rack that cannot be built is not drawn, as on screen
    const r = ra.footprint.rect;
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    const rows = ra.capacity.rowsPerUnit, perRow = ra.capacity.bottlesPerRow * ra.capacity.units;
    const pitch = (project.rackSpec.rowPitchMm ?? profile.diameterMm + 5) as number;
    const h = Math.min(H - 20, Math.max(300, rows * pitch + 80));
    const open = OPEN_SIDE[run.wall];
    racks.push({ id: run.id, x0, x1, y0, y1, h, open, rows, perRow, pitch });

    const alongX = open === 'N' || open === 'S';
    const len = alongX ? x1 - x0 : y1 - y0;
    const step = len / Math.max(1, perRow);
    const radius = Math.min(profile.diameterMm / 2, step / 2) * 0.94;
    const depthOfRack = alongX ? y1 - y0 : x1 - x0;
    const length = Math.min(profile.lengthMm, Math.max(120, depthOfRack - 30));
    // the bottle's front (the neck end) sits a little proud of the open front; the body lies back into the rack
    const frontPlane = open === 'S' ? y1 : open === 'N' ? y0 : open === 'E' ? x1 : x0;
    for (let j = 0; j < rows; j++) {
      const z = 50 + (j + 0.5) * pitch;
      for (let i = 0; i < perRow; i++) {
        if (bottles.length >= MAX_PHOTO_BOTTLES) break;
        const along = (alongX ? x0 : y0) + (i + 0.5) * step;
        const back = length / 2 - 12; // the centre of the body, back from the front plane
        const cx = alongX ? along : open === 'E' ? frontPlane - back : frontPlane + back;
        const cy = alongX ? (open === 'S' ? frontPlane - back : frontPlane + back) : along;
        bottles.push({ x: cx, y: cy, z, dir: open, radius, length });
      }
    }
  }

  // the door, and what it is made of (glass or timber doors and a glass front are feature picks, as on screen)
  let door: PhotoDoor = { wall: e.door.wall, aMm: 0, bMm: 0, heightMm: Math.min(H, Math.max(1500, e.door.heightMm)), leaves: e.door.leaves === 2 ? 2 : 1, kind: 'none' };
  try {
    const op = doorOpening(e);
    const glass = fx.has('GLASS_DOORS') || fx.has('GLASS_FRONT');
    const timber = fx.has('DOOR_TIMBER') && !glass;
    door = { ...door, wall: op.wall, aMm: op.aMm, bMm: op.bMm, kind: glass ? 'glass' : timber ? 'timber' : 'none' };
  } catch { /* no door opening: leave it out */ }

  const side = (s: WallSide): PhotoWall => ({ side: s, kind: e.walls[s].kind });
  const piece = fx.has('CENTRE_ISLAND') ? { sx: Math.min(1800, W * 0.5), sy: Math.min(900, D * 0.45), h: 900 } : fx.has('CENTRE_BENCH') ? { sx: Math.min(1600, W * 0.5), sy: Math.min(450, D * 0.3), h: 900 } : null;
  const centrePiece = piece ? { x0: W / 2 - piece.sx / 2, x1: W / 2 + piece.sx / 2, y0: D / 2 - piece.sy / 2, y1: D / 2 + piece.sy / 2, h: piece.h } : null;
  const downlights: PhotoGeometry['downlights'] = [];
  if (fx.has('LIGHT_DOWNLIGHTS')) {
    const nx = Math.max(1, Math.min(4, Math.round(W / 900))), ny = Math.max(1, Math.min(3, Math.round(D / 900)));
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) downlights.push({ x: (W * (i + 0.5)) / nx, y: (D * (j + 0.5)) / ny });
  }

  const finish: FinishKey = project.finish && project.finish in FINISH_LOOK ? project.finish : 'OAK';
  return {
    widthMm: W, depthMm: D, heightMm: H,
    walls: (['NORTH', 'EAST', 'SOUTH', 'WEST'] as WallSide[]).map(side),
    racks, bottles, door, finish, effects: input.effects ?? [], centrePiece, downlights,
    stats: { racks: racks.length, bottles: bottles.length },
  };
}

/** Where the camera stands and looks, in mm. `door` is a person standing just inside the door, `overview` looks down into the room with the door wall cut away. */
export type PhotoView = 'door' | 'overview';
export interface PhotoPose { position: [number, number, number]; target: [number, number, number]; fov: number }

export function photoPose(g: PhotoGeometry, view: PhotoView): PhotoPose {
  const { widthMm: W, depthMm: D, heightMm: H } = g;
  const door = g.door;
  // the door wall's outward direction in plan coordinates, and where the door is along it
  const dirs: Record<WallSide, [number, number]> = { NORTH: [0, -1], SOUTH: [0, 1], WEST: [-1, 0], EAST: [1, 0] };
  const out = dirs[door.wall];
  const along = (door.aMm + door.bMm) / 2 || ((door.wall === 'NORTH' || door.wall === 'SOUTH') ? W / 2 : D / 2);
  const onWall: [number, number] = door.wall === 'NORTH' ? [along, 0] : door.wall === 'SOUTH' ? [along, D] : door.wall === 'WEST' ? [0, along] : [W, along];
  const centre: [number, number] = [W / 2, D / 2];
  if (view === 'door') {
    // just inside the door, eye height, looking at the middle of the far side of the room
    const eyeXY: [number, number] = [onWall[0] - out[0] * 450, onWall[1] - out[1] * 450];
    return { position: [eyeXY[0], eyeXY[1], Math.min(1550, H - 250)], target: [centre[0], centre[1], Math.min(1100, H * 0.5)], fov: 78 };
  }
  const back = Math.max(W, D) * 0.7 + 700;
  return { position: [centre[0] + out[0] * back, centre[1] + out[1] * back, H * 1.5 + 500], target: [centre[0], centre[1], H * 0.3], fov: 50 };
}
