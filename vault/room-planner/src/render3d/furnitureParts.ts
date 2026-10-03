// Procedural 3D models for furniture (D41, v2 in M4.6): rounded boxes, tapered legs, cushions, panels, handles, books, in the object's
// local frame (x = width axis, y = up from the instance elevation, z = length axis, front = +z, C20). Pure data, no three.js.
// Every recipe fits inside the instance's width × height × length and the parts together span all three extents exactly, so the model
// never pokes out of the footprint the engine validates. Unknown definitions fall back to one plain box.
import type { Vec3 } from './transforms';

/** Part names double as the keys of `finishOverrides` (C13): part name → material id. */
export type PartRole = 'frame' | 'upholstery' | 'top' | 'leg' | 'fabric' | 'accent' | 'handle' | 'glass' | 'door';

export type PartShape = 'box' | 'rbox' | 'cylinder' | 'taper';

export interface Part {
  shape: PartShape;
  role: PartRole;
  /** Centre in the local frame. */
  centre: Vec3;
  /** Full extents (a taper's are those of its wide end). */
  size: Vec3;
  /** `rbox`: corner radius in metres (always less than half of every extent). */
  radius?: number;
  /** `taper`: width of the narrow (bottom) end as a fraction of the wide (top) end. */
  taper?: number;
  /** `cylinder`: the axis it runs along (default y). The cross-section is an ellipse in the other two extents. */
  axis?: 'x' | 'y' | 'z';
  /** A decorative colour for this one part in the Realistic look (the books); the Clay look ignores it. */
  tint?: string;
}

/** Default look per part when no finish override applies (Spec §8: roughness 0.4–0.8, metalness 0–0.1). */
export const ROLE_DEFAULTS: Record<PartRole, { colour: string; roughness: number; metalness: number; opacity?: number }> = {
  frame: { colour: '#b98b57', roughness: 0.6, metalness: 0 },
  upholstery: { colour: '#8d949c', roughness: 0.8, metalness: 0 },
  top: { colour: '#c9a679', roughness: 0.5, metalness: 0 },
  leg: { colour: '#5a4636', roughness: 0.6, metalness: 0.05 },
  fabric: { colour: '#e6e2d8', roughness: 0.8, metalness: 0 },
  accent: { colour: '#a67c4e', roughness: 0.55, metalness: 0 },
  handle: { colour: '#a9adb2', roughness: 0.4, metalness: 0.1 },
  glass: { colour: '#bfe3f2', roughness: 0.4, metalness: 0.1, opacity: 0.35 },
  door: { colour: '#d8d2c6', roughness: 0.6, metalness: 0 },
};

type Ext = [number, number]; // [min, max]
const GAP = 0.004;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Box from local min/max extents. */
const box = (role: PartRole, x: Ext, y: Ext, z: Ext): Part => ({
  shape: 'box', role, centre: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2], size: [x[1] - x[0], y[1] - y[0], z[1] - z[0]],
});
/** Rounded box: the radius is capped so it can never exceed half of any extent. */
const rbox = (role: PartRole, x: Ext, y: Ext, z: Ext, r = 0.015, tint?: string): Part => {
  const b = box(role, x, y, z);
  return { ...b, shape: 'rbox', radius: Math.max(0, Math.min(r, b.size[0] / 2 - 1e-4, b.size[1] / 2 - 1e-4, b.size[2] / 2 - 1e-4)), ...(tint ? { tint } : {}) };
};
const cyl = (role: PartRole, x: Ext, y: Ext, z: Ext, axis: 'x' | 'y' | 'z' = 'y'): Part => ({ ...box(role, x, y, z), shape: 'cylinder', axis });
/** A leg that narrows toward the floor: `top` wide at the top of height `height`, `ratio` at the foot. */
const leg = (role: PartRole, cx: number, cz: number, top: number, height: number, ratio = 0.6): Part => ({
  shape: 'taper', role, centre: [cx, height / 2, cz], size: [top, height, top], taper: ratio,
});

/** Four tapered legs under a rectangle, inset from the corners. */
function fourLegs(w: number, l: number, height: number, top: number, inset: number, role: PartRole = 'leg'): Part[] {
  const t = Math.min(top, w / 4, l / 4);
  const dx = w / 2 - inset - t / 2;
  const dz = l / 2 - inset - t / 2;
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => leg(role, sx * dx, sz * dz, t, height));
}

// ------------------------------------------------------------------ seating

