// Procedural 3D models for furniture (D41): a handful of boxes / ellipse-cylinders per type, in the object's local frame
// (x = width axis, y = up from the instance elevation, z = length axis, front = +z, C20). Pure data, no three.js.
// Every recipe fits inside the instance's width × height × length, and the parts together span the full height, so the
// model never pokes out of the footprint the engine validates. Unknown definitions fall back to one plain box.
import type { Vec3 } from './transforms';

/** Part names double as the keys of `finishOverrides` (C13): part name → material id. */
export type PartRole = 'frame' | 'upholstery' | 'top' | 'leg' | 'fabric' | 'accent' | 'glass' | 'door';

export interface Part {
  shape: 'box' | 'cylinder';
  role: PartRole;
  /** Centre in the local frame. */
  centre: Vec3;
  /** Full extents; a cylinder is elliptical in x/z and `size[1]` tall. */
  size: Vec3;
}

/** Default look per part when no finish override applies (Spec §8: roughness 0.4–0.8, metalness 0–0.1). */
export const ROLE_DEFAULTS: Record<PartRole, { colour: string; roughness: number; metalness: number; opacity?: number }> = {
  frame: { colour: '#b98b57', roughness: 0.6, metalness: 0 },
  upholstery: { colour: '#8d949c', roughness: 0.8, metalness: 0 },
  top: { colour: '#c9a679', roughness: 0.5, metalness: 0 },
  leg: { colour: '#5a4636', roughness: 0.6, metalness: 0.05 },
  fabric: { colour: '#e6e2d8', roughness: 0.8, metalness: 0 },
  accent: { colour: '#a67c4e', roughness: 0.55, metalness: 0 },
  glass: { colour: '#bfe3f2', roughness: 0.4, metalness: 0.1, opacity: 0.35 },
  door: { colour: '#d8d2c6', roughness: 0.6, metalness: 0 },
};

type Ext = [number, number]; // [min, max]

/** Box from local min/max extents. */
const box = (role: PartRole, x: Ext, y: Ext, z: Ext): Part => ({
  shape: 'box', role, centre: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2], size: [x[1] - x[0], y[1] - y[0], z[1] - z[0]],
});
const cyl = (role: PartRole, x: Ext, y: Ext, z: Ext): Part => ({ ...box(role, x, y, z), shape: 'cylinder' });

/** Four corner legs of thickness `t` from y = 0 to `top`, inset from the footprint edge by `inset`. */
function legs(w: number, l: number, top: number, t: number, inset = 0): Part[] {
  const out: Part[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x0 = sx < 0 ? -w / 2 + inset : w / 2 - inset - t;
      const z0 = sz < 0 ? -l / 2 + inset : l / 2 - inset - t;
      out.push(box('leg', [x0, x0 + t], [0, top], [z0, z0 + t]));
    }
  }
  return out;
}

function seating(w: number, l: number, h: number, o: { arm: number; back: number; seatTop: number }): Part[] {
  const leg = Math.min(0.1, h * 0.12);
  const armW = Math.min(o.arm, w / 4);
  const backT = Math.min(o.back, l / 2);
  const seatY = h * o.seatTop;
  return [
    ...legs(w, l, leg, Math.min(0.06, w / 6, l / 6)),
    box('frame', [-w / 2, w / 2], [leg, seatY * 0.8], [-l / 2, l / 2]),
    box('upholstery', [-w / 2 + armW, w / 2 - armW], [seatY * 0.8, seatY], [-l / 2 + backT, l / 2]),
    box('upholstery', [-w / 2, w / 2], [seatY * 0.8, h], [-l / 2, -l / 2 + backT]),
    box('upholstery', [-w / 2, -w / 2 + armW], [seatY * 0.8, h * 0.72], [-l / 2 + backT, l / 2]),
    box('upholstery', [w / 2 - armW, w / 2], [seatY * 0.8, h * 0.72], [-l / 2 + backT, l / 2]),
  ];
}

function table(w: number, l: number, h: number, topT: number, legT: number, round = false): Part[] {
  const top = round
    ? cyl('top', [-w / 2, w / 2], [h - topT, h], [-l / 2, l / 2])
    : box('top', [-w / 2, w / 2], [h - topT, h], [-l / 2, l / 2]);
  if (round) {
    const t = Math.min(legT, w / 4, l / 4);
    return [top, cyl('leg', [-t / 2, t / 2], [0, h - topT], [-t / 2, t / 2]), cyl('leg', [-w * 0.25, w * 0.25], [0, 0.02], [-l * 0.25, l * 0.25])];
  }
  const t = Math.min(legT, w / 4, l / 4);
  return [top, ...legs(w, l, h - topT, t, Math.min(0.04, w / 10, l / 10))];
}