function sofa(w: number, l: number, h: number, o: { seats: number; arm: number }): Part[] {
  const legH = clamp(h * 0.16, 0.05, 0.16);
  const base = h * 0.38;
  const armW = Math.min(o.arm, w / 4);
  const backT = Math.min(0.26, l * 0.3);
  const cush = Math.min(0.18, h * 0.22);
  const x0 = -w / 2 + armW;
  const x1 = w / 2 - armW;
  const cw = (x1 - x0 - GAP * (o.seats - 1)) / o.seats;
  const parts: Part[] = [
    ...fourLegs(w, l, legH, Math.min(0.06, w / 8), 0.05),
    rbox('frame', [-w / 2, w / 2], [legH, base], [-l / 2, l / 2], 0.02),
    rbox('upholstery', [-w / 2, -w / 2 + armW], [legH, h * 0.68], [-l / 2, l / 2], armW * 0.45),
    rbox('upholstery', [w / 2 - armW, w / 2], [legH, h * 0.68], [-l / 2, l / 2], armW * 0.45),
    rbox('upholstery', [x0, x1], [base, h * 0.9], [-l / 2, -l / 2 + backT * 0.5], 0.04),
  ];
  for (let i = 0; i < o.seats; i++) {
    const a = x0 + i * (cw + GAP);
    parts.push(rbox('upholstery', [a, a + cw], [base, base + cush], [-l / 2 + backT * 0.5, l / 2 - 0.01], 0.05));
    parts.push(rbox('upholstery', [a, a + cw], [base + cush * 0.8, h], [-l / 2 + backT * 0.45, -l / 2 + backT * 0.45 + backT], 0.07));
  }
  return parts;
}

function diningChair(w: number, l: number, h: number): Part[] {
  const seatY = h * 0.54;
  const t = Math.min(0.035, w / 10);
  const dx = w / 2 - 0.03 - t / 2;
  const dz = l / 2 - 0.03 - t / 2;
  const posts = [-1, 1].map((sx) => rbox('leg', [sx * dx - t / 2, sx * dx + t / 2], [0, h], [-dz - t / 2, -dz + t / 2], 0.008));
  const rails = [0.62, 0.74, 0.86].map((f) => rbox('frame', [-dx + t / 2, dx - t / 2], [h * f - 0.02, h * f + 0.02], [-dz - 0.008, -dz + 0.008], 0.005));
  return [
    ...[-1, 1].map((sx) => leg('leg', sx * dx, dz, t, seatY - 0.045, 0.7)),
    ...posts,
    rbox('upholstery', [-w / 2, w / 2], [seatY - 0.045, seatY], [-l / 2, l / 2], 0.02),
    ...rails,
  ];
}

function bed(w: number, l: number, h: number): Part[] {
  const legH = clamp(h * 0.14, 0.04, 0.15);
  const rail = h * 0.4;
  const hb = Math.min(0.09, l / 20);
  const matTop = h * 0.62;
  const pillowTop = matTop + Math.min(0.12, h * 0.1);
  const pw = (w - 0.12) / 2 - 0.03;
  return [
    ...fourLegs(w, l, legH, 0.07, 0.03),
    rbox('frame', [-w / 2, w / 2], [legH, rail], [-l / 2, l / 2], 0.02),
    rbox('fabric', [-w / 2 + 0.03, w / 2 - 0.03], [rail, matTop], [-l / 2 + hb, l / 2 - 0.02], 0.04),
    rbox('upholstery', [-w / 2 + 0.01, w / 2 - 0.01], [matTop - 0.02, matTop + Math.min(0.05, h * 0.05)], [-l / 2 + hb + l * 0.26, l / 2 - 0.005], 0.04),
    rbox('fabric', [-w / 2 + 0.06, -w / 2 + 0.06 + pw], [matTop, pillowTop], [-l / 2 + hb + 0.04, -l / 2 + hb + 0.04 + Math.min(0.5, l * 0.22)], 0.06),
    rbox('fabric', [w / 2 - 0.06 - pw, w / 2 - 0.06], [matTop, pillowTop], [-l / 2 + hb + 0.04, -l / 2 + hb + 0.04 + Math.min(0.5, l * 0.22)], 0.06),
    rbox('frame', [-w / 2, w / 2], [legH, h], [-l / 2, -l / 2 + hb], 0.035),
  ];
}

// ------------------------------------------------------------------ tables, desk

function table(w: number, l: number, h: number, o: { topT: number; legT: number; shelf?: boolean; apron?: boolean }): Part[] {
  const topT = Math.min(o.topT, h / 4);
  const parts: Part[] = [
    rbox('top', [-w / 2, w / 2], [h - topT, h], [-l / 2, l / 2], Math.min(0.012, topT / 2.2)),
    ...fourLegs(w, l, h - topT, o.legT, Math.min(0.05, w / 12, l / 12)),
  ];
  if (o.shelf) {
    const i = 0.07;
    parts.push(rbox('frame', [-w / 2 + i, w / 2 - i], [h * 0.26, h * 0.26 + 0.02], [-l / 2 + i, l / 2 - i], 0.008));
  }
  if (o.apron) {
    const i = Math.min(0.09, w / 10, l / 10);
    parts.push(rbox('frame', [-w / 2 + i, w / 2 - i], [h - topT - 0.07, h - topT], [-l / 2 + i, l / 2 - i], 0.01));
  }
  return parts;
}

function roundSideTable(w: number, l: number, h: number): Part[] {
  const stem = Math.min(0.06, w / 6, l / 6);
  return [
    cyl('top', [-w / 2, w / 2], [h - 0.03, h], [-l / 2, l / 2]),
    { shape: 'taper', role: 'leg', centre: [0, (h - 0.03 + 0.02) / 2, 0], size: [stem, h - 0.05, stem], taper: 0.7 },
    cyl('leg', [-w * 0.3, w * 0.3], [0, 0.02], [-l * 0.3, l * 0.3]),
  ];
}

function desk(w: number, l: number, h: number): Part[] {
  const topT = 0.03;
  const ped = Math.min(0.48, w * 0.36);
  const body = h - topT;
  const parts: Part[] = [
    rbox('top', [-w / 2, w / 2], [h - topT, h], [-l / 2, l / 2], 0.012),
    rbox('frame', [-w / 2 + 0.02, -w / 2 + ped], [0, body], [-l / 2 + 0.02, l / 2 - 0.04], 0.01),
    rbox('frame', [w / 2 - 0.04, w / 2 - 0.02], [0, body], [-l / 2 + 0.04, l / 2 - 0.04], 0.005),
    rbox('frame', [-w / 2 + ped, w / 2 - 0.04], [body * 0.3, body], [-l / 2 + 0.04, -l / 2 + 0.05], 0.004),
  ];
  const rows = 3;
  const rh = (body - 0.04) / rows;
  for (let i = 0; i < rows; i++) {
    const y0 = 0.02 + i * rh;
    parts.push(rbox('accent', [-w / 2 + 0.03, -w / 2 + ped - 0.01], [y0 + 0.005, y0 + rh - 0.005], [l / 2 - 0.04, l / 2 - 0.032], 0.004));
    parts.push(rbox('handle', [-w / 2 + ped / 2 - 0.07, -w / 2 + ped / 2 + 0.07], [y0 + rh - 0.045, y0 + rh - 0.035], [l / 2 - 0.032, l / 2 - 0.012], 0.004));
  }
  return parts;
}

// ------------------------------------------------------------------ storage

/** A carcase with a front of `doors` panels, slim handles, a top slab and a base (feet or plinth). */
function cabinet(w: number, l: number, h: number, o: { baseH: number; doors: number; plinth: boolean; slab: boolean; handleLen: number }): Part[] {
  const baseH = Math.min(o.baseH, h / 4);
  const slab = o.slab ? Math.min(0.025, h / 10) : 0;
  const front = l / 2 - 0.02;
  const parts: Part[] = [];
  if (o.plinth) parts.push(rbox('leg', [-w / 2 + 0.02, w / 2 - 0.02], [0, baseH], [-l / 2 + 0.02, front - 0.02], 0.004));
  else parts.push(...fourLegs(w, l, baseH, Math.min(0.045, w / 10), 0.04));
  parts.push(rbox('frame', [-w / 2, w / 2], [baseH, h - slab], [-l / 2, front], 0.008));
  if (o.slab) parts.push(rbox('top', [-w / 2, w / 2], [h - slab, h], [-l / 2, l / 2], 0.01));
  const dw = (w - 0.02 - GAP * (o.doors - 1)) / o.doors;
  const y0 = baseH + 0.008;
  const y1 = h - slab - 0.008;
  for (let i = 0; i < o.doors; i++) {
    const a = -w / 2 + 0.01 + i * (dw + GAP);
    parts.push(rbox('accent', [a, a + dw], [y0, y1], [front, front + 0.008], 0.004));
    const hx = i % 2 === 0 ? a + dw - 0.04 : a + 0.04; // handles meet in the middle of a pair
    const hy = (y0 + y1) / 2;
    const half = Math.min(o.handleLen, (y1 - y0) / 2 - 0.02) / 2;
    parts.push(rbox('handle', [hx - 0.008, hx + 0.008], [hy - half, hy + half], [front + 0.008, l / 2], 0.005));
  }
  return parts;
}