/** Cabinet carcase with a recessed plinth and two door panels on the front (+z). */
function cabinet(w: number, l: number, h: number, plinth: number, doors: number): Part[] {
  const face = Math.min(0.012, l / 10);
  const p = Math.min(plinth, h / 4);
  const parts: Part[] = [
    box('leg', [-w / 2 + 0.03, w / 2 - 0.03], [0, p], [-l / 2 + 0.03, l / 2 - 0.03]),
    box('frame', [-w / 2, w / 2], [p, h], [-l / 2, l / 2 - face]),
  ];
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x0 = -w / 2 + i * dw + 0.006;
    parts.push(box('accent', [x0, x0 + dw - 0.012], [p + 0.006, h - 0.006], [l / 2 - face, l / 2]));
  }
  return parts;
}

function shelf(w: number, l: number, h: number): Part[] {
  const t = Math.min(0.03, w / 20);
  const parts: Part[] = [
    box('frame', [-w / 2, -w / 2 + t], [0, h], [-l / 2, l / 2]),
    box('frame', [w / 2 - t, w / 2], [0, h], [-l / 2, l / 2]),
    box('frame', [-w / 2 + t, w / 2 - t], [0, h], [-l / 2, -l / 2 + 0.01]),
  ];
  const boards = 5;
  for (let i = 0; i <= boards; i++) {
    const y = (i / boards) * (h - t);
    parts.push(box('frame', [-w / 2 + t, w / 2 - t], [y, y + t], [-l / 2 + 0.01, l / 2]));
  }
  // A few "books" so it reads as a bookshelf rather than an empty frame.
  for (let i = 1; i < boards; i += 2) {
    const y = (i / boards) * (h - t) + t;
    const gap = ((h - t) / boards - t) * 0.8;
    parts.push(box('accent', [-w / 2 + t + 0.03, -w / 2 + t + 0.03 + (w - 2 * t) * 0.45], [y, y + gap], [-l / 2 + 0.03, l / 2 - 0.04]));
  }
  return parts;
}

function bed(w: number, l: number, h: number): Part[] {
  const legH = Math.min(0.15, h * 0.15);
  const baseTop = Math.min(0.4, h * 0.4);
  const mattressTop = Math.min(baseTop + 0.22, h * 0.7);
  const head = Math.min(0.08, l / 20);
  const pillowTop = mattressTop + 0.1;
  const pw = (w - 0.2) / 2 - 0.04;
  return [
    ...legs(w, l, legH, 0.08),
    box('frame', [-w / 2, w / 2], [legH, baseTop], [-l / 2, l / 2]),
    box('fabric', [-w / 2 + 0.03, w / 2 - 0.03], [baseTop, mattressTop], [-l / 2 + head, l / 2 - 0.02]),
    box('frame', [-w / 2, w / 2], [legH, h], [-l / 2, -l / 2 + head]),
    box('upholstery', [-w / 2 + 0.1, -w / 2 + 0.1 + pw], [mattressTop, pillowTop], [-l / 2 + head + 0.05, -l / 2 + head + 0.45]),
    box('upholstery', [w / 2 - 0.1 - pw, w / 2 - 0.1], [mattressTop, pillowTop], [-l / 2 + head + 0.05, -l / 2 + head + 0.45]),
  ];
}

function diningChair(w: number, l: number, h: number): Part[] {
  const seatY = h * 0.53;
  const t = Math.min(0.035, w / 10);
  return [
    ...legs(w, l, seatY - 0.04, t),
    box('upholstery', [-w / 2, w / 2], [seatY - 0.04, seatY], [-l / 2, l / 2]),
    box('frame', [-w / 2, w / 2], [seatY, h], [-l / 2, -l / 2 + 0.035]),
  ];
}

function desk(w: number, l: number, h: number): Part[] {
  const topT = 0.03;
  const panel = 0.03;
  return [
    box('top', [-w / 2, w / 2], [h - topT, h], [-l / 2, l / 2]),
    box('frame', [-w / 2, -w / 2 + panel], [0, h - topT], [-l / 2, l / 2]),
    box('frame', [w / 2 - panel, w / 2], [0, h - topT], [-l / 2, l / 2]),
    box('accent', [-w / 2 + panel, w / 2 - panel], [h * 0.45, h - topT], [-l / 2, -l / 2 + 0.02]),
  ];
}

type Recipe = (w: number, l: number, h: number) => Part[];

const RECIPES: Record<string, Recipe> = {
  'sofa-3': (w, l, h) => seating(w, l, h, { arm: 0.18, back: Math.min(0.25, l * 0.3), seatTop: 0.52 }),
  armchair: (w, l, h) => seating(w, l, h, { arm: 0.14, back: Math.min(0.22, l * 0.3), seatTop: 0.52 }),
  'coffee-table': (w, l, h) => table(w, l, h, 0.04, 0.05),
  'side-table': (w, l, h) => table(w, l, h, 0.03, 0.05, true),
  'dining-table': (w, l, h) => table(w, l, h, 0.04, 0.08),
  'dining-chair': diningChair,
  'bed-queen': bed,
  'bedside-table': (w, l, h) => cabinet(w, l, h, 0.06, 1),
  wardrobe: (w, l, h) => cabinet(w, l, h, 0.08, 2),
  desk,
  bookshelf: shelf,
  'tv-unit': (w, l, h) => cabinet(w, l, h, 0.1, 3),
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