function bedsideTable(w: number, l: number, h: number): Part[] {
  const legH = clamp(h * 0.18, 0.06, 0.12);
  const slab = 0.025;
  const front = l / 2 - 0.02;
  const parts: Part[] = [
    ...fourLegs(w, l, legH, 0.04, 0.03),
    rbox('frame', [-w / 2, w / 2], [legH, h - slab], [-l / 2, front], 0.008),
    rbox('top', [-w / 2, w / 2], [h - slab, h], [-l / 2, l / 2], 0.01),
  ];
  const rows = 2;
  const rh = (h - slab - legH - 0.02) / rows;
  for (let i = 0; i < rows; i++) {
    const y0 = legH + 0.01 + i * rh;
    parts.push(rbox('accent', [-w / 2 + 0.012, w / 2 - 0.012], [y0, y0 + rh - GAP], [front, front + 0.008], 0.004));
    parts.push(cyl('handle', [-0.015, 0.015], [y0 + rh / 2 - 0.015, y0 + rh / 2 + 0.015], [front + 0.008, l / 2], 'z'));
  }
  return parts;
}

const BOOK_TINTS = ['#8c3b2e', '#2f4f6f', '#d9d2c0', '#556b4a', '#a07a3c', '#3c3c3c', '#7a4f6d', '#c9b27c'];

function shelf(w: number, l: number, h: number): Part[] {
  const t = Math.min(0.03, w / 20);
  const parts: Part[] = [
    box('frame', [-w / 2, -w / 2 + t], [0, h], [-l / 2, l / 2]),
    box('frame', [w / 2 - t, w / 2], [0, h], [-l / 2, l / 2]),
    box('frame', [-w / 2 + t, w / 2 - t], [0, h], [-l / 2, -l / 2 + 0.01]),
  ];
  const boards = 5;
  const gap = (h - t) / boards;
  for (let i = 0; i <= boards; i++) {
    const y = i * gap;
    parts.push(box('frame', [-w / 2 + t, w / 2 - t], [y, y + t], [-l / 2 + 0.01, l / 2]));
  }
  // books on the shelves between the boards: deterministic widths, heights and colours
  for (let row = 0; row < boards; row++) {
    if (row % 2 === 1) continue; // every other shelf is left open
    const y = row * gap + t;
    const room = gap - t - 0.015;
    if (room < 0.08) continue;
    let x = -w / 2 + t + 0.02;
    for (let i = 0; i < 12; i++) {
      const bw = 0.024 + ((row * 7 + i * 5) % 5) * 0.007;
      const bh = Math.min(room, 0.15 + ((row * 3 + i * 7) % 6) * 0.02);
      if (x + bw > w / 2 - t - 0.02) break;
      parts.push(rbox('accent', [x, x + bw], [y, y + bh], [-l / 2 + 0.03, -l / 2 + 0.03 + Math.min(0.24, l * 0.7)], 0.003, BOOK_TINTS[(row * 3 + i) % BOOK_TINTS.length]));
      x += bw + 0.002;
    }
  }
  return parts;
}

type Recipe = (w: number, l: number, h: number) => Part[];

const RECIPES: Record<string, Recipe> = {
  'sofa-3': (w, l, h) => sofa(w, l, h, { seats: w > 1.8 ? 3 : 2, arm: 0.17 }),
  armchair: (w, l, h) => sofa(w, l, h, { seats: 1, arm: 0.14 }),
  'coffee-table': (w, l, h) => table(w, l, h, { topT: 0.04, legT: 0.05, shelf: true }),
  'side-table': roundSideTable,
  'dining-table': (w, l, h) => table(w, l, h, { topT: 0.04, legT: 0.07, apron: true }),
  'dining-chair': diningChair,
  'bed-queen': bed,
  'bedside-table': bedsideTable,
  wardrobe: (w, l, h) => cabinet(w, l, h, { baseH: 0.08, doors: 2, plinth: true, slab: false, handleLen: 0.35 }),
  desk,
  bookshelf: shelf,
  'tv-unit': (w, l, h) => cabinet(w, l, h, { baseH: 0.1, doors: 3, plinth: false, slab: true, handleLen: 0.12 }),
};

/** Parts of a furniture model at the given size. Unknown definitions get a single box. */
export function furnitureParts(definitionId: string, width: number, length: number, height: number): Part[] {
  const recipe = RECIPES[definitionId];
  if (!recipe) return [box('frame', [-width / 2, width / 2], [0, height], [-length / 2, length / 2])];
  return recipe(width, length, height);
}

export const hasFurnitureRecipe = (definitionId: string): boolean => definitionId in RECIPES;

/** Axis-aligned bounds of a part list (local frame). */
export function partsBounds(parts: Part[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p.centre[a] - p.size[a] / 2);
      max[a] = Math.max(max[a], p.centre[a] + p.size[a] / 2);
    }
  }
  return { min, max };
}
